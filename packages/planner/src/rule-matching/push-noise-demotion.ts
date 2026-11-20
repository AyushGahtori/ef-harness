export interface PushNoiseDiagnostic {
  readonly projectId: string;
  readonly nodeId: string;
  readonly pushedTaskCount: number;
  readonly referencedTaskCount: number;
  readonly correlatedCheckCount: number;
  readonly couldPullCount: number;
  readonly noise: boolean;
  readonly summary: string;
}

interface NodeNoise {
  pushed: Set<string>;
  referenced: Set<string>;
  checks: Set<string>;
  couldPulls: Set<string>;
}

/**
 * SHOULD facts that were pushed and never referenced or tied to a check,
 * compared with COULD pulls of the same node. Meta-Lab (Task 191) prunes from this report.
 */
export class PushNoiseDemotionMetric {
  private readonly nodes = new Map<string, NodeNoise>();

  recordShouldPush(projectId: string, taskId: string, nodeId: string): void {
    this.bucket(projectId, nodeId).pushed.add(taskId);
  }

  recordReference(projectId: string, taskId: string, nodeId: string): void {
    this.bucket(projectId, nodeId).referenced.add(taskId);
  }

  recordCheckCorrelation(projectId: string, taskId: string, nodeId: string, checkId: string): void {
    this.bucket(projectId, nodeId).checks.add(`${taskId}\u0000${checkId}`);
  }

  recordCouldPull(projectId: string, taskId: string, nodeId: string): void {
    this.bucket(projectId, nodeId).couldPulls.add(taskId);
  }

  diagnose(projectId?: string): readonly PushNoiseDiagnostic[] {
    const diagnostics: PushNoiseDiagnostic[] = [];
    for (const [key, bucket] of this.nodes) {
      const splitAt = key.indexOf("\u0000");
      const rowProject = key.slice(0, splitAt);
      const nodeId = key.slice(splitAt + 1);
      if (projectId !== undefined && rowProject !== projectId) continue;
      const noise = bucket.pushed.size > 0 && bucket.referenced.size === 0 && bucket.checks.size === 0;
      const summary = noise
        ? `SHOULD band item ${nodeId} was pushed to ${bucket.pushed.size} tasks and never referenced or correlated with checks; ${bucket.couldPulls.size} COULD pulls recorded for comparison`
        : `SHOULD band item ${nodeId} was referenced or correlated with checks`;
      diagnostics.push({
        projectId: rowProject,
        nodeId,
        pushedTaskCount: bucket.pushed.size,
        referencedTaskCount: bucket.referenced.size,
        correlatedCheckCount: bucket.checks.size,
        couldPullCount: bucket.couldPulls.size,
        noise,
        summary,
      });
    }
    diagnostics.sort((left, right) => {
      const project = left.projectId.localeCompare(right.projectId);
      if (project !== 0) return project;
      return left.nodeId.localeCompare(right.nodeId);
    });
    return diagnostics;
  }

  private bucket(projectId: string, nodeId: string): NodeNoise {
    const key = `${projectId}\u0000${nodeId}`;
    const existing = this.nodes.get(key);
    if (existing) return existing;
    const created: NodeNoise = {
      pushed: new Set(),
      referenced: new Set(),
      checks: new Set(),
      couldPulls: new Set(),
    };
    this.nodes.set(key, created);
    return created;
  }
}
