---
description: Show the codex-goal gate state and the latest Codex verdict
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-ctl.mjs" status
```

Relay the output to the user. If the verification status is `stalled`, explain that the gate
hit its iteration limit without independently verifying the goal, and that setting a new
built-in `/goal` resets the gate.
