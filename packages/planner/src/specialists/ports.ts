import { randomUUID } from "node:crypto";
import type { CompletenessGateRunner, LeafAuditInput } from "@ef-harness/completeness-gate";
import type { BudgetLedgerRepo, ScopeKind } from "@ef-harness/db";
import type {
  CasBlobStorePort,
  HintFeedbackPayload,
  HintLadderController,
  HintLadderHiddenCheckFailure,
  PersistentHintLadder,
  UiInteractionContractVerifier,
  UiVerificationRequest,
} from "@ef-harness/verifier";
import type {
  AdapterCallOptions,
  ModelProfile,
  ModelProtocolAdapter,
  ModelRoute,
} from "@ef-harness/worker-loop";
import { BUDGET_PRESSURE_RATIO } from "./types.js";
import type {
  ModelCall,
  ReviewerDefectHint,
  ScreenshotKind,
  SpecialistModel,
  StaticAuditReceiptView,
  TasteScreenshot,
} from "./types.js";

/** Async port of Task 065 / C24 hint ladder. */
export interface VerificationHintLadder {
  readonly source: string;
  pushReviewerDefect(defect: ReviewerDefectHint): Promise<{
    readonly recorded: true;
    readonly ladderStep: number;
  }>;
}

/** Async port of the STATIC_AUDIT receipt reader (Tasks 058/059 / C23). */
export interface StaticAuditGate {
  readonly source: string;
  readReceipt(taskId: string): Promise<StaticAuditReceiptView | null>;
}

/** Async port of Task 062 / C24 `UiInteractionContractVerifier`. */
export interface UiPlaywrightContractVerifier {
  readonly source: string;
  captureScreens(screenIds: readonly string[]): Promise<readonly TasteScreenshot[]>;
}

/** Envelope accounting port (Task 090 / C09 `BudgetLedgerRepo`). */
export interface ReviewEnvelopePort {
  readonly limitUnits: number;
  readonly spentUnits: number;
  pressure(): BudgetPressure | Promise<BudgetPressure>;
  charge(units: number): void | Promise<void>;
}

export class MemoryReviewRejectionStore {
  private readonly counts = new Map<string, number>();

  count(taskId: string): number {
    return this.counts.get(taskId) ?? 0;
  }

  record(taskId: string): number {
    const next = this.count(taskId) + 1;
    this.counts.set(taskId, next);
    return next;
  }
}

export class MemoryHintLadder implements VerificationHintLadder {
  readonly source = "local-port:VerificationHintLadder:Task-065";
  readonly pushes: ReviewerDefectHint[] = [];

  async pushReviewerDefect(
    defect: ReviewerDefectHint,
  ): Promise<{ readonly recorded: true; readonly ladderStep: number }> {
    this.pushes.push(defect);
    return { recorded: true, ladderStep: this.pushes.length };
  }
}

export class MemoryStaticAuditGate implements StaticAuditGate {
  readonly source = "local-port:StaticAuditGate:Task-059";
  private readonly receipts = new Map<string, StaticAuditReceiptView>();

  put(receipt: StaticAuditReceiptView): void {
    this.receipts.set(receipt.taskId, receipt);
  }

  async readReceipt(taskId: string): Promise<StaticAuditReceiptView | null> {
    return this.receipts.get(taskId) ?? null;
  }
}

export class MemoryUiPlaywrightVerifier implements UiPlaywrightContractVerifier {
  readonly source = "local-port:UiPlaywrightContractVerifier:Task-062";
  readonly shots: TasteScreenshot[] = [];

  async captureScreens(screenIds: readonly string[]): Promise<readonly TasteScreenshot[]> {
    const wanted = new Set(screenIds);
    return this.shots.filter((shot) => wanted.size === 0 || wanted.has(shot.screenId));
  }
}

export type BudgetPressure = "normal" | "high" | "exhausted";

export function budgetPressure(limitUnits: number, spentUnits: number): BudgetPressure {
  if (limitUnits <= 0 || spentUnits >= limitUnits) return "exhausted";
  if (spentUnits / limitUnits >= BUDGET_PRESSURE_RATIO) return "high";
  return "normal";
}

