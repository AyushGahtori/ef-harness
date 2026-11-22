import { AGING_NUDGE_MS, CALM_BATCH_MS, type PriorityTier } from "./constants.js";
import type { DeliveryAssessment, QuestionCard } from "./types.js";

export function deliveryLane(priority: PriorityTier): DeliveryAssessment["lane"] {
  if (priority === "P0") return "interrupt_now";
  if (priority === "P4") return "digest";
  return "batch";
}

export function assessDelivery(card: QuestionCard, now: number, focusMode: boolean): DeliveryAssessment {
  const waitedMs = Math.max(0, now - card.createdAt);
  const lane = deliveryLane(card.priority);
  const earlyFlush =
    lane === "batch" && (card.blockedWorkerCount >= 2 || card.onCriticalPath || card.priority === "P1");
  const due = lane === "interrupt_now" || (lane === "batch" && (earlyFlush || waitedMs >= CALM_BATCH_MS));
  const agingNudge = card.status === "open" && waitedMs >= AGING_NUDGE_MS;
  const surfaced = focusMode ? card.priority === "P0" : due;
  return {
    questionId: card.questionId,
    priority: card.priority,
    lane,
    due,
    earlyFlush,
    agingNudge,
    waitedMs,
    surfaced,
    sound: false,
    modal: false,
  };
}
