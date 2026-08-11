// Builds the text that re-arms a goal after the built-in /goal command has
// archived it. Used in two places so the wording stays identical:
//   - the Stop hook's block reason (directive for the next turn)
//   - the UserPromptSubmit hook's additionalContext (survives across turns)

export function buildGoalReminder(goal, { header, includeDirective = true } = {}) {
  const lines = [header, `Active goal (still unverified): ${goal.condition}`];

  if (goal.refinedCriteria) {
    lines.push(`Refined acceptance criteria: ${goal.refinedCriteria}`);
  }
  if (includeDirective && goal.lastDirective) {
    lines.push(`Latest independent verdict — what is still missing: ${goal.lastDirective}`);
  }
  if (Number.isFinite(goal.iterations) && Number.isFinite(goal.maxIterations)) {
    lines.push(`Gate iteration: ${goal.iterations}/${goal.maxIterations}.`);
  }

  const judged = Boolean(goal.lastDirective || goal.refinedCriteria);
  lines.push(
    `This goal stays in force even though the built-in /goal evaluator may have already ` +
      `marked it met and archived it — ` +
      (judged
        ? "it was refuted against actual repository state. "
        : "independent verification against repository state has not confirmed it. ") +
      "Keep working toward it and surface concrete evidence (test output, build results, " +
      "file contents) rather than restating that it is done. Only the user running " +
      "/goal clear retires it."
  );

  return lines.filter(Boolean).join("\n");
}