export class MemoryReviewEnvelope implements ReviewEnvelopePort {
  spentUnits: number;

  constructor(
    readonly limitUnits: number,
    spentUnits = 0,
  ) {
    this.spentUnits = spentUnits;
  }

  pressure(): BudgetPressure {
    return budgetPressure(this.limitUnits, this.spentUnits);
  }

  charge(units: number): void {
    if (units > 0) this.spentUnits += units;
  }
}

/**
 * Adapts `@ef-harness/worker-loop` `ModelProtocolAdapter` to async `SpecialistModel`.
 */
export function adaptWorkerLoopModel(
  adapter: ModelProtocolAdapter,
  config: {
    readonly profileForCall: (call: ModelCall) => {
      readonly model: string;
      readonly profile: ModelProfile;
      readonly route: ModelRoute;
    };
    readonly callOptions: AdapterCallOptions;
    readonly reservedOutputTokens?: number;
  },
): SpecialistModel {
  let seq = 0;
  return {
    async complete(call) {
      seq += 1;
      const target = config.profileForCall(call);
      const stream = adapter.stream(
        {
          model: target.model,
          profile: target.profile,
          route: target.route,
          prefix: {
            zone1: `Specialist role ${call.role}`,
            zone2: `Model family ${call.family}`,
          },
          messages: [{ role: "user", text: call.prompt }],
          tools: [],
          replayItems: [],
          reservedOutputTokens: config.reservedOutputTokens ?? 1024,
          clientRequestId: `specialist-${call.role}-${seq}`,
          idempotencyKey: `specialist-${call.role}-${seq}`,
        },
        config.callOptions,
      );
      let structured: unknown;
      let text = "";
      for await (const event of stream) {
        if (event.type === "structured_output") {
          structured = event.parsed;
        } else if (event.type === "text_delta") {
          text += event.text;
        } else if (event.type === "error") {
          throw new Error(event.error.message);
        }
      }
      if (structured !== undefined) return structured;
      return JSON.parse(text) as unknown;
    },
  };
}

/** Binds `@ef-harness/completeness-gate` `CompletenessGateRunner` (`C23`) into `StaticAuditGate`. */
export function bindCompletenessGate(
  runner: CompletenessGateRunner,
  auditInputFor: (taskId: string) => LeafAuditInput | null,
): StaticAuditGate {
  return {
    source: "@ef-harness/completeness-gate:CompletenessGateRunner",
    async readReceipt(taskId) {
      const input = auditInputFor(taskId);
      if (!input) return null;
      const report = runner.runLeafStaticAudit(input);
      return {
        taskId: report.taskId,
        passed: report.passed,
        fingerprint: report.fingerprint,
        hardFindingCount: report.findings.length,
        softFindingCount: report.softFindings.length,
      };
    },
  };
}

function stepFromPayload(payload: HintFeedbackPayload): number {
  if ("ladderStep" in payload) return payload.ladderStep;
  return 1;
}

/** Binds `@ef-harness/verifier` `HintLadderController` or `PersistentHintLadder` (`C24`). */
export function bindHintLadder(
  ladder: HintLadderController | PersistentHintLadder,
  defaults: {
    readonly model?: string;
    readonly workerLevel?: string;
    readonly briefVersion?: number;
    readonly checkId?: string;
  } = {},
): VerificationHintLadder {
  return {
    source: "@ef-harness/verifier:HintLadder",
    async pushReviewerDefect(defect) {
      const failure: HintLadderHiddenCheckFailure = {
        taskId: defect.taskId,
        attemptId: defect.attemptId,
        model: defaults.model ?? "specialist-reviewer",
        workerLevel: defaults.workerLevel ?? "Senior",
        briefVersion: defaults.briefVersion ?? 1,
        ruleId: defect.violatedRuleOrReqId,
        ruleText: defect.hint,
        checkId: defaults.checkId ?? `reviewer:${defect.taskId}`,
        failureType: "exception",
        filePath: defect.filePath,
        detail: defect.scenario,
        attribution: "implementation",
      };
      const payload = await ladder.processHiddenFailure(failure);
      return { recorded: true, ladderStep: stepFromPayload(payload) };
    },
  };
}

