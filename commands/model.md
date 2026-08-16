---
description: Show or pin the Codex model that verifies goals
argument-hint: "gpt-5.6-sol | gpt-5.6-terra | gpt-5.6-luna | gpt-5.5 | gpt-5.4 | <slug> | default"
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-ctl.mjs" model $ARGUMENTS
```

Report the output to the user verbatim, then add one line of context:

- With no argument it reports the current judge model, where the value comes from, and the
  known model slugs. That list is a hardcoded convenience — the real catalog is served to the
  Codex CLI and changes without this plugin, so any other slug is accepted as well.
- Pinning a model means goal verdicts stop changing when the user edits `model` in
  `~/.codex/config.toml` for their own interactive Codex work.
- `default` clears the pin and goes back to inheriting that file.
- `$GOALKEEPER_CODEX_MODEL` overrides both.

If the command exits non-zero, relay the error rather than retrying with a different value.
