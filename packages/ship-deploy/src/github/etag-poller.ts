import type { GitHubHttpResponse, PollRunSnapshot } from "./types.js";
import type { GitHubRateAwareQueue } from "./rate-queue.js";

export interface ConditionalEtagPollerOptions {
  readonly queue: GitHubRateAwareQueue;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface PollTarget {
  readonly path: string;
  readonly etag?: string;
}

export interface PollProgress {
  readonly snapshot: PollRunSnapshot;
  readonly etag: string | null;
  readonly notModified: boolean;
  readonly quotaConsumed: number;
}

export class ConditionalEtagPoller {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private startedAt = 0;
  private paused = false;

  constructor(private readonly options: ConditionalEtagPollerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? delay;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (this.startedAt === 0) this.startedAt = this.now();
  }

  private intervalMs(elapsedMs: number): number {
    if (elapsedMs < 120_000) return 10_000;
    if (elapsedMs < 300_000) return 20_000;
    return 45_000;
  }

  async pollOnce(target: PollTarget): Promise<PollProgress> {
    if (this.startedAt === 0) this.startedAt = this.now();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (target.etag) headers["If-None-Match"] = target.etag;
    const response = await this.options.queue.request({
      method: "GET",
      path: target.path,
      headers,
    });
    if (response.status === 304) {
      return {
        snapshot: parseRuns(response, true),
        etag: target.etag ?? null,
        notModified: true,
        quotaConsumed: 0,
      };
    }
    const etag = response.headers.etag ?? response.headers.ETag ?? null;
    return {
      snapshot: parseRuns(response, false),
      etag,
      notModified: false,
      quotaConsumed: 1,
    };
  }

  async watchUntilDone(
    target: PollTarget,
    onTick?: (progress: PollProgress) => void,
  ): Promise<PollProgress> {
    let etag = target.etag;
    let last: PollProgress | null = null;
    while (!this.paused) {
      const progress = await this.pollOnce({ path: target.path, ...(etag ? { etag } : {}) });
      last = progress;
      etag = progress.etag ?? etag;
      onTick?.(progress);
      if (progress.snapshot.completed && !progress.snapshot.inProgress) return progress;
      const elapsed = this.now() - this.startedAt;
      await this.sleep(this.intervalMs(elapsed));
    }
    if (!last) {
      return this.pollOnce(target);
    }
    return last;
  }
}

function parseRuns(response: GitHubHttpResponse, notModified: boolean): PollRunSnapshot {
  if (notModified || response.status === 304) {
    return { completed: false, failed: false, inProgress: true, runs: [] };
  }
  let parsed: { check_runs?: unknown[]; workflow_runs?: unknown[] } = {};
  try {
    parsed = JSON.parse(response.body) as typeof parsed;
  } catch {
    return { completed: false, failed: false, inProgress: true, runs: [] };
  }
  const raw = parsed.check_runs ?? parsed.workflow_runs ?? [];
  const runs = raw.map((item) => {
    const row = item as { id?: number; status?: string; conclusion?: string | null };
    return {
      id: row.id ?? 0,
      status: row.status ?? "queued",
      conclusion: row.conclusion ?? null,
    };
  });
  const inProgress = runs.some((r) => r.status !== "completed");
  const failed = runs.some((r) => r.status === "completed" && r.conclusion && r.conclusion !== "success");
  const completed = runs.length > 0 && runs.every((r) => r.status === "completed");
  return { completed, failed, inProgress, runs };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}