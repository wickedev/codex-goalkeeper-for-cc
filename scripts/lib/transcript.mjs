import fs from "node:fs";

import { VERIFIED_MARK, VERIFIED_TOKEN } from "./reminder.mjs";

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

// Scans the session transcript for built-in /goal activity and reduces it to
// the current goal situation:
//   { condition, userCleared, builtinMet, builtinReason, verified }
// condition is null when no goal was ever set. userCleared / builtinMet /
// verified apply to the most recent goal only.
export function readBuiltinGoal(transcriptPath) {
  const result = {
    condition: null,
    userCleared: false,
    builtinMet: false,
    builtinReason: null,
    verified: false
  };

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return result;
  }

  for (const line of raw.split("\n")) {
    // The clearance stamp is emitted by this plugin, not by /goal, so it is
    // matched before the `goal` fast-path filter below. Both halves are
    // required: the protocol note names the token without granting it.
    if (line.includes(VERIFIED_TOKEN) && line.includes(VERIFIED_MARK)) {
      result.verified = true;
      continue;
    }
    if (!line.includes("goal")) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const attachment = entry?.attachment;
    if (attachment?.type === "goal_status" && typeof attachment.condition === "string") {
      if (attachment.sentinel) {
        // A new goal was set; it supersedes everything before it. The built-in
        // also writes a sentinel when it archives a goal it judged met, so a
        // clearance is only discarded when the condition genuinely changed.
        if (attachment.condition !== result.condition) {
          result.verified = false;
        }
        result.condition = attachment.condition;
        result.userCleared = false;
        result.builtinMet = false;
        result.builtinReason = null;
      } else if (attachment.condition === result.condition) {
        result.builtinMet = Boolean(attachment.met);
        result.builtinReason = attachment.reason ?? null;
      }
      continue;
    }

    const content = entry?.message?.content;
    if (
      entry?.type === "user" &&
      typeof content === "string" &&
      content.includes("<command-name>/goal</command-name>")
    ) {
      const args = content.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
      if (CLEAR_ALIASES.has(args.toLowerCase())) {
        result.userCleared = true;
      }
    }
  }

  return result;
}
