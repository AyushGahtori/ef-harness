import { spawnSync } from "node:child_process";
import { HardCodedPortError, JobAlreadyTerminatedError, LeaseTimeoutError } from "./errors.js";
import type { GlobalResourceLeaseStore, LeaseHolder } from "./resource-lease-store.js";
import type { JobTerminationHandle } from "./service-contracts.js";

export const HARD_CODED_PORT = 3000;
export const PORT_3000_LEASE_KEY = "port:3000";

export const PORT_FALLBACK_PRECEDENCE = [
  { option: 1, action: "recommend_configurability" },
  { option: 2, action: "tier_d_container_network_namespace" },
  { option: 3, action: "exclusive_port_3000_lease" },
] as const;

export interface DockerCli {
  isAvailable(): boolean | Promise<boolean>;
  createNetwork(name: string): Promise<void>;
  removeNetwork(name: string): Promise<void>;
}

export interface PortFallbackRequest {
  readonly projectId: string;
  readonly envId: string;
  readonly flaggedBy?: "task-049" | "task-166";
  readonly job?: JobTerminationHandle;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly leaseTtlMs?: number;
}

export interface ConfigurabilityRecommendation {
  readonly option: 1;
  readonly phase: "phase0_or_brownfield";
  readonly message: string;
}

export interface TierDAllocation {
  readonly tier: "D";
  readonly namespace: string;
  readonly network: string;
  readonly portInsideNamespace: 3000;
}

export interface PortFallbackResolution {
  readonly resolutionId: string;
  readonly precedence: typeof PORT_FALLBACK_PRECEDENCE;
  readonly recommendation: ConfigurabilityRecommendation;
  readonly selectedOption: 2 | 3;
  readonly mode: "tier_d" | "exclusive_port_lease";
  readonly projectId: string;
  readonly envId: string;
  readonly hardCodedPort: 3000;
  readonly flaggedBy?: "task-049" | "task-166";
  readonly tierD?: TierDAllocation;
  readonly lease?: {
    readonly resourceKey: typeof PORT_3000_LEASE_KEY;
    readonly projectId: string;
    readonly envId: string;
    readonly port: 3000;
  };
}

export interface SandboxAccountLease {
  readonly resourceKey: string;
  readonly accountKey: string;
  readonly projectId: string;
  readonly envId: string;
}

const RECOMMENDATION_MESSAGE =
  "Hard-coded localhost:3000 was flagged. Recommended fix: a Phase 0 or brownfield configurability task so the app reads PORT and the environment manifest instead of a literal port. Stateless tasks stay parallel; only environments that still need port 3000 are isolated.";

export function systemDockerCli(): DockerCli {
  return {
    isAvailable() {
      const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
        timeout: 2_000,
        windowsHide: true,
        encoding: "utf8",
      });
      return result.status === 0;
    },
    async createNetwork(name: string) {
      const result = spawnSync("docker", ["network", "create", name], {
        timeout: 10_000,
        windowsHide: true,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || "docker network create failed").trim();
        throw new HardCodedPortError(detail);
      }
    },
    async removeNetwork(name: string) {
      spawnSync("docker", ["network", "rm", name], {
        timeout: 10_000,
        windowsHide: true,
        encoding: "utf8",
      });
    },
  };
}

export class HardCodedPortFallbackManager {
  private readonly store: GlobalResourceLeaseStore;
  private readonly docker: DockerCli;
  private readonly clock: () => number;
  private readonly defaultWaitMs: number;
  private readonly defaultPollMs: number;
  private seq = 0;
  private readonly networksByResolution = new Map<string, { readonly envKey: string; readonly network: string }>();
  private readonly jobUnsubs = new Map<string, () => void>();

