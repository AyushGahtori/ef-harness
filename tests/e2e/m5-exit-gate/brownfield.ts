import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CODE_INDEX_DB,
  COMPETING_UI_KITS,
  HARNESS_EMAIL,
  MAX_FOCUS_FILES,
  PAGE_RANK_DAMPING,
  PAGE_RANK_ITERS,
  STALE_STATUS,
  UI_WIDTHS,
} from "./constants.ts";
import type { ManifestParity } from "./manifest.ts";
import { codeIndexSchemaPath } from "./paths.ts";
import type { BrownfieldFacts, M5Faults } from "./types.ts";

export interface FixtureFile {
  readonly path: string;
  readonly text: string;
}

export interface GuidedChangeFixture {
  readonly request: string;
  readonly staleDocPath: string;
  readonly deletedPath: string;
  readonly untouchedDirtyPath: string;
  readonly allowedChangePaths: readonly string[];
  readonly developerName: string;
  readonly developerEmail: string;
  readonly baselineTestIds: readonly string[];
  readonly newCheckIds: readonly string[];
  readonly headerHeightPx: number;
  readonly tapTargetPx: number;
  readonly sensitive: readonly FixtureFile[];
  readonly envExampleNames: readonly string[];
  readonly files: readonly FixtureFile[];
  readonly changeFiles: readonly FixtureFile[];
}

interface CodeSymbol {
  readonly file: string;
  readonly name: string;
  readonly kind: string;
}

interface CodeEdge {
  readonly from: string;
  readonly to: string;
}

const EXPORT_RE = /export\s+(?:async\s+)?(?:function|class|const|type|interface)\s+([A-Za-z0-9_]+)/g;
const IMPORT_RE = /from\s+["'](\.[^"']+)["']/g;
const STOP = new Set(["add", "with", "that", "this", "from", "into"]);

export function loadGuidedChangeFixture(filePath: string): GuidedChangeFixture {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isFixture(parsed)) throw new Error("guided-change fixture is missing required fields");
  return parsed;
}

export class BrownfieldL0RepoScanner {
  scan(fixture: GuidedChangeFixture, manifest: ManifestParity, faults: M5Faults): {
    readonly elapsedMs: number;
    readonly next: boolean;
    readonly tailwind: boolean;
    readonly vitest: boolean;
    readonly secretBytesRead: number;
    readonly secondUiKit: boolean;
    readonly packageNames: readonly string[];
  } {
    const started = performance.now();
    let secretBytesRead = 0;
    if (faults.readEnvSecrets) {
      for (const secret of fixture.sensitive) secretBytesRead += Buffer.byteLength(secret.text);
    }
    const pkg = fixture.files.find((file) => file.path === "package.json");
    const names = new Set(pkg ? packageNames(pkg.text) : []);
    if (faults.installSecondUiKit) names.add("@mui/material");
    const elapsedMs = faults.l0ElapsedOverrideMs > 0 ? faults.l0ElapsedOverrideMs : performance.now() - started;
    return {
      elapsedMs,
      next: names.has("next"),
      tailwind: names.has("tailwindcss"),
      vitest: names.has("vitest"),
      secretBytesRead,
      secondUiKit: COMPETING_UI_KITS.some((kit) => names.has(kit)),
      packageNames: [...names],
    };
  }
}

export class WasmTreeSitterIndexer {
  index(files: readonly FixtureFile[]): { readonly symbols: readonly CodeSymbol[]; readonly edges: readonly CodeEdge[] } {
    const paths = new Set(files.map((file) => file.path));
    const symbols: CodeSymbol[] = [];
    const edges: CodeEdge[] = [];
    for (const file of files) {
      if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;
      for (const match of file.text.matchAll(EXPORT_RE)) {
        const name = match[1];
        if (!name) continue;
        const kind = /export\s+(?:async\s+)?function/.test(match[0])
          ? "function"
          : /export\s+class/.test(match[0])
            ? "class"
            : /export\s+type|export\s+interface/.test(match[0])
              ? "type"
              : "const";
        symbols.push({ file: file.path, name, kind });
      }
      for (const match of file.text.matchAll(IMPORT_RE)) {
        const spec = match[1];
        if (!spec) continue;
        const target = resolveImport(file.path, spec, paths);
        if (target) edges.push({ from: file.path, to: target });
      }
    }
    return { symbols, edges };
  }
}

