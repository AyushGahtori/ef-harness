import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompliancePolicyLocks } from "./compliance-policy-locks.js";
import { summarizePolicyDiff } from "./diff-summary.js";
import { verifyPinnedSignature } from "./ed25519.js";
import { PolicyDocumentError } from "./errors.js";
import { GlobalDbPolicyPort } from "./global-db-policy-port.js";
import { parsePolicyDocument } from "./parse-document.js";
import { readBundledPolicyText } from "./bundled-policy.js";
import { CliMinVersionGate } from "./cli-min-version-gate.js";
import {
  RouteRevocationParkHandler,
  type ParkTransitionResult,
} from "./route-revocation-park-handler.js";
import { buildTransparency } from "./transparency.js";
import type {
  AccountCard,
  ActiveAtomicStep,
  ApplyResult,
  ConnectionRecord,
  PolicyHistoryRecord,
  PolicyTransparencyView,
  ProviderPolicyDocument,
} from "./types.js";
import { VersionedModelRosterPort } from "./versioned-model-roster-port.js";

export const POLICY_FETCH_TIMEOUT_MS = 5_000;
export const POLICY_REFRESH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const POLICY_STARTUP_REFRESH_DELAY_MS = 30_000;
export const POLICY_STARTUP_BUDGET_MS = 5;

const CACHE_FILE = "provider-policy.verified.json";

export interface RuntimeContext {
  connections?: readonly ConnectionRecord[];
  activeSteps?: readonly ActiveAtomicStep[];
  checkpoint?: (step: ActiveAtomicStep) => ActiveAtomicStep;
}

export interface EngineRuntimeReaders {
  connections?: () => readonly ConnectionRecord[];
  activeSteps?: () => readonly ActiveAtomicStep[];
  checkpoint?: (step: ActiveAtomicStep) => ActiveAtomicStep;
}

export interface SignedProviderPolicyEngineOptions {
  cacheDirectory: string;
  globalDb?: GlobalDbPolicyPort;
  roster?: VersionedModelRosterPort;
  locks?: CompliancePolicyLocks;
  parkHandler?: RouteRevocationParkHandler;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  schedule?: (fn: () => void, delayMs: number) => { cancel: () => void };
  runtime?: EngineRuntimeReaders;
}

export interface StartupLoadResult {
  source: "cache" | "bundled";
  policyVersion: number;
  elapsedMs: number;
  fetchAttempted: false;
}

interface PolicyCacheEnvelope {
  checkedAt: string | null;
  verifiedAt: string;
  source: "bundled" | "remote" | "cache";
  pendingCard: AccountCard | null;
  document: ProviderPolicyDocument;
}

interface VerifiedPolicy {
  document: ProviderPolicyDocument;
  sha256: string;
  raw: Record<string, unknown>;
}

export class SignedProviderPolicyEngine {
  private readonly cacheDirectory: string;
  private readonly globalDb: GlobalDbPolicyPort;
  private readonly roster: VersionedModelRosterPort;
  private readonly locks: CompliancePolicyLocks;
  private readonly parkHandler: RouteRevocationParkHandler;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly schedule: (fn: () => void, delayMs: number) => { cancel: () => void };
  private readonly runtime: EngineRuntimeReaders;
  private document: ProviderPolicyDocument | null = null;
  private sha256 = "";
  private checkedAtMs: number | null = null;
  private verifiedAtMs: number | null = null;
  private cancelTimer: (() => void) | null = null;

  constructor(options: SignedProviderPolicyEngineOptions) {
    this.cacheDirectory = options.cacheDirectory;
    this.globalDb =
      options.globalDb ?? new GlobalDbPolicyPort(join(options.cacheDirectory, "global.db"));
    this.roster = options.roster ?? new VersionedModelRosterPort();
    this.locks = options.locks ?? new CompliancePolicyLocks();
    this.parkHandler = options.parkHandler ?? new RouteRevocationParkHandler();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? POLICY_FETCH_TIMEOUT_MS;
    this.schedule = options.schedule ?? defaultSchedule;
    this.runtime = options.runtime ?? {};
  }

  loadStartup(): StartupLoadResult {
    const started = performance.now();
    const cached = readCacheEnvelope(this.cachePath());
    const fromCache = cached ? verifyAndParse(JSON.stringify(cached.document)) : null;
    let source: StartupLoadResult["source"] = "bundled";
    let verified: VerifiedPolicy;
    if (fromCache && fromCache.ok && cached) {
      source = "cache";
      verified = fromCache;
      this.checkedAtMs = cached.checkedAt === null ? null : Date.parse(cached.checkedAt);
      this.verifiedAtMs = Date.parse(cached.verifiedAt);
      this.parkHandler.syncFromDocument(verified.document.routes, cached.pendingCard);
    } else {
      const bundled = verifyAndParse(readBundledPolicyText());
      if (!bundled.ok) {
        throw new PolicyDocumentError(bundled.reason, bundled.detail);
      }
      verified = bundled;
      this.checkedAtMs = null;
      this.verifiedAtMs = this.now();
      this.parkHandler.syncFromDocument(verified.document.routes, null);
    }
    this.commitVerified(verified, source === "cache" ? null : "bundled");
    const elapsedMs = performance.now() - started;
    return {
      source,
      policyVersion: verified.document.policyVersion,
      elapsedMs,
      fetchAttempted: false,
    };
  }