  constructor(options: {
    readonly store: GlobalResourceLeaseStore;
    readonly docker: DockerCli;
    readonly clock?: () => number;
    readonly waitMs?: number;
    readonly pollMs?: number;
  }) {
    this.store = options.store;
    this.docker = options.docker;
    this.clock = options.clock ?? Date.now;
    this.defaultWaitMs = options.waitMs ?? 30_000;
    this.defaultPollMs = options.pollMs ?? 20;
  }

  async resolve(input: PortFallbackRequest): Promise<PortFallbackResolution> {
    if (input.job?.terminated === true) throw new JobAlreadyTerminatedError(input.job.jobId);
    const recommendation: ConfigurabilityRecommendation = {
      option: 1,
      phase: "phase0_or_brownfield",
      message: RECOMMENDATION_MESSAGE,
    };
    const dockerAvailable = await this.docker.isAvailable();
    const resolutionId = `pf_${++this.seq}`;
    if (dockerAvailable) {
      const tierD = await this.allocateTierD(input.projectId, input.envId);
      await this.docker.createNetwork(tierD.network);
      this.networksByResolution.set(resolutionId, {
        envKey: envKey(input.projectId, input.envId),
        network: tierD.network,
      });
      return {
        resolutionId,
        precedence: PORT_FALLBACK_PRECEDENCE,
        recommendation,
        selectedOption: 2,
        mode: "tier_d",
        projectId: input.projectId,
        envId: input.envId,
        hardCodedPort: 3000,
        tierD,
        ...(input.flaggedBy ? { flaggedBy: input.flaggedBy } : {}),
      };
    }
    const holder: LeaseHolder = {
      projectId: input.projectId,
      envId: input.envId,
      ...(input.job ? { jobId: input.job.jobId } : {}),
    };
    const ttl = input.leaseTtlMs ?? 15 * 60 * 1000;
    const lease = await this.waitForLease(PORT_3000_LEASE_KEY, holder, {
      waitMs: input.waitMs ?? this.defaultWaitMs,
      pollMs: input.pollMs ?? this.defaultPollMs,
      expiresAtMs: this.clock() + ttl,
    });
    if (input.job) this.watchJob(PORT_3000_LEASE_KEY, holder, input.job);
    return {
      resolutionId,
      precedence: PORT_FALLBACK_PRECEDENCE,
      recommendation,
      selectedOption: 3,
      mode: "exclusive_port_lease",
      projectId: input.projectId,
      envId: input.envId,
      hardCodedPort: 3000,
      lease: {
        resourceKey: PORT_3000_LEASE_KEY,
        projectId: lease.projectId,
        envId: lease.envId,
        port: 3000,
      },
      ...(input.flaggedBy ? { flaggedBy: input.flaggedBy } : {}),
    };
  }

  async withHardCodedPort<T>(input: PortFallbackRequest, fn: (resolution: PortFallbackResolution) => Promise<T>): Promise<T> {
    const resolution = await this.resolve(input);
    try {
      return await fn(resolution);
    } finally {
      await this.finish(resolution);
    }
  }

  async finish(resolution: PortFallbackResolution): Promise<void> {
    if (resolution.mode === "tier_d") {
      const booked = this.networksByResolution.get(resolution.resolutionId);
      this.networksByResolution.delete(resolution.resolutionId);
      if (booked) await this.docker.removeNetwork(booked.network);
      return;
    }
    this.clearJobWatch(PORT_3000_LEASE_KEY, resolution.projectId, resolution.envId);
    this.store.release(PORT_3000_LEASE_KEY, { projectId: resolution.projectId, envId: resolution.envId });
  }

