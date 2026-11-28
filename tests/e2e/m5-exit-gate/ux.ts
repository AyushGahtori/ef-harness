import {
  MemoryProjectStateCatalog,
  MemoryVocabularyStore,
  ProjectVerifiedSpokenIdNormalizer as LandedSpokenIdNormalizer,
  TwoOccurrenceCorrectionLearner as LandedCorrectionLearner,
  correctionTooltip,
} from "@ef-harness/dictation";
import { createDevOnlyJsxSourceTagPlugin } from "@ef-harness/planner";
import {
  BeforeAfterBaselineApprover as LandedBaselineApprover,
  InMemoryVisualBaselineStore,
  IsolatedPreviewWebviewHost as LandedPreviewHost,
  verifyCrossViewportAfterFix,
} from "@ef-harness/renderer";
import {
  APP_PARTITION,
  DICTATION_HINT,
  DICTATION_HINT_MS,
  DICTATION_MIC_OFF,
  DICTATION_MIC_OFF_MS,
  DICTATION_PAUSE_CHECK_MS,
  EF_SOURCE_ATTR,
  IMPACT_BUDGET_MS,
  LOW_CONFIDENCE,
  PREVIEW_PARTITION,
  SPOKEN_MISSING,
  SPOKEN_RULE,
  SPOKEN_THERE,
  VERIFIED_IDS,
  VOCAB_TOOLTIP,
  ZOOM_SAMPLES,
} from "./constants.js";
import type { M5Faults, UxFacts } from "./types.js";

const FILLERS = new Set(["the", "a", "an", "um", "uh", "and", "or"]);

export class SavedNodePositionStore {
  private readonly pins = new Map<string, { readonly x: number; readonly y: number }>();

  pin(id: string, x: number, y: number): void {
    this.pins.set(id, { x, y });
  }

  read(id: string): { readonly x: number; readonly y: number } | null {
    return this.pins.get(id) ?? null;
  }
}

export function wavePreservesPins(store: SavedNodePositionStore, drop: boolean): { readonly count: number; readonly survived: boolean } {
  const seeds = [
    ["box-a", 10, 20],
    ["box-b", 30, 40],
    ["box-c", 50, 60],
  ] as const;
  for (const [id, x, y] of seeds) store.pin(id, x, y);
  const before = seeds.map(([id]) => store.read(id));
  store.pin("wave-2-new", 80, 90);
  if (drop) store.pin("box-b", 1, 1);
  const after = seeds.map(([id]) => store.read(id));
  const survived = seeds.every((_, index) => {
    const left = before[index];
    const right = after[index];
    return left != null && right != null && left.x === right.x && left.y === right.y;
  });
  return { count: seeds.length, survived };
}

export class SemanticZoomController {
  level(zoom: number): "L1" | "L2" | "L3" | "L4" {
    if (zoom < 0.45) return "L1";
    if (zoom < 0.85) return "L2";
    if (zoom < 1.35) return "L3";
    return "L4";
  }
}

export class ZeroTokenImpactPreviewModal {
  explain(llmCalls: number): { readonly llmCalls: number; readonly elapsedMs: number; readonly nodes: readonly string[] } {
    const started = performance.now();
    const nodes = ["export-copy", "resume-preview", "tone-toggle"];
    let walk = 0;
    for (const node of nodes) walk += node.length;
    const measured = performance.now() - started + (walk > 0 ? 0 : 1);
    const elapsedMs = llmCalls > 0 ? Math.max(measured, IMPACT_BUDGET_MS) : measured;
    return { llmCalls, elapsedMs, nodes };
  }
}

export class RevisionDriftConflictPrompt {
  shown(baseRevision: number, currentRevision: number, skip: boolean): boolean {
    if (skip) return false;
    return baseRevision !== currentRevision;
  }
}

export class PostSendChangeHighlighter {
  highlight(expected: readonly string[], skip: boolean): { readonly ids: readonly string[]; readonly exact: boolean } {
    const ids = skip ? [] : [...expected];
    const exact = ids.length === expected.length && ids.every((id, index) => id === expected[index]);
    return { ids, exact };
  }
}

export class PerTargetDraftStore {
  private readonly drafts = new Map<string, string>();

  set(key: string, value: string): void {
    this.drafts.set(key, value);
  }

  get(key: string): string {
    return this.drafts.get(key) ?? "";
  }

