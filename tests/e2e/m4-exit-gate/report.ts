import { createHash } from "node:crypto";
import { PASS_RATE_FLOOR, PPM_SCALE, REPORT_SCHEMA } from "./constants.js";
import type { AdapterConformance, GateFacts, ProviderRow, SignedReport } from "./types.js";

export class M4ExitGateReport {
  readonly schema = REPORT_SCHEMA;
  readonly mode = "ci-replay" as const;
  readonly exitCode: number;
  readonly claimedCertification: boolean;
  readonly reasons: readonly string[];
  readonly facts: GateFacts;
  readonly providers: readonly ProviderRow[];
  readonly scorecardMarkdown: string;
  readonly signature: string;
  readonly hostElapsedMs: number;

  private constructor(input: {
    readonly exitCode: number;
    readonly reasons: readonly string[];
    readonly facts: GateFacts;
    readonly providers: readonly ProviderRow[];
    readonly scorecardMarkdown: string;
    readonly signature: string;
    readonly hostElapsedMs: number;
  }) {
    this.exitCode = input.exitCode;
    this.claimedCertification = input.exitCode === 0;
    this.reasons = input.reasons;
    this.facts = input.facts;
    this.providers = input.providers;
    this.scorecardMarkdown = input.scorecardMarkdown;
    this.signature = input.signature;
    this.hostElapsedMs = input.hostElapsedMs;
  }

  static evaluate(facts: GateFacts, hostElapsedMs: number): M4ExitGateReport {
    const providers = providerRows(facts);
    const reasons = collectReasons(facts);
    const rowFail = providers.some((row) => [row.auth, row.conformance, row.pacing, row.compliance].includes("fail"));
    if (rowFail && reasons.length === 0) reasons.push("providerRow");
    reasons.sort();
    const exitCode = reasons.length === 0 ? 0 : 1;
    const draft: SignedReport = {
      schema: REPORT_SCHEMA,
      mode: "ci-replay",
      exitCode,
      claimedCertification: exitCode === 0,
      reasons,
      facts,
      providers,
      scorecardMarkdown: "",
    };
    const scorecardMarkdown = renderScorecard(draft);
    const signature = signReport({ ...draft, scorecardMarkdown });
    return new M4ExitGateReport({
      exitCode,
      reasons,
      facts,
      providers,
      scorecardMarkdown,
      signature,
      hostElapsedMs,
    });
  }

  renderScorecard(): string {
    return this.scorecardMarkdown;
  }

  toJSON(): string {
    return JSON.stringify(this.payload());
  }

  payload(): SignedReport & { readonly signature: string } {
    return {
      schema: this.schema,
      mode: this.mode,
      exitCode: this.exitCode,
      claimedCertification: this.claimedCertification,
      reasons: this.reasons,
      facts: this.facts,
      providers: this.providers,
      scorecardMarkdown: this.scorecardMarkdown,
      signature: this.signature,
    };
  }
}

