![codex-goalkeeper](assets/banner.png)

# codex-goalkeeper-for-cc

Independent, repo-state verification for Claude Code's built-in `/goal` command, judged by
Codex.

> `/goal` asks Haiku whether you're done. Haiku reads the chat. Goalkeeper has Codex read the
> repo.

You keep using the built-in `/goal` exactly as before. This plugin adds a Stop-hook gate that
asks Codex — a full-size model with real repository access — to verify the goal against the
actual state of the repo before the session is allowed to consider it achieved.
If the goal is too ambiguous to verify, the gate steers: it refines the goal into checkable
acceptance criteria and hands them to Claude as the directive for the next turn.

## Why

The built-in `/goal` already knows Claude should not grade its own loop: it hands the exit
decision to a separate evaluator — your configured small fast model, Haiku by default. A
second model is the right instinct. Haiku, as wired, is not enough for it:

- **It cannot look.** The evaluator does not call tools. It judges the condition purely from
  the conversation transcript, so it believes whatever Claude surfaced.
- **It is small.** In a controlled cross-model review experiment (150 planted errors, 900
  review sessions), a lightweight reviewer from a different developer scored no higher than
  the same model re-reviewing its own work in a fresh session
  ([Song 2026](https://arxiv.org/abs/2610.01471)). Being a different model is not what helps;
  being a capable one that looks is.

Observed in practice — goal: *"a file named marker.txt exists containing exactly the word
DONE"*, with the file deleted from disk:

- **Built-in evaluator**: `met: true` — *"The transcript shows a Write tool call that created
  the file … and the assistant confirmed it."* (never looked at the disk)
- **This gate**: `block` — *"marker.txt does not exist in the current directory. Create it …"*
  (Codex listed the directory itself)

Two other properties fall out of the design:

- **A second pair of eyes, not a second opinion of the transcript**: the judge is not the
  model that did the work, and it checks the repository rather than Claude's account of it.
  Different models also tend to catch different errors — cross-model reviewer pairs share
  37–46% of their findings, against 52–62% for same-model sessions (Song 2026). That is
  coverage, not a guarantee: strong models' errors stay correlated even across vendors
  ([Kim et al. 2025](https://arxiv.org/abs/2506.07962)), which is why the gate leans on repo
  evidence rather than on vendor diversity.
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
              ├─ is this a judgement moment?  (see below — if not, pass through)
              ├─ reads transcript_path → finds the active /goal condition
              │    (goal_status entries written by the built-in command)
              ├─ runs `codex exec --sandbox read-only` with a judge prompt
              └─ verdict:
                   ACHIEVED: <evidence>   → emit the clearance token, then stand down
                   CONTINUE: <what's left>→ block; text becomes Claude's next directive
                   STEER:    <criteria>   → block; goal refined into checkable criteria
```

The gate keeps its own per-session state in `~/.claude/goalkeeper/` (iteration count,
refined criteria, verdict history). It stands down when the user runs `/goal clear` (or any
alias), when Codex confirms the goal, when the judge fails repeatedly, or when the iteration
cap is hit.

### Judging order: the clearance token

The two evaluators start together, but the built-in one is roughly an order of magnitude
faster (small model, no tools, ~5 s vs. 30–120 s). Left alone it can declare a goal met and
archive it long before Codex has finished looking at the repository — the exact failure this
plugin exists to prevent.

The built-in evaluator judges *"based on transcript evidence only"*, so the fix is to put the
ordering into the transcript. While a goal is unverified, the `UserPromptSubmit` hook injects
a protocol note stating that the goal is not satisfied until the token `GOALKEEPER-VERIFIED`
appears — and only this plugin's `ACHIEVED` path ever writes that token. The built-in
evaluator therefore cannot reach `met: true` before Codex has confirmed the repository state,
without either evaluator having to know the other exists.

On `ACHIEVED` the gate blocks exactly once, purely to get the token onto the record; the goal
is already marked verified, so that is the last time it blocks. The built-in evaluator sees
the token on the next stop, agrees, and archives the goal on its own.

The user's `/goal` command is untouched — nothing is appended to the condition string.

### Judgement moments

A `Stop` fires whenever a turn ends, which is not the same thing as Claude claiming the goal
is done. The gate passes straight through — no Codex run, no block — when:

- `stop_hook_active` is set: this stop is the tail of a continuation some Stop hook already
  forced. The directive for this turn has been delivered and nothing has been re-verified
  since, so re-judging only stacks blocks.
- `background_tasks` is non-empty: the turn is parked on work that is still running. "The
  fitter is at 97% CPU, I'll check when it finishes" is a progress report, not a completion
  claim.
- the clearance token is already in the transcript.

### Re-arming a refuted goal

Blocking a stop only steers the turn that was interrupted. Once the built-in evaluator
declares a goal met it archives it and stops re-injecting it, so on every *later* user turn
the goal would be invisible to Claude even though this gate still considers it open. A
`UserPromptSubmit` hook closes that gap: while a tracked goal is unverified, each prompt gets
the goal, the refined criteria, and the last `CONTINUE` directive injected as context.

While the built-in command is still carrying the goal itself, the hook injects the protocol
note alone rather than restating the goal twice in the same context. It injects nothing once
the goal is verified, `stalled`, or cleared by the user.

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

| Command                      | Effect                                                     |
| :--------------------------- | :--------------------------------------------------------- |
| `/goalkeeper:status`         | Gate state, judge settings, tracked goal, last verdict     |
| `/goalkeeper:model [<name>]` | Show or pin the model that judges (`default` to unpin)     |
| `/goalkeeper:effort [<lvl>]` | Show or pin its reasoning effort (`default` to unpin)      |
| `/goalkeeper:off`            | Disable the Codex layer (built-in /goal unaffected)        |
| `/goalkeeper:on`             | Re-enable it                                               |

## Configuration

`~/.claude/goalkeeper/config.json`:

| Key             | Default | Meaning                                                          |
| :-------------- | :------ | :--------------------------------------------------------------- |
| `enabled`       | `true`  | Master switch for the Codex layer                                |
| `maxIterations` | `8`     | Real verdicts per goal before it is marked `stalled`             |
| `model`         | unset   | Judge model; unset inherits `~/.codex/config.toml`               |
| `effort`        | unset   | Judge reasoning effort; unset inherits the model's own default   |
| `sandbox`       | unset   | Judge sandbox; unset means `read-only`                           |

Each of the last three is overridden by `$GOALKEEPER_CODEX_MODEL`,
`$GOALKEEPER_CODEX_EFFORT`, and `$GOALKEEPER_CODEX_SANDBOX` respectively.

### Judge model and effort

Left unset, the judge runs on whatever `~/.codex/config.toml` says — which means editing that
file for your own interactive Codex work silently changes how goals are judged. Pinning with
`/goalkeeper:model` and `/goalkeeper:effort` decouples the two.

Valid efforts: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` — cheapest to
most thorough. There is no `auto`; use `default` to clear the pin instead. Values are validated
here because Codex does not validate them itself: `-c model_reasoning_effort=bogus` is accepted,
printed back as `reasoning effort: bogus`, and left for the backend to interpret, so a typo
would otherwise go unnoticed. Support varies by model (`gpt-5.5` stops at `xhigh`, `gpt-5.6-sol`
reaches `ultra`), so a valid level can still be refused at run time. The whole judge run holds
the stop open, so raising effort lengthens every verification.

Both commands print the accepted values when run with no argument, and the model slugs also
appear in the slash-command autocomplete hint. The model list is a hardcoded convenience — the
real catalog is served to the Codex CLI, so unknown slugs are accepted rather than rejected.

`sandbox` is `read-only` by default; `workspace-write` lets the judge actually run test suites
that need to write.

## Failure policy

The gate **fails open**: a missing codex CLI, judge timeout (10 min), or unparseable verdict
logs a note and allows the stop. Only an explicit `CONTINUE`/`STEER` verdict blocks — plus the
single `ACHIEVED` block that records the clearance token. Your session can never be trapped by
the gate itself.

Two independent bounds keep a broken judge from running forever: `maxIterations` caps real
verdicts, and three consecutive judge failures (auth expired, usage limit, timeout, empty
answer) mark the goal `stalled`. Without the second bound a judge that never returns a verdict
never advances the iteration counter, so the cap that is supposed to end the loop never fires.

## Caveats

- The active goal condition is recovered by parsing the session transcript
  (`goal_status` entries). The transcript format is internal to Claude Code and may change
  between versions — verified against v2.1.195. If parsing breaks, the gate silently stands
  down (fail-open), it does not error your session.
- Both evaluators run in parallel by design. The built-in one may still declare the goal met
  and archive it — on the very first stop, before the protocol note has reached the
  transcript, or if the small evaluator model simply disregards the note. That is a
  degradation, not a hole: this gate keeps blocking, and keeps re-injecting the goal on later
  turns, until Codex agrees (or a bound is hit), which is the point.
- Each verification is a real `codex exec` run (typically 30–90 s). It now runs only at
  judgement moments, not on every stop, so cost scales with how many times Claude actually
  claims to be done — not with how many turns the goal takes.
- `background_tasks` in the Stop payload is internal to Claude Code. Set
  `GOALKEEPER_DEBUG_INPUT=/path/to/log` to append the raw payload and check what your version
  sends; an unrecognised shape is read as "no pending work", so the gate degrades to its old
  behaviour rather than going silent.

## License

[MIT](LICENSE)