  async acquireExternalSandboxAccount(input: {
    readonly accountKey: string;
    readonly projectId: string;
    readonly envId: string;
    readonly job?: JobTerminationHandle;
    readonly waitMs?: number;
    readonly pollMs?: number;
    readonly leaseTtlMs?: number;
  }): Promise<SandboxAccountLease> {
    if (!input.accountKey.trim()) throw new HardCodedPortError("external sandbox account key is required");
    if (input.job?.terminated === true) throw new JobAlreadyTerminatedError(input.job.jobId);
    const resourceKey = `external-sandbox:${input.accountKey}`;
    const holder: LeaseHolder = {
      projectId: input.projectId,
      envId: input.envId,
      ...(input.job ? { jobId: input.job.jobId } : {}),
    };
    const ttl = input.leaseTtlMs ?? 15 * 60 * 1000;
    await this.waitForLease(resourceKey, holder, {
      waitMs: input.waitMs ?? this.defaultWaitMs,
      pollMs: input.pollMs ?? this.defaultPollMs,
      expiresAtMs: this.clock() + ttl,
    });
    if (input.job) this.watchJob(resourceKey, holder, input.job);
    return { resourceKey, accountKey: input.accountKey, projectId: input.projectId, envId: input.envId };
  }

  releaseExternalSandboxAccount(accountKey: string, holder: { readonly projectId: string; readonly envId: string }): boolean {
    const resourceKey = `external-sandbox:${accountKey}`;
    this.clearJobWatch(resourceKey, holder.projectId, holder.envId);
    return this.store.release(resourceKey, holder);
  }

  async releaseEnvironment(projectId: string, envId: string): Promise<readonly string[]> {
    const key = envKey(projectId, envId);
    const networks = [...this.networksByResolution.entries()].filter((entry) => entry[1].envKey === key);
    for (const [resolutionId, booked] of networks) {
      this.networksByResolution.delete(resolutionId);
      await this.docker.removeNetwork(booked.network);
    }
    for (const watchKey of [...this.jobUnsubs.keys()]) {
      if (watchKey.endsWith(`\u0000${projectId}\u0000${envId}`)) this.clearJobWatchKey(watchKey);
    }
    return this.store.releaseEnvironment(projectId, envId);
  }

  close(): void {
    for (const unsubscribe of this.jobUnsubs.values()) unsubscribe();
    this.jobUnsubs.clear();
    this.store.close();
  }

  private async allocateTierD(projectId: string, envId: string): Promise<TierDAllocation> {
    const project = sanitizeName(projectId);
    const env = sanitizeName(envId);
    return {
      tier: "D",
      namespace: `efh-${project}-${env}`,
      network: `efh-net-${project}-${env}`,
      portInsideNamespace: 3000,
    };
  }

  private async waitForLease(
    resourceKey: string,
    holder: LeaseHolder,
    options: { readonly waitMs: number; readonly pollMs: number; readonly expiresAtMs: number },
  ) {
    const deadline = this.clock() + options.waitMs;
    for (;;) {
      const acquired = this.store.tryAcquire({
        resourceKey,
        holder,
        nowMs: this.clock(),
        expiresAtMs: options.expiresAtMs,
      });
      if (acquired) return acquired;
      if (this.clock() >= deadline) throw new LeaseTimeoutError(resourceKey);
      await delay(options.pollMs);
    }
  }

  private watchJob(resourceKey: string, holder: LeaseHolder, job: JobTerminationHandle): void {
    const key = watchKey(resourceKey, holder.projectId, holder.envId);
    const unsubscribe = job.onTerminate(() => {
      this.jobUnsubs.delete(key);
      this.store.forceRelease(resourceKey, holder);
    });
    this.jobUnsubs.set(key, unsubscribe);
  }

  private clearJobWatch(resourceKey: string, projectId: string, envId: string): void {
    this.clearJobWatchKey(watchKey(resourceKey, projectId, envId));
  }

  private clearJobWatchKey(key: string): void {
    const unsubscribe = this.jobUnsubs.get(key);
    if (!unsubscribe) return;
    this.jobUnsubs.delete(key);
    unsubscribe();
  }
}

function envKey(projectId: string, envId: string): string {
  return `${projectId}\u0000${envId}`;
}

function watchKey(resourceKey: string, projectId: string, envId: string): string {
  return `${resourceKey}\u0000${projectId}\u0000${envId}`;
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "env";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
