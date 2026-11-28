import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { ConformanceError } from "./errors.js";
import { cacheKeyId } from "./types.js";
import type {
  AdapterMode,
  ConformanceCacheKey,
  ConformanceReport,
  SandboxTierId,
  TrustLevel,
} from "./types.js";

export interface AdapterConformanceRecord {
  readonly adapterId: string;
  readonly cliVersion: string;
  readonly osSandboxTier: SandboxTierId;
  readonly mode: AdapterMode;
  readonly suiteVersion: string;
  readonly trust: TrustLevel;
  readonly payload: string;
  readonly signature: string;
  readonly report: ConformanceReport;
}

/**
 * Local port of Task 014 `GlobalDbRepo` table `global.db.adapter_conformance`.
 * Rows are keyed by `(adapterId, cliVersion, osSandboxTier, mode, suiteVersion)`.
 * Swap for the real global database at integration. Do not keep this map.
 */
export interface GlobalDbConformancePort {
  upsert(record: AdapterConformanceRecord): void;
  activate(key: ConformanceCacheKey, mode: AdapterMode): void;
  findActive(key: ConformanceCacheKey): AdapterConformanceRecord | null;
  rewriteSignature(key: ConformanceCacheKey, signature: string): void;
}

export class InMemoryAdapterConformanceDb implements GlobalDbConformancePort {
  private readonly rows = new Map<string, AdapterConformanceRecord>();
  private readonly active = new Map<string, string>();

  upsert(record: AdapterConformanceRecord): void {
    this.rows.set(this.rowId(record), record);
  }

  activate(key: ConformanceCacheKey, mode: AdapterMode): void {
    this.active.set(cacheKeyId(key), this.modeId(key, mode));
  }

  findActive(key: ConformanceCacheKey): AdapterConformanceRecord | null {
    const id = this.active.get(cacheKeyId(key));
    if (!id) return null;
    return this.rows.get(id) ?? null;
  }

  rewriteSignature(key: ConformanceCacheKey, signature: string): void {
    const current = this.findActive(key);
    if (!current) return;
    this.rows.set(this.rowId(current), { ...current, signature });
  }

  history(): readonly AdapterConformanceRecord[] {
    return [...this.rows.values()];
  }

  private modeId(key: ConformanceCacheKey, mode: AdapterMode): string {
    return `${cacheKeyId(key)}\u001f${mode}`;
  }

  private rowId(record: AdapterConformanceRecord): string {
    return this.modeId(
      {
        adapterId: record.adapterId,
        cliVersion: record.cliVersion,
        sandboxTier: record.osSandboxTier,
        harnessConformanceSuiteVersion: record.suiteVersion,
      },
      record.mode,
    );
  }
}

/**
 * Local port of Task 135 signed policy. The MAC key is a suite constant, not a
 * user secret. Replace `sign` / `verify` with the real policy signer.
 */
export interface VerdictSignerPort {
  sign(payload: string): string;
  verify(payload: string, signature: string): boolean;
}

const LOCAL_VERDICT_MAC = "conformance-suite-local-port-mac";

export class LocalVerdictSigner implements VerdictSignerPort {
  sign(payload: string): string {
    return createHmac("sha256", LOCAL_VERDICT_MAC).update(payload).digest("hex");
  }

  verify(payload: string, signature: string): boolean {
    const expected = this.sign(payload);
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}

export interface CodingDispatch {
  readonly adapterId: string;
  readonly mode: AdapterMode;
  readonly trust: TrustLevel;
}

/**
 * Local port of Task 142 `AdapterRegistry`.
 * Only `conformance_verified` adapters can take a coding task.
 */
export interface AdapterRegistryPort {
  setTrust(adapterId: string, trust: TrustLevel, reason: string, mode: AdapterMode): void;
  trustOf(adapterId: string): TrustLevel | null;
  assignCodingTask(adapterId: string): CodingDispatch;
}

interface RegistryEntry {
  readonly trust: TrustLevel;
  readonly reason: string;
  readonly mode: AdapterMode;
}

export class InMemoryAdapterRegistry implements AdapterRegistryPort {
  private readonly entries = new Map<string, RegistryEntry>();

  setTrust(adapterId: string, trust: TrustLevel, reason: string, mode: AdapterMode): void {
    this.entries.set(adapterId, { trust, reason, mode });
  }

  trustOf(adapterId: string): TrustLevel | null {
    return this.entries.get(adapterId)?.trust ?? null;
  }

  reasonOf(adapterId: string): string | null {
    return this.entries.get(adapterId)?.reason ?? null;
  }

