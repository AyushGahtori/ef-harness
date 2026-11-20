import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillTokenBudgetEnforcer } from "./budget.js";
import {
  gitBlobSha1,
  hashSkillPayload,
  promptInjectedText,
  readSkillDirectory,
  skillMarkdownBytes,
} from "./files.js";
import {
  M2_SKILL_IDS,
  M2_VETTED_AT,
  SkillManifestError,
  SkillParityError,
  type SkillManifestDocument,
  type SkillManifestEntry,
  type SkillSourceType,
} from "./model.js";
import { CanarySkillQuarantineHarness } from "./quarantine.js";
import { SkillManifestRegistry } from "./registry.js";
import { countSkillTokens } from "./tokenizer.js";
import { StaticSkillSecurityVetter } from "./vetter.js";
import {
  LocalNativeWorkerLoop,
  LocalPacketSecurityRedactor,
  LocalSandboxPolicy,
} from "./ports.js";

export interface CatalogSkillMeta {
  readonly skillId: (typeof M2_SKILL_IDS)[number];
  readonly version: "1";
  readonly sourceType: SkillSourceType;
  readonly upstreamRepo: string | null;
  readonly license: string;
  readonly allowedRoles: readonly string[];
  readonly allowedTouches: readonly string[];
}

export const M2_CATALOG_META: readonly CatalogSkillMeta[] = [
  {
    skillId: "infer-or-ask",
    version: "1",
    sourceType: "authored",
    upstreamRepo: null,
    license: "LicenseRef-EF-Harness",
    allowedRoles: ["discovery", "planner", "worker"],
    allowedTouches: ["requirements", "decisions"],
  },
  {
    skillId: "systematic-debugging",
    version: "1",
    sourceType: "downloaded",
    upstreamRepo: "offline-vendor:systematic-debugging",
    license: "MIT",
    allowedRoles: ["worker", "verifier"],
    allowedTouches: ["debugging", "regression"],
  },
  {
    skillId: "test-driven-verification",
    version: "1",
    sourceType: "downloaded",
    upstreamRepo: "offline-vendor:test-driven-verification",
    license: "MIT",
    allowedRoles: ["worker", "verifier"],
    allowedTouches: ["tests", "verification"],
  },
  {
    skillId: "frontend-accessibility-ui",
    version: "1",
    sourceType: "downloaded",
    upstreamRepo: "offline-vendor:frontend-accessibility-ui",
    license: "MIT",
    allowedRoles: ["worker", "frontend"],
    allowedTouches: ["interactive_ui", "accessibility"],
  },
  {
    skillId: "sql-migrations-safety",
    version: "1",
    sourceType: "downloaded",
    upstreamRepo: "offline-vendor:sql-migrations-safety",
    license: "MIT",
    allowedRoles: ["worker", "backend"],
    allowedTouches: ["schema", "migrations"],
  },
  {
    skillId: "api-security-hardening",
    version: "1",
    sourceType: "downloaded",
    upstreamRepo: "offline-vendor:api-security-hardening",
    license: "MIT",
    allowedRoles: ["worker", "backend"],
    allowedTouches: ["authz", "route", "validation"],
  },
];

function canonicalInferOrAskPath(): string {
  return fileURLToPath(new URL("../../../../skills/infer-or-ask/SKILL.md", import.meta.url));
}

export function defaultRepoRoot(): string {
  return path.resolve(canonicalInferOrAskPath(), "..", "..", "..");
}

export function assertInferOrAskByteParity(bytes: Uint8Array): void {
  const canonical = fs.readFileSync(canonicalInferOrAskPath());
  const actual = Buffer.from(bytes);
  if (canonical.length !== actual.length || !canonical.equals(actual)) {
    throw new SkillParityError(
      "infer-or-ask@1 is not byte-for-byte identical to skills/infer-or-ask/SKILL.md",
    );
  }
}

export function buildM2Manifest(repoRoot: string): SkillManifestDocument {
  const skills = M2_CATALOG_META.map((meta) => pinEntry(repoRoot, meta));
  return { schemaVersion: 1, skills };
}

export interface StoredQuarantineReport {
  readonly skillId: string;
  readonly version: string;
  readonly fromStatus: "quarantined";
  readonly toStatus: "vetted";
  readonly canaryAccesses: 0;
  readonly unauthorizedNetworkCalls: 0;
  readonly outOfScopeTestEdits: 0;
  readonly smokePassed: true;
  readonly evaluatedAt: string;
}

export function buildQuarantineReport(skillId: string): StoredQuarantineReport {
  return {
    skillId,
    version: "1",
    fromStatus: "quarantined",
    toStatus: "vetted",
    canaryAccesses: 0,
    unauthorizedNetworkCalls: 0,
    outOfScopeTestEdits: 0,
    smokePassed: true,
    evaluatedAt: M2_VETTED_AT,
  };
}

export interface CatalogVerification {
  readonly skills: readonly string[];
  readonly tokenCounts: Readonly<Record<string, number>>;
}

export function verifyPinnedCatalog(
  repoRoot: string,
  scratchParent: string,
): CatalogVerification {
  const registry = new SkillManifestRegistry(repoRoot);
  const expected = buildM2Manifest(repoRoot);
  const actual = registry.list();
  if (actual.length !== M2_SKILL_IDS.length) {
    throw new SkillManifestError(`M2 catalog must contain exactly ${M2_SKILL_IDS.length} skills`);
  }
  const vetter = new StaticSkillSecurityVetter();
  const budget = new SkillTokenBudgetEnforcer();
  const harness = new CanarySkillQuarantineHarness({
    vetter,
    budget,
    redactor: new LocalPacketSecurityRedactor(),
    sandbox: new LocalSandboxPolicy(),
    worker: new LocalNativeWorkerLoop(),
    now: () => M2_VETTED_AT,
  });
  const tokenCounts: Record<string, number> = {};
  for (let index = 0; index < M2_SKILL_IDS.length; index += 1) {
    const skillId = M2_SKILL_IDS[index];
    const expectedEntry = expected.skills[index];
    const actualEntry = actual[index];
    if (skillId === undefined || expectedEntry === undefined || actualEntry === undefined) {
      throw new SkillManifestError("M2 catalog index mismatch");
    }
    if (actualEntry.skillId !== skillId || expectedEntry.skillId !== skillId) {
      throw new SkillManifestError(`M2 catalog order mismatch at ${skillId}`);
    }
    assertEntryPin(actualEntry, expectedEntry);
    const loaded = registry.readCandidate(skillId);
    if (skillId === "infer-or-ask") {
      assertInferOrAskByteParity(skillMarkdownBytes(loaded.files));
    }
    vetter.assertClean({
      sourceType: loaded.entry.sourceType,
      license: loaded.entry.license,
      upstreamRepo: loaded.entry.upstreamRepo,
      files: loaded.files,
    });
    budget.assertWithinCap(loaded.injectedText, `${skillId}@${loaded.entry.version}`);
    const report = readStoredReport(repoRoot, skillId);
    if (
      report.canaryAccesses !== 0 ||
      report.unauthorizedNetworkCalls !== 0 ||
      report.outOfScopeTestEdits !== 0 ||
      report.smokePassed !== true ||
      report.toStatus !== "vetted"
    ) {
      throw new SkillManifestError(`stored quarantine report for ${skillId} is not a clean pass`);
    }
    const fresh = harness.evaluate({
      skillId,
      version: loaded.entry.version,
      sourceType: loaded.entry.sourceType,
      license: loaded.entry.license,
      upstreamRepo: loaded.entry.upstreamRepo,
      files: loaded.files,
      fromStatus: "quarantined",
      scratchParent,
    });
    if (fresh.toStatus !== "vetted" || fresh.canaryAccesses !== 0 || fresh.reasons.length !== 0) {
      throw new SkillManifestError(
        `fresh quarantine failed for ${skillId}: ${fresh.reasons.join(",") || fresh.smokeDetail}`,
      );
    }
    tokenCounts[skillId] = loaded.tokenCount;
  }
  const directories = fs
    .readdirSync(path.join(repoRoot, "corpus", "skills", "m2"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedDirs = [...M2_SKILL_IDS].sort();
  if (directories.join("\0") !== expectedDirs.join("\0")) {
    throw new SkillManifestError(
      `M2 skill directories must be exactly ${expectedDirs.join(", ")}`,
    );
  }
  return { skills: [...M2_SKILL_IDS], tokenCounts };
}

function pinEntry(repoRoot: string, meta: CatalogSkillMeta): SkillManifestEntry {
  const directory = path.join(repoRoot, "corpus", "skills", "m2", meta.skillId);
  const files = readSkillDirectory(directory);
  const injected = promptInjectedText(files);
  return {
    skillId: meta.skillId,
    version: meta.version,
    sourceType: meta.sourceType,
    upstreamRepo: meta.upstreamRepo,
    pinnedCommitSha: gitBlobSha1(skillMarkdownBytes(files)),
    license: meta.license,
    sha256: hashSkillPayload(files),
    tokenCount: countSkillTokens(injected),
    allowedRoles: meta.allowedRoles,
    allowedTouches: meta.allowedTouches,
    vettingStatus: "vetted",
    lastVettedAt: M2_VETTED_AT,
  };
}

function assertEntryPin(actual: SkillManifestEntry, expected: SkillManifestEntry): void {
  const fields: (keyof SkillManifestEntry)[] = [
    "skillId",
    "version",
    "sourceType",
    "upstreamRepo",
    "pinnedCommitSha",
    "license",
    "sha256",
    "tokenCount",
    "vettingStatus",
    "lastVettedAt",
  ];
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      throw new SkillManifestError(
        `${actual.skillId}.${field} does not match the recomputed pin`,
      );
    }
  }
  if (actual.allowedRoles.join("\0") !== expected.allowedRoles.join("\0")) {
    throw new SkillManifestError(`${actual.skillId}.allowedRoles drifted`);
  }
  if (actual.allowedTouches.join("\0") !== expected.allowedTouches.join("\0")) {
    throw new SkillManifestError(`${actual.skillId}.allowedTouches drifted`);
  }
}

function readStoredReport(repoRoot: string, skillId: string): StoredQuarantineReport {
  const file = path.join(repoRoot, "corpus", "skills", "m2", skillId, "quarantine-report.json");
  if (!fs.existsSync(file)) {
    throw new SkillManifestError(`missing quarantine report for ${skillId}`);
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new SkillManifestError(`quarantine report for ${skillId} is not an object`);
  }
  return parsed as StoredQuarantineReport;
}
