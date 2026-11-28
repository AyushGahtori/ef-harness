import type { BoardTaskRecord } from "./types.js";
import { BOARD_SWIMLANE_HEIGHT_PX } from "./types.js";
import { mapTaskToBoardLane } from "./map-task-to-board-lane.js";

export interface FeatureSummary {
  readonly key: string;
  readonly label: string;
  readonly total: number;
  readonly done: number;
  readonly working: number;
  readonly blocked: number;
  readonly summary: string;
}

export interface SwimlaneChip {
  readonly kind: "swimlane";
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly collapsed: boolean;
  readonly heightPx: number;
}

export interface SwimlaneCardRef {
  readonly kind: "card";
  readonly task: BoardTaskRecord;
}

export type SwimlaneRow = SwimlaneChip | SwimlaneCardRef;

export class FeatureSwimlaneGrouper {
  summarize(
    tasks: readonly BoardTaskRecord[],
    keyOf: (task: BoardTaskRecord) => string,
    labelOf: (task: BoardTaskRecord) => string,
  ): Map<string, FeatureSummary> {
    const buckets = new Map<string, { label: string; tasks: BoardTaskRecord[] }>();
    for (const task of tasks) {
      const key = keyOf(task);
      const existing = buckets.get(key);
      if (existing) existing.tasks.push(task);
      else buckets.set(key, { label: labelOf(task), tasks: [task] });
    }
    const summaries = new Map<string, FeatureSummary>();
    for (const [key, bucket] of buckets) {
      let done = 0;
      let working = 0;
      let blocked = 0;
      for (const task of bucket.tasks) {
        const lane = mapTaskToBoardLane(task);
        if (lane === "done") done += 1;
        else if (lane === "working") working += 1;
        else if (lane === "waiting_on_you" || lane === "held") blocked += 1;
      }
      const total = bucket.tasks.length;
      summaries.set(key, {
        key,
        label: bucket.label,
        total,
        done,
        working,
        blocked,
        summary: `${done}/${total} done · ${working} working · ${blocked} blocked`,
      });
    }
    return summaries;
  }

  rowsForLane(
    laneTasks: readonly BoardTaskRecord[],
    summaries: ReadonlyMap<string, FeatureSummary>,
    collapsed: ReadonlySet<string>,
    keyOf: (task: BoardTaskRecord) => string,
  ): SwimlaneRow[] {
    const rows: SwimlaneRow[] = [];
    const seen = new Set<string>();
    const order: string[] = [];
    const byKey = new Map<string, BoardTaskRecord[]>();
    for (const task of laneTasks) {
      const key = keyOf(task);
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
        byKey.set(key, []);
      }
      byKey.get(key)?.push(task);
    }
    for (const key of order) {
      const summary = summaries.get(key);
      const group = byKey.get(key) ?? [];
      const isCollapsed = collapsed.has(key);
      rows.push({
        kind: "swimlane",
        key,
        label: summary?.label ?? key,
        summary: summary?.summary ?? `${group.length}/${group.length} done · 0 working · 0 blocked`,
        collapsed: isCollapsed,
        heightPx: BOARD_SWIMLANE_HEIGHT_PX,
      });
      if (!isCollapsed) {
        for (const task of group) rows.push({ kind: "card", task });
      }
    }
    return rows;
  }
}