  assignCodingTask(adapterId: string): CodingDispatch {
    const entry = this.entries.get(adapterId);
    if (!entry || entry.trust !== "conformance_verified") {
      throw new ConformanceError(
        "adapter_not_dispatchable",
        `${adapterId} is ${entry?.trust ?? "unregistered"} and cannot receive coding tasks`,
      );
    }
    return { adapterId, mode: entry.mode, trust: entry.trust };
  }
}

export interface NativeResumeAttempt {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface ResumeOutcome {
  readonly ok: boolean;
  readonly path: "native" | "fresh_session_labeled_wip" | "failed";
  readonly nativeResumeSupported: boolean;
  readonly sessionId: string;
  readonly label: string | null;
}

export interface ResumeRequest {
  readonly adapterId: string;
  readonly nativeSessionId: string;
  readonly checkpointRef: string;
  readonly wipSummary: string;
  readonly nativeResume: () => Promise<NativeResumeAttempt>;
  readonly fallbackFails: boolean;
}

/**
 * Local port of Task 150 `ForeignRuntimeResumeCoordinator`.
 * Native resume is tried first. Failure rebuilds a fresh session that carries
 * the labeled WIP marker `[PRIOR UNVERIFIED WIP]`.
 */
export interface ForeignRuntimeResumeCoordinatorPort {
  resumeOrRebuild(request: ResumeRequest): Promise<ResumeOutcome>;
}

export class LocalForeignRuntimeResumeCoordinator implements ForeignRuntimeResumeCoordinatorPort {
  async resumeOrRebuild(request: ResumeRequest): Promise<ResumeOutcome> {
    const native = await request.nativeResume();
    if (native.ok) {
      return {
        ok: true,
        path: "native",
        nativeResumeSupported: true,
        sessionId: request.nativeSessionId,
        label: null,
      };
    }
    if (request.fallbackFails) {
      return {
        ok: false,
        path: "failed",
        nativeResumeSupported: false,
        sessionId: "",
        label: null,
      };
    }
    return {
      ok: true,
      path: "fresh_session_labeled_wip",
      nativeResumeSupported: false,
      sessionId: `fresh-${request.checkpointRef.slice(0, 12)}`,
      label: "[PRIOR UNVERIFIED WIP]",
    };
  }
}

export interface VersionGateDecision {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Local port of Task 135 `CliMinVersionGate`.
 * Semver below 1.0.0 is rejected. A 7+ hex build id is accepted.
 * Real per-adapter pins replace this floor at integration.
 */
export interface CliMinVersionGatePort {
  allow(adapterId: string, version: string): VersionGateDecision;
}

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  allow(adapterId: string, version: string): VersionGateDecision {
    void adapterId;
    const trimmed = version.trim();
    if (/^[0-9a-f]{7,64}$/i.test(trimmed)) {
      return { ok: true, reason: "build id accepted" };
    }
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(trimmed);
    if (!match) return { ok: false, reason: "version is not semver or a build id" };
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (major < 1) return { ok: false, reason: "below minimum 1.0.0" };
    if (!Number.isInteger(minor) || !Number.isInteger(patch)) {
      return { ok: false, reason: "version is not semver or a build id" };
    }
    return { ok: true, reason: "meets minimum 1.0.0" };
  }
}

export interface SandboxTierSelection {
  readonly tier: SandboxTierId;
  readonly reason: string;
}

/** Local port of Task 045 `SandboxTierSelector`. */
export interface SandboxTierSelectorPort {
  select(requested: SandboxTierId): SandboxTierSelection;
}

export class RequestedSandboxTierSelector implements SandboxTierSelectorPort {
  select(requested: SandboxTierId): SandboxTierSelection {
    return { tier: requested, reason: "requested sandbox tier" };
  }
}

export interface ProxyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface TrapEndpoint {
  readonly port: number;
  readonly exfilUrl: string;
  hits(): number;
  resetHits(): void;
  close(): Promise<void>;
}

/**
 * Local port of Task 046 `LoopbackAllowlistProxy`.
 * Non-provider hosts, including the loopback trap, are denied and never forwarded.
 */
export interface LoopbackAllowlistProxyPort {
  decide(url: string): ProxyDecision;
  openTrap(): Promise<TrapEndpoint>;
}

const PROVIDER_ALLOWLIST = ["api.provider.invalid"];

export class LocalLoopbackAllowlistProxy implements LoopbackAllowlistProxyPort {
  decide(url: string): ProxyDecision {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { allowed: false, reason: "proxy rejected an unparseable URL" };
    }
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      return { allowed: false, reason: "loopback is not a provider destination" };
    }
    if (PROVIDER_ALLOWLIST.includes(hostname)) {
      return { allowed: true, reason: "provider allowlist" };
    }
    return { allowed: false, reason: "host is not on the provider allowlist" };
  }

  openTrap(): Promise<TrapEndpoint> {
    const hits = { count: 0 };
    const server = http.createServer((_request, response) => {
      hits.count += 1;
      response.writeHead(204);
      response.end();
    });
    return new Promise((resolve, reject) => {
      const fail = (error: Error): void => {
        server.close(() => {
          reject(error);
        });
      };
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail);
        const address = server.address();
        if (!address || typeof address === "string") {
          fail(new ConformanceError("trap", "Loopback trap did not bind a TCP port"));
          return;
        }
        resolve(new Trap(server, hits, address.port));
      });
    });
  }
}

class Trap implements TrapEndpoint {
  private closed = false;

  constructor(
    private readonly server: http.Server,
    private readonly hitsBox: { count: number },
    readonly port: number,
  ) {}

  get exfilUrl(): string {
    return `http://127.0.0.1:${this.port}/exfil`;
  }

  hits(): number {
    return this.hitsBox.count;
  }

  resetHits(): void {
    this.hitsBox.count = 0;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}
