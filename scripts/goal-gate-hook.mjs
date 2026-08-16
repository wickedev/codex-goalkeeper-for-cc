#!/usr/bin/env node
// Stop hook: piggybacks on the BUILT-IN /goal command. When a built-in goal is
// active in this session, this gate asks Codex to verify the goal against the
// actual repository state (the built-in evaluator only reads the transcript).
// The stop is blocked — Claude keeps working — until Codex confirms the goal,
// the user runs /goal clear, or the iteration cap is hit.
//
// It only judges at judgement time. A Stop that is a parked turn (background
// work still running) or a continuation this gate itself caused is not a claim
// of completion, so it costs nothing and passes straight through.
//
// Fails open by design: judge errors, timeouts, or a missing codex CLI never
// trap the session — they log a note and allow the stop.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { codexAvailable, runCodexJudge } from "./lib/codex.mjs";
import {
  newSessionState,
  pushHistory,
  readConfig,
  readSessionState,
  resolveJudge,
  writeSessionState
} from "./lib/state.mjs";
import { readBuiltinGoal } from "./lib/transcript.mjs";
import { buildGoalReminder, buildVerifiedAnnouncement } from "./lib/reminder.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "prompts", "goal-gate.md");
const JUDGE_TIMEOUT_MS = 10 * 60 * 1000;
// Consecutive judge failures tolerated before the gate stands down. Without
// this a judge that is permanently broken (no auth, usage limit) never advances
// the iteration counter, so the cap that is supposed to end the loop never hits.
const JUDGE_ERROR_CAP = 3;

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  // Opt-in capture of the raw Stop payload; the field set is internal to Claude
  // Code, and this is how you check what a given version actually sends.
  const debugPath = process.env.GOALKEEPER_DEBUG_INPUT;
  if (debugPath && raw) {
    try {
      fs.appendFileSync(debugPath, `${raw}\n`);
    } catch {
      // ignore
    }
  }
  return raw ? JSON.parse(raw) : {};
}

function note(message) {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
}

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

// A turn that parks on background work is not claiming the goal is done. Shape
// of the field is version-internal, so anything non-empty counts as pending and
// anything unrecognised counts as none.
function pendingBackgroundWork(input) {
  const tasks = input.background_tasks;
  if (Array.isArray(tasks)) {
    return tasks.length;
  }
  if (tasks && typeof tasks === "object") {
    return Object.keys(tasks).length;
  }
  return 0;
}

function buildPrompt(goal, state, input) {
  const template = fs.readFileSync(PROMPT_PATH, "utf8");
  const lastMessage = String(input.last_assistant_message ?? "").trim();
  const lastMessageBlock = lastMessage
    ? `Claude's last response (claims only — verify independently):\n${lastMessage}`
    : "";
  const criteriaBlock = state.refinedCriteria
    ? `Refined acceptance criteria from an earlier gate iteration:\n${state.refinedCriteria}`
    : "";
  const builtinBlock = goal.builtinMet
    ? `Note: the built-in transcript-only evaluator already judged this goal met, with reason: ${goal.builtinReason ?? "(none)"}. Your job is to confirm or refute that from the repository itself.`
    : "";
  return template
    .replace("{{GOAL}}", goal.condition)
    .replace("{{CRITERIA_BLOCK}}", criteriaBlock)
    .replace("{{BUILTIN_BLOCK}}", builtinBlock)
    .replace("{{ITERATION}}", String(state.iterations + 1))
    .replace("{{MAX_ITERATIONS}}", String(state.maxIterations))
    .replace("{{LAST_MESSAGE_BLOCK}}", lastMessageBlock);
}

function parseVerdict(lastMessage) {
  const firstLine = lastMessage.split(/\r?\n/, 1)[0].trim();
  for (const kind of ["ACHIEVED", "CONTINUE", "STEER"]) {
    if (firstLine.startsWith(`${kind}:`)) {
      return { kind, detail: firstLine.slice(kind.length + 1).trim() || lastMessage };
    }
  }
  return null;
}

