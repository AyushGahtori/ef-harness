import { createHash } from "node:crypto";
import {
  BULLPEN_VISIBLE_DESK_CAP,
  DOC_COUNT,
  EXPECTED_OFFICE_TAG,
  HOST_BUDGET_MS,
  IDLE_CPU_CEILING,
  IMPACT_BUDGET_MS,
  L0_BUDGET_MS,
  MAX_FOCUS_FILES,
  MAX_QUEUE_LEN,
  MAX_VISUAL_LAG_MS,
  PINNED_COMMIT,
  PLAN_FILE_COUNT,
  PLAN_LINE_COUNT,
  REPORT_SCHEMA,
  SPOKEN_MISSING,
  SPOKEN_RULE_NORMALIZED,
  SPOKEN_THERE,
  ZOOM_SAMPLES,
} from "./constants.js";
import type { GateFacts, SignedReport } from "./types.js";

const ZOOM_TRAIL = ZOOM_SAMPLES.map((sample) => sample.level);

export class M5ExitGateReport {
  readonly schema = REPORT_SCHEMA;
  readonly mode: SignedReport["mode"];
  readonly exitCode: number;
  readonly claimedCertification: boolean;
  readonly reasons: readonly string[];
  readonly facts: GateFacts | null;
  readonly scorecardMarkdown: string;
  readonly signature: string;
  readonly hostElapsedMs: number;
  readonly liveCheckoutSeen: boolean;

  private constructor(input: {
    readonly mode: SignedReport["mode"];
    readonly exitCode: number;
    readonly reasons: readonly string[];
    readonly facts: GateFacts | null;
    readonly scorecardMarkdown: string;
    readonly signature: string;
    readonly hostElapsedMs: number;
    readonly liveCheckoutSeen: boolean;
  }) {
    this.mode = input.mode;
    this.exitCode = input.exitCode;
    this.claimedCertification = input.exitCode === 0;
    this.reasons = input.reasons;
    this.facts = input.facts;
    this.scorecardMarkdown = input.scorecardMarkdown;
    this.signature = input.signature;
    this.hostElapsedMs = input.hostElapsedMs;
    this.liveCheckoutSeen = input.liveCheckoutSeen;
  }

  static evaluate(facts: GateFacts, hostElapsedMs: number): M5ExitGateReport {
    const reasons = collectReasons(facts, hostElapsedMs);
    const exitCode = reasons.length === 0 ? 0 : 1;
    const draft: SignedReport = {
      schema: REPORT_SCHEMA,
      mode: "ci-replay",
      exitCode,
      claimedCertification: exitCode === 0,
      reasons,
      facts,
      scorecardMarkdown: "",
      liveCheckoutSeen: false,
    };
    const scorecardMarkdown = renderScorecard(draft);
    const signed: SignedReport = { ...draft, scorecardMarkdown };
    return new M5ExitGateReport({
      mode: "ci-replay",
      exitCode,
      reasons,
      facts,
      scorecardMarkdown,
      signature: signReport(signed),
      hostElapsedMs,
      liveCheckoutSeen: false,
    });
  }

  static live(liveCheckoutSeen: boolean): M5ExitGateReport {
    const reasons = ["liveNotClaimed"];
    const draft: SignedReport = {
      schema: REPORT_SCHEMA,
      mode: "live",
      exitCode: 2,
      claimedCertification: false,
      reasons,
      facts: null,
      scorecardMarkdown: "",
      liveCheckoutSeen,
    };
    const scorecardMarkdown = renderScorecard(draft);
    const signed: SignedReport = { ...draft, scorecardMarkdown };
    return new M5ExitGateReport({
      mode: "live",
      exitCode: 2,
      reasons,
      facts: null,
      scorecardMarkdown,
      signature: signReport(signed),
      hostElapsedMs: 0,
      liveCheckoutSeen,
    });
  }

  renderScorecard(): string {
    return this.scorecardMarkdown;
  }

  toJSON(): string {
    return JSON.stringify(this.payload());
  }

