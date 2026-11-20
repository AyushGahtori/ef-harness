import { CONTRACT_OWNER_ROLE, COORDINATOR_ROLE } from "./constants.js";
import { HandoffDatabase } from "./database.js";
import { WaitGraphDeadlockError } from "./errors.js";
import type { EscalationTarget, GraphEdge, WaitDecision, WaitGraphDeadlockBreak } from "./types.js";

export function minimalCycle(edges: readonly GraphEdge[], from: string, to: string): string[] | null {
  if (from.length === 0 || to.length === 0) return null;
  if (from === to) return [from, to];
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacent.get(edge.fromNode) ?? [];
    list.push(edge.toNode);
    adjacent.set(edge.fromNode, list);
  }
  for (const list of adjacent.values()) list.sort();
  const previous = new Map<string, string | null>();
  const queue: string[] = [to];
  previous.set(to, null);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    if (node === from) break;
    const nexts = adjacent.get(node) ?? [];
    for (const next of nexts) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  if (!previous.has(from)) return null;
  const backward: string[] = [];
  let walk: string | null = from;
  while (walk !== null) {
    backward.push(walk);
    const parent: string | null | undefined = previous.get(walk);
    walk = parent === undefined ? null : parent;
  }
  backward.reverse();
  return [from, ...backward];
}

export class WaitGraphCycleDetector {
  constructor(
    private readonly db: HandoffDatabase,
    private readonly now: () => number,
    private readonly needsHumanDecision: (from: string, to: string) => boolean = () => false,
  ) {}

  edges(): readonly GraphEdge[] {
    return this.db.listEdges();
  }

  breaks(): readonly WaitGraphDeadlockBreak[] {
    return this.db.listBreaks();
  }

  hasEdge(kind: GraphEdge["kind"], from: string, to: string): boolean {
    return this.db.hasEdge(kind, from, to);
  }

  cycleIfAdded(from: string, to: string): string[] | null {
    return minimalCycle(this.db.listEdges(), from, to);
  }

  addDependsOn(from: string, to: string): void {
    const decision = this.commitEdge("depends_on", from, to);
    if (!decision.accepted && decision.deadlock) throw new WaitGraphDeadlockError(decision.deadlock);
  }

  addWait(from: string, to: string): void {
    const decision = this.commitEdge("waits_on", from, to);
    if (!decision.accepted && decision.deadlock) throw new WaitGraphDeadlockError(decision.deadlock);
  }

  commitWait(from: string, to: string): WaitDecision {
    return this.commitEdge("waits_on", from, to);
  }

  private commitEdge(kind: GraphEdge["kind"], from: string, to: string): WaitDecision {
    return this.db.transaction(() => {
      const cycle = minimalCycle(this.db.listEdges(), from, to);
      if (cycle) {
        const deadlock = this.persistBreak(from, to, cycle);
        return { accepted: false, cycle, deadlock };
      }
      this.db.insertEdge(kind, from, to, this.now());
      return { accepted: true, cycle: null, deadlock: null };
    });
  }

  private persistBreak(from: string, to: string, cycle: readonly string[]): WaitGraphDeadlockBreak {
    const escalatedTo: EscalationTarget = this.needsHumanDecision(from, to) ? "developer" : "coordinator";
    const notifiedRoles =
      escalatedTo === "developer"
        ? [COORDINATOR_ROLE, CONTRACT_OWNER_ROLE, "user-inbox"]
        : [COORDINATOR_ROLE, CONTRACT_OWNER_ROLE];
    const record: WaitGraphDeadlockBreak = {
      breakId: this.db.nextId("BRK-"),
      fromNode: from,
      toNode: to,
      cycle,
      escalatedTo,
      notifiedRoles,
      createdAt: this.now(),
    };
    this.db.insertBreak(record);
    for (const targetRole of notifiedRoles) {
      this.db.insertNotice({
        noticeId: this.db.nextId("NT-"),
        targetRole,
        reason: "wait_graph_deadlock",
        payload: {
          pipeline: "Task 112",
          from,
          to,
          cycle: [...cycle],
          escalatedTo,
          parties: [from, to],
        },
        createdAt: this.now(),
      });
    }
    return record;
  }
}
