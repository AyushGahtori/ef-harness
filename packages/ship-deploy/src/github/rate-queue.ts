import type { GitHubHttpRequest, GitHubHttpResponse, RateLimitPauseEvent } from "./types.js";

export const MIN_MUTATION_SPACING_MS = 1_000;
export const MAX_MUTATIONS_PER_MINUTE = 80;
export const MAX_MUTATIONS_PER_HOUR = 500;

export interface GitHubTransport {
  send(request: GitHubHttpRequest): Promise<GitHubHttpResponse>;
}

export interface GitHubRateAwareQueueOptions {
  readonly accountKey: string;
  readonly transport: GitHubTransport;
  readonly now?: () => number;
  readonly onPause?: (event: RateLimitPauseEvent) => void;
}

function parseRetryAfterMs(headers: Readonly<Record<string, string>>, now: number): number | null {
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1_000;
  }
  const reset = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"];
  if (reset) {
    const epoch = Number(reset) * 1_000;
    if (Number.isFinite(epoch) && epoch > now) return epoch;
  }
  return null;
}

function jitterMs(base: number): number {
  return base + Math.floor(Math.random() * 250);
}

function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export class GitHubRateAwareQueue {
  readonly accountKey: string;
  private readonly transport: GitHubTransport;
  private readonly now: () => number;
  private readonly onPause?: (event: RateLimitPauseEvent) => void;
  private mutationChain: Promise<unknown> = Promise.resolve();
  private lastMutationAt = 0;
  private minuteWindowStart = 0;
  private hourWindowStart = 0;
  private mutationsThisMinute = 0;
  private mutationsThisHour = 0;
  private pausedUntil = 0;

  constructor(options: GitHubRateAwareQueueOptions) {
    this.accountKey = options.accountKey;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    if (options.onPause) this.onPause = options.onPause;
    const t = this.now();
    this.minuteWindowStart = t;
    this.hourWindowStart = t;
  }

  async request(input: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    const mutating = input.mutating ?? isMutatingMethod(input.method);
    if (mutating) {
      const run = this.mutationChain.then(() => this.dispatchMutating(input));
      this.mutationChain = run.catch(() => undefined);
      return run;
    }
    return this.dispatchRead(input);
  }

  private async dispatchRead(input: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    await this.waitIfPaused();
    return this.sendWithBackoff(input);
  }

  private async dispatchMutating(input: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    await this.waitIfPaused();
    await this.enforceSpacingAndCeilings();
    const response = await this.sendWithBackoff({ ...input, mutating: true });
    this.recordMutation();
    return response;
  }

  private async waitIfPaused(): Promise<void> {
    const wait = this.pausedUntil - this.now();
    if (wait > 0) await delay(wait);
  }

  private async enforceSpacingAndCeilings(): Promise<void> {
    while (true) {
      const t = this.now();
      if (t - this.minuteWindowStart >= 60_000) {
        this.minuteWindowStart = t;
        this.mutationsThisMinute = 0;
      }
      if (t - this.hourWindowStart >= 3_600_000) {
        this.hourWindowStart = t;
        this.mutationsThisHour = 0;
      }
      if (this.mutationsThisMinute >= MAX_MUTATIONS_PER_MINUTE) {
        const resume = this.minuteWindowStart + 60_000;
        this.emitPause("secondary", resume, "GitHub rate limit — resuming at minute window reset");
        await delay(resume - t);
        continue;
      }
      if (this.mutationsThisHour >= MAX_MUTATIONS_PER_HOUR) {
        const resume = this.hourWindowStart + 3_600_000;
        this.emitPause("secondary", resume, "GitHub hourly rate limit — resuming at hour window reset");
        await delay(resume - t);
        continue;
      }
      const spacing = this.lastMutationAt + MIN_MUTATION_SPACING_MS - t;
      if (spacing > 0) {
        this.emitPause("spacing", t + spacing, "Serializing GitHub mutations");
        await delay(spacing);
        continue;
      }
      return;
    }
  }

  private recordMutation(): void {
    const t = this.now();
    this.lastMutationAt = t;
    this.mutationsThisMinute += 1;
    this.mutationsThisHour += 1;
  }

  private async sendWithBackoff(input: GitHubHttpRequest, attempt = 0): Promise<GitHubHttpResponse> {
    const response = await this.transport.send(input);
    if (response.status !== 403 && response.status !== 429) return response;
    const resume = parseRetryAfterMs(response.headers, this.now());
    if (resume) {
      const msg = `GitHub rate limit — resuming in ${Math.max(0, Math.ceil((resume - this.now()) / 1_000))}s`;
      this.emitPause("secondary", resume, msg);
      await delay(jitterMs(resume - this.now()));
      return this.sendWithBackoff(input, attempt + 1);
    }
    if (attempt >= 4) return response;
    const backoff = jitterMs(1_000 * 2 ** attempt);
    await delay(backoff);
    return this.sendWithBackoff(input, attempt + 1);
  }

  private emitPause(reason: RateLimitPauseEvent["reason"], resumeAtMs: number, message: string): void {
    this.pausedUntil = Math.max(this.pausedUntil, resumeAtMs);
    this.onPause?.({ reason, resumeAtMs, message });
  }
}

const sharedQueues = new Map<string, GitHubRateAwareQueue>();

export function sharedGitHubQueue(options: GitHubRateAwareQueueOptions): GitHubRateAwareQueue {
  const existing = sharedQueues.get(options.accountKey);
  if (existing) return existing;
  const created = new GitHubRateAwareQueue(options);
  sharedQueues.set(options.accountKey, created);
  return created;
}

export function resetSharedGitHubQueuesForTests(): void {
  sharedQueues.clear();
}