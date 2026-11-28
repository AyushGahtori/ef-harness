import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollectingLogger, GlobalBrokerDb } from "@ef-harness/db";
import { conformanceSubject } from "./behavior-adapter.js";
import { ConformanceVersionCache, verdictPayload } from "./cache.js";
import { AutomaticTrustDowngrader, needsStrippedRetry } from "./downgrade.js";
import { BrokerAdapterConformanceDb } from "./global-db.js";
import type { JobRun } from "./job.js";
import { LocalWindowsJobSupervisor } from "./job.js";
import { LiveCliTransport } from "./live.js";
import { OsSandboxBroker, ConformancePermissionEngine } from "./permission.js";
import { runProbeSuite } from "./probes.js";
import type { ProbeSession, SuiteOutcome } from "./probes.js";
import {
  InMemoryAdapterRegistry,
  LocalCliMinVersionGate,
  LocalForeignRuntimeResumeCoordinator,
  LocalLoopbackAllowlistProxy,
  LocalVerdictSigner,
  RequestedSandboxTierSelector,
} from "./ports.js";
import type {
  AdapterRegistryPort,
  CliMinVersionGatePort,
  ForeignRuntimeResumeCoordinatorPort,
  GlobalDbConformancePort,
  LoopbackAllowlistProxyPort,
  SandboxTierSelectorPort,
  TrapEndpoint,
  VerdictSignerPort,
} from "./ports.js";
import { redactReceipt, redactText } from "./redaction.js";
import type { ScratchWorkspace } from "./scratch.js";
import { ScratchWorkspace as ScratchWorkspaceCtor } from "./scratch.js";
import { HARNESS_CONFORMANCE_SUITE_VERSION, PROBE_IDS, PROBE_NAMES } from "./types.js";
import type {
  AdapterBehavior,
  AdapterMode,
  CleanupProof,
  ConformanceCacheKey,
  ConformanceReport,
  ConformanceRunRequest,
  ProbeResult,
} from "./types.js";

export interface ConformanceDependencies {
  readonly db: GlobalDbConformancePort;
  readonly signer: VerdictSignerPort;
  readonly cache: ConformanceVersionCache;
  readonly registry: AdapterRegistryPort;
  readonly jobs: LocalWindowsJobSupervisor | { openRun(label: string): JobRun };
  readonly proxy: LoopbackAllowlistProxyPort;
  readonly tiers: SandboxTierSelectorPort;
  readonly resume: ForeignRuntimeResumeCoordinatorPort;
  readonly versions: CliMinVersionGatePort;
  readonly downgrader: AutomaticTrustDowngrader;
}

export interface ConformanceStack {
  readonly runner: AdapterConformanceRunner;
  readonly db: GlobalDbConformancePort;
  readonly cache: ConformanceVersionCache;
  readonly registry: InMemoryAdapterRegistry;
  readonly signer: LocalVerdictSigner;
  readonly close: () => void;
}

const EMPTY_CLEANUP: CleanupProof = {
  scratchRemoved: false,
  canaryRemoved: false,
  trapClosed: false,
  leftoverPids: 0,
};

export class AdapterConformanceRunner {
  constructor(private readonly deps: ConformanceDependencies) {}

  async run(request: ConformanceRunRequest): Promise<ConformanceReport> {
    const tier = this.deps.tiers.select(request.sandboxTier).tier;
    const key: ConformanceCacheKey = {
      adapterId: request.behavior.adapterId,
      cliVersion: request.behavior.cliVersion,
      sandboxTier: tier,
      harnessConformanceSuiteVersion: HARNESS_CONFORMANCE_SUITE_VERSION,
    };
    if (request.trigger === "startup") {
      const lookupStarted = performance.now();
      const hit = this.deps.cache.lookup(key);
      const lookupMs = performance.now() - lookupStarted;
      if (hit) {
        this.remember(hit);
        return { ...hit, cacheHit: true, probesExecuted: false, durationMs: lookupMs, trigger: "startup" };
      }
    }

    const started = performance.now();
    const trap = await this.deps.proxy.openTrap();
    let scratch: ScratchWorkspace | null = null;
    let job: JobRun | null = null;
    let live: LiveCliTransport | null = null;
    let settled = false;
    try {
      scratch = await ScratchWorkspaceCtor.create(trap);
      job = this.deps.jobs.openRun(request.behavior.adapterId);
      if (request.onScratchReady) {
        request.onScratchReady({ root: scratch.root, canaryPath: scratch.canaryPath, trapPort: trap.port });
      }
      let liveMissing: string | null = null;
      if (request.driver === "live") {
        const opened = await LiveCliTransport.open(request.liveCommand ?? "", request.liveArgs ?? []);
        if ("missing" in opened) liveMissing = opened.reason;
        else live = opened;
      }
      const wrapped = liveMissing
        ? missingBinarySuite(request.behavior, liveMissing)
        : await this.executeSuite(request, scratch, job, trap, "wrapped", live);
      let stripped: SuiteOutcome | null = null;
      if (!liveMissing && needsStrippedRetry(wrapped.probes)) {
        await job.reapAll();
        await scratch.resetFixtures();
        stripped = await this.executeSuite(request, scratch, job, trap, "stripped", live);
      }
      const decision = this.deps.downgrader.decide({
        displayName: request.behavior.displayName,
        cliVersion: request.behavior.cliVersion,
        wrapped: wrapped.probes,
        stripped: stripped ? stripped.probes : null,
        readOnlyInspectionOnly: request.behavior.readOnlyInspectionOnly,
        nativeResumeSupported: (stripped ?? wrapped).nativeResumeSupported,
      });
      const draft = this.assemble(request, tier, decision, wrapped, stripped, performance.now() - started);
      const signature = this.deps.signer.sign(verdictPayload(draft));
      const leftover = await job.reapAll();
      if (live) await live.close();
      live = null;
      const cleanup = await scratch.dispose(leftover);
      scratch = null;
      settled = true;
      const report: ConformanceReport = { ...draft, signature, cleanup };
      this.persist(key, report);
      return report;
    } finally {
      if (!settled) {
        await release(scratch, trap, job, live);
      }
    }
  }

