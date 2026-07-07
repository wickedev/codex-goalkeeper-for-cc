---
description: Enable the Codex verification gate for built-in /goal
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-ctl.mjs" on
```

Confirm to the user: while a built-in `/goal` is active, every stop will now be independently
verified by Codex against the repository state before the goal is considered achieved.
