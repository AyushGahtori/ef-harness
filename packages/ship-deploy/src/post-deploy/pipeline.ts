import { TenMinuteErrorWatchMonitor, type WatchHandle } from "./error-watch.js";
import {
  DevArtifactLeakError,
  HealthCheckTimeoutError,
  SmokeCheckFailedError,
  StackTraceLeakError,
  StaleDeploymentBuildIdMismatch,
  TlsCertificateError,
} from "./errors.js";
import { PostDeployVerifier } from "./verifier.js";
import {
  EnvironmentRollbackPolicyController,
  type RollbackDecision,
  type RollbackRequest,
} from "./rollback.js";
import { schemaStatusFor } from "./store.js";
import { sha256 } from "./redactor.js";
import type {
  CasBlobStore,
  Clock,
  DeployAdapter,
  DeployEnvironment,
  EnvApprovalPolicyEngine,
  ExternalEffectLedger,
  HostObservabilitySource,
  LocalConnectivityProbe,
  PacketSecurityRedactor,
  PostDeployStateStore,
  ProductionAlertCardSink,
  ReleaseOutcome,
  ShippedReleaseReceipt,
  ShipRunState,
  TlsProbe,
  UiPlaywrightContractVerifier,
} from "./types.js";

export interface PostDeployGateInput {
  readonly shipRunId: string;
  readonly env: DeployEnvironment;
  readonly commitSha: string;
  readonly liveUrl: string;
  readonly deploymentId: string;
  readonly previousSha: string;
  readonly previousDeploymentId: string;
  readonly publicRoutes?: readonly string[];
  readonly protectedRoutes?: readonly string[];
  readonly healthPath?: string;
  readonly healthMaxWaitMs?: number;
  readonly healthIntervalMs?: number;
  readonly watchWindowMs?: number;
  readonly watchPollMs?: number;
  readonly containerName?: string;
}

interface RunMemory {
  readonly input: PostDeployGateInput;
  healthPassedAt: string | null;
  smokeReceiptSha: string | null;
  watchVerdict: string | null;
  watchLogs: readonly string[];
  minimized: boolean;
}

export class PostDeployReleaseGate {
  private readonly verifier: PostDeployVerifier;
  private readonly monitor: TenMinuteErrorWatchMonitor;
  private readonly controller: EnvironmentRollbackPolicyController;
  private watch: WatchHandle | null = null;
  private memory: RunMemory | null = null;

