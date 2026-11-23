import {
  ACTIVE_OVERLAP_TASK_STATES,
  type ActiveTaskSnapshot,
  type CodemodRunResult,
  type SweepGrantRecord,
  type SweepIntentRecord,
} from "../../src/sweeps/index.js";
import { globToPathPrefix } from "../../src/sweeps/path-prefix.js";
import type {
  CodemodBackendPort,
  RefLeaseAndCasManagerPort,
  SandboxedRunnerPort,
  SweepLeasePort,
  SweepOrchestratorPorts,
  TaskRuntimePort,
  WorktreeSlotPoolPort,
} from "../../src/sweeps/ports.js";

type LeaseRow = {
  holder: string;
  mode: "intent" | "granted";
  prefixes: string[];
  createdAt: number;
};

type TaskRow = {
  scopes: string[];
  state: string;
};

export class InMemorySweepLeasePort implements SweepLeasePort {
  private readonly leases = new Map<string, LeaseRow>();
  private readonly tasks?: InMemoryTaskRuntimePort;

  constructor(tasks?: InMemoryTaskRuntimePort) {
    this.tasks = tasks;
  }

  openSweepIntent(input: {
    leaseId: string;
    sweepTask: string;
    globs: readonly string[];
    now: number;
  }): SweepIntentRecord {
    const prefixes = input.globs.map((g) => globToPathPrefix(g));
    this.leases.set(input.leaseId, {
      holder: input.sweepTask,
      mode: "intent",
      prefixes,
      createdAt: input.now,
    });
    return { leaseId: input.leaseId, mode: "intent", prefixes };
  }

  grantSweepLease(leaseId: string): SweepGrantRecord {
    const row = this.leases.get(leaseId);
    if (!row) return { granted: false, mode: "intent", blockedBy: null };
    const blocker = this.findBlockingLease(leaseId);
    if (blocker) {
      return { granted: false, mode: "intent", blockedBy: blocker };
    }
    if (this.hasOverlappingActiveTasks(row.prefixes, row.holder)) {
      return { granted: false, mode: "intent", blockedBy: null };
    }
    row.mode = "granted";
    return { granted: true, mode: "granted", blockedBy: null };
  }

  releaseSweepLease(leaseId: string): { released: boolean } {
    return { released: this.leases.delete(leaseId) };
  }

  listActiveRepoWideLeases(): readonly string[] {
    return [...this.leases.entries()]
      .filter(([, row]) => row.prefixes.includes(""))
      .map(([id]) => id);
  }

  snapshot(): ReadonlyMap<string, LeaseRow> {
    return this.leases;
  }

  private hasOverlappingActiveTasks(prefixes: string[], sweepTask: string): boolean {
    if (!this.tasks) return false;
    return this.tasks.listActiveTasks().some((task) => {
      if (task.taskId === sweepTask) return false;
      if (!ACTIVE_OVERLAP_TASK_STATES.includes(task.state as (typeof ACTIVE_OVERLAP_TASK_STATES)[number])) {
        return false;
      }
      return task.pathPrefixes.some((prefix) => overlapsOne(prefix, prefixes));
    });
  }

  private findBlockingLease(leaseId: string): string | null {
    const self = this.leases.get(leaseId);
    if (!self) return null;
    const blockers = [...this.leases.entries()]
      .filter(
        ([id, row]) =>
          id !== leaseId &&
          overlapsAny(self.prefixes, row.prefixes) &&
          (row.createdAt < self.createdAt || (row.createdAt === self.createdAt && id < leaseId)),
      )
      .sort(([ida, a], [idb, b]) => a.createdAt - b.createdAt || ida.localeCompare(idb));
    return blockers[0]?.[0] ?? null;
  }
}

function overlapsAny(a: readonly string[], b: readonly string[]): boolean {
  return a.some((left) => b.some((right) => overlaps(left, right)));
}

function overlapsOne(prefix: string, prefixes: readonly string[]): boolean {
  return prefixes.some((lease) => overlaps(prefix, lease));
}

export class InMemoryTaskRuntimePort implements TaskRuntimePort {
  private readonly tasks = new Map<string, TaskRow>();

  setTask(taskId: string, scopes: string[], state: string): void {
    this.tasks.set(taskId, { scopes, state });
  }

  parkTask(taskId: string): void {
    const row = this.tasks.get(taskId);
    if (row) row.state = "PARKED";
  }

  listActiveTasks(): readonly ActiveTaskSnapshot[] {
    return [...this.tasks.entries()].map(([taskId, row]) => ({
      taskId,
      pathPrefixes: row.scopes,
      state: row.state,
    }));
  }

  async requestDrain(taskId: string): Promise<void> {
    const row = this.tasks.get(taskId);
    if (!row) return;
    if (ACTIVE_OVERLAP_TASK_STATES.includes(row.state as (typeof ACTIVE_OVERLAP_TASK_STATES)[number])) {
      row.state = "PARKED";
    }
  }
}

export class RecordingWorktreePort implements WorktreeSlotPoolPort {
  readonly branches: string[] = [];
  readonly discarded: string[] = [];

  async ensureSweepBranch(input: { slug: string; integrationHead: string }) {
    const branch = `harness/s/${input.slug}`;
    this.branches.push(branch);
    return { branch, worktreePath: `/tmp/sweep/${input.slug}` };
  }

  async discardSweepBranch(slug: string): Promise<void> {
    this.discarded.push(slug);
  }
}

export function createOrchestratorPorts(overrides?: Partial<SweepOrchestratorPorts>): SweepOrchestratorPorts {
  const tasks = overrides?.tasks ?? new InMemoryTaskRuntimePort();
  const leases = overrides?.leases ?? new InMemorySweepLeasePort(tasks);
  const worktrees = overrides?.worktrees ?? new RecordingWorktreePort();
  const refs: RefLeaseAndCasManagerPort = overrides?.refs ?? {
    casUpdateRef: async () => ({ updated: true }),
  };
  const sandbox: SandboxedRunnerPort =
    overrides?.sandbox ??
    ({
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    } satisfies SandboxedRunnerPort);
  const codemods: CodemodBackendPort =
    overrides?.codemods ??
    ({
      runTsMorphRename: async () => ({
        ok: true,
        preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0, samplePaths: [] },
        applied: true,
      }),
      runAstGrepRule: async () => ({
        ok: true,
        preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0, samplePaths: [] },
        applied: true,
      }),
    } satisfies CodemodBackendPort);
  return {
    leases,
    tasks,
    worktrees,
    refs,
    sandbox,
    codemods,
    safety: overrides?.safety,
  };
}

export function overlaps(prefixA: string, prefixB: string): boolean {
  return prefixA === "" || prefixB === "" || prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA);
}

export type { CodemodRunResult };