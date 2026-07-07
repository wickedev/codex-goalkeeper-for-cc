---
description: Disable the Codex verification gate for built-in /goal
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-ctl.mjs" off
```

Confirm to the user: the Codex verification layer is off. The built-in `/goal` evaluator
(transcript-only, no independent verification) still runs as normal.
