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
import { buildGoalReminder } from "./lib/reminder.mjs";

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
  if (!goal.condition || goal.userCleared) {
    return;
  }

  const state = readSessionState(sessionId);
  // Only re-arm goals this gate is actually still tracking. A goal it verified
  // (achieved) or gave up on (stalled) must not keep nagging.
  if (state && state.condition === goal.condition && (state.status === "achieved" || state.status === "stalled")) {
    return;
  }

  // Nothing to restore while the built-in command is still carrying the goal
  // itself: it only goes quiet once it has judged the goal met.
  const tracking = state && state.condition === goal.condition ? state : null;
  if (!goal.builtinMet && !tracking?.refinedCriteria && !lastVerdictDetail(tracking)) {
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
