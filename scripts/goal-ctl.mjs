#!/usr/bin/env node
// CLI used by the plugin commands (and by hand) to inspect and toggle the gate.
// Usage:
//   goal-ctl.mjs status
//   goal-ctl.mjs on
//   goal-ctl.mjs off

import process from "node:process";
import { latestSessionState, readConfig, writeConfig } from "./lib/state.mjs";

function main() {
  const [command] = process.argv.slice(2);
  const config = readConfig();

  if (command === "on" || command === "off") {
    writeConfig({ ...config, enabled: command === "on" });
    process.stdout.write(
      command === "on"
        ? "goalkeeper gate enabled. Active built-in /goal conditions will be independently verified by Codex at every stop.\n"
        : "goalkeeper gate disabled. The built-in /goal evaluator still runs; only the Codex verification layer is off.\n"
    );
    return;
  }

  if (command === "status") {
    const lines = [`Gate: ${config.enabled ? "enabled" : "disabled"}`];
    const state = latestSessionState();
    if (state) {
      lines.push(
        `Most recent tracked goal: ${state.condition}`,
        `Verification status: ${state.status}`,
        `Gate iterations: ${state.iterations}/${state.maxIterations ?? config.maxIterations}`
      );
      if (state.refinedCriteria) {
        lines.push(`Refined criteria: ${state.refinedCriteria}`);
      }
      const lastVerdict = [...(state.history ?? [])].reverse().find((h) => h.event === "verdict");
      if (lastVerdict) {
        lines.push(`Last Codex verdict: ${lastVerdict.detail}`);
      }
    } else {
      lines.push("No goal has been tracked yet. Set one with the built-in /goal command.");
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  process.stderr.write(`goal-ctl: unknown command: ${command ?? "(none)"} — expected status, on, or off\n`);
  process.exit(1);
}

main();
