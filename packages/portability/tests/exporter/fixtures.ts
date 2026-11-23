import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { ExportEntity, HiddenCheckPoolPort, SealedHiddenCheck } from "../../src/exporter/index.js";
import {
  AgeSealedChecksEncryptor,
  ExportSecretGate,
  InMemoryKnowledgeGraphRepo,
  OrphanBranchPortabilityExporter,
  PacketSecurityRedactor,
  createNodeGitInspector,
  GitFastImportWriter,
} from "../../src/exporter/index.js";

export const TEST_AGE_KEYS = {
  publicKey: "age14am7vp7fdda3hzx9s7dtqyzcltncq72q24sxkntpyfwsglkthelqmwy6cs",
  identitySecret:
    "AGE-SECRET-KEY-1X5NGW5GN60ZGKTTZ4NUL9KQM5ML3T33W0HHSACWLY7FEPSYRWDVS8ZQP7F",
} as const;

export class TestHiddenCheckPool implements HiddenCheckPoolPort {
  constructor(private readonly rows: readonly SealedHiddenCheck[]) {}

  listSealedForFeatures(featureIds: readonly string[]): readonly SealedHiddenCheck[] {
    const allowed = new Set(featureIds);
    return this.rows.filter((row) => allowed.has(row.featureId));
  }
}

export function initBareRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-harness-state-"));
  const init = spawnSync("git", ["init", "-b", "main"], { cwd: dir, encoding: "utf8", windowsHide: true });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  spawnSync("git", ["config", "user.email", "foundation@ef-harness.local"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "EF Harness"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "--allow-empty", "-m", "bootstrap"], { cwd: dir, windowsHide: true });
  return dir;
}

export function buildExporter(
  repoPath: string,
  graph: InMemoryKnowledgeGraphRepo,
  hidden: TestHiddenCheckPool,
  agePublicKey: string,
  debounceMs = 0,
  clock?: () => number,
): OrphanBranchPortabilityExporter {
  return new OrphanBranchPortabilityExporter({
    repoPath,
    graph,
    hiddenChecks: hidden,
    secretGate: new ExportSecretGate(new PacketSecurityRedactor()),
    ageEncryptor: new AgeSealedChecksEncryptor(agePublicKey),
    writer: new GitFastImportWriter(repoPath, createNodeGitInspector()),
    debounceMs,
    clock,
  });
}

export function decisionEntity(id: string, revision: number, extra?: Record<string, unknown>): ExportEntity {
  return {
    id,
    kind: "decision",
    revision,
    title: `Decision ${id}`,
    text: "settled",
    fields: { status: "settled", ...(extra ?? {}) },
  };
}

export function featureEntity(id: string, revision: number): ExportEntity {
  return {
    id,
    kind: "feature",
    revision,
    title: `Feature ${id}`,
    text: "scope",
    fields: { status: "active" },
  };
}

export function ageKeys() {
  return TEST_AGE_KEYS;
}