import {
  GREEN_VERDICT,
  OPTIONAL_FOLLOW_UPS,
  PAPERWORK_CAP_PERCENT,
  RESIDUAL_CHOICES,
  needsReviewVerdict,
} from "./constants.js";
import { makeFinding } from "./text.js";
import type {
  ConfirmedFinding,
  CountTrio,
  LandingSummary,
  LayerAReport,
  LayerBReport,
  LedgerRecap,
  PlannedFeature,
  Regression,
  SpendSnapshot,
  SuiteCase,
  SuiteCaseKind,
} from "./types.js";

export interface LandingSummaryInput {
  readonly features: readonly PlannedFeature[];
  readonly routes: readonly string[];
  readonly commands: readonly string[];
  readonly layerA: LayerAReport;
  readonly layerB: LayerBReport;
  readonly findings: readonly ConfirmedFinding[];
  readonly regressions: readonly Regression[];
  readonly waivedFingerprints: readonly string[];
  readonly ledger: LedgerRecap;
  readonly spend: SpendSnapshot;
  readonly fixRounds: number;
  readonly budgetCapHit: boolean;
  readonly roundCapHit: boolean;
  readonly auditFixUnits: bigint;
  readonly auditFixCapUnits: bigint;
  readonly finalAuditUnits: bigint;
  readonly finalAuditCapUnits: bigint;
}

function trio(cases: readonly SuiteCase[], kind: SuiteCaseKind): CountTrio {
  const matching = cases.filter((item) => item.kind === kind);
  const passed = matching.filter((item) => item.passed).length;
  return { passed, failed: matching.length - passed, total: matching.length };
}

function formatShare(part: bigint, total: bigint): string {
  if (total <= 0n) return "0.0%";
  const tenths = (part * 1000n) / total;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return `${whole.toString()}.${fraction.toString()}%`;
}

function countLine(label: string, counts: CountTrio): string {
  return `${counts.passed} of ${counts.total} ${label} passed (${counts.failed} failed)`;
}

export class LandingSummaryGenerator {
  generate(input: LandingSummaryInput): LandingSummary {
    const waived = new Set(input.waivedFingerprints);
    const regressionIds = new Set(input.regressions.map((item) => item.caseId));
    const kept = input.findings.filter((finding) => {
      if (waived.has(finding.fingerprint)) return false;
      if (finding.code === "suite-failure" && [...regressionIds].some((id) => finding.detail.includes(id))) return false;
      return true;
    });
    const knownDetails = new Set(kept.map((finding) => finding.detail));
    for (const item of input.layerA.suiteCases) {
      if (item.passed || regressionIds.has(item.id)) continue;
      const detail = `${item.kind} ${item.id} failed for ${item.featureId}`;
      if (knownDetails.has(detail)) continue;
      knownDetails.add(detail);
      kept.push(
        makeFinding({
          code: "suite-failure",
          kind: "layer_a",
          severity: "high",
          detail,
          fixCostUnits: 0n,
        }),
      );
    }
    const regressionFindings = input.regressions.map((item) =>
      makeFinding({
        code: "regression",
        kind: "regression",
        severity: "critical",
        detail: item.detail,
        fixCostUnits: 0n,
      }),
    );
    const all = [...kept, ...regressionFindings];
    const unresolved = all.filter(
      (finding) => !finding.advisory && (finding.severity === "critical" || finding.severity === "high" || finding.severity === "medium"),
    );
    const optionalFollowUps = all.filter((finding) => finding.advisory).map((finding) => finding.detail);
    const readyToLand = unresolved.length === 0;
    const capped = input.budgetCapHit || input.roundCapHit;
    const choices = capped && !readyToLand ? RESIDUAL_CHOICES : null;
    const verdict = readyToLand ? GREEN_VERDICT : needsReviewVerdict(unresolved.length);
    const total = input.spend.codingUnits + input.spend.paperworkUnits;
    const paperworkWithinCap = total === 0n || input.spend.paperworkUnits * 100n <= total * PAPERWORK_CAP_PERCENT;
    const paperworkShare = formatShare(input.spend.paperworkUnits, total);
    const staticCheck = input.layerA.checks.find((item) => item.id === "A:static_audit");
    const secretCheck = input.layerA.checks.find((item) => item.id === "A:secret_scan");
    const crawlChecks = input.layerB.checks.filter((item) => item.id !== "B:teardown");
    const crawlPassed = crawlChecks.filter((item) => item.passed).length;
    const leaf = trio(input.layerA.suiteCases, "leaf");
    const journeys = trio(input.layerA.suiteCases, "feature_journey");
    const sealed = trio(input.layerA.suiteCases, "sealed_hidden");
    const summary: LandingSummary = {
      title: "Project Delivery & Landing Summary",
      presentation: "ship-build",
      verdict,
      readyToLand,
      whatWasBuilt: {
        features: input.features.map((feature) => ({
          id: feature.id,
          journeys: feature.journeys,
          routes: input.routes,
          commands: input.commands,
        })),
      },
      receipts: {
        leafTests: leaf,
        featureJourneys: journeys,
        sealedHiddenChecks: sealed,
        routeCrawler: {
          passed: crawlPassed,
          failed: crawlChecks.length - crawlPassed,
          total: crawlChecks.length,
          routes: input.routes.length,
        },
        staticAudit: {
          passed: staticCheck?.passed ?? false,
          findingCount: staticCheck?.findings.length ?? 0,
        },
        secretScan: {
          passed: secretCheck?.passed ?? false,
          hitCount: secretCheck?.findings.length ?? 0,
        },
      },
      chosenForYou: input.ledger.chosenForYou,
      deferred: input.ledger.deferred,
      spend: {
        codingUnits: input.spend.codingUnits,
        paperworkUnits: input.spend.paperworkUnits,
        paperworkShare,
        paperworkWithinCap,
        perConnection: input.spend.connections,
        auditFixUnits: input.auditFixUnits,
        auditFixCapUnits: input.auditFixCapUnits,
        finalAuditUnits: input.finalAuditUnits,
        finalAuditCapUnits: input.finalAuditCapUnits,
      },
      unresolvedFindings: unresolved,
      optionalFollowUps,
      optionalFollowUpsLabel: OPTIONAL_FOLLOW_UPS,
      choices,
      fixRounds: input.fixRounds,
      regressions: input.regressions,
      plainEnglish: "",
    };
    return { ...summary, plainEnglish: renderPlainEnglish(summary) };
  }
}

