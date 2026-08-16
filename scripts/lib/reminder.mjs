// Builds the text this plugin injects into the transcript. Used in three places
// so the wording stays identical:
//   - the Stop hook's block reason (directive for the next turn)
//   - the UserPromptSubmit hook's additionalContext (survives across turns)
//   - the one-shot announcement that releases a verified goal
//
// The built-in /goal evaluator judges "based on transcript evidence only", so
// everything written here is evidence it will read. That is deliberate: the
// protocol note below is what stops the built-in evaluator from declaring a goal
// met before the independent verifier has looked at the repository.

// The clearance stamp. Only ever written by the ACHIEVED path of the Stop gate.
export const VERIFIED_TOKEN = "GOALKEEPER-VERIFIED";

// A phrase that appears exclusively in the announcement, never in the protocol
// note that merely *describes* the token. Detection needs both so the protocol
// text does not read as its own clearance.
export const VERIFIED_MARK = "Codex verification passed";

// The note that inverts the judging order. Without it the built-in evaluator
// (small model, transcript-only, ~5 s) can declare a goal met long before the
// Codex judge (~30-120 s) has finished looking at the repo. With it, the only
// transcript evidence that satisfies the condition is a stamp this plugin emits,
// and it only emits that stamp after Codex has confirmed the repository state.
export function buildProtocolNote(condition) {
  return [
    `GOALKEEPER PROTOCOL — applies to every stopping-condition judgement in this session.`,
    `The goal below is NOT satisfied until the exact token ${VERIFIED_TOKEN} appears in this ` +
      `transcript. That token is emitted only by an independent verifier that inspects the ` +
      `repository itself. Nothing written or claimed in this conversation substitutes for it: ` +
      `if the token is absent, the condition is unmet no matter how complete the work looks here.`,
    `Goal: ${condition}`
  ].join("\n");
}

export function buildGoalReminder(goal, { header, includeDirective = true } = {}) {
  const lines = [buildProtocolNote(goal.condition), "", header];

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

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

// The one-shot clearance. Blocking the stop once is what gets this text into the
// transcript as a `Stop hook feedback` message; on the next stop the built-in
// evaluator can finally see the token, agree, and archive the goal on its own.
export function buildVerifiedAnnouncement(condition, evidence) {
  return [
    `${VERIFIED_TOKEN} — ${VERIFIED_MARK}.`,
    `Goal: ${condition}`,
    evidence ? `Verified against repository state: ${evidence}` : null,
    `The independent gate is satisfied and will not block again for this goal. Report the ` +
      `completion to the user and end the turn — do not start new work on the strength of ` +
      `this message.`
  ]
    .filter(Boolean)
    .join("\n");
}