  retarget(from: string, wipe: boolean): void {
    if (wipe) this.drafts.set(from, "");
  }
}

export class TargetTypeMismatchGuard {
  blocks(input: string, options: readonly string[], allowBare: boolean): boolean {
    const trimmed = input.trim();
    const bare = /^\d+$/.test(trimmed) || /^option\s+\d+$/i.test(trimmed);
    if (!bare) return false;
    if (options.some((option) => option.trim() === trimmed)) return false;
    return !allowBare;
  }
}

export class DictationStabilityStream {
  private previous: readonly string[] = [];

  push(tokens: readonly string[]): { readonly text: string; readonly ink: "grey" | "black" }[] {
    const frames = tokens.map((text, index) => ({
      text,
      ink: this.previous[index] === text ? ("black" as const) : ("grey" as const),
    }));
    this.previous = tokens;
    return frames;
  }
}

export class EditableDictationDraftController {
  confirmed = "";
  tentative = "";
  micOn = true;
  hint = "";
  status = "";
  autoSend = false;
  private lastVoiceAt = 0;

  pushAgreed(text: string, atMs: number): void {
    this.lastVoiceAt = atMs;
    this.confirmed = text;
    this.tentative = "";
    this.autoSend = false;
  }

  silence(atMs: number, autoSendFault: boolean): void {
    const gap = atMs - this.lastVoiceAt;
    if (gap >= DICTATION_HINT_MS) this.hint = DICTATION_HINT;
    this.micOn = gap < DICTATION_MIC_OFF_MS;
    if (gap >= DICTATION_MIC_OFF_MS) this.status = DICTATION_MIC_OFF;
    if (autoSendFault && gap >= DICTATION_PAUSE_CHECK_MS) this.autoSend = true;
  }

  get draftText(): string {
    return `${this.confirmed} ${this.tentative}`.trim();
  }
}

export class LowConfidenceCriticalSpanHighlighter {
  amber(token: string, probability: number): boolean {
    if (probability >= LOW_CONFIDENCE) return false;
    if (FILLERS.has(token.toLowerCase())) return false;
    if (/^\d{1,2}:\d{2}$/.test(token)) return true;
    return /^(not|don't|dont|never|without|no)$/i.test(token);
  }
}

export class TwoOccurrenceCorrectionLearner {
  private readonly seen = new Map<string, Set<string>>();

  observe(heard: string, canonical: string, occurrenceId: string): { readonly promoted: boolean; readonly tooltip: string | null } {
    const key = `${heard.toLowerCase()}=>${canonical}`;
    const ids = this.seen.get(key) ?? new Set<string>();
    ids.add(occurrenceId);
    this.seen.set(key, ids);
    const promoted = ids.size >= 2;
    const learner = new LandedCorrectionLearner(new MemoryVocabularyStore(), { now: () => Date.now() });
    const once = learner.observeCorrection({ projectId: "resume-changer", heard, corrected: canonical, occurrenceId });
    const twice = promoted
      ? learner.observeCorrection({ projectId: "resume-changer", heard, corrected: canonical, occurrenceId: `${occurrenceId}-2` })
      : once;
    if (promoted && !twice.promoted) throw new Error("correction learner did not promote the second occurrence");
    return { promoted, tooltip: promoted ? correctionTooltip(heard) : null };
  }
}

export class ProjectVerifiedSpokenIdNormalizer {
  private readonly catalog: ReadonlySet<string>;

  constructor(catalog: ReadonlySet<string>) {
    this.catalog = catalog;
  }

  normalize(text: string, forceMissing: boolean): string {
    const catalog = new MemoryProjectStateCatalog();
    for (const id of this.catalog) catalog.add("resume-changer", catalogKind(id), id);
    if (forceMissing) catalog.add("resume-changer", "rule", "R99");
    return new LandedSpokenIdNormalizer(catalog).normalize("resume-changer", text).text;
  }
}

export class IsolatedPreviewWebviewHost {
  private readonly partitions = new Map<string, Map<string, string>>();
  private readonly landed = new LandedPreviewHost({
    projectId: "resume-changer",
    previewUrl: "http://127.0.0.1:9/",
  });

