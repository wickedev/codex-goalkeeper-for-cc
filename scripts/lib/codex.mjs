import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Codex accepts these for `model_reasoning_effort`. It does NOT validate the
// value locally — `-c model_reasoning_effort=bogus` runs happily and prints
// "reasoning effort: bogus" — so a typo would silently fall back to whatever the
// backend decides. Validation therefore has to happen here.
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
];

// Suggestions only — the real catalog is served to the Codex CLI and changes
// without us. Unknown models are therefore accepted, not rejected; this list
// exists so `/goalkeeper:model` can show something useful instead of nothing.
// Not every model supports every effort (gpt-5.5 stops at xhigh, gpt-5.6-sol
// goes to ultra), so an effort Codex rejects is a runtime failure, not a
// validation error here.
export const KNOWN_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark"
];

export function codexAvailable() {
  const result = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0;
}

export function runCodexJudge(cwd, prompt, { timeoutMs, sandbox, model, effort }) {
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "goalkeeper-")),
    "last-message.txt"
  );

  // Anything left unset falls through to ~/.codex/config.toml, so an unconfigured
  // gate behaves exactly as before.
  const args = ["exec", "--sandbox", sandbox, "--skip-git-repo-check"];
  if (model) {
    args.push("--model", model);
  }
  if (effort) {
    args.push("-c", `model_reasoning_effort=${effort}`);
  }
  args.push("--output-last-message", outFile, prompt);

  const result = spawnSync("codex", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "ignore", "pipe"]
  });

  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, error: "timeout" };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" ");
    return { ok: false, error: detail || `codex exec exited with status ${result.status}` };
  }

  try {
    const lastMessage = fs.readFileSync(outFile, "utf8").trim();
    if (!lastMessage) {
      return { ok: false, error: "codex returned an empty final message" };
    }
    return { ok: true, lastMessage };
  } catch {
    return { ok: false, error: "codex did not write a final message" };
  }
}
