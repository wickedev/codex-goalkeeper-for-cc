import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function codexAvailable() {
  const result = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0;
}

export function runCodexJudge(cwd, prompt, { timeoutMs, sandbox }) {
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "codex-goal-")),
    "last-message.txt"
  );

  const result = spawnSync(
    "codex",
    [
      "exec",
      "--sandbox",
      sandbox,
      "--skip-git-repo-check",
      "--output-last-message",
      outFile,
      prompt
    ],
    { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "ignore", "pipe"] }
  );

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
