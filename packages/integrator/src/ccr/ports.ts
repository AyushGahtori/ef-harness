import { parseCcrV1 } from "./ccr-v1.js";
import { sha256, utcStamp } from "./clock.js";
import type {
  ContractOwner,
  ContractOwnerDirectory,
  CcrV1,
  DiffOp,
  FeatureRuntimeDirectory,
  FeatureState,
  ImpactGraph,
  ImpactedBlast,
  WaitEdge,
} from "./types.js";
import { COORDINATOR_ROLE } from "./types.js";

/**
 * Local ports for sibling tasks that are not on this base.
 * Swap these classes for the published barrels at integration.
 * See `.agent-handoffs/task-112.md`.
 */

export class LocalCcrV1Schema {
  readonly source = "local-port:task-009";

  parse(value: unknown): CcrV1 {
    return parseCcrV1(value);
  }
}

export interface LockDecision {
  readonly allowed: boolean;
  readonly classification: "unlocked" | "additive" | "breaking";
  readonly route: "none" | "ccr" | "revision";
  readonly reason: string;
}

export class LocalSkeletonLock {
  readonly source = "local-port:task-083";

  constructor(private readonly lockedContracts: ReadonlySet<string> = new Set()) {}

  evaluate(contractNodeId: string, ops: readonly DiffOp[]): LockDecision {
    const breaking = ops.some((op) => op.breaking);
    const locked = this.lockedContracts.has(contractNodeId);
    if (!locked) {
      return {
        allowed: !breaking,
        classification: "unlocked",
        route: breaking ? "ccr" : "none",
        reason: breaking ? "Breaking diff is outside the additive fast path." : "Contract is not skeleton-locked.",
      };
    }
    if (!breaking) {
      return {
        allowed: true,
        classification: "additive",
        route: "none",
        reason: "Additive change is allowed on the locked skeleton.",
      };
    }
    return {
      allowed: false,
      classification: "breaking",
      route: "ccr",
      reason: "Breaking mutation of a locked skeleton element must go through CCR review.",
    };
  }
}

export class LocalContradictionCounter {
  readonly source = "local-port:task-081";

  constructor(private readonly counts: ReadonlyMap<string, number> = new Map()) {}

  count(contractNodeId: string): number {
    return this.counts.get(contractNodeId) ?? 0;
  }
}

export class LocalReverseImpactWalker {
  readonly source = "local-port:task-087";

  constructor(private readonly graph: ImpactGraph = { nodes: [], edges: [] }) {}

  walk(startIds: readonly string[]): ImpactedBlast {
    const seen = new Set<string>();
    const queue = [...startIds];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      for (const edge of this.graph.edges) {
        if (edge.to === id) queue.push(edge.from);
      }
    }
    const features: string[] = [];
    const screens: string[] = [];
    const active: string[] = [];
    const merged: string[] = [];
    const checks: string[] = [];
    for (const node of this.graph.nodes) {
      if (!seen.has(node.id)) continue;
      if (node.kind === "feature" && node.featureId) features.push(node.featureId);
      else if (node.kind === "feature") features.push(node.id);
      else if (node.kind === "screen") screens.push(node.id);
      else if (node.kind === "check") checks.push(node.id);
      else if (node.kind === "task") {
        if (node.state === "DONE" || node.state === "MERGED_TO_FEATURE" || node.state === "ACCEPTED") merged.push(node.id);
        else if (node.state === "WORKING" || node.state === "LEASED" || node.state === "CODING") active.push(node.id);
      }
    }
    return {
      affectedFeatures: unique(features),
      affectedScreens: unique(screens),
      affectedActiveTasks: unique(active),
      affectedMergedTasks: unique(merged),
      affectedChecks: unique(checks),
      nodes: [...seen].sort(),
    };
  }
}

export interface WaitDecision {
  readonly accepted: boolean;
  readonly cycle: readonly string[] | null;
}

export interface WaitEdgeStore {
  listEdges(): readonly WaitEdge[];
  insertEdge(edge: WaitEdge): void;
  removeEdgesForCcr(ccrId: string): void;
}