  constructor(
    private readonly deps: {
      readonly adapter: DeployAdapter;
      readonly ledger: ExternalEffectLedger;
      readonly policy: EnvApprovalPolicyEngine;
      readonly cards: ProductionAlertCardSink;
      readonly source: HostObservabilitySource;
      readonly connectivity: LocalConnectivityProbe;
      readonly store: PostDeployStateStore;
      readonly redactor: PacketSecurityRedactor;
      readonly cas: CasBlobStore;
      readonly playwright?: UiPlaywrightContractVerifier;
      readonly clock?: Clock;
      readonly tlsProbe?: TlsProbe;
      readonly fetchImpl?: typeof fetch;
    },
  ) {
    this.verifier = new PostDeployVerifier({
      redactor: deps.redactor,
      cas: deps.cas,
      ...(deps.playwright ? { playwright: deps.playwright } : {}),
      ...(deps.clock ? { clock: deps.clock } : {}),
      ...(deps.tlsProbe ? { tlsProbe: deps.tlsProbe } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    this.monitor = new TenMinuteErrorWatchMonitor({
      source: deps.source,
      connectivity: deps.connectivity,
      redactor: deps.redactor,
      cas: deps.cas,
      ...(deps.clock ? { clock: deps.clock } : {}),
    });
    this.controller = new EnvironmentRollbackPolicyController({
      adapter: deps.adapter,
      ledger: deps.ledger,
      policy: deps.policy,
      cards: deps.cards,
      redactor: deps.redactor,
      ...(deps.clock ? { clock: deps.clock } : {}),
      ...(deps.tlsProbe ? { tlsProbe: deps.tlsProbe } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
  }

  isWatching(): boolean {
    return this.watch !== null && this.watch.phase() !== "done";
  }

  minimizeWatch(): void {
    this.watch?.minimize();
  }

  dismissWatchEarly(): void {
    this.watch?.dismissEarly();
  }

  async approveRollback(cardId: string): Promise<ReleaseOutcome> {
    const decision = await this.controller.approveRollback(cardId);
    return this.persist(decision, decision.state === "ROLLED_BACK" ? "breached" : null);
  }

  async keepLive(cardId: string): Promise<ReleaseOutcome> {
    const decision = await this.controller.keepLive(cardId);
    return this.persist(decision, null);
  }

  async run(input: PostDeployGateInput): Promise<ReleaseOutcome> {
    this.memory = {
      input,
      healthPassedAt: null,
      smokeReceiptSha: null,
      watchVerdict: null,
      watchLogs: [],
      minimized: false,
    };
    try {
      const health = await this.verifier.verifyHealthAndBuildId({
        env: input.env,
        liveUrl: input.liveUrl,
        expectedCommitSha: input.commitSha,
        ...(input.healthPath !== undefined ? { healthPath: input.healthPath } : {}),
        ...(input.healthMaxWaitMs !== undefined ? { maxWaitMs: input.healthMaxWaitMs } : {}),
        ...(input.healthIntervalMs !== undefined ? { intervalMs: input.healthIntervalMs } : {}),
      });
      this.memory.healthPassedAt = health.passedAt;
    } catch (error) {
      return this.fail(input, "health", error, [], null);
    }

    try {
      const smoke = await this.verifier.runDeployedSmoke({
        env: input.env,
        liveUrl: input.liveUrl,
        ...(input.publicRoutes !== undefined ? { publicRoutes: input.publicRoutes } : {}),
        ...(input.protectedRoutes !== undefined ? { protectedRoutes: input.protectedRoutes } : {}),
      });
      this.memory.smokeReceiptSha = smoke.receiptSha256;
    } catch (error) {
      return this.fail(input, "smoke", error, consoleErrorsFrom(error, this.deps.redactor), screenshotFrom(error));
    }

    if (input.env === "preview") {
      return this.ship("SHIPPED", null, "Preview health and read-only smoke passed.");
    }

    let decision: RollbackDecision | null = null;
    this.watch = this.monitor.start({
      deploymentId: input.deploymentId,
      env: input.env,
      ...(input.containerName !== undefined ? { containerName: input.containerName } : {}),
      ...(input.watchWindowMs !== undefined ? { windowMs: input.watchWindowMs } : {}),
      ...(input.watchPollMs !== undefined ? { pollMs: input.watchPollMs } : {}),
      onBreach: async (breach, logs) => {
        decision = await this.controller.handle(
          this.request(input, `error-watch:${breach.kind}`, [], logs.join("\n"), null),
        );
      },
    });
    const watched = await this.watch.done;
    this.memory.watchVerdict = watched.verdict;
    this.memory.watchLogs = watched.logs;
    this.memory.minimized = watched.minimized;
    if (decision) {
      return this.persist(decision, watched.verdict);
    }
    if (watched.verdict === "paused-local-offline") {
      return this.ship(
        "WATCH_PAUSED",
        watched.verdict,
        watched.logs.find((line) => line.includes("Local internet offline")) ??
          "Local internet offline — watch paused, live app unaffected",
      );
    }
    const state: ShipRunState = "SHIPPED";
    const note =
      watched.verdict === "dismissed-early"
        ? "10-minute watch dismissed early. Ship receipt recorded."
        : "Health, read-only smoke, and 10-minute error watch passed.";
    return this.ship(state, watched.verdict, note);
  }

  private async fail(
    input: PostDeployGateInput,
    fallback: string,
    error: unknown,
    consoleErrors: readonly string[],
    screenshotSha256: string | null,
  ): Promise<ReleaseOutcome> {
    const failingCheck = classify(error, fallback);
    const redactedLogs = this.deps.redactor.redact(
      error instanceof Error ? error.message : String(error),
    );
    const decision = await this.controller.handle(
      this.request(input, failingCheck, consoleErrors, redactedLogs, screenshotSha256),
    );
    return this.persist(decision, null);
  }

  private request(
    input: PostDeployGateInput,
    failingCheck: string,
    consoleErrors: readonly string[],
    redactedLogs: string,
    screenshotSha256: string | null,
  ): RollbackRequest {
    return {
      shipRunId: input.shipRunId,
      env: input.env,
      commitSha: input.commitSha,
      liveUrl: input.liveUrl,
      deploymentId: input.deploymentId,
      previousSha: input.previousSha,
      previousDeploymentId: input.previousDeploymentId,
      failingCheck,
      consoleErrors: consoleErrors.map((line) => this.deps.redactor.redact(line)),
      redactedLogs: this.deps.redactor.redact(redactedLogs),
      screenshotSha256,
    };
  }

  private ship(state: ShipRunState, verdict: string | null, notification: string): ReleaseOutcome {
    return this.persist(
      {
        state,
        rolledBack: false,
        previousHealthy: null,
        cardId: null,
        notification,
        redactedLogs: "",
        rollbackTargetId: null,
        repairTaskRequested: false,
      },
      verdict,
    );
  }

  private persist(decision: RollbackDecision, verdict: string | null): ReleaseOutcome {
    const memory = this.memory;
    if (!memory) throw new Error("Post-deploy gate has no active run");
    const watchVerdict = verdict ?? memory.watchVerdict;
    const receipt: ShippedReleaseReceipt = {
      shipRunId: memory.input.shipRunId,
      env: memory.input.env,
      commitSha: memory.input.commitSha,
      liveUrl: memory.input.liveUrl,
      deploymentId: memory.input.deploymentId,
      healthPassedAt: memory.healthPassedAt,
      smokeReceiptSha: memory.smokeReceiptSha,
      tenMinWatchVerdict: watchVerdict,
      registrations: this.deps.store.registrationsFor(memory.input.shipRunId),
      rollbackTargetId: decision.rollbackTargetId,
      state: decision.state,
    };
    this.deps.store.saveShipRun({
      id: memory.input.shipRunId,
      kind: "deploy",
      environment: memory.input.env,
      headSha: memory.input.commitSha,
      deploymentId: memory.input.deploymentId,
      url: memory.input.liveUrl,
      state: decision.state,
      schemaStatus: schemaStatusFor(decision.state),
      failureFingerprint: decision.repairTaskRequested
        ? sha256(`${decision.state}:${decision.notification}`)
        : null,
      updatedAt: (this.deps.clock ?? { now: () => Date.now() }).now(),
      receipt,
    });
    return {
      state: decision.state,
      receipt,
      rolledBack: decision.rolledBack,
      previousHealthy: decision.previousHealthy,
      cardId: decision.cardId,
      notification: this.deps.redactor.redact(decision.notification),
      minimized: memory.minimized,
      watchLogs: memory.watchLogs,
    };
  }
}

function classify(error: unknown, fallback: string): string {
  if (error instanceof StaleDeploymentBuildIdMismatch) return "build-id";
  if (error instanceof DevArtifactLeakError) return "dev-artifact";
  if (error instanceof StackTraceLeakError) return "stack-trace";
  if (error instanceof TlsCertificateError) return "tls";
  if (error instanceof HealthCheckTimeoutError) return "health";
  if (error instanceof SmokeCheckFailedError) return "smoke";
  return fallback;
}

function consoleErrorsFrom(error: unknown, redactor: PacketSecurityRedactor): readonly string[] {
  if (!(error instanceof SmokeCheckFailedError)) return [];
  return error.consoleErrors.map((line) => redactor.redact(line));
}

function screenshotFrom(error: unknown): string | null {
  return error instanceof SmokeCheckFailedError ? error.screenshotSha256 : null;
}
