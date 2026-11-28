import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inventoryDocs } from "./docs-inventory.js";
import {
  createMinGitRepoInspector,
  type MinGitRepoInspectorPort,
} from "./git-exec.js";
import { GitChurnHotspotAnalyzer } from "./git-churn-hotspot-analyzer.js";
import { MonorepoWorkspacePicker } from "./monorepo-workspace-picker.js";
import {
  InMemoryKnowledgeGraphRepo,
  InMemoryStateMetaStore,
  type KnowledgeGraphRepoPort,
  type StateMetaStore,
} from "./knowledge-graph-port.js";
import { ObservedRepoFactsPersister } from "./observed-repo-facts-persister.js";
import { SafetyScanner } from "./sensitive.js";
import { StackAndFrameworkDetector } from "./stack-and-framework-detector.js";
import { listRepoFiles } from "./tree-walker.js";
import type { L0ScanResult } from "./types.js";

export interface BrownfieldL0ScanOptions {
  readonly repoRoot: string;
  readonly git?: MinGitRepoInspectorPort;
  readonly safety?: SafetyScanner;
  readonly graph?: KnowledgeGraphRepoPort;
  readonly meta?: StateMetaStore;
  readonly useCache?: boolean;
  readonly dirtyMtimes?: readonly number[];
}

export class BrownfieldL0RepoScanner {
  private readonly git: MinGitRepoInspectorPort;
  private readonly safety: SafetyScanner;
  private readonly stack = new StackAndFrameworkDetector();
  private readonly churn: GitChurnHotspotAnalyzer;
  private readonly monorepo = new MonorepoWorkspacePicker();
  private readonly persister: ObservedRepoFactsPersister;

  constructor(deps?: {
    readonly git?: MinGitRepoInspectorPort;
    readonly safety?: SafetyScanner;
    readonly graph?: KnowledgeGraphRepoPort;
    readonly meta?: StateMetaStore;
  }) {
    this.git = deps?.git ?? createMinGitRepoInspector();
    this.safety = deps?.safety ?? new SafetyScanner();
    this.churn = new GitChurnHotspotAnalyzer(this.git);
    this.persister = new ObservedRepoFactsPersister(
      deps?.graph ?? new InMemoryKnowledgeGraphRepo(),
      deps?.meta ?? new InMemoryStateMetaStore(),
    );
  }

  scan(options: BrownfieldL0ScanOptions): L0ScanResult {
    const started = performance.now();
    const root = path.resolve(options.repoRoot);

    if (options.useCache !== false && options.dirtyMtimes !== undefined) {
      const rememberedHead = this.persister.rememberedHeadSha();
      if (rememberedHead) {
        const cached = this.persister.tryFastLoad(rememberedHead, options.dirtyMtimes);
        if (cached) {
          return { ...cached, durationMs: performance.now() - started, scannedAtMs: cached.scannedAtMs };
        }
      }
    }

    const isGit = this.git.isGitRepo(root);
    const headSha = isGit ? this.git.headSha(root) : null;
    const dirtyMtimes = options.dirtyMtimes ?? collectDirtyMtimes(root, isGit);
    const hash = this.persister.computeSnapshotHash(headSha, dirtyMtimes);

    if (options.useCache !== false) {
      const cached = this.persister.loadCached(hash);
      if (cached) {
        const durationMs = performance.now() - started;
        return { ...cached, durationMs, scannedAtMs: cached.scannedAtMs };
      }
    }

    const walk = listRepoFiles(root, this.git, isGit);
    for (const rel of walk.files.map((f) => f.path)) {
      if (this.safety.shouldSkipRead(rel)) {
        // defensive: tree walker already filters; keeps SafetyScanner on the path
      }
    }

    const filePaths = walk.files.map((f) => f.path);
    const stack = this.stack.detect(root, walk.files);
    const churn = this.churn.analyze(root, isGit);
    const monorepo = this.monorepo.detect(root, filePaths);
    const docs = inventoryDocs(root, walk.files, this.git, isGit);

    const result: L0ScanResult = {
      repoRoot: root,
      scannedAtMs: Date.now(),
      durationMs: performance.now() - started,
      headSha,
      files: walk.files,
      sensitiveSkipped: walk.sensitiveSkipped,
      stack,
      churn,
      monorepo,
      docs,
      basis: "observed",
    };

    this.persister.saveCache(hash, result);
    this.persister.persistObservedFacts(result);
    return result;
  }
}

function collectDirtyMtimes(root: string, isGit: boolean): number[] {
  if (!isGit) return [];
  const status = spawnStatus(root);
  if (!status) return [];
  const mtimes: number[] = [];
  for (const rel of status) {
    const full = path.join(root, rel);
    try {
      mtimes.push(fs.statSync(full).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return mtimes;
}

function spawnStatus(root: string): string[] | null {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  const paths: string[] = [];
  for (const line of (result.stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rel = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
    if (rel) paths.push(rel);
  }
  return paths;
}

export {
  StackAndFrameworkDetector,
  GitChurnHotspotAnalyzer,
  MonorepoWorkspacePicker,
  ObservedRepoFactsPersister,
  SafetyScanner,
  createMinGitRepoInspector,
  InMemoryKnowledgeGraphRepo,
  InMemoryStateMetaStore,
};