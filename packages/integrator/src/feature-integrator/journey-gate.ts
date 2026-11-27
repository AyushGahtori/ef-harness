import {
  CompletenessGateRunner,
  createLocalGitSafetyScanner,
  createLocalNameRegistry,
  createLocalStaticAuditAstEngine,
  type NameRegistryService,
} from "@ef-harness/completeness-gate";
import {
  RedBeforeGreenGate,
  kernelRun,
  type BlindBinderOrchestrator,
  type UiInteractionContractVerifier,
  type UiVerificationRequest,
} from "@ef-harness/verifier";
import { BACKEND_SHARED_FILES, MAX_FIX_ROUNDS, UI_SHARED_FILES } from "./constants.js";
import { VacuousSealedCheckError } from "./errors.js";
import { executeSeamJourney, mountFromPlan } from "./seam-runner.js";
import type {
  BlindBinderPort,
  CodeSnapshot,
  ConflictHunk,
  FileText,
  IntegrationFixHint,
  JourneyReport,
  RouteMount,
  SealedCheck,
  SeamJourney,
  StaticAuditPort,
  ViewportCheck,
  WiringRepair,
} from "./types.js";

const NOOP_NAME_REGISTRY: NameRegistryService = {
  auditCodeNamesAgainstRegistry() {
    return [];
  },
};

function snapshotToRecord(snapshot?: CodeSnapshot): Record<string, string> {
  if (!snapshot) return {};
  return Object.fromEntries(snapshot.files.entries());
}

function isolateSnapshot(snapshot: CodeSnapshot): CodeSnapshot {
  return {
    label: snapshot.label,
    commit: snapshot.commit,
    files: new Map(snapshot.files),
  };
}

/**
 * Red-before-green sealed check binder backed by `@ef-harness/verifier` (`C24`).
 * Evaluates declared `AcceptanceCheck` contracts through `BlindBinderOrchestrator`
 * / `RedBeforeGreenGate` and isolates base/feature snapshots during execution.
 */
export class RedBeforeGreenBlindBinder implements BlindBinderPort {
  private readonly gate: RedBeforeGreenGate;
  private readonly orchestrator?: BlindBinderOrchestrator;

  constructor(options: { readonly gate?: RedBeforeGreenGate; readonly orchestrator?: BlindBinderOrchestrator } = {}) {
    this.gate = options.gate ?? new RedBeforeGreenGate();
    if (options.orchestrator !== undefined) {
      this.orchestrator = options.orchestrator;
    }
  }

  async bind(
    check: SealedCheck,
    context?: { readonly base?: CodeSnapshot; readonly feature?: CodeSnapshot },
  ): Promise<SealedCheck> {
    if (check.acceptanceCheck !== undefined) {
      const acceptance = check.acceptanceCheck;
      const baseFiles = snapshotToRecord(context?.base);
      if (this.orchestrator !== undefined && context?.feature !== undefined) {
        const result = await this.orchestrator.bind(acceptance, {
          baseFiles,
          candidateFiles: snapshotToRecord(context.feature),
        });
        if (result.defect?.classification === "false_green") {
          throw new VacuousSealedCheckError(check.id);
        }
        if (!result.locked) {
          const message = result.defect?.message ?? `Blind binder did not lock check ${check.id}`;
          return {
            ...check,
            async run() {
              return { pass: false, observed: message };
            },
          };
        }
      } else {
        const decision = await this.gate.evaluate({
          check: acceptance,
          baseFiles,
          run: kernelRun(acceptance),
        });
        if (decision.classification === "false_green") {
          throw new VacuousSealedCheckError(check.id);
        }
      }
    }
    return {
      ...check,
      async run(snapshot) {
        return check.run(isolateSnapshot(snapshot));
      },
    };
  }
}

export function bindBlindBinderOrchestrator(
  orchestrator: BlindBinderOrchestrator,
  gate?: RedBeforeGreenGate,
): BlindBinderPort {
  return new RedBeforeGreenBlindBinder({
    orchestrator,
    ...(gate !== undefined ? { gate } : {}),
  });
}

export const passthroughBinder: BlindBinderPort = {
  async bind(check) {
    return check;
  },
};

/**
 * Binds `@ef-harness/completeness-gate` `CompletenessGateRunner` (`C23`)
 * into the integrator's async `StaticAuditPort`.
 */
export function bindCompletenessGateRunner(
  runner?: CompletenessGateRunner,
  defaults: { readonly nameRegistry?: NameRegistryService } = {},
): StaticAuditPort {
  return {
    async audit(input) {
      if (input.files.length === 0) return [];
      const activeRegistry =
        input.nameRegistry ??
        (input.registry !== undefined ? createLocalNameRegistry(input.registry) : undefined) ??
        defaults.nameRegistry ??
        NOOP_NAME_REGISTRY;
      const activeRunner =
        runner ??
        new CompletenessGateRunner({
          astEngine: createLocalStaticAuditAstEngine(),
          safetyScanner: createLocalGitSafetyScanner(),
          nameRegistry: activeRegistry,
        });
      const workspaceFiles = input.files.map((file) => ({ path: file.path, content: file.text }));
      const report = activeRunner.runFeatureStaticAudit({
        taskId: input.taskId,
        featureId: input.featureId,
        actor: "integrator",
        baseRef: input.baseRef,
        candidateRef: input.candidateRef,
        files: input.files.map((file) => ({
          path: file.path,
          status: "modified" as const,
          afterText: file.text,
        })),
        workspaceFiles,
        featureFiles: workspaceFiles,
        mergedTaskIds: [input.taskId],
        allFeatureTaskIds: [input.taskId],
        produces: [],
        schemaFields: [],
        staticData: [],
        approvedDeferralIds: [],
        excludedGeneratedPaths: [],
        seedFixturePaths: [],
        protectedTestPaths: [],
        protectedTestConfigPaths: [],
        lockedSnapshotPaths: [],
        verificationScopeGrant: false,
        writeScope: input.writeScope ?? input.files.map((file) => file.path),
        integratorConflictHunks: (input.conflictHunks ?? []).map((hunk) => ({
          file: hunk.path,
          startLine: hunk.startLine,
          endLine: hunk.endLine,
        })),
        declaredSharedFiles: input.declaredSharedFiles ?? [
          ...UI_SHARED_FILES,
          ...BACKEND_SHARED_FILES,
          "src/subscriptions.ts",
        ],
        errorHandlingRequiresSurface: false,
        entryPoints: input.entryPoints ?? input.files.map((file) => file.path),
        registeredAssets: [],
        publicFiles: [],
        assetModuleSources: [],
        visibleExampleLiterals: [],
        deletionDeclared: false,
        justifiedTaskNotes: [],
        registry: input.registry ?? { names: [] },
        vaultSecrets: [],
      });
      return report.findings.map(
        (finding) => `${finding.file}:${finding.line} [${finding.ruleId}] ${finding.message}`,
      );
    },
  };
}

/**
 * Binds `@ef-harness/verifier` `UiInteractionContractVerifier` (`C24`) into `ViewportCheck`.
 */
export function bindUiInteractionContractVerifier(
  verifier: UiInteractionContractVerifier,
  spec: {
    readonly id: string;
    readonly width: 375 | 1440;
    readonly request: UiVerificationRequest;
  },
): ViewportCheck {
  return {
    id: spec.id,
    width: spec.width,
    async render() {
      const result = await verifier.verify(spec.request);
      return {
        text: result.message.trim() || (result.passed ? "verified" : ""),
        overflow: !result.passed,
        tapTargetPx: result.passed ? 48 : 0,
      };
    },
  };
}

const DEFAULT_STATIC_AUDIT = bindCompletenessGateRunner();

export async function auditTexts(files: readonly FileText[]): Promise<string[]> {
  return [...(await DEFAULT_STATIC_AUDIT.audit({
    featureId: "feature-audit",
    taskId: "wiring-audit",
    baseRef: "HEAD",
    candidateRef: "HEAD",
    files,
  }))];
}

export interface JourneyEvaluationInput {
  readonly base: CodeSnapshot;
  readonly feature: CodeSnapshot;
  readonly sealedChecks: readonly SealedCheck[];
  readonly mounts: readonly RouteMount[];
  readonly journeys: readonly SeamJourney[];
  readonly viewportChecks: readonly ViewportCheck[];
  readonly auditFiles: readonly FileText[];
  readonly binder?: BlindBinderPort;
  readonly staticAudit?: StaticAuditPort;
  readonly featureId?: string;
  readonly taskId?: string;
  readonly entryPoints?: readonly string[];
  readonly conflictHunks?: readonly ConflictHunk[];
  readonly declaredSharedFiles?: readonly string[];
}

async function viewportProblems(checks: readonly ViewportCheck[]): Promise<string[]> {
  const problems: string[] = [];
  const widths = new Set(checks.map((check) => check.width));
  if (checks.length > 0 && (!widths.has(375) || !widths.has(1440))) {
    problems.push("Playwright viewport checks must execute both 375 and 1440");
  }
  for (const check of checks) {
    const rendered = await check.render(check.width);
    if (rendered.overflow) {
      problems.push(`${check.id} overflowed at ${check.width}px`);
    }
    if (check.width === 375 && rendered.tapTargetPx < 44) {
      problems.push(`${check.id} tap target ${rendered.tapTargetPx}px is below 44 at 375px`);
    }
    if (!rendered.text.trim()) {
      problems.push(`${check.id} rendered empty text at ${check.width}px`);
    }
  }
  return problems;
}

export class FeatureJourneyGate {
  constructor(private readonly defaultStaticAudit: StaticAuditPort = DEFAULT_STATIC_AUDIT) {}

  async evaluate(input: JourneyEvaluationInput): Promise<JourneyReport> {
    const binder = input.binder ?? new RedBeforeGreenBlindBinder();
    const proofs = [];
    for (const check of input.sealedChecks) {
      const bound = await binder.bind(check, { base: input.base, feature: input.feature });
      const base = await bound.run(input.base);
      const feature = await bound.run(input.feature);
      if (base.pass) {
        throw new VacuousSealedCheckError(check.id);
      }
      proofs.push({ checkId: check.id, basePassed: base.pass, featurePassed: feature.pass });
    }
    const seamFailures = input.journeys.flatMap((journey) => {
      const failure = executeSeamJourney(input.mounts, journey);
      return failure ? [failure] : [];
    });
    const viewportFailures = await viewportProblems(input.viewportChecks);
    const auditor = input.staticAudit ?? this.defaultStaticAudit;
    const auditFindings = [
      ...(await auditor.audit({
        featureId: input.featureId ?? "feature",
        taskId: input.taskId ?? "wiring",
        baseRef: input.base.commit,
        candidateRef: input.feature.commit,
        files: input.auditFiles,
        ...(input.entryPoints !== undefined ? { entryPoints: input.entryPoints } : {}),
        ...(input.conflictHunks !== undefined ? { conflictHunks: input.conflictHunks } : {}),
        ...(input.declaredSharedFiles !== undefined ? { declaredSharedFiles: input.declaredSharedFiles } : {}),
      })),
    ];
    const sealedMisses = proofs.filter((proof) => !proof.featurePassed);
    const hint = this.hintFor(
      seamFailures,
      viewportFailures,
      auditFindings,
      sealedMisses.map((proof) => proof.checkId),
    );
    const ok =
      sealedMisses.length === 0 &&
      seamFailures.length === 0 &&
      viewportFailures.length === 0 &&
      auditFindings.length === 0;
    return {
      ok,
      redBeforeGreen: proofs,
      seamFailures,
      viewportFailures,
      auditFindings,
      hint: ok ? null : hint,
    };
  }

  private hintFor(
    seamFailures: JourneyReport["seamFailures"],
    viewportFailures: readonly string[],
    auditFindings: readonly string[],
    sealedMisses: readonly string[],
  ): IntegrationFixHint {
    const mismatch = seamFailures.find(
      (failure) =>
        failure.expectedPath && failure.mountedPath && failure.expectedPath !== failure.mountedPath,
    );
    if (mismatch?.expectedPath && mismatch.mountedPath) {
      const repair: WiringRepair = { fromPath: mismatch.mountedPath, toPath: mismatch.expectedPath };
      return { round: 0, target: "seam", detail: mismatch.detail, repair };
    }
    const seam = seamFailures[0];
    if (seam) {
      return { round: 0, target: "seam", detail: seam.detail, repair: null };
    }
    const viewport = viewportFailures[0];
    if (viewport) {
      return { round: 0, target: "viewport", detail: viewport, repair: null };
    }
    const audit = auditFindings[0];
    if (audit) {
      return { round: 0, target: "audit", detail: audit, repair: null };
    }
    return {
      round: 0,
      target: "sealed",
      detail: `Sealed checks still failing on the feature commit: ${sealedMisses.join(", ")}`,
      repair: null,
    };
  }
}

export async function runBoundedFixLoop<T>(options: {
  readonly maxRounds?: number;
  readonly initial: T;
  readonly evaluate: (state: T) => JourneyReport | Promise<JourneyReport>;
  readonly apply: (state: T, repair: WiringRepair) => T | Promise<T>;
}): Promise<{ readonly state: T; readonly report: JourneyReport; readonly hints: IntegrationFixHint[] }> {
  const maxRounds = options.maxRounds ?? MAX_FIX_ROUNDS;
  let state = options.initial;
  let report = await options.evaluate(state);
  const hints: IntegrationFixHint[] = [];
  let round = 0;
  while (!report.ok) {
    if (round >= maxRounds) break;
    const hint = report.hint;
    if (!hint) break;
    round += 1;
    const stamped = { ...hint, round };
    hints.push(stamped);
    if (!hint.repair) break;
    state = await options.apply(state, hint.repair);
    report = await options.evaluate(state);
  }
  return { state, report, hints };
}

export function mountsOf(plans: Parameters<typeof mountFromPlan>[0][]): RouteMount[] {
  return plans.map((plan) => mountFromPlan(plan));
}