export function signReport(payload: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`;
}

export function collectReasons(facts: GateFacts): string[] {
  const reasons: string[] = [];
  const reserveFloor = Math.round(0.2 * PPM_SCALE);
  if (facts.passRate < PASS_RATE_FLOOR) reasons.push("passRate");
  if (facts.hiddenLeak) reasons.push("hiddenLeak");
  if (facts.prematureLockouts !== 0) reasons.push("prematureLockouts");
  if (facts.personalReserveRemainingPpm < reserveFloor) reasons.push("personalReserve");
  if (!facts.tokenRefreshOk) reasons.push("tokenRefresh");
  if (facts.lostWip !== 0) reasons.push("lostWip");
  if (facts.failedTurns !== 0) reasons.push("failedTurns");
  if (!facts.withinFiveHours) reasons.push("fiveHourWindow");
  if (!facts.pacingProfileOk) reasons.push("pacingProfile");
  if (!facts.aimdOk) reasons.push("aimd");
  if (!facts.cwndCapHolds) reasons.push("cwnd");
  if (!facts.reserveBoundaryOk || facts.queuedStartedAt89 !== 0) reasons.push("reserveBoundary");
  if (facts.usageLimitDuringPacedBuild !== 0) reasons.push("usageLimit");
  if (facts.paidSpendMicroUsd !== 0) reasons.push("paidSpend");
  if (facts.unconsentedPaidRequests !== 0 || facts.anthropicPosts !== 0) reasons.push("paidRequests");
  if (facts.openRouterRequestCount !== 0) reasons.push("openRouterLeak");
  if (facts.copilotRequestsAfterQuotaZero !== 0) reasons.push("copilotOverage");
  if (!facts.consentDrillAllowsPaid) reasons.push("consentDrill");
  if (!facts.exhaustionOk) reasons.push("exhaustion");
  if (!facts.conformanceAllTen) reasons.push("conformance");
  if (!facts.rogueDowngradeOk) reasons.push("rogueDowngrade");
  if (facts.productionTrapHits !== 0 || facts.rogueTrapHits < 1) reasons.push("p06");
  if (!facts.cacheHitUnder2ms || !facts.cacheInvalidatesOnVersion) reasons.push("conformanceCache");
  if (!facts.interruptUnder2s) reasons.push("interrupt");
  if (!facts.processCleanupOk) reasons.push("processCleanup");
  if (!facts.claudeOk || facts.setupCommandHits !== 0) reasons.push("termsClaude");
  if (!facts.geminiOk || !facts.geminiDefaultOff || facts.personalGeminiPathHits !== 0) reasons.push("termsGemini");
  if (facts.withdrawnHits !== 0) reasons.push("termsWithdrawn");
  if (!facts.wireOk || facts.wireProblems.length > 0) reasons.push("wire");
  if (!facts.handoffOk || !facts.userApprovedSwitch || facts.wipTreeSha !== facts.restoredTreeSha) reasons.push("handoffWip");
  if (facts.ephemeralLeftovers !== 0) reasons.push("handoffClean");
  if (!facts.analyticsSeparated) reasons.push("analytics");
  if (!facts.csvSafe) reasons.push("csv");
  if (!facts.idleParkOk || facts.idleTerminatedAtMs !== 90_000 || !facts.idleCheckpointPreserved) reasons.push("idlePark");
  if (facts.tokenRefreshOk && facts.failedTurns === 0 && (facts.oidcTokenPosts < 1 || facts.responsePosts < 8)) {
    reasons.push("mockServers");
  }
  return reasons;
}

function providerRows(facts: GateFacts): ProviderRow[] {
  const scenario = (id: string): boolean => facts.scenarios.some((item) => item.id === id && item.ok);
  const adapter = (id: string): boolean => passedAdapter(facts.adapters, id);
  const paced =
    facts.pacingProfileOk &&
    facts.aimdOk &&
    facts.reserveBoundaryOk &&
    facts.prematureLockouts === 0 &&
    facts.withinFiveHours &&
    facts.cwndCapHolds;
  const noPaid = facts.unconsentedPaidRequests === 0 && facts.paidSpendMicroUsd === 0;
  return [
    row("ChatGPT Plus", facts.tokenRefreshOk, facts.wireOk, paced, facts.passRate >= PASS_RATE_FLOOR && !facts.hiddenLeak && facts.lostWip === 0),
    row("GitHub Copilot", scenario("copilot-overage"), adapter("copilot"), facts.copilotRequestsAfterQuotaZero === 0, scenario("copilot-overage") && facts.openRouterRequestCount === 0),
    row("Cursor", scenario("cursor-expired"), adapter("cursor"), noPaid, scenario("cursor-expired")),
    row("Ollama", scenario("ollama-down"), scenario("ollama-down"), noPaid, scenario("ollama-down") && noPaid),
    row("Anthropic Console", facts.claudeOk, adapter("claude-code"), noPaid, facts.claudeOk && noPaid),
    row("Gemini CLI", facts.geminiDefaultOff, adapter("gemini-cli"), true, facts.geminiOk && facts.personalGeminiPathHits === 0),
    row("OpenRouter", true, facts.openRouterRequestCount === 0, noPaid, facts.openRouterRequestCount === 0),
    row("Generic ACP", true, adapter("generic-acp"), true, facts.conformanceAllTen),
    row("Codex", facts.handoffOk, adapter("codex"), facts.ephemeralLeftovers === 0, facts.handoffOk && facts.ephemeralLeftovers === 0),
    row("OpenCode", true, adapter("opencode"), facts.productionTrapHits === 0, adapter("opencode") && facts.productionTrapHits === 0),
  ];
}

function passedAdapter(adapters: readonly AdapterConformance[], id: string): boolean {
  return adapters.some((adapter) => adapter.adapterId === id && adapter.passed === 10 && adapter.trust === "wrapped");
}

function row(provider: string, auth: boolean, conformance: boolean, pacing: boolean, compliance: boolean): ProviderRow {
  return {
    provider,
    auth: auth ? "pass" : "fail",
    conformance: conformance ? "pass" : "fail",
    pacing: pacing ? "pass" : "fail",
    compliance: compliance ? "pass" : "fail",
  };
}

function renderScorecard(report: SignedReport): string {
  const lines = [
    "# M4 Exit Gate Scorecard",
    "",
    `Exit: ${report.exitCode}`,
    "",
    "| Provider | Auth | Conformance | Pacing | Compliance |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const provider of report.providers) {
    lines.push(`| ${provider.provider} | ${provider.auth} | ${provider.conformance} | ${provider.pacing} | ${provider.compliance} |`);
  }
  lines.push("");
  lines.push(`Hidden pass rate: ${report.facts.hiddenPassed}/${report.facts.hiddenTotal}`);
  lines.push(`Personal reserve remaining ppm: ${report.facts.personalReserveRemainingPpm}`);
  lines.push(`Unconsented paid requests: ${report.facts.unconsentedPaidRequests}`);
  lines.push(`Reasons: ${report.reasons.length === 0 ? "none" : report.reasons.join(", ")}`);
  lines.push("");
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
