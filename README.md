# codex-goalkeeper-for-cc

Independent, repo-state verification for Claude Code's built-in `/goal` command, judged by
Codex.

You keep using the built-in `/goal` exactly as before. This plugin adds a Stop-hook gate that
asks Codex — a different vendor's model with real repository access — to verify the goal
against the actual state of the repo before the session is allowed to consider it achieved.
If the goal is too ambiguous to verify, the gate steers: it refines the goal into checkable
acceptance criteria and hands them to Claude as the directive for the next turn.

## Why

The built-in `/goal` evaluator (a small fast model) **cannot call tools**. It judges the
condition purely from the conversation transcript, so it believes whatever Claude surfaced.
Observed in practice — goal: *"a file named marker.txt exists containing exactly the word
DONE"*, with the file deleted from disk:

- **Built-in evaluator**: `met: true` — *"The transcript shows a Write tool call that created
  the file … and the assistant confirmed it."* (never looked at the disk)
- **This gate**: `block` — *"marker.txt does not exist in the current directory. Create it …"*
  (Codex listed the directory itself)

Two other properties fall out of the design:

- **No self-grading**: the model verifying the work is not the model that did the work.
- **Steering**: a goal the judge cannot verify as written gets rewritten into concrete
  criteria (`STEER` verdict) instead of looping forever on an unfalsifiable condition.

## How it works

```
you: /goal all tests in test/auth pass          (built-in command, unchanged)
        │
        ▼
Claude works … tries to stop
        │
        ├── built-in evaluator (Haiku, transcript-only)     ─┐  both run in
        └── goalkeeper gate (this plugin, Stop hook)         ─┘  parallel; any
              │                                                  block ⇒ keep working
              ├─ reads transcript_path → finds the active /goal condition
              │    (goal_status entries written by the built-in command)
              ├─ runs `codex exec --sandbox read-only` with a judge prompt
              └─ verdict:
                   ACHIEVED: <evidence>   → allow stop, mark verified
                   CONTINUE: <what's left>→ block; text becomes Claude's next directive
                   STEER:    <criteria>   → block; goal refined into checkable criteria
```

The gate keeps its own per-session state in `~/.claude/goalkeeper/` (iteration count,
refined criteria, verdict history). It stands down when the user runs `/goal clear` (or any
alias), when Codex confirms the goal, or when the iteration cap is hit.

### Re-arming a refuted goal

Blocking a stop only steers the turn that was interrupted. Once the built-in evaluator
declares a goal met it archives it and stops re-injecting it, so on every *later* user turn
the goal would be invisible to Claude even though this gate still considers it open. A
`UserPromptSubmit` hook closes that gap: while a tracked goal is unverified, each prompt gets
the goal, the refined criteria, and the last `CONTINUE` directive injected as context.

It injects nothing when the goal is `achieved` or `stalled`, when the user cleared it, or
while the built-in command is still carrying the goal itself (no duplicate reminder).

## Install

Requires Claude Code ≥ 2.1.139 (built-in `/goal`), Node.js, and an authenticated
[Codex CLI](https://github.com/openai/codex) (`codex login`).

```
/plugin marketplace add wickedev/codex-goalkeeper-for-cc
/plugin install goalkeeper@codex-goalkeeper-for-cc
```

## Use

```
/goal npm test exits 0 and git status is clean     ← just use the built-in command
```

That's it — the gate activates automatically whenever a built-in goal is active.

| Command              | Effect                                              |
| :------------------- | :-------------------------------------------------- |
| `/goalkeeper:status` | Gate state, tracked goal, iterations, last verdict  |
| `/goalkeeper:off`    | Disable the Codex layer (built-in /goal unaffected) |
| `/goalkeeper:on`     | Re-enable it                                        |

## Configuration

- `~/.claude/goalkeeper/config.json` — `{"enabled": true, "maxIterations": 8}`.
  `maxIterations` caps how many times the gate will send Claude back to work per goal;
  after that the goal is marked `stalled` and stops are allowed again.
- `CODEX_GOAL_SANDBOX` env var — sandbox for the judge (`read-only` default;
  `workspace-write` lets the judge actually run test suites that need to write).

## Failure policy

The gate **fails open**: a missing codex CLI, judge timeout (10 min), or unparseable verdict
logs a note and allows the stop. Only an explicit `CONTINUE`/`STEER` verdict blocks. Your
session can never be trapped by the gate itself; the iteration cap bounds the loop.

## Caveats

- The active goal condition is recovered by parsing the session transcript
  (`goal_status` entries). The transcript format is internal to Claude Code and may change
  between versions — verified against v2.1.195. If parsing breaks, the gate silently stands
  down (fail-open), it does not error your session.
- Both evaluators run in parallel by design. The built-in one may declare the goal met and
  archive it; this gate keeps blocking — and keeps re-injecting the goal on later turns —
  until Codex agrees (or the cap is hit), which is the point.
- Each verification is a real `codex exec` run (typically 30–90 s per stop while a goal is
  active). Cost scales with how many turns the goal takes.
