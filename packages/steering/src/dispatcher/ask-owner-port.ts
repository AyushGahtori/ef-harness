import { AskOwnerResponderEngine, SpecialistStateDb } from "@ef-harness/planner";
import type { AskOwnerResponderEnginePort } from "./ports.js";
import type { Citation, OwnerAnswer } from "./types.js";

/**
 * Route 1 calls the landed `AskOwnerResponderEngine`. LLM synthesis calls are allowed.
 * The read-only fingerprint stays on the dispatcher.
 */
export function landedAskOwner(db: SpecialistStateDb): AskOwnerResponderEnginePort {
  const engine = new AskOwnerResponderEngine({
    db,
    model: null,
    roster: [],
    workerFamily: "steering",
  });
  return {
    async answerQuestion(question: string): Promise<OwnerAnswer> {
      const answer = await engine.answerQuestion(question);
      const citations: Citation[] = answer.citations.map((item) => ({
        kind: item.kind,
        id: item.id,
        label: item.label,
        href: item.href,
      }));
      return {
        text: answer.text,
        citations,
        grounded: answer.grounded,
        guessed: false,
        llmCalls: answer.llmCalls,
      };
    },
  };
}
