import { checkCitation } from "./citations.js";
import { consultModel, estimateTokens, selectFamily } from "./model-select.js";
import { budgetPressure } from "./ports.js";
import type { UiPlaywrightContractVerifier } from "./ports.js";
import { buildTastePrompt } from "./prompts.js";
import { isBlockedExit, parseTasteReviewerV1 } from "./schemas.js";
import type { TasteFindingV1 } from "./schemas.js";
import type {
  CitationGround,
  LayoutEscalation,
  PolishOffer,
  SpecialistModel,
  TasteFinding,
  TasteReviewRequest,
  TasteReviewResult,
  TasteScreenshot,
} from "./types.js";

const PRESERVED = { deterministicUiChecks: true, reviewerOnSecurityDiffs: true } as const;

const LIVE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SYNTHETIC_EMAIL = /@(?:example\.(?:com|org|net|test)|seed\.test|[A-Za-z0-9.-]+\.invalid)$/i;
const SECRET_IN_BYTES = /password\s*=\s*\S+|bearer\s+[A-Za-z0-9._-]{12,}/i;
const LAYOUT_DEFECT = /overlap|clipped|cut off|overflow|off-screen|cramped|collision/i;

export interface AdvisoryTasteVisionReviewerOptions {
  readonly model: SpecialistModel | null;
  readonly verifier?: UiPlaywrightContractVerifier | null;
}

function emptyResult(
  request: TasteReviewRequest,
  status: TasteReviewResult["status"],
  reason: string,
): TasteReviewResult {
  return {
    taskId: request.taskId,
    label: "ADVISORY ONLY",
    blocksMerge: false,
    tokensSpent: 0,
    modelInvoked: false,
    preserves: PRESERVED,
    status,
    findings: [],
    polishOffer: null,
    layoutEscalation: null,
    missingCaptures: [],
    reason,
  };
}

function bytesText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

export function screenshotRedactionProblem(shot: TasteScreenshot): string | null {
  if (shot.environment !== "synthetic_test_env") {
    return "screenshot is not from the synthetic seeded test environment";
  }
  if (!shot.seeded || shot.seedReceiptId === null || shot.seedReceiptId.trim().length === 0) {
    return "screenshot is missing its synthetic seed receipt";
  }
  const text = bytesText(shot.bytes);
  if (SECRET_IN_BYTES.test(text)) return "screenshot bytes contain a secret";
  const emails = text.match(LIVE_EMAIL) ?? [];
  if (emails.some((email) => !SYNTHETIC_EMAIL.test(email))) {
    return "screenshot bytes contain live customer data";
  }
  return null;
}

function missingCaptures(shots: readonly TasteScreenshot[]): string[] {
  const missing: string[] = [];
  if (!shots.some((shot) => shot.kind === "full_page")) missing.push("full_page");
  if (!shots.some((shot) => shot.kind === "mobile" && shot.viewportWidth === 375)) missing.push("mobile_375");
  if (!shots.some((shot) => shot.kind === "desktop" && shot.viewportWidth === 1440)) missing.push("desktop_1440");
  if (!shots.some((shot) => shot.kind === "styleguide")) missing.push("styleguide");
  return missing;
}

function sourceLines(): Set<number> {
  const lines = new Set<number>();
  for (let line = 1; line <= 400; line += 1) lines.add(line);
  return lines;
}

function groundFor(request: TasteReviewRequest, shots: readonly TasteScreenshot[]): CitationGround {
  const files = new Map<string, Set<number>>();
  const remember = (path: string): void => {
    if (!files.has(path)) files.set(path, sourceLines());
  };
  for (const path of request.knownFiles) remember(path);
  for (const shot of shots) {
    for (const path of shot.sourceFiles) remember(path);
  }
  return {
    files,
    nodeIds: new Set(request.knownNodeIds),
    receiptIds: new Set(request.knownReceiptIds),
  };
}

