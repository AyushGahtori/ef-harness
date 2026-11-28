import type { IntegrationCommit, StopTrigger } from "./types.js";

export interface IntegrationBranch {
  head(): string;
  history(): readonly IntegrationCommit[];
  mergeVerified(commit: IntegrationCommit): void;
}

export class InMemoryIntegration implements IntegrationBranch {
  private readonly commits: IntegrationCommit[];

  constructor(initial: readonly IntegrationCommit[]) {
    const first = initial[0];
    if (!first) throw new Error("integration needs a base commit");
    this.commits = initial.map((commit) => ({ ...commit }));
  }

  head(): string {
    const last = this.commits[this.commits.length - 1];
    if (!last) throw new Error("integration history is empty");
    return last.sha;
  }

  history(): readonly IntegrationCommit[] {
    return this.commits.map((commit) => ({ ...commit }));
  }

  mergeVerified(commit: IntegrationCommit): void {
    this.commits.push({ ...commit });
  }
}

export interface KernelStopPort {
  stop(trigger: StopTrigger): void;
}

export class LocalKernelStop implements KernelStopPort {
  readonly calls: StopTrigger[] = [];

  stop(trigger: StopTrigger): void {
    this.calls.push(trigger);
  }
}
