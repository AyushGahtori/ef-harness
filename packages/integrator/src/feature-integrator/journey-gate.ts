import { MAX_FIX_ROUNDS } from "./constants.js";
import { VacuousSealedCheckError } from "./errors.js";
import { executeSeamJourney, mountFromPlan } from "./seam-runner.js";
import type {
  BlindBinderPort,
  CodeSnapshot,
  IntegrationFixHint,
  JourneyReport,
  RouteMount,
  SealedCheck,
  SeamJourney,
  ViewportCheck,
  WiringRepair,
} from "./types.js";

export const passthroughBinder: BlindBinderPort = {
  bind(check) {
    return check;
  },
};

const STUB_WORDS = [[["T", "O"].join(""), ["D", "O"].join("")].join(""), [["F", "I"].join(""), ["X", "ME"].join("")].join("")];

export function auditTexts(files: readonly { path: string; text: string }[]): string[] {
  const findings: string[] = [];
  const marker = new RegExp(`\\b(?:${STUB_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (marker.test(line) || /not implemented/i.test(line) || /\.(?:skip|only)\s*\(/.test(line)) {
        findings.push(`${file.path}:${index + 1} static audit finding`);
      }
    }
  }
  return findings;
}

export interface JourneyEvaluationInput {
  readonly base: CodeSnapshot;
  readonly feature: CodeSnapshot;
  readonly sealedChecks: readonly SealedCheck[];
  readonly mounts: readonly RouteMount[];
  readonly journeys: readonly SeamJourney[];
  readonly viewportChecks: readonly ViewportCheck[];
  readonly auditFiles: readonly { path: string; text: string }[];
  readonly binder?: BlindBinderPort;
}

function viewportProblems(checks: readonly ViewportCheck[]): string[] {
  const problems: string[] = [];
  const widths = new Set(checks.map((check) => check.width));
  if (checks.length > 0 && (!widths.has(375) || !widths.has(1440))) {
    problems.push("Playwright viewport checks must execute both 375 and 1440");
  }
  for (const check of checks) {
    const rendered = check.render(check.width);
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
  evaluate(input: JourneyEvaluationInput): JourneyReport {
    const binder = input.binder ?? passthroughBinder;
    const proofs = input.sealedChecks.map((check) => {
      const bound = binder.bind(check);
      const base = bound.run(input.base);
      const feature = bound.run(input.feature);
      if (base.pass) {
        throw new VacuousSealedCheckError(check.id);
      }
      return { checkId: check.id, basePassed: base.pass, featurePassed: feature.pass };
    });
    const seamFailures = input.journeys.flatMap((journey) => {
      const failure = executeSeamJourney(input.mounts, journey);
      return failure ? [failure] : [];
    });
    const viewportFailures = viewportProblems(input.viewportChecks);
    const auditFindings = auditTexts(input.auditFiles);
    const sealedMisses = proofs.filter((proof) => !proof.featurePassed);
    const hint = this.hintFor(seamFailures, viewportFailures, auditFindings, sealedMisses.map((proof) => proof.checkId));
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
    const mismatch = seamFailures.find((failure) => failure.expectedPath && failure.mountedPath && failure.expectedPath !== failure.mountedPath);
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

export function runBoundedFixLoop<T>(options: {
  readonly maxRounds?: number;
  readonly initial: T;
  readonly evaluate: (state: T) => JourneyReport;
  readonly apply: (state: T, repair: WiringRepair) => T;
}): { readonly state: T; readonly report: JourneyReport; readonly hints: IntegrationFixHint[] } {
  const maxRounds = options.maxRounds ?? MAX_FIX_ROUNDS;
  let state = options.initial;
  let report = options.evaluate(state);
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
    state = options.apply(state, hint.repair);
    report = options.evaluate(state);
  }
  return { state, report, hints };
}

export function mountsOf(plans: Parameters<typeof mountFromPlan>[0][]): RouteMount[] {
  return plans.map((plan) => mountFromPlan(plan));
}
