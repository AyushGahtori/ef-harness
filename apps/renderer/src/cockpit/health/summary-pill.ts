import { healthyCalm, healthyVerbose, joinSummary } from "./format.js";
import { alarmKindOf, type AlarmSignalKind, type HealthSignal } from "./types.js";

const PHRASES: readonly { kind: AlarmSignalKind; phrase: string }[] = [
  { kind: "stuck_no_progress", phrase: "stuck" },
  { kind: "loop_detected", phrase: "looping" },
  { kind: "rate_limited_backoff", phrase: "rate-limited" },
  { kind: "allowance_window_wait", phrase: "waiting on reset" },
  { kind: "escalated_or_retrying", phrase: "escalated" },
];

export class BoardHealthSummaryPill {
  readonly label: string;
  readonly calmLabel: string;
  readonly shown: string;
  readonly healthy: boolean;
  readonly obtrusive: boolean;
  readonly affectedTaskIds: readonly string[];
  readonly workerCount: number;
  readonly flashing = false as const;
  readonly modal = false as const;
  readonly stealsFocus = false as const;
  readonly explainButton = {
    label: "Explain what's happening" as const,
    explicitClickOnly: true as const,
    backgroundNarrator: false as const,
  };

  constructor(input: {
    readonly workerCount: number;
    readonly signals: readonly HealthSignal[];
  }) {
    this.workerCount = input.workerCount;
    const affected = new Set<string>();
    const tasksByKind = new Map<AlarmSignalKind, Set<string>>();
    for (const signal of input.signals) {
      const kind = alarmKindOf(signal.kind);
      if (!signal.alarm || !kind) continue;
      affected.add(signal.taskId);
      const bucket = tasksByKind.get(kind) ?? new Set<string>();
      bucket.add(signal.taskId);
      tasksByKind.set(kind, bucket);
    }
    this.affectedTaskIds = [...affected];
    this.healthy = this.affectedTaskIds.length === 0;
    this.obtrusive = false;
    this.label = this.healthy
      ? healthyVerbose(input.workerCount)
      : joinSummary(
          PHRASES.flatMap((entry) => {
            const count = tasksByKind.get(entry.kind)?.size ?? 0;
            return count > 0 ? [`${count} ${entry.phrase}`] : [];
          }),
        );
    this.calmLabel = this.healthy ? healthyCalm(input.workerCount) : this.label;
    this.shown = this.healthy ? this.calmLabel : this.label;
  }

  filterCards<T extends { readonly taskId: string }>(cards: readonly T[]): readonly T[] {
    if (this.healthy) return cards;
    const allowed = new Set(this.affectedTaskIds);
    return cards.filter((card) => allowed.has(card.taskId));
  }
}
