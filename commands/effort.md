---
description: Show or pin the reasoning effort the Codex judge runs at
argument-hint: "none | minimal | low | medium | high | xhigh | max | ultra | default"
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-ctl.mjs" effort $ARGUMENTS
```

Report the output to the user verbatim, then add one line of context:

- With no argument it reports the current effort, where the value comes from, and the valid
  values. Not every model supports every level — `gpt-5.5` stops at `xhigh` while
  `gpt-5.6-sol` reaches `ultra` — so an accepted value can still be refused at run time.
- Higher effort buys a more careful verdict and pays for it in wall-clock: the stop is held
  open for the whole judge run (30–120 s at `medium`, longer above it).
- There is no `auto`. Use `default` to clear the pin and inherit the model's own default via
  `~/.codex/config.toml`.
- `$GOALKEEPER_CODEX_EFFORT` overrides both.

An invalid value is rejected here on purpose — Codex itself accepts anything and lets the
backend decide, so a typo would otherwise go unnoticed. If the command exits non-zero, relay
the error rather than retrying with a different value.