export class AiderPageRankCalculator {
  score(files: readonly string[], edges: readonly CodeEdge[]): Map<string, number> {
    const unique = [...new Set(files)];
    const count = unique.length;
    const rank = new Map<string, number>();
    if (count === 0) return rank;
    for (const file of unique) rank.set(file, 1 / count);
    const outgoing = new Map<string, string[]>();
    for (const file of unique) outgoing.set(file, []);
    for (const edge of edges) {
      const list = outgoing.get(edge.from);
      if (list && unique.includes(edge.to)) list.push(edge.to);
    }
    for (let iter = 0; iter < PAGE_RANK_ITERS; iter += 1) {
      const next = new Map<string, number>();
      for (const file of unique) next.set(file, (1 - PAGE_RANK_DAMPING) / count);
      for (const file of unique) {
        const targets = outgoing.get(file) ?? [];
        const share = (PAGE_RANK_DAMPING * (rank.get(file) ?? 0)) / (targets.length || count);
        const receivers = targets.length > 0 ? targets : unique;
        for (const target of receivers) next.set(target, (next.get(target) ?? 0) + share);
      }
      for (const [file, value] of next) rank.set(file, value);
    }
    return rank;
  }
}

export class CodeIndexDatabase {
  private readonly schemaPath: string;

  constructor(schemaPath: string) {
    this.schemaPath = schemaPath;
  }

  open(commit: string, symbols: readonly CodeSymbol[], ranks: ReadonlyMap<string, number>): {
    readonly database: string;
    readonly schemaOk: boolean;
    readonly symbolCount: number;
    readonly rankedFileCount: number;
  } {
    const schema = fs.existsSync(this.schemaPath) ? fs.readFileSync(this.schemaPath, "utf8") : "";
    const schemaOk =
      commit.length > 0 && schema.includes("CREATE TABLE symbols") && schema.includes("CREATE TABLE file_rank");
    return {
      database: CODE_INDEX_DB,
      schemaOk,
      symbolCount: schemaOk ? symbols.length : 0,
      rankedFileCount: schemaOk ? ranks.size : 0,
    };
  }

  remember(commit: string): string {
    return commit;
  }
}

export class StaleDocsDetector {
  flag(docPath: string, referencedPath: string, indexed: ReadonlySet<string>): { readonly path: string; readonly status: string } {
    if (!indexed.has(referencedPath)) return { path: docPath, status: STALE_STATUS };
    return { path: docPath, status: "current" };
  }
}

export class RequestDrivenFocusSelector {
  select(files: readonly FixtureFile[], request: string, deletedPath: string, faults: M5Faults): readonly string[] {
    const terms = request
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3 && !STOP.has(term));
    const ranked = files
      .filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"))
      .map((file) => ({
        path: file.path,
        score: terms.filter((term) => haystack(file).includes(term)).length,
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const selected = ranked.map((row) => row.path);
    if (faults.ignoreStaleDoc) selected.push(deletedPath);
    if (faults.focusBeyondCap) {
      while (selected.length <= MAX_FOCUS_FILES) selected.push(`src/padding/pad-${selected.length}.ts`);
    }
    return selected;
  }
}

export class L2PreSpendEstimator {
  estimate(fileCount: number): { readonly tokens: number; readonly microUsd: number; readonly shown: boolean; readonly text: string } {
    const tokens = Math.max(1, fileCount) * 450;
    const microUsd = tokens * 3;
    const text = `Uncached input ${tokens} tokens, about ${microUsd} micro-USD, before any cloud card is written.`;
    return { tokens, microUsd, shown: true, text };
  }
}

export class BrownfieldOpeningController {
  questions(stackKnown: boolean, faults: M5Faults): number {
    if (!stackKnown) return faults.redundantStackQuestions + 3;
    return faults.redundantStackQuestions;
  }
}

export class TodayVsChangeConfirmationBuilder {
  confirm(changePaths: readonly string[]): { readonly confirmed: boolean; readonly todayHasChange: boolean; readonly changeCount: number } {
    return { confirmed: changePaths.length > 0, todayHasChange: false, changeCount: changePaths.length };
  }
}

export class ExistingConventionsExtractor {
  preserved(fixture: GuidedChangeFixture, secondUiKit: boolean): boolean {
    const tokens = fixture.files.find((file) => file.path === "src/design/tokens.ts");
    const change = fixture.changeFiles.find((file) => file.path.endsWith("ToneToggle.tsx"));
    const usesTokens = Boolean(tokens?.text.includes("headerHeightPx") && change?.text.includes("headerHeightPx"));
    return usesTokens && !secondUiKit && fixture.headerHeightPx === 64;
  }
}

export class BaselineTestHealthRunner {
  run(ids: readonly string[], faults: M5Faults): { readonly passRate: number; readonly newChecksPass: boolean } {
    if (ids.length === 0) return { passRate: 0, newChecksPass: false };
    if (!faults.baselineRegression) return { passRate: 1, newChecksPass: true };
    return { passRate: (ids.length - 1) / ids.length, newChecksPass: true };
  }
}

export class EditorCoexistenceWatcher {
  watch(text: string, faults: M5Faults): { readonly interruptions: number; readonly shaPreserved: boolean } {
    const before = sha256(text);
    const after = faults.clobberDirtySha ? sha256(`${text}\n/* harness write */\n`) : before;
    return {
      interruptions: faults.interruptUntouchedEdit ? 1 : 0,
      shaPreserved: before === after,
    };
  }
}

export class ZeroStashLandingExecutor {
  land(fixture: GuidedChangeFixture, faults: M5Faults): { readonly commands: readonly string[]; readonly stashCount: number; readonly scopeFenceOk: boolean } {
    const commands = ["git status --porcelain", "git diff --no-ext-diff"];
    if (faults.silentStash) commands.push("git stash push --keep-index");
    const changed = faults.editUntouchedFile
      ? [...fixture.allowedChangePaths, fixture.untouchedDirtyPath]
      : fixture.allowedChangePaths;
    const allowed = new Set(fixture.allowedChangePaths);
    const scopeFenceOk = changed.every((file) => allowed.has(file));
    return {
      commands,
      stashCount: commands.filter((command) => /\bgit\s+stash\b/.test(command)).length,
      scopeFenceOk,
    };
  }
}

export class UiConsistencyPipeline {
  run(fixture: GuidedChangeFixture, secondUiKit: boolean, faults: M5Faults): {
    readonly stagesPassed: number;
    readonly contrastOk: boolean;
    readonly rhythmOk: boolean;
  } {
    const button = fixture.files.find((file) => file.path.endsWith("Button.tsx"))?.text ?? "";
    const toggle = fixture.changeFiles.find((file) => file.path.endsWith("ToneToggle.tsx"))?.text ?? "";
    const duplicate = jaccard(tokenize(button), tokenize(toggle)) >= 0.8 || secondUiKit;
    const tapOk = fixture.tapTargetPx >= 24 && UI_WIDTHS.length === 3;
    const contrastOk = !faults.contrastDrift;
    const rhythmOk = !faults.headerDrift && fixture.headerHeightPx === 64;
    const screenshotOk = !faults.skipBaselineUpdate;
    const tokenOk = toggle.includes("headerHeightPx") && !secondUiKit;
    const stages = [tokenOk, !duplicate, tapOk, contrastOk, rhythmOk, screenshotOk];
    return { stagesPassed: stages.filter(Boolean).length, contrastOk, rhythmOk };
  }
}

export class ResumeChangerBenchmarkVerifier {
  private readonly scanner = new BrownfieldL0RepoScanner();
  private readonly indexer = new WasmTreeSitterIndexer();
  private readonly ranks = new AiderPageRankCalculator();
  private readonly database = new CodeIndexDatabase(codeIndexSchemaPath());
  private readonly stale = new StaleDocsDetector();
  private readonly focus = new RequestDrivenFocusSelector();
  private readonly spend = new L2PreSpendEstimator();
  private readonly opening = new BrownfieldOpeningController();
  private readonly today = new TodayVsChangeConfirmationBuilder();
  private readonly conventions = new ExistingConventionsExtractor();
  private readonly baseline = new BaselineTestHealthRunner();
  private readonly coexistence = new EditorCoexistenceWatcher();
  private readonly landing = new ZeroStashLandingExecutor();
  private readonly ui = new UiConsistencyPipeline();

  verify(manifest: ManifestParity, fixture: GuidedChangeFixture, faults: M5Faults): BrownfieldFacts {
    const l0 = this.scanner.scan(fixture, manifest, faults);
    const indexed = this.indexer.index(fixture.files);
    const sourcePaths = fixture.files
      .filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"))
      .map((file) => file.path);
    const rank = this.ranks.score(sourcePaths, indexed.edges);
    const db = this.database.open(manifest.commit, indexed.symbols, rank);
    this.database.remember(manifest.commit);
    const indexedSet = new Set(fixture.files.map((file) => file.path));
    const stale = this.stale.flag(fixture.staleDocPath, fixture.deletedPath, indexedSet);
    const selected = this.focus.select(fixture.files, fixture.request, fixture.deletedPath, faults);
    const spend = this.spend.estimate(selected.length);
    const stackKnown = l0.next && l0.tailwind && l0.vitest;
    const confirmation = this.today.confirm(fixture.allowedChangePaths);
    const health = this.baseline.run(fixture.baselineTestIds, faults);
    const dirty = fixture.files.find((file) => file.path === fixture.untouchedDirtyPath)?.text ?? "";
    const watch = this.coexistence.watch(dirty, faults);
    const landed = this.landing.land(fixture, faults);
    const ui = this.ui.run(fixture, l0.secondUiKit, faults);
    const authorEmail = faults.spoofHumanAuthor ? HARNESS_EMAIL : fixture.developerEmail;
    return {
      commit: manifest.commit,
      docCount: manifest.docCount,
      planFileCount: manifest.planFileCount,
      planLineCount: manifest.planLineCount,
      manifestOk: manifest.ok,
      stackNext: l0.next,
      stackTailwind: l0.tailwind,
      stackVitest: l0.vitest,
      secretBytesRead: l0.secretBytesRead,
      l0ElapsedMs: l0.elapsedMs,
      symbolCount: db.symbolCount,
      rankedFileCount: db.rankedFileCount,
      codeIndexDb: db.database,
      focusCount: selected.length,
      focusIncludesDeleted: selected.includes(fixture.deletedPath),
      staleFlagged: stale.status === STALE_STATUS,
      staleIgnored: !selected.includes(fixture.deletedPath) && !selected.includes(fixture.staleDocPath),
      preSpendShown: spend.shown && spend.text.length > 0 && spend.tokens > 0,
      preSpendTokens: spend.tokens,
      stackQuestions: this.opening.questions(stackKnown, faults),
      todayChangeConfirmed: confirmation.confirmed && !confirmation.todayHasChange,
      secondUiKit: l0.secondUiKit,
      conventionsPreserved: this.conventions.preserved(fixture, l0.secondUiKit),
      baselinePassRate: health.passRate,
      newChecksPass: health.newChecksPass && fixture.newCheckIds.length > 0,
      interruptions: watch.interruptions,
      shaPreserved: watch.shaPreserved,
      stashCount: landed.stashCount,
      humanOwned: !faults.spoofHumanAuthor,
      developerAuthorship: authorEmail === fixture.developerEmail && authorEmail !== HARNESS_EMAIL,
      scopeFenceOk: landed.scopeFenceOk,
      uiStagesPassed: ui.stagesPassed,
      contrastOk: ui.contrastOk,
      rhythmOk: ui.rhythmOk,
    };
  }
}

function packageNames(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const names: string[] = [];
  for (const key of ["dependencies", "devDependencies"]) {
    const block = record[key];
    if (!block || typeof block !== "object") continue;
    names.push(...Object.keys(block as Record<string, unknown>));
  }
  return names;
}

function resolveImport(fromFile: string, spec: string, files: ReadonlySet<string>): string | null {
  const raw = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, raw.replace(/\.js$/, ".ts"), raw.replace(/\.js$/, ".tsx")];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function haystack(file: FixtureFile): string {
  return `${file.path} ${file.text.replace(/\bexport\b/g, " ")}`.toLowerCase();
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

function isFixture(value: unknown): value is GuidedChangeFixture {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.request === "string" &&
    typeof record.staleDocPath === "string" &&
    typeof record.deletedPath === "string" &&
    typeof record.untouchedDirtyPath === "string" &&
    Array.isArray(record.allowedChangePaths) &&
    typeof record.developerName === "string" &&
    typeof record.developerEmail === "string" &&
    Array.isArray(record.baselineTestIds) &&
    Array.isArray(record.newCheckIds) &&
    typeof record.headerHeightPx === "number" &&
    typeof record.tapTargetPx === "number" &&
    Array.isArray(record.sensitive) &&
    Array.isArray(record.envExampleNames) &&
    Array.isArray(record.files) &&
    Array.isArray(record.changeFiles)
  );
}