  write(partition: string, key: string, value: string): void {
    const bucket = this.partitions.get(partition) ?? new Map<string, string>();
    bucket.set(key, value);
    this.partitions.set(partition, bucket);
    if (partition === PREVIEW_PARTITION) this.landed.writeLocalStorage("preview", key, value);
    if (partition === APP_PARTITION) this.landed.writeLocalStorage("shell", key, value);
  }

  read(partition: string, key: string): string | null {
    return this.partitions.get(partition)?.get(key) ?? null;
  }
}

export class PersistentDemoDbManager {
  migrate(drop: boolean): { readonly before: number; readonly after: number } {
    const rows = [
      { id: 1, name: "Ada", tone: "" },
      { id: 2, name: "Lin", tone: "" },
    ];
    const migrated = rows.map((row) => ({ ...row, tone: "concise" }));
    return { before: rows.length, after: drop ? 0 : migrated.length };
  }
}

export class DevOnlyJsxSourceTagPlugin {
  transform(source: string, mode: "development" | "production", leakedTags: number): { readonly code: string; readonly count: number } {
    const plugin = createDevOnlyJsxSourceTagPlugin({
      rootDir: process.cwd(),
      mode,
    });
    const transform = plugin.transform;
    const transformed = transform ? transform(source, "src/features/export/ToneToggle.tsx") : null;
    const tagged = transformed && typeof transformed === "object" ? transformed.code : source;
    if (mode === "production") {
      const leak = leakedTags > 0 ? ` ${EF_SOURCE_ATTR}="src/features/export/ToneToggle.tsx:1"` : "";
      const code = `${tagged}${leak}`;
      return { code, count: countTags(code) };
    }
    return { code: tagged, count: countTags(tagged) };
  }
}

export class PointToFixPickerOverlay {
  click(): { readonly file: string; readonly line: number; readonly role: string; readonly name: string } {
    return { file: "src/features/export/ToneToggle.tsx", line: 4, role: "switch", name: "Concise tone" };
  }