/** Binds `@ef-harness/verifier` `UiInteractionContractVerifier` (`C24`) into `UiPlaywrightContractVerifier`. */
export function bindUiInteractionContractVerifier(
  verifier: UiInteractionContractVerifier,
  specFor: (screenIds: readonly string[]) => readonly {
    readonly id: string;
    readonly screenId: string;
    readonly kind: ScreenshotKind;
    readonly viewportWidth: number;
    readonly request: UiVerificationRequest;
    readonly sourceFiles: readonly string[];
    readonly seedReceiptId?: string;
  }[],
  cas?: CasBlobStorePort,
): UiPlaywrightContractVerifier {
  return {
    source: "@ef-harness/verifier:UiInteractionContractVerifier",
    async captureScreens(screenIds) {
      const specs = specFor(screenIds);
      const screenshots: TasteScreenshot[] = [];
      for (const spec of specs) {
        const result = await verifier.verify(spec.request);
        const shotArtifact = result.artifacts.find((artifact) => artifact.label === "playwright-screenshot");
        let bytes: Uint8Array = result.traceBytes;
        if (cas && shotArtifact) {
          const loaded = await cas.get(shotArtifact.digest);
          if (loaded) bytes = loaded;
        }
        screenshots.push({
          id: spec.id,
          screenId: spec.screenId,
          kind: spec.kind,
          viewportWidth: spec.viewportWidth,
          bytes,
          environment: "synthetic_test_env",
          seeded: true,
          seedReceiptId: spec.seedReceiptId ?? `seed:${spec.screenId}`,
          sourceFiles: spec.sourceFiles,
        });
      }
      return screenshots;
    },
  };
}

/** Binds `@ef-harness/db` `BudgetLedgerRepo` (`C09`) as an async review budget envelope. */
export function bindBudgetLedgerReviewEnvelope(
  repo: BudgetLedgerRepo,
  options: {
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
    readonly limitUnits: number;
    readonly currency?: string;
    readonly parentKind?: ScopeKind;
    readonly parentId?: string;
    readonly now?: () => number;
  },
): ReviewEnvelopePort {
  const currency = options.currency ?? "usd";
  const now = options.now ?? (() => Date.now());
  repo.registerCurrency(currency);
  const existing = repo
    .getBudgetRemaining(options.scopeKind, options.scopeId)
    .find((row) => row.currency === currency);
  if (!existing) {
    repo.createBudgetScope({
      scopeKind: options.scopeKind,
      scopeId: options.scopeId,
      currency,
      limitUnits: options.limitUnits,
      ...(options.parentKind !== undefined ? { parentKind: options.parentKind } : {}),
      ...(options.parentId !== undefined ? { parentId: options.parentId } : {}),
    });
  }
  const readRow = () =>
    repo.getScopeSnapshot(options.scopeKind, options.scopeId).currencies.find((c) => c.currency === currency);

  return {
    get limitUnits() {
      return readRow()?.limitUnits ?? options.limitUnits;
    },
    get spentUnits() {
      const row = readRow();
      return row ? row.spentUnits + row.reservedUnits : 0;
    },
    pressure() {
      const snap = repo.getScopeSnapshot(options.scopeKind, options.scopeId);
      if (snap.hardStop) return "exhausted";
      const row = snap.currencies.find((c) => c.currency === currency);
      if (!row) return "exhausted";
      return budgetPressure(row.limitUnits, row.spentUnits + row.reservedUnits);
    },
    charge(units) {
      if (units <= 0) return;
      const reservationId = `spec-rev-${randomUUID()}`;
      const res = repo.reserveAcrossScopes({
        reservationId,
        purpose: options.scopeKind === "wave_paperwork" ? "paperwork" : "model_call",
        currency,
        amountUnits: units,
        scopeKind: options.scopeKind,
        scopeId: options.scopeId,
        createdAt: now(),
      });
      if (res.ok) {
        repo.settleReservation({ reservationId, actualUnits: units, now: now() });
      }
    },
  };
}
