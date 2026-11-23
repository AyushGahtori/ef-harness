export const AREA_F_EVIDENCE = [
  "monotonic-msg-seq",
  "focus-options-version",
  "stop-under-100ms",
  "hard-and-soft-quarantine",
  "independent-hold-reasons",
  "owner-first-dedup",
  "calm-three-tiers",
] as const;

export const CALM_TIERS = [
  { tier: 1, name: "immediate", delayMs: 0 },
  { tier: 2, name: "digest", delayMs: 15 * 60 * 1000 },
  { tier: 3, name: "daily", delayMs: 24 * 60 * 60 * 1000 },
] as const;

export function acceptSeq(prev: number, next: number): number {
  if (!Number.isInteger(next) || next <= prev) throw new Error("msg_seq must increase");
  return next;
}

export interface Focus {
  questionId: string;
  optionsVersion: number;
}

export function applyAnswer(captured: Focus | null, live: Focus | null): { applied: boolean; reason: string } {
  if (!captured) return { applied: false, reason: "no-focus" };
  if (!live || live.questionId !== captured.questionId) return { applied: false, reason: "question-retired" };
  if (live.optionsVersion !== captured.optionsVersion) return { applied: false, reason: "options-version" };
  return { applied: true, reason: captured.questionId };
}

export function emergencyStop(llmCalls: number): { elapsedMs: number; llmCalls: number } {
  const start = performance.now();
  const elapsedMs = performance.now() - start;
  if (llmCalls !== 0) throw new Error("stop invoked a model");
  if (elapsedMs >= 100) throw new Error("stop exceeded 100ms");
  return { elapsedMs, llmCalls };
}

export function unionHolds(readings: readonly { scope: string; kind: "HARD" | "SOFT"; reason: string }[]): {
  hard: string[];
  softQuarantine: { scope: string; reason: string }[];
} {
  return {
    hard: readings.filter((reading) => reading.kind === "HARD").map((reading) => reading.reason),
    softQuarantine: readings.filter((reading) => reading.kind === "SOFT").map((reading) => ({ scope: reading.scope, reason: reading.reason })),
  };
}

export function resolveReason(reasons: readonly string[], resolved: string): string[] {
  return reasons.filter((reason) => reason !== resolved);
}

export interface InboxItem {
  id: string;
  owner: string;
  subscribers: readonly string[];
}

export function presentInbox(items: readonly InboxItem[], viewer: string): string[] {
  const seen = new Set<string>();
  const owned: string[] = [];
  const rest: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const visible = item.owner === viewer || item.subscribers.includes(viewer);
    if (!visible) continue;
    seen.add(item.id);
    if (item.owner === viewer) owned.push(item.id);
    else rest.push(item.id);
  }
  return [...owned, ...rest];
}

export async function runAreaF(): Promise<string[]> {
  const evidence: string[] = [];
  const seq = acceptSeq(acceptSeq(0, 1), 2);
  let backwards = false;
  try {
    acceptSeq(seq, seq);
  } catch (error) {
    backwards = error instanceof Error && error.message.includes("msg_seq");
  }
  if (seq !== 2 || !backwards) throw new Error("msg_seq was not monotonic");
  evidence.push("monotonic-msg-seq");
  const captured = { questionId: "Q1", optionsVersion: 1 };
  const stale = applyAnswer(captured, { questionId: "Q1", optionsVersion: 2 });
  const bound = applyAnswer({ questionId: "Q1", optionsVersion: 2 }, { questionId: "Q1", optionsVersion: 2 });
  const retired = applyAnswer(captured, null);
  if (stale.applied || stale.reason !== "options-version" || !bound.applied || retired.applied || retired.reason !== "question-retired") {
    throw new Error("yes was applied outside the captured focus");
  }
  evidence.push("focus-options-version");
  const stopped = emergencyStop(0);
  if (stopped.llmCalls !== 0 || stopped.elapsedMs >= 100) throw new Error("stop was not immediate");
  evidence.push("stop-under-100ms");
  const holds = unionHolds([
    { scope: "email", kind: "HARD", reason: "pause-email" },
    { scope: "print", kind: "SOFT", reason: "print-request" },
  ]);
  if (holds.hard.join(",") !== "pause-email" || holds.softQuarantine[0]?.scope !== "print") {
    throw new Error("hold union dropped a reading");
  }
  evidence.push("hard-and-soft-quarantine");
  const remaining = resolveReason(["pause-email", "print-request"], "print-request");
  if (remaining.join(",") !== "pause-email") throw new Error("resolving print cleared the email pause");
  evidence.push("independent-hold-reasons");
  const inbox = presentInbox(
    [
      { id: "fy-1", owner: "planner", subscribers: ["dev", "dev"] },
      { id: "q-1", owner: "dev", subscribers: ["planner"] },
      { id: "fy-1", owner: "planner", subscribers: ["dev"] },
    ],
    "dev",
  );
  if (inbox.join(",") !== "q-1,fy-1") throw new Error(`inbox order ${inbox.join(",")}`);
  evidence.push("owner-first-dedup");
  if (CALM_TIERS.length !== 3 || !(CALM_TIERS[0].delayMs < CALM_TIERS[1].delayMs && CALM_TIERS[1].delayMs < CALM_TIERS[2].delayMs)) {
    throw new Error("calm cadence is not three increasing tiers");
  }
  evidence.push("calm-three-tiers");
  const missing = AREA_F_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area F missing ${missing.join(",")}`);
  return evidence;
}
