import { attributeVerificationFailure } from "./attribution.js";
import type { CollectedCase } from "./reporters.js";
import type {
  AttributionRoute,
  CheckDbStatus,
  CheckStability,
  EnvironmentFailureKind,
  FailureAttribution,
  FailureAttributionDecision,
  HintFailureType,
  RequirementResolution,
  RunSignals,
} from "./types.js";
import type { MaterializedCheck } from "./materialize.js";

export interface CollectedEvidence {
  readonly present: boolean;
  readonly reporterStatus: CollectedCase["reporterStatus"];
  readonly hasObserved: boolean;
  readonly observed: unknown;
  readonly signals: RunSignals | null;
  readonly trace: Uint8Array;
  readonly log: Uint8Array;
}

export interface RunDraft {
  readonly materialized: MaterializedCheck;
  status: CheckDbStatus;
  stability: CheckStability;
  observed: unknown;
  hasObserved: boolean;
  signals: RunSignals | null;
  runs: CollectedEvidence[];
  decision: FailureAttributionDecision | null;
}

const SENSITIVE_SURFACES = new Set(["time", "network", "browser"]);

export function emptyEvidence(trace: Uint8Array, log: Uint8Array, signals: RunSignals | null): CollectedEvidence {
  return {
    present: false,
    reporterStatus: null,
    hasObserved: false,
    observed: null,
    signals,
    trace,
    log,
  };
}

export function evidenceFromCase(
  found: CollectedCase | undefined,
  trace: Uint8Array,
  log: Uint8Array,
  signals: RunSignals | null,
): CollectedEvidence {
  if (!found) return emptyEvidence(trace, log, signals);
  return {
    present: true,
    reporterStatus: found.reporterStatus,
    hasObserved: found.hasObserved,
    observed: found.hasObserved ? found.observed : null,
    signals,
    trace,
    log,
  };
}

export function judgeEvidence(check: MaterializedCheck, evidence: CollectedEvidence | undefined): {
  readonly status: CheckDbStatus;
  readonly observed: unknown;
  readonly hasObserved: boolean;
} {
  if (!evidence?.present) {
    return { status: "missing", observed: null, hasObserved: false };
  }
  if (evidence.signals?.environmentFailure) {
    return { status: "error", observed: evidence.observed, hasObserved: evidence.hasObserved };
  }
  if (evidence.signals?.bindingDefect || evidence.signals?.binderCrash || evidence.signals?.missingSetup) {
    return { status: "error", observed: evidence.observed, hasObserved: evidence.hasObserved };
  }
  if (evidence.signals?.contractMismatch || evidence.signals?.visibleControlMissing) {
    return { status: "fail", observed: evidence.observed, hasObserved: evidence.hasObserved };
  }
  if (evidence.reporterStatus === "skip") {
    return { status: "skip", observed: evidence.observed, hasObserved: evidence.hasObserved };
  }
  if (evidence.reporterStatus === "error") {
    return { status: "error", observed: evidence.observed, hasObserved: evidence.hasObserved };
  }
  if (!evidence.hasObserved) {
    return { status: "fail", observed: null, hasObserved: false };
  }
  const equal = stableEqual(evidence.observed, check.expected);
  return {
    status: equal ? "pass" : "fail",
    observed: evidence.observed,
    hasObserved: true,
  };
}

export function needsReplay(draft: RunDraft): boolean {
  const signals = draft.signals;
  if (signals?.environmentFailure || signals?.bindingDefect || signals?.binderCrash || signals?.missingSetup) {
    return false;
  }
  if (signals?.contractMismatch || signals?.visibleControlMissing) return false;
  if (draft.status === "missing" || draft.status === "skip" || draft.status === "error") return false;
  if (draft.materialized.ref.flaky && (draft.status === "pass" || draft.status === "fail")) return true;
  return SENSITIVE_SURFACES.has(draft.materialized.ref.surface) && draft.status === "fail";
}

export function applyJudgement(draft: RunDraft, evidence: CollectedEvidence): void {
  const judged = judgeEvidence(draft.materialized, evidence);
  draft.status = judged.status;
  draft.observed = judged.observed;
  draft.hasObserved = judged.hasObserved;
  draft.signals = evidence.signals;
  draft.runs = [evidence];
  draft.stability = "stable";
  draft.decision = decisionFor(draft, false);
}

export function applyReplay(draft: RunDraft, evidence: CollectedEvidence): void {
  const second = judgeEvidence(draft.materialized, evidence);
  draft.runs = [...draft.runs, evidence];
  const disagreed = (draft.status === "pass") !== (second.status === "pass");
  if (disagreed) {
    draft.stability = "unstable";
    draft.status = "error";
    draft.observed = second.observed;
    draft.hasObserved = second.hasObserved;
    draft.signals = null;
    draft.decision = decisionFor(draft, true);
    return;
  }
  draft.status = second.status;
  draft.observed = second.observed;
  draft.hasObserved = second.hasObserved;
  draft.signals = evidence.signals;
  draft.stability = "stable";
  draft.decision = decisionFor(draft, false);
}

export function environmentKindFromMessage(message: string): EnvironmentFailureKind | null {
  if (/postgres/i.test(message)) return "postgres_crash";
  if (/\boom\b|out of memory/i.test(message)) return "oom";
  if (/eaddrinuse|address already in use|port failure/i.test(message)) return "port_failure";
  if (/service crash|econnreset/i.test(message)) return "service_crash";
  return null;
}

export function headlineAttribution(drafts: readonly RunDraft[]): FailureAttribution | null {
  const order: readonly FailureAttribution[] = [
    "environment",
    "binding_defect",
    "implementation",
    "contract_mismatch",
    "flaky_test",
  ];
  const present = new Set<FailureAttribution>();
  for (const draft of drafts) {
    if (draft.decision) present.add(draft.decision.attribution);
  }
  for (const kind of order) {
    if (present.has(kind)) return kind;
  }
  return null;
}

export function requirementResolution(drafts: readonly RunDraft[]): RequirementResolution {
  if (drafts.length === 0) return "not_run";
  if (drafts.some((draft) => draft.decision?.attribution === "environment")) return "unresolved";
  if (drafts.some((draft) => draft.status !== "pass" && draft.decision?.requirementEffect === "failing")) {
    return "failing";
  }
  if (drafts.some((draft) => draft.stability === "unstable" || draft.decision?.requirementEffect === "unresolved")) {
    return "unresolved";
  }
  if (drafts.every((draft) => draft.status === "pass" && draft.stability === "stable")) return "passing";
  return "failing";
}

export function inferFailureType(status: CheckDbStatus): HintFailureType {
  if (status === "error") return "exception";
  if (status === "missing") return "missing_item";
  return "wrong_value";
}

function decisionFor(draft: RunDraft, flakyDisagreement: boolean): FailureAttributionDecision | null {
  if (!flakyDisagreement && draft.status === "pass") return null;
  return attributeVerificationFailure({
    status: flakyDisagreement ? "unstable" : draft.status,
    checkId: draft.materialized.ref.checkId,
    visibility: draft.materialized.ref.visibility,
    ruleId: draft.materialized.ref.ruleId,
    signals: flakyDisagreement ? null : draft.signals,
    flakyDisagreement,
  });
}

function stableEqual(observed: unknown, expected: unknown): boolean {
  return JSON.stringify(sortValue(observed)) === JSON.stringify(sortValue(expected));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child === undefined) continue;
    sorted[key] = sortValue(child);
  }
  return sorted;
}

export function routeOf(decision: FailureAttributionDecision | null): AttributionRoute | null {
  return decision?.route ?? null;
}