  scheduleDailyRefresh(): void {
    this.cancelTimer?.();
    const handle = this.schedule(() => {
      void this.refreshDaily();
    }, POLICY_STARTUP_REFRESH_DELAY_MS);
    this.cancelTimer = handle.cancel;
  }

  async refreshDaily(): Promise<ApplyResult> {
    const document = this.requireDocument();
    const now = this.now();
    if (
      this.checkedAtMs !== null &&
      now - this.checkedAtMs < POLICY_REFRESH_MIN_INTERVAL_MS
    ) {
      return {
        applied: false,
        reason: "throttled",
        policyVersion: document.policyVersion,
        detail: null,
        card: null,
      };
    }
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const response = await this.fetchImpl(document.refreshUrl, {
        signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      this.checkedAtMs = now;
      const result = this.applyVerifiedText(text);
      this.persistCheckedAt();
      return result;
    } catch (error) {
      this.checkedAtMs = now;
      this.persistCheckedAt();
      return {
        applied: false,
        reason: "offline",
        policyVersion: document.policyVersion,
        detail: isTimeoutError(error) ? "timeout" : "fetch_failed",
        card: null,
      };
    }
  }

  ingestRemotePolicy(payload: unknown, context?: RuntimeContext): ApplyResult {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return this.applyVerifiedText(text, context);
  }

  transparency(): PolicyTransparencyView {
    return buildTransparency({
      document: this.requireDocument(),
      checkedAtMs: this.checkedAtMs,
      verifiedAtMs: this.verifiedAtMs,
      nowMs: this.now(),
    });
  }

  cliGate(): CliMinVersionGate {
    return new CliMinVersionGate(this.requireDocument().cliFloors);
  }

  complianceLocks(): CompliancePolicyLocks {
    return this.locks;
  }

  revocationHandler(): RouteRevocationParkHandler {
    return this.parkHandler;
  }

  rosterPort(): VersionedModelRosterPort {
    return this.roster;
  }

  policyHistory(): PolicyHistoryRecord[] {
    return this.globalDb.listHistory();
  }

  activeDocument(): ProviderPolicyDocument {
    return this.requireDocument();
  }

  acknowledgeCard(): void {
    this.parkHandler.acknowledgeCard();
    this.persistCheckedAt();
  }

  close(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.globalDb.close();
  }

  private applyVerifiedText(text: string, context?: RuntimeContext): ApplyResult {
    const current = this.requireDocument();
    const verified = verifyAndParse(text);
    if (!verified.ok) {
      return {
        applied: false,
        reason: verified.reason,
        policyVersion: current.policyVersion,
        detail: verified.detail,
        card: null,
      };
    }
    const floor = Math.max(current.policyVersion, this.globalDb.latestVersion() ?? 0);
    if (verified.document.policyVersion < floor) {
      return {
        applied: false,
        reason: "rollback",
        policyVersion: current.policyVersion,
        detail: `rejected ${verified.document.policyVersion} < ${floor}`,
        card: null,
      };
    }
    if (verified.sha256 === this.sha256) {
      return {
        applied: false,
        reason: "unchanged",
        policyVersion: current.policyVersion,
        detail: null,
        card: null,
      };
    }
    const violations = this.locks.documentViolations(verified.document, verified.raw);
    if (violations.length > 0) {
      return {
        applied: false,
        reason: "compliance_lock",
        policyVersion: current.policyVersion,
        detail: violations.join(","),
        card: null,
      };
    }
    return this.commitRemote(verified, context);
  }

  private commitRemote(verified: VerifiedPolicy, context?: RuntimeContext): ApplyResult {
    const current = this.requireDocument();
    const now = this.now();
    const appliedAt = new Date(now).toISOString();
    const diffSummary = summarizePolicyDiff(current, verified.document);
    const readers = this.resolveRuntime(context);
    const transition = this.parkHandler.applyTransition({
      previousRoutes: current.routes,
      nextRoutes: verified.document.routes,
      connections: readers.connections,
      activeSteps: readers.activeSteps,
      checkpoint: readers.checkpoint,
      nowIso: appliedAt,
    });
    this.roster.applyPolicyModels(verified.document.models, verified.document.publishedAt);
    this.document = verified.document;
    this.sha256 = verified.sha256;
    this.verifiedAtMs = now;
    this.writeCache("remote", transition.card);
    this.globalDb.insertHistory({
      policyVersion: verified.document.policyVersion,
      publishedAt: verified.document.publishedAt,
      sha256: verified.sha256,
      appliedAt,
      diffSummary,
    });
    return {
      applied: true,
      reason: "applied",
      policyVersion: verified.document.policyVersion,
      detail: diffSummary,
      card: transition.card,
    };
  }

  private commitVerified(verified: VerifiedPolicy, cacheSource: "bundled" | null): void {
    const violations = this.locks.documentViolations(verified.document, verified.raw);
    if (violations.length > 0) {
      throw new PolicyDocumentError("compliance_lock", violations.join(","));
    }
    this.document = verified.document;
    this.sha256 = verified.sha256;
    this.roster.applyPolicyModels(verified.document.models, verified.document.publishedAt);
    if (this.verifiedAtMs === null) this.verifiedAtMs = this.now();
    const already = this.globalDb.listHistory().some((row) => row.sha256 === verified.sha256);
    if (!already) {
      this.globalDb.insertHistory({
        policyVersion: verified.document.policyVersion,
        publishedAt: verified.document.publishedAt,
        sha256: verified.sha256,
        appliedAt: new Date(this.verifiedAtMs).toISOString(),
        diffSummary: summarizePolicyDiff(null, verified.document),
      });
    }
    if (cacheSource === "bundled") {
      this.writeCache("bundled", null);
    }
  }

  private persistCheckedAt(): void {
    if (!this.document || this.verifiedAtMs === null) return;
    this.writeCache("cache", this.parkHandler.currentCard());
  }

  private writeCache(source: PolicyCacheEnvelope["source"], pendingCard: AccountCard | null): void {
    const document = this.requireDocument();
    const envelope: PolicyCacheEnvelope = {
      checkedAt: this.checkedAtMs === null ? null : new Date(this.checkedAtMs).toISOString(),
      verifiedAt: new Date(this.verifiedAtMs ?? this.now()).toISOString(),
      source,
      pendingCard,
      document,
    };
    mkdirSync(this.cacheDirectory, { recursive: true });
    writeFileSync(this.cachePath(), `${JSON.stringify(envelope)}\n`, "utf8");
  }

  private cachePath(): string {
    return join(this.cacheDirectory, CACHE_FILE);
  }

  private requireDocument(): ProviderPolicyDocument {
    if (!this.document) {
      throw new PolicyDocumentError("startup", "loadStartup must run before policy use");
    }
    return this.document;
  }

  private resolveRuntime(context?: RuntimeContext): {
    connections: readonly ConnectionRecord[];
    activeSteps: readonly ActiveAtomicStep[];
    checkpoint: (step: ActiveAtomicStep) => ActiveAtomicStep;
  } {
    const connections =
      context?.connections ??
      this.runtime.connections?.() ??
      this.globalDb.listConnections();
    const activeSteps = context?.activeSteps ?? this.runtime.activeSteps?.() ?? [];
    const checkpoint =
      context?.checkpoint ??
      this.runtime.checkpoint ??
      ((step: ActiveAtomicStep) => ({ ...step, checkpointed: true, corrupted: false }));
    return { connections, activeSteps, checkpoint };
  }
}

export function verifyAndParse(
  rawText: string,
): (VerifiedPolicy & { ok: true }) | { ok: false; reason: "malformed" | "invalid_signature"; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "malformed", detail: "policy JSON is invalid" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "malformed", detail: "policy must be an object" };
  }
  const signature = verifyPinnedSignature(parsed);
  if (!signature.ok) {
    return {
      ok: false,
      reason: "invalid_signature",
      detail: "Ed25519 signature or pinned key mismatch",
    };
  }
  try {
    const document = parsePolicyDocument(parsed);
    return { ok: true, document, sha256: signature.sha256, raw: parsed };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "malformed policy";
    return { ok: false, reason: "malformed", detail };
  }
}

function readCacheEnvelope(file: string): PolicyCacheEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.document)) return null;
    const checkedAt = parsed.checkedAt;
    const verifiedAt = parsed.verifiedAt;
    if (checkedAt !== null && typeof checkedAt !== "string") return null;
    if (typeof verifiedAt !== "string") return null;
    const source = parsed.source;
    if (source !== "bundled" && source !== "remote" && source !== "cache") return null;
    return {
      checkedAt,
      verifiedAt,
      source,
      pendingCard: isRecord(parsed.pendingCard) ? (parsed.pendingCard as unknown as AccountCard) : null,
      document: parsed.document as unknown as ProviderPolicyDocument,
    };
  } catch {
    return null;
  }
}

function defaultSchedule(fn: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(fn, delayMs);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "TimeoutError" || name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type { ParkTransitionResult };
