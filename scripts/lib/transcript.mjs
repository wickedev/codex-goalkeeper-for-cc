import fs from "node:fs";

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

// Scans the session transcript for built-in /goal activity and reduces it to
// the current goal situation:
//   { condition, setAt, userCleared, builtinMet, builtinReason }
// condition is null when no goal was ever set. userCleared / builtinMet apply
// to the most recent goal only.
export function readBuiltinGoal(transcriptPath) {
  const result = {
    condition: null,
    userCleared: false,
    builtinMet: false,
    builtinReason: null
  };

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return result;
  }

  for (const line of raw.split("\n")) {
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
        // A new goal was set; it supersedes everything before it.
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