export class LocalWaitGraphCycleDetector {
  readonly source = "local-port:task-109";
  readonly decisions: WaitDecision[] = [];

  constructor(private readonly store: WaitEdgeStore) {}

  cycleIfAdded(fromTaskId: string, toTaskId: string): readonly string[] | null {
    return minimalCycle(this.store.listEdges(), fromTaskId, toTaskId);
  }

  commitWait(fromTaskId: string, toTaskId: string, ccrId: string): WaitDecision {
    const cycle = this.cycleIfAdded(fromTaskId, toTaskId);
    if (cycle) {
      const decision = { accepted: false, cycle };
      this.decisions.push(decision);
      return decision;
    }
    this.store.insertEdge({ fromTaskId, toTaskId, kind: "waits_on", ccrId });
    const decision = { accepted: true, cycle: null };
    this.decisions.push(decision);
    return decision;
  }
}

export function minimalCycle(edges: readonly WaitEdge[], from: string, to: string): string[] | null {
  if (from.length === 0 || to.length === 0) return null;
  if (from === to) return [from, to];
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacent.get(edge.fromTaskId) ?? [];
    list.push(edge.toTaskId);
    adjacent.set(edge.fromTaskId, list);
  }
  for (const list of adjacent.values()) list.sort();
  const previous = new Map<string, string | null>();
  const queue: string[] = [to];
  previous.set(to, null);
  let found = false;
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    if (node === from) {
      found = true;
      break;
    }
    for (const next of adjacent.get(node) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  if (!found && !previous.has(from)) return null;
  const backward: string[] = [];
  let walk: string | null = from;
  while (walk !== null) {
    backward.push(walk);
    const parent = previous.get(walk);
    walk = parent === undefined ? null : parent;
  }
  backward.reverse();
  return [from, ...backward];
}

export interface MailboxWake {
  readonly mailboxId: string;
  readonly taskId: string;
  readonly resolution: Readonly<Record<string, string>>;
}

export class LocalDurableRoleMailbox {
  readonly source = "local-port:task-109";
  readonly wakes: MailboxWake[] = [];
  readonly submitted: { readonly mailboxId: string; readonly targetRole: string; readonly contractId: string }[] = [];
  private next = 1;

  submit(input: {
    readonly targetRole: string;
    readonly targetOwnerTaskId: string;
    readonly contractId: string;
    readonly requestingTaskId: string;
    readonly kind: "ContractClarificationRequest" | "SharedTypeAdditionRequest";
  }): { readonly mailboxId: string } {
    const mailboxId = `MB-${this.next}`;
    this.next += 1;
    this.submitted.push({ mailboxId, targetRole: input.targetRole, contractId: input.contractId });
    return { mailboxId };
  }

  wake(taskIds: readonly string[], resolution: Readonly<Record<string, string>>): readonly string[] {
    const woken: string[] = [];
    for (const taskId of taskIds) {
      this.wakes.push({ mailboxId: `WAKE-${this.wakes.length + 1}`, taskId, resolution });
      woken.push(taskId);
    }
    return woken;
  }
}

export class LocalRevisionAutoStartPolicy {
  readonly source = "local-port:task-108";

  evaluate(breakingContract: boolean): { readonly autoStart: boolean; readonly trigger: "breaking_contract" | null } {
    if (breakingContract) return { autoStart: false, trigger: "breaking_contract" };
    return { autoStart: true, trigger: null };
  }
}

export class LocalMigrationNamer {
  readonly source = "local-port:task-110";

  name(input: { readonly featureId: string; readonly slug: string; readonly sql: string; readonly at: Date }): {
    readonly path: string;
    readonly timestamp: string;
    readonly hash: string;
  } {
    const timestamp = utcStamp(input.at);
    const hash = sha256(`${input.featureId}\n${input.sql}`).slice(0, 6);
    const slug = sanitizeSlug(input.slug);
    return { timestamp, hash, path: `migrations/${timestamp}_${hash}_${slug}.sql` };
  }
}