function main() {
  const input = readHookInput();
  const config = readConfig();
  if (!config.enabled) {
    return;
  }

  const sessionId = input.session_id;
  const transcriptPath = input.transcript_path;
  if (!sessionId || !transcriptPath) {
    return;
  }

  // This stop is the tail of a continuation some Stop hook already forced. The
  // directive for this turn has been delivered and nothing has been re-verified
  // since, so re-judging here only stacks blocks.
  if (input.stop_hook_active) {
    return;
  }

  const goal = readBuiltinGoal(transcriptPath);
  if (!goal.condition || goal.userCleared || goal.verified) {
    return;
  }

  const pending = pendingBackgroundWork(input);
  if (pending > 0) {
    note(
      `goalkeeper: ${pending} background task(s) still running — parked turn, not a completion ` +
        `claim. Skipping verification.`
    );
    return;
  }

  let state = readSessionState(sessionId);
  if (!state || state.condition !== goal.condition) {
    state = newSessionState(goal.condition);
  }
  state.maxIterations = state.maxIterations ?? config.maxIterations;

  if (state.status === "achieved" || state.status === "stalled") {
    return;
  }

  if (state.iterations >= state.maxIterations) {
    state.status = "stalled";
    writeSessionState(sessionId, pushHistory(state, "stalled", `hit max iterations (${state.maxIterations})`));
    note(
      `goalkeeper: gate hit its iteration limit (${state.maxIterations}) without verifying the goal. ` +
        `Marked stalled — check /goalkeeper:status. Setting a new /goal resets the gate.`
    );
    return;
  }

  if (!codexAvailable()) {
    note("goalkeeper: codex CLI not found; skipping independent goal verification.");
    return;
  }

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const settings = resolveJudge(config);
  const judge = runCodexJudge(cwd, buildPrompt(goal, state, input), {
    timeoutMs: JUDGE_TIMEOUT_MS,
    sandbox: settings.sandbox.value || "read-only",
    model: settings.model.value,
    effort: settings.effort.value
  });

  if (!judge.ok || !parseVerdict(judge.lastMessage)) {
    const reason = judge.ok ? "unparseable verdict" : judge.error;
    state.judgeErrors = (state.judgeErrors ?? 0) + 1;
    pushHistory(state, "judge-error", reason);
    if (state.judgeErrors >= JUDGE_ERROR_CAP) {
      state.status = "stalled";
      writeSessionState(sessionId, pushHistory(state, "stalled", `${state.judgeErrors} consecutive judge failures`));
      note(
        `goalkeeper: judge failed ${state.judgeErrors} times in a row (${reason}). Standing down ` +
          `so the gate stops re-running — check /goalkeeper:status. Setting a new /goal resets it.`
      );
      return;
    }
    writeSessionState(sessionId, state);
    note(
      `goalkeeper: judge failed (${reason}); allowing stop. The gate stays active ` +
        `(${state.judgeErrors}/${JUDGE_ERROR_CAP} before standing down).`
    );
    return;
  }

  const verdict = parseVerdict(judge.lastMessage);
  state.iterations += 1;
  state.judgeErrors = 0;
  pushHistory(state, "verdict", `${verdict.kind}: ${verdict.detail}`);

  if (verdict.kind === "ACHIEVED") {
    state.status = "achieved";
    writeSessionState(sessionId, state);
    note(`goalkeeper: independently verified — ${verdict.detail}`);
    // Block exactly once, to write the clearance token into the transcript. The
    // built-in evaluator judges from transcript evidence only, so without this
    // it would keep refusing a goal the repository already satisfies. The
    // `achieved` status above makes this the last time the gate blocks.
    block(buildVerifiedAnnouncement(goal.condition, verdict.detail));
    return;
  }

  if (verdict.kind === "STEER") {
    state.refinedCriteria = verdict.detail;
    state.status = "refuted";
    writeSessionState(sessionId, state);
    block(
      buildGoalReminder(
        {
          condition: goal.condition,
          refinedCriteria: verdict.detail,
          iterations: state.iterations,
          maxIterations: state.maxIterations
        },
        {
          header:
            `Codex goalkeeper: the goal is too ambiguous to verify as written, so it was ` +
            `refined into checkable criteria. Tell the user it was interpreted this way, ` +
            `then keep working toward it.`,
          includeDirective: false
        }
      )
    );
    return;
  }

  state.status = "refuted";
  writeSessionState(sessionId, state);
  block(
    buildGoalReminder(
      {
        condition: goal.condition,
        refinedCriteria: state.refinedCriteria,
        lastDirective: verdict.detail,
        iterations: state.iterations,
        maxIterations: state.maxIterations
      },
      {
        header:
          `Codex goalkeeper — independent repo-state verification says the goal is NOT achieved yet.`
      }
    )
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`goalkeeper: ${message}\n`);
  process.exitCode = 1;
}
