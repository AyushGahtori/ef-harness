import type { Reversibility } from "./types.js";

/**
 * Local port of Task 073 MustAskPolicyFloor.
 * Costly and irreversible questions cannot set must_ask to false.
 * Swap for the Task 073 export when task/073-stage-depth-autopilot is integrated.
 */
export function violatesMustAskPolicyFloor(question: {
  readonly reversibility: Reversibility;
  readonly must_ask: boolean;
}): boolean {
  return (
    question.must_ask === false &&
    (question.reversibility === "costly" || question.reversibility === "irreversible")
  );
}