function toFinding(raw: TasteFindingV1, ground: CitationGround): TasteFinding | null {
  const file = /file:([^\s:]+):(\d+)(?:-(\d+))?/.exec(raw.suggestion);
  const node = /node:([A-Za-z0-9._-]+)/.exec(raw.suggestion);
  const receipt = /receipt:([A-Za-z0-9._:-]+)/.exec(raw.suggestion);
  const citation: {
    filePath?: string;
    lineRange?: { start: number; end: number };
    nodeId?: string;
    receiptId?: string;
  } = {};
  if (file?.[1] && file[2]) {
    const start = Number(file[2]);
    citation.filePath = file[1];
    citation.lineRange = { start, end: file[3] === undefined ? start : Number(file[3]) };
  }
  if (node?.[1]) citation.nodeId = node[1];
  if (receipt?.[1]) citation.receiptId = receipt[1];
  const named =
    citation.filePath !== undefined || citation.nodeId !== undefined || citation.receiptId !== undefined;
  if (named && !checkCitation(citation, ground).ok) return null;
  return {
    screen: raw.screen,
    region: raw.region,
    kind: raw.kind,
    severity: raw.severity,
    suggestion: raw.suggestion,
    blocksMerge: false,
  };
}

function layoutEscalation(findings: readonly TasteFinding[]): LayoutEscalation | null {
  const candidate = findings.find(
    (finding) =>
      finding.severity === "high" &&
      (finding.kind === "spacing" || finding.kind === "alignment" || finding.kind === "hierarchy") &&
      LAYOUT_DEFECT.test(finding.suggestion),
  );
  if (!candidate) return null;
  return {
    confidence: "high",
    blocksMerge: false,
    requiresUserApproval: true,
    summary: candidate.suggestion,
  };
}

export class AdvisoryTasteVisionReviewer {
  private readonly model: SpecialistModel | null;
  private readonly verifier: UiPlaywrightContractVerifier | null;

  constructor(options: AdvisoryTasteVisionReviewerOptions) {
    this.model = options.model;
    this.verifier = options.verifier ?? null;
  }

  review(request: TasteReviewRequest): TasteReviewResult {
    if (request.stage === "Prototype") {
      return emptyResult(request, "skipped_prototype", "Prototype stage skips advisory taste review");
    }
    if (request.preset === "Cheapest") {
      return emptyResult(request, "skipped_cheapest", "Cheapest preset skips advisory taste review");
    }
    const pressure = budgetPressure(request.budgetLimitUnits, request.budgetSpentUnits);
    if (pressure === "high" || pressure === "exhausted") {
      return emptyResult(request, "skipped_budget_pressure", "integration/review envelope is under pressure");
    }
    const family = selectFamily(request.roster, request.workerFamily, true);
    if (!family) {
      return emptyResult(request, "skipped_no_vision_model", "no vision-capable model is configured");
    }
    const screenshots =
      request.screenshots.length > 0
        ? request.screenshots
        : (this.verifier?.captureScreens([request.taskId]) ?? []);
    for (const shot of screenshots) {
      const problem = screenshotRedactionProblem(shot);
      if (problem) return emptyResult(request, "rejected_non_synthetic", problem);
    }
    const prompt = buildTastePrompt(screenshots);
    const imageBytes = screenshots.reduce((sum, shot) => sum + shot.bytes.byteLength, 0);
    const raw = consultModel(this.model, {
      role: "taste-reviewer@1",
      family: family.family,
      vision: true,
      prompt,
      imageBytes,
    });
    const tokensSpent = this.model === null && raw === null ? 0 : estimateTokens(prompt);
    const ground = groundFor(request, screenshots);
    const parsed = raw === null ? null : parseTasteReviewerV1(raw);
    const findings: TasteFinding[] = [];
    if (parsed?.ok && !isBlockedExit(parsed.value)) {
      for (const finding of parsed.value.findings) {
        const kept = toFinding(finding, ground);
        if (kept) findings.push(kept);
      }
    }
    const polishOffer: PolishOffer | null =
      findings.length > 0 ? { shots: 1, requiresUserApproval: true, applied: false } : null;
    return {
      taskId: request.taskId,
      label: "ADVISORY ONLY",
      blocksMerge: false,
      tokensSpent,
      modelInvoked: raw !== null || this.model !== null,
      preserves: PRESERVED,
      status: "advisory",
      findings,
      polishOffer,
      layoutEscalation: layoutEscalation(findings),
      missingCaptures: missingCaptures(screenshots),
      reason: null,
    };
  }
}