export interface MergeLanding {
  readonly ccrIds: readonly string[];
  readonly ownerTaskId: string;
  readonly migrationName: string | null;
  readonly contractNodeId: string;
  readonly commitSha: string;
}

export class LocalProjectMergeQueue {
  readonly source = "local-port:task-111";
  readonly landings: MergeLanding[] = [];

  land(input: {
    readonly ccrIds: readonly string[];
    readonly ownerTaskId: string;
    readonly migrationName: string | null;
    readonly contractNodeId: string;
    readonly regressionChecks: readonly string[];
  }): { readonly commitSha: string } {
    const commitSha = sha256(
      JSON.stringify({
        ccrIds: [...input.ccrIds].sort(),
        ownerTaskId: input.ownerTaskId,
        migrationName: input.migrationName,
        contractNodeId: input.contractNodeId,
        checks: [...input.regressionChecks].sort(),
      }),
    ).slice(0, 40);
    this.landings.push({
      ccrIds: input.ccrIds,
      ownerTaskId: input.ownerTaskId,
      migrationName: input.migrationName,
      contractNodeId: input.contractNodeId,
      commitSha,
    });
    return { commitSha };
  }
}

export class LocalSurgicalHolds {
  readonly source = "local-port:task-021";
  readonly rows: { readonly taskId: string; readonly reasonRef: string }[] = [];

  place(taskIds: readonly string[], reasonRef: string): void {
    for (const taskId of taskIds) this.rows.push({ taskId, reasonRef });
  }
}

export class LocalRegressionChecks {
  readonly source = "local-port:task-111-regression";

  constructor(private readonly fail: ReadonlySet<string> = new Set()) {}

  run(checkIds: readonly string[]): { readonly passed: boolean; readonly failed: readonly string[] } {
    const failed = checkIds.filter((id) => this.fail.has(id));
    return { passed: failed.length === 0, failed };
  }
}

export class LocalHybridRevision {
  readonly source = "local-port:task-087-revision";
  readonly opened: { readonly ccrId: string; readonly taskIds: readonly string[] }[] = [];

  open(ccrId: string, taskIds: readonly string[]): { readonly revisionTask: "Task-087" } {
    this.opened.push({ ccrId, taskIds });
    return { revisionTask: "Task-087" };
  }
}

export class MapContractOwners implements ContractOwnerDirectory {
  constructor(private readonly owners: ReadonlyMap<string, ContractOwner>) {}

  get(contractNodeId: string): ContractOwner | null {
    return this.owners.get(contractNodeId) ?? null;
  }
}

export class MapFeatureRuntime implements FeatureRuntimeDirectory {
  constructor(
    private readonly states: ReadonlyMap<string, FeatureState>,
    private readonly running: readonly string[],
  ) {}

  stateOf(featureId: string): FeatureState {
    return this.states.get(featureId) ?? "RUNNING";
  }

  runningFeatures(): readonly string[] {
    return this.running;
  }
}

export function migrationSql(ops: readonly DiffOp[]): string | null {
  const lines: string[] = [];
  for (const op of ops) {
    if ((op.kind === "add_nullable_column" || op.kind === "add_defaulted_column") && op.payload.table && op.payload.column) {
      const type = op.payload.type ?? "TEXT";
      if (op.kind === "add_defaulted_column") {
        const nullSql = op.payload.nullable === "false" ? " NOT NULL" : " NULL";
        lines.push(`ALTER TABLE ${op.payload.table} ADD COLUMN ${op.payload.column} ${type}${nullSql} DEFAULT ${op.payload.default ?? "NULL"};`);
      } else {
        lines.push(`ALTER TABLE ${op.payload.table} ADD COLUMN ${op.payload.column} ${type} NULL;`);
      }
    } else if (op.kind === "add_table" && op.payload.ddl) {
      const ddl = op.payload.ddl.endsWith(";") ? op.payload.ddl : `${op.payload.ddl};`;
      lines.push(ddl);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function sanitizeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug.slice(0, 48) : "ccr";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export const COORDINATOR = COORDINATOR_ROLE;