  private async executeSuite(
    request: ConformanceRunRequest,
    scratch: ScratchWorkspace,
    job: JobRun,
    trap: TrapEndpoint,
    mode: AdapterMode,
    live: LiveCliTransport | null,
  ): Promise<SuiteOutcome> {
    const subject = conformanceSubject(request.behavior, request.adapter);
    subject.prepare(scratch, mode, trap.exfilUrl);
    const session: ProbeSession = { id: null };
    return runProbeSuite({
      behavior: request.behavior,
      mode,
      tier: this.deps.tiers.select(request.sandboxTier).tier,
      scratch,
      job,
      proxy: this.deps.proxy,
      trap,
      permission: new ConformancePermissionEngine(),
      broker: new OsSandboxBroker(scratch.root, scratch.canaryPath),
      resume: this.deps.resume,
      versions: this.deps.versions,
      live,
      subject,
      session,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.crashAt ? { crashAt: request.crashAt } : {}),
      ...(request.abortAfter ? { abortAfter: request.abortAfter } : {}),
    });
  }

  private assemble(
    request: ConformanceRunRequest,
    tier: ConformanceReport["sandboxTier"],
    decision: ReturnType<AutomaticTrustDowngrader["decide"]>,
    wrapped: SuiteOutcome,
    stripped: SuiteOutcome | null,
    durationMs: number,
  ): ConformanceReport {
    return {
      adapterId: request.behavior.adapterId,
      displayName: request.behavior.displayName,
      cliVersion: request.behavior.cliVersion,
      sandboxTier: tier,
      driver: request.driver,
      trigger: request.trigger,
      mode: decision.mode,
      trust: decision.trust,
      nativeResumeSupported: decision.nativeResumeSupported,
      suiteVersion: HARNESS_CONFORMANCE_SUITE_VERSION,
      probes: decision.probes,
      attempted: { wrapped: wrapped.probes, stripped: stripped ? stripped.probes : null },
      notification: decision.notification,
      forensics: [...wrapped.forensics, ...(stripped ? stripped.forensics : [])],
      cacheHit: false,
      probesExecuted: true,
      durationMs,
      cleanup: EMPTY_CLEANUP,
      signature: "",
    };
  }

  private persist(key: ConformanceCacheKey, report: ConformanceReport): void {
    this.deps.db.upsert({
      adapterId: report.adapterId,
      cliVersion: report.cliVersion,
      osSandboxTier: report.sandboxTier,
      mode: report.mode,
      suiteVersion: report.suiteVersion,
      trust: report.trust,
      payload: verdictPayload(report),
      signature: report.signature,
      report,
    });
    this.deps.db.activate(key, report.mode);
    this.deps.cache.store(key, report);
    this.remember(report);
  }

  private remember(report: ConformanceReport): void {
    const reason = report.notification ?? `${report.trust} (${report.mode})`;
    this.deps.registry.setTrust(report.adapterId, report.trust, reason, report.mode);
  }
}

export function createConformanceStack(options?: { readonly root?: string }): ConformanceStack {
  const root = options?.root ?? mkdtempSync(path.join(tmpdir(), "ef-conformance-"));
  const broker = GlobalBrokerDb.open({ root, logger: createCollectingLogger([]) });
  const db = new BrokerAdapterConformanceDb(broker);
  const signer = new LocalVerdictSigner();
  const cache = new ConformanceVersionCache(db, signer);
  const registry = new InMemoryAdapterRegistry();
  const runner = new AdapterConformanceRunner({
    db,
    signer,
    cache,
    registry,
    jobs: new LocalWindowsJobSupervisor(),
    proxy: new LocalLoopbackAllowlistProxy(),
    tiers: new RequestedSandboxTierSelector(),
    resume: new LocalForeignRuntimeResumeCoordinator(),
    versions: new LocalCliMinVersionGate(),
    downgrader: new AutomaticTrustDowngrader(),
  });
  return { runner, db, cache, registry, signer, close: () => broker.close() };
}

function missingBinarySuite(behavior: AdapterBehavior, reason: string): SuiteOutcome {
  const diagnostic = redactText(reason);
  const probes: ProbeResult[] = PROBE_IDS.map((probeId, index) => ({
    probeId,
    name: PROBE_NAMES[probeId],
    status: index === 0 ? "fail" : "skipped",
    durationMs: 0,
    diagnostic: index === 0 ? diagnostic : "skipped because the CLI binary is missing",
  }));
  return {
    probes,
    nativeResumeSupported: false,
    forensics: [
      redactReceipt({
        probeId: "P01",
        adapterId: behavior.adapterId,
        cliVersion: behavior.cliVersion,
        mode: "wrapped",
        diagnostic,
        evidence: { missingBinary: true },
      }),
    ],
  };
}

async function release(
  scratch: ScratchWorkspace | null,
  trap: TrapEndpoint,
  job: JobRun | null,
  live: LiveCliTransport | null,
): Promise<void> {
  if (job) {
    try {
      await job.reapAll();
    } catch (error) {
      void error;
    }
  }
  if (live) {
    try {
      await live.close();
    } catch (error) {
      void error;
    }
  }
  if (scratch) {
    try {
      await scratch.dispose(0);
    } catch (error) {
      void error;
    }
    return;
  }
  try {
    await trap.close();
  } catch (error) {
    void error;
  }
}