function renderPlainEnglish(summary: LandingSummary): string {
  const built = summary.whatWasBuilt.features
    .map((feature) => `${feature.id}: journeys ${feature.journeys.join(", ") || "(none)"}; routes ${feature.routes.join(", ") || "(none)"}; commands ${feature.commands.join(", ") || "(none)"}`)
    .join("\n");
  const chosen = summary.chosenForYou.map((item) => `${item.id}: ${item.summary}`).join("\n") || "(none)";
  const deferred = summary.deferred.map((item) => `${item.id}: ${item.summary}`).join("\n") || "(none)";
  const connections = summary.spend.perConnection
    .map((item) => `${item.connectionId} cost ${item.costUnits.toString()} used ${item.usedUnits.toString()} of window ${item.windowUnits.toString()}`)
    .join("\n");
  const followUps = summary.optionalFollowUps.length === 0 ? "(none)" : summary.optionalFollowUps.join("\n");
  const unresolved = summary.unresolvedFindings.map((finding) => finding.detail).join("\n") || "(none)";
  const choiceLine = summary.choices ? summary.choices.join(" / ") : "(none)";
  const regressions = summary.regressions.map((item) => item.detail).join("\n") || "(none)";
  return [
    "Project Delivery & Landing Summary",
    `Verdict: ${summary.verdict}`,
    "What was built",
    built,
    "Verification receipts",
    countLine("leaf tests", summary.receipts.leafTests),
    countLine("feature journeys", summary.receipts.featureJourneys),
    countLine("sealed hidden checks", summary.receipts.sealedHiddenChecks),
    countLine("route crawler checks", summary.receipts.routeCrawler),
    `STATIC_AUDIT ${summary.receipts.staticAudit.passed ? "passed" : "failed"} with ${summary.receipts.staticAudit.findingCount} findings`,
    `secret scan ${summary.receipts.secretScan.passed ? "passed" : "failed"} with ${summary.receipts.secretScan.hitCount} hits`,
    "Chosen for you",
    chosen,
    "Deferred",
    deferred,
    "Resource spend",
    `coding ${summary.spend.codingUnits.toString()}`,
    `paperwork ${summary.spend.paperworkUnits.toString()} (${summary.spend.paperworkShare}, cap 20% ${summary.spend.paperworkWithinCap ? "met" : "exceeded"})`,
    `audit fixes ${summary.spend.auditFixUnits.toString()} of ${summary.spend.auditFixCapUnits.toString()}`,
    `final audit ${summary.spend.finalAuditUnits.toString()} of ${summary.spend.finalAuditCapUnits.toString()}`,
    connections,
    `${summary.optionalFollowUpsLabel}`,
    followUps,
    "Unresolved findings",
    unresolved,
    "Regressions",
    regressions,
    "Choices",
    choiceLine,
    `Fix rounds: ${summary.fixRounds}`,
  ].join("\n");
}
