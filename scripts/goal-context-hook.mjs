#!/usr/bin/env node
// UserPromptSubmit hook: re-arms an active-but-unverified goal.
//
// The built-in /goal command stops re-injecting a goal once its transcript-only
// evaluator declares it met. When the Codex gate refutes that verdict, the goal
// is still live for us but invisible to Claude on every later turn. This hook
// puts it back into context until Codex confirms it or the user clears it.
//
// Fails open like the Stop gate: any error just means no injected context.

import fs from "node:fs";
import process from "node:process";

import { readConfig, readSessionState } from "./lib/state.mjs";
import { readBuiltinGoal } from "./lib/transcript.mjs";
import { buildGoalReminder, buildProtocolNote } from "./lib/reminder.mjs";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function emit(additionalContext) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext }
    })}\n`
  );
}

function lastVerdictDetail(state) {
  const verdict = [...(state?.history ?? [])].reverse().find((h) => h.event === "verdict");
  if (!verdict) {
    return null;
  }
  const detail = String(verdict.detail ?? "");
  return detail.startsWith("ACHIEVED:") ? null : detail.replace(/^(CONTINUE|STEER):\s*/, "");
}

function main() {
  const input = readHookInput();
  const config = readConfig();
  if (!config.enabled) {
    return;
  }

  const { session_id: sessionId, transcript_path: transcriptPath } = input;
  if (!sessionId || !transcriptPath) {
    return;
  }

  const goal = readBuiltinGoal(transcriptPath);
  if (!goal.condition || goal.userCleared || goal.verified) {
    return;
  }

  const state = readSessionState(sessionId);
  // Only re-arm goals this gate is actually still tracking. A goal it verified
  // (achieved) or gave up on (stalled) must not keep nagging.
  if (state && state.condition === goal.condition && (state.status === "achieved" || state.status === "stalled")) {
    return;
  }

  const tracking = state && state.condition === goal.condition ? state : null;

  // While the built-in command is still carrying the goal itself there is
  // nothing to restore — but the protocol note still has to be on the record.
  // It is what keeps the built-in evaluator (transcript-only, and roughly an
  // order of magnitude faster than the Codex judge) from declaring the goal met
  // before the repository has actually been inspected. Protocol only here, so
  // the goal is not restated twice in the same context.
  if (!goal.builtinMet && !tracking?.refinedCriteria && !lastVerdictDetail(tracking)) {
    emit(buildProtocolNote(goal.condition));
    return;
  }

  emit(
    buildGoalReminder(
      {
        condition: goal.condition,
        refinedCriteria: tracking?.refinedCriteria ?? null,
        lastDirective: lastVerdictDetail(tracking),
        iterations: tracking?.iterations,
        maxIterations: tracking?.maxIterations ?? config.maxIterations
      },
      { header: "Codex goalkeeper — this goal is still open:" }
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