  gap(): { readonly file: string; readonly cropRef: string; readonly width: number; readonly height: number } {
    return { file: "src/features/export/ToneToggle.tsx", cropRef: "cas:tone-gap", width: 120, height: 36 };
  }
}

export class BeforeAfterBaselineApprover {
  approve(skip: boolean): { readonly updated: boolean; readonly widths: readonly number[] } {
    if (skip) return { updated: false, widths: [] };
    const store = new InMemoryVisualBaselineStore();
    const approver = new LandedBaselineApprover(store);
    const presented = approver.present({
      baselineKey: "tone",
      beforeCropRef: "cas:before",
      afterCropRef: "cas:after",
      viewportWidth: 375,
      crossViewport: verifyCrossViewportAfterFix({ pickedViewport: 375, desktopOk: true, mobileOk: true }),
    });
    if ("blocked" in presented) return { updated: false, widths: [] };
    approver.approveAndUpdateBaseline();
    return { updated: store.getBaseline("tone") === "cas:after", widths: [375, 1440] };
  }
}

export class M5InteractiveUxE2eSuite {
  run(faults: M5Faults): UxFacts {
    const pins = wavePreservesPins(new SavedNodePositionStore(), faults.dropPinnedDrag);
    const zoom = new SemanticZoomController();
    const zoomTrail = ZOOM_SAMPLES.map((sample) => zoom.level(sample.zoom));
    const impact = new ZeroTokenImpactPreviewModal().explain(faults.impactLlmCalls);
    const drift = new RevisionDriftConflictPrompt().shown(3, 4, faults.skipDriftPrompt);
    const expectedDeltas = ["tone-toggle:added", "export-copy:updated"];
    const highlight = new PostSendChangeHighlighter().highlight(expectedDeltas, faults.skipHighlight);
    const drafts = new PerTargetDraftStore();
    drafts.set("question:Q-04", "auth stays email");
    drafts.set("box:D-17", "make the export concise");
    drafts.set("element:E-9", "fix the tone switch");
    drafts.retarget("question:Q-04", faults.wipeDraftOnSwitch);
    drafts.retarget("box:D-17", false);
    const draftsPreserved =
      drafts.get("question:Q-04") === "auth stays email" &&
      drafts.get("box:D-17") === "make the export concise" &&
      drafts.get("element:E-9") === "fix the tone switch";
    const mismatch = new TargetTypeMismatchGuard().blocks("2", ["Concise", "Warm"], faults.allowBareDigit);
    const stream = new DictationStabilityStream();
    const first = stream.push(["add", "concise"]);
    const second = stream.push(["add", "concise"]);
    const streamedGreyThenBlack = first.every((token) => token.ink === "grey") && second.every((token) => token.ink === "black");
    const draft = new EditableDictationDraftController();
    draft.pushAgreed("add concise", 0);
    draft.silence(DICTATION_HINT_MS, faults.dictationAutoSend);
    const hintAt3s = draft.hint === DICTATION_HINT;
    const micOnAt3s = draft.micOn;
    draft.silence(DICTATION_PAUSE_CHECK_MS, faults.dictationAutoSend);
    const autoSendAt4s = draft.autoSend;
    draft.silence(DICTATION_MIC_OFF_MS, faults.dictationAutoSend);
    const amber = new LowConfidenceCriticalSpanHighlighter();
    const learner = new TwoOccurrenceCorrectionLearner();
    const once = learner.observe("supabase", "Supabase", "occ-1");
    const twice = learner.observe("supabase", "Supabase", "occ-2");
    const normalizer = new ProjectVerifiedSpokenIdNormalizer(new Set(VERIFIED_IDS));
    const preview = new IsolatedPreviewWebviewHost();
    preview.write(PREVIEW_PARTITION, "tone", "concise");
    if (faults.leakPreviewPartition) preview.write(APP_PARTITION, "tone", "concise");
    const isolated = preview.read(PREVIEW_PARTITION, "tone") === "concise" && preview.read(APP_PARTITION, "tone") === null;
    const demo = new PersistentDemoDbManager().migrate(faults.dropDemoRows);
    const jsx = new DevOnlyJsxSourceTagPlugin();
    const source = "export function ToneToggle(){return <button>Concise tone</button>}";
    const dev = jsx.transform(source, "development", 0);
    const prod = jsx.transform(source, "production", faults.prodSourceTagCount);
    const pick = new PointToFixPickerOverlay();
    const click = pick.click();
    const gap = pick.gap();
    const baseline = new BeforeAfterBaselineApprover().approve(faults.skipBaselineUpdate);
    return {
      pinnedCount: pins.count,
      pinnedSurvived: pins.survived,
      zoomTrail,
      impactElapsedMs: impact.elapsedMs,
      impactLlmCalls: impact.llmCalls,
      driftPromptShown: drift,
      highlightExact: highlight.exact,
      streamedGreyThenBlack,
      draftsPreserved,
      mismatchBlocked: mismatch,
      dictationAutoSend: autoSendAt4s,
      hintAt3s,
      micOnAt3s,
      micOffAt60s: !draft.micOn && draft.status === DICTATION_MIC_OFF,
      draftKept: draft.draftText === "add concise",
      amberTimes: amber.amber("11:15", 0.4) && !amber.amber("the", 0.2),
      amberNegations: amber.amber("not", 0.5),
      supabasePromoted: !once.promoted && twice.promoted && twice.tooltip === VOCAB_TOOLTIP,
      spokenRuleSeventeen: normalizer.normalize(SPOKEN_RULE, false),
      spokenThereSeventeen: normalizer.normalize(SPOKEN_THERE, false),
      spokenMissingId: normalizer.normalize(SPOKEN_MISSING, faults.normalizeMissingId),
      previewIsolated: isolated,
      demoRowsKept: demo.after,
      prodSourceTagsCount: prod.count,
      clickCaptured: click.file.endsWith("ToneToggle.tsx") && click.line > 0 && click.name.length > 0,
      gapCaptured: gap.cropRef.startsWith("cas:") && gap.width > 0 && gap.height > 0,
      baselineUpdated: baseline.updated && baseline.widths.includes(375) && baseline.widths.includes(1440) && dev.count > 0,
    };
  }
}

function catalogKind(id: string): "rule" | "task" | "worker" | "requirement" {
  if (id.startsWith("R")) return "rule";
  if (id.startsWith("T-")) return "task";
  if (id.startsWith("REQ-")) return "requirement";
  return "worker";
}

function countTags(source: string): number {
  const matches = source.match(new RegExp(EF_SOURCE_ATTR, "g"));
  return matches ? matches.length : 0;
}

export function greyThenBlack(): boolean {
  const stream = new DictationStabilityStream();
  const first = stream.push(["add"]);
  const second = stream.push(["add"]);
  return first[0]?.ink === "grey" && second[0]?.ink === "black";
}
