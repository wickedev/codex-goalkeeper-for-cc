import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_ROOT = path.join(os.homedir(), ".claude", "codex-goal");
const SESSIONS_DIR = path.join(STATE_ROOT, "sessions");
const CONFIG_PATH = path.join(STATE_ROOT, "config.json");

export const DEFAULT_MAX_ITERATIONS = 8;

export function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { enabled: true, maxIterations: DEFAULT_MAX_ITERATIONS, ...config };
  } catch {
    return { enabled: true, maxIterations: DEFAULT_MAX_ITERATIONS };
  }
}

export function writeConfig(config) {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function sessionPath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId.replace(/[^a-zA-Z0-9-]/g, "_")}.json`);
}

export function readSessionState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

export function writeSessionState(sessionId, state) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(sessionPath(sessionId), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function newSessionState(condition) {
  return {
    condition,
    status: "verifying", // verifying | achieved | stalled
    iterations: 0,
    refinedCriteria: null,
    history: [{ at: new Date().toISOString(), event: "tracking", detail: condition }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function pushHistory(state, event, detail) {
  state.history = [...(state.history ?? []), { at: new Date().toISOString(), event, detail }];
  return state;
}

export function latestSessionState() {
  try {
    const files = fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(SESSIONS_DIR, f));
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files.length ? JSON.parse(fs.readFileSync(files[0], "utf8")) : null;
  } catch {
    return null;
  }
}
