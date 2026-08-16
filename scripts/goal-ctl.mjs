#!/usr/bin/env node
// CLI used by the plugin commands (and by hand) to inspect and configure the gate.
// Usage:
//   goal-ctl.mjs status
//   goal-ctl.mjs on
//   goal-ctl.mjs off
//   goal-ctl.mjs model  [<model> | default]
//   goal-ctl.mjs effort [<effort> | default]

import process from "node:process";
import { latestSessionState, readConfig, resolveJudge, writeConfig } from "./lib/state.mjs";
import { KNOWN_MODELS, REASONING_EFFORTS } from "./lib/codex.mjs";

// Deliberately excludes "none" (a real reasoning effort) and "auto" (not a Codex
// value at all — it gets an explanatory rejection instead of quietly clearing).
const UNSET = new Set(["default", "reset", "clear", "unset"]);

function describe(setting, label) {
  return setting.value
    ? `${label}: ${setting.value} (from ${setting.source})`
    : `${label}: codex default (unset — inherited from ~/.codex/config.toml)`;
}

// `model` and `effort` share one shape: no argument reports, `default` clears,
// anything else is stored after validation.
function setting({ key, label, argv, validate, choices }) {
  const config = readConfig();
  const raw = argv.join(" ").trim();

  if (!raw) {
    const judge = resolveJudge(config);
    const lines = [describe(judge[key], label)];
    if (judge[key].source.startsWith("$") && config[key]) {
      lines.push(`Note: the environment variable overrides the configured value "${config[key]}".`);
    }
    lines.push("", choices, `default — clear the pin and inherit ~/.codex/config.toml`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  if (UNSET.has(raw.toLowerCase())) {
    const next = { ...config };
    delete next[key];
    writeConfig(next);
    process.stdout.write(
      `${label} cleared. The judge now inherits it from ~/.codex/config.toml, so changing that ` +
        `file changes how goals are judged.\n`
    );
    return 0;
  }

  const problem = validate?.(raw);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    return 1;
  }

  writeConfig({ ...config, [key]: raw });
  const judge = resolveJudge(readConfig());
  const lines = [`${label} set to ${raw}. Every goal verification will use it.`];
  if (judge[key].source.startsWith("$")) {
    lines.push(
      `Warning: ${judge[key].source} is set to "${judge[key].value}" and takes precedence, so ` +
        `this has no effect until that variable is unset.`
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

function validateModel(value) {
  if (value.toLowerCase() !== "auto") {
    return null;
  }
  return (
    `"auto" is not a Codex model. To let the judge inherit whatever ~/.codex/config.toml ` +
    `specifies, clear the pin with /goalkeeper:model default.`
  );
}

function validateEffort(value) {
  if (REASONING_EFFORTS.includes(value.toLowerCase())) {
    return null;
  }
  const lines = [
    `Unknown reasoning effort "${value}". Valid values: ${REASONING_EFFORTS.join(", ")}.`
  ];
  if (value.toLowerCase() === "auto") {
    lines.push(
      `Codex has no "auto" level. To fall back to the model's own default, clear the pin with ` +
        `/goalkeeper:effort default.`
    );
  }
  lines.push(
    `Codex does not validate this value itself — an unknown effort is accepted silently and the ` +
      `backend decides what to do with it — which is why it is rejected here.`
  );
  return lines.join("\n");
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const config = readConfig();

  if (command === "on" || command === "off") {
    writeConfig({ ...config, enabled: command === "on" });
    process.stdout.write(
      command === "on"
        ? "goalkeeper gate enabled. Active built-in /goal conditions will be independently verified by Codex.\n"
        : "goalkeeper gate disabled. The built-in /goal evaluator still runs; only the Codex verification layer is off.\n"
    );
    return 0;
  }

  if (command === "model") {
    return setting({
      key: "model",
      label: "Judge model",
      argv,
      validate: validateModel,
      choices: `Known models: ${KNOWN_MODELS.join(", ")} (any other slug is accepted too)`
    });
  }

  if (command === "effort") {
    return setting({
      key: "effort",
      label: "Judge reasoning effort",
      argv,
      validate: validateEffort,
      choices:
        `Valid efforts: ${REASONING_EFFORTS.join(", ")} — ordered cheapest to most thorough. ` +
        `Support varies by model (gpt-5.5 stops at xhigh, gpt-5.6-sol reaches ultra)`
    });
  }

  if (command === "status") {
    const judge = resolveJudge(config);
    const lines = [
      `Gate: ${config.enabled ? "enabled" : "disabled"}`,
      describe(judge.model, "Judge model"),
      describe(judge.effort, "Judge reasoning effort"),
      judge.sandbox.value
        ? `Judge sandbox: ${judge.sandbox.value} (from ${judge.sandbox.source})`
        : `Judge sandbox: read-only (default)`
    ];
    const state = latestSessionState();
    if (state) {
      lines.push(
        "",
        `Most recent tracked goal: ${state.condition}`,
        `Verification status: ${state.status}`,
        `Gate iterations: ${state.iterations}/${state.maxIterations ?? config.maxIterations}`
      );
      if (state.refinedCriteria) {
        lines.push(`Refined criteria: ${state.refinedCriteria}`);
      }
      if (state.judgeErrors) {
        lines.push(`Consecutive judge failures: ${state.judgeErrors}`);
      }
      const lastVerdict = [...(state.history ?? [])].reverse().find((h) => h.event === "verdict");
      if (lastVerdict) {
        lines.push(`Last Codex verdict: ${lastVerdict.detail}`);
      }
    } else {
      lines.push("", "No goal has been tracked yet. Set one with the built-in /goal command.");
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  process.stderr.write(
    `goal-ctl: unknown command: ${command ?? "(none)"} — expected status, on, off, model, or effort\n`
  );
  return 1;
}

process.exitCode = main();
