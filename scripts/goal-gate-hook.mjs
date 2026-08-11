#!/usr/bin/env node
// Stop hook: piggybacks on the BUILT-IN /goal command. When a built-in goal is
// active in this session, this gate asks Codex to verify the goal against the
// actual repository state (the built-in evaluator only reads the transcript).
// The stop is blocked — Claude keeps working — until Codex confirms the goal,
// the user runs /goal clear, or the iteration cap is hit.
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
  writeSessionState
} from "./lib/state.mjs";
import { readBuiltinGoal } from "./lib/transcript.mjs";
import { buildGoalReminder } from "./lib/reminder.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "prompts", "goal-gate.md");
const JUDGE_TIMEOUT_MS = 10 * 60 * 1000;
const SANDBOX = process.env.CODEX_GOAL_SANDBOX || "read-only";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
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

  const goal = readBuiltinGoal(transcriptPath);
  if (!goal.condition || goal.userCleared) {
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
  const judge = runCodexJudge(cwd, buildPrompt(goal, state, input), {
    timeoutMs: JUDGE_TIMEOUT_MS,
    sandbox: SANDBOX
  });

  if (!judge.ok) {
    writeSessionState(sessionId, pushHistory(state, "judge-error", judge.error));
    note(`goalkeeper: judge failed (${judge.error}); allowing stop. The gate stays active.`);
    return;
  }

  const verdict = parseVerdict(judge.lastMessage);
  if (!verdict) {
    writeSessionState(sessionId, pushHistory(state, "judge-error", "unparseable verdict"));
    note("goalkeeper: judge returned an unexpected answer; allowing stop. The gate stays active.");
    return;
  }

  state.iterations += 1;
  pushHistory(state, "verdict", `${verdict.kind}: ${verdict.detail}`);

  if (verdict.kind === "ACHIEVED") {
    state.status = "achieved";
    writeSessionState(sessionId, state);
    note(`goalkeeper: independently verified — ${verdict.detail}`);
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