  payload(): SignedReport & { readonly signature: string; readonly hostElapsedMs: number } {
    return {
      schema: this.schema,
      mode: this.mode,
      exitCode: this.exitCode,
      claimedCertification: this.claimedCertification,
      reasons: this.reasons,
      facts: this.facts,
      scorecardMarkdown: this.scorecardMarkdown,
      liveCheckoutSeen: this.liveCheckoutSeen,
      signature: this.signature,
      hostElapsedMs: this.hostElapsedMs,
    };
  }
}

export function signReport(payload: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`;
}

export function collectReasons(facts: GateFacts, hostElapsedMs: number): string[] {
  const reasons: string[] = [];
  if (!facts.manifestOk || facts.commit !== PINNED_COMMIT || facts.docCount !== DOC_COUNT) reasons.push("manifest");
  if (facts.planFileCount !== PLAN_FILE_COUNT || facts.planLineCount !== PLAN_LINE_COUNT) reasons.push("manifest");
  if (!facts.stackNext || !facts.stackTailwind || !facts.stackVitest) reasons.push("l0Scan");
  if (facts.secretBytesRead !== 0) reasons.push("l0Secrets");
  if (facts.l0ElapsedMs >= L0_BUDGET_MS) reasons.push("l0Latency");
  if (facts.symbolCount < 1 || facts.rankedFileCount < 1 || facts.codeIndexDb !== "code-index.db") reasons.push("l1Index");
  if (facts.focusCount < 1 || facts.focusCount > MAX_FOCUS_FILES || facts.focusIncludesDeleted) reasons.push("l2Focus");
  if (!facts.staleFlagged || !facts.staleIgnored) reasons.push("staleDocs");
  if (!facts.preSpendShown || facts.preSpendTokens < 1) reasons.push("preSpend");
  if (facts.stackQuestions !== 0) reasons.push("stackQuestions");
  if (!facts.conventionsPreserved) reasons.push("conventions");
  if (facts.baselinePassRate !== 1 || !facts.newChecksPass) reasons.push("baselineRegression");
  if (facts.secondUiKit) reasons.push("secondUiKit");
  if (!facts.todayChangeConfirmed) reasons.push("todayChange");
  if (facts.interruptions !== 0) reasons.push("coexistence");
  if (!facts.shaPreserved) reasons.push("shaPreserved");
  if (facts.stashCount !== 0) reasons.push("silentStash");
  if (!facts.humanOwned || !facts.developerAuthorship) reasons.push("humanAuthorship");
  if (!facts.scopeFenceOk) reasons.push("scopeFence");
  if (facts.uiStagesPassed !== 6) reasons.push("uiConsistency");
  if (!facts.contrastOk) reasons.push("uiContrast");
  if (!facts.rhythmOk) reasons.push("uiRhythm");
  if (facts.pinnedCount !== 3 || !facts.pinnedSurvived) reasons.push("pinnedDrag");
  if (facts.zoomTrail.join(",") !== ZOOM_TRAIL.join(",")) reasons.push("semanticZoom");
  if (facts.impactLlmCalls !== 0 || facts.impactElapsedMs >= IMPACT_BUDGET_MS) reasons.push("impactPreview");
  if (!facts.driftPromptShown) reasons.push("driftConflict");
  if (!facts.highlightExact) reasons.push("changeHighlight");
  if (!facts.draftsPreserved) reasons.push("draftPreserve");
  if (!facts.mismatchBlocked) reasons.push("typeMismatch");
  if (facts.dictationAutoSend) reasons.push("dictationAutoSend");
  if (!facts.hintAt3s || !facts.micOnAt3s || !facts.micOffAt60s || !facts.draftKept || !facts.streamedGreyThenBlack) {
    reasons.push("dictationTiming");
  }
  if (!facts.amberTimes || !facts.amberNegations) reasons.push("amberHighlight");
  if (!facts.supabasePromoted) reasons.push("vocabCorrection");
  if (
    facts.spokenRuleSeventeen !== SPOKEN_RULE_NORMALIZED ||
    facts.spokenThereSeventeen !== SPOKEN_THERE ||
    facts.spokenMissingId !== SPOKEN_MISSING
  ) {
    reasons.push("spokenId");
  }
  if (!facts.previewIsolated) reasons.push("previewPartition");
  if (facts.demoRowsKept !== 2) reasons.push("demoDb");
  if (facts.prodSourceTagsCount !== 0) reasons.push("prodSourceTags");
  if (!facts.clickCaptured || !facts.gapCaptured) reasons.push("pointToFix");
  if (!facts.baselineUpdated) reasons.push("beforeAfter");
  if (facts.roomCount !== 11 || !facts.castTruthful || facts.decorativeNpcs !== 0) reasons.push("officeCast");
  if (facts.officeTag !== EXPECTED_OFFICE_TAG) reasons.push("officeTag");
  if (facts.helperVisible !== 3 || facts.helperPill !== "+2") reasons.push("officeHelpers");
  if (facts.iconLagMs !== 0) reasons.push("officeIconLatency");
  if (facts.maxVisualLagMs > MAX_VISUAL_LAG_MS) reasons.push("officeVisualLag");
  if (facts.burstQueueLen < 1 || facts.burstQueueLen > MAX_QUEUE_LEN) reasons.push("officeBurst");
  if (facts.idleCpuPercent >= IDLE_CPU_CEILING) reasons.push("officeIdleCpu");
  if (facts.hiddenCpuPercent !== 0) reasons.push("officeHiddenCpu");
  if (!facts.reducedMotionStatic) reasons.push("reducedMotion");
  if (!facts.orangeBoard) reasons.push("orangeBoard");
  if (facts.hotDeskWorkers < 30 || facts.hotDeskOverflow !== facts.hotDeskWorkers - BULLPEN_VISIBLE_DESK_CAP) {
    reasons.push("hotDeskOverflow");
  }
  if (facts.axeSerious !== 0) reasons.push("axeSerious");
  if (hostElapsedMs >= HOST_BUDGET_MS) reasons.push("hostElapsed");
  return [...new Set(reasons)].sort();
}

function renderScorecard(report: SignedReport): string {
  const facts = report.facts;
  const lines = [
    "# M5 Exit Gate Scorecard",
    "",
    `Exit: ${report.exitCode}`,
    `Mode: ${report.mode}`,
    `Benchmark: ${facts?.commit ?? PINNED_COMMIT}`,
    `Docs: ${facts?.docCount ?? DOC_COUNT}`,
    `Plan files: ${facts?.planFileCount ?? PLAN_FILE_COUNT}`,
    `Plan lines: ${facts?.planLineCount ?? PLAN_LINE_COUNT}`,
    "",
    "| Gate | Result |",
    "| --- | --- |",
    `| Brownfield guided change | ${facts && facts.manifestOk && facts.stashCount === 0 && facts.baselinePassRate === 1 ? "pass" : "fail"} |`,
    `| Interactive UX | ${facts && facts.prodSourceTagsCount === 0 && !facts.dictationAutoSend ? "pass" : "fail"} |`,
    `| Office truthfulness | ${facts && facts.maxVisualLagMs <= MAX_VISUAL_LAG_MS && facts.iconLagMs === 0 ? "pass" : "fail"} |`,
    "",
    `Prod JSX tags: ${facts?.prodSourceTagsCount ?? "n/a"}`,
    `Silent stash: ${facts?.stashCount ?? "n/a"}`,
    `Max visual lag ms: ${facts?.maxVisualLagMs ?? "n/a"}`,
    `Office tag: ${facts?.officeTag ?? "n/a"}`,
    `Reasons: ${report.reasons.length === 0 ? "none" : report.reasons.join(", ")}`,
    "",
  ];
  return lines.join("\n");
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("report contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => key !== "signature" && key !== "hostElapsedMs")
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("report contains an unsupported value");
}
