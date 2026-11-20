import fs from "node:fs";
import path from "node:path";
import {
  gitBlobSha1,
  hashSkillPayload,
  promptInjectedText,
  readSkillDirectory,
  skillMarkdown,
  skillMarkdownBytes,
} from "./files.js";
import {
  SkillHashMismatchError,
  SkillManifestError,
  SkillMountDeniedError,
  type LoadedSkill,
  type SkillManifestDocument,
  type SkillManifestEntry,
  type SkillSourceType,
  type VettingStatus,
} from "./model.js";
import { countSkillTokens } from "./tokenizer.js";

const VETTING_STATUSES = new Set<VettingStatus>(["quarantined", "vetted", "revoked", "rejected"]);
const SOURCE_TYPES = new Set<SkillSourceType>(["authored", "downloaded"]);

/** Pins every bundled skill and refuses a disk SHA-256 that diverges from the manifest. */
export class SkillManifestRegistry {
  constructor(private readonly repoRoot: string) {}

  manifestFile(): string {
    return path.join(this.repoRoot, "corpus", "skills", "manifest.json");
  }

  skillDirectory(skillId: string): string {
    return path.join(this.repoRoot, "corpus", "skills", "m2", skillId);
  }

  list(): readonly SkillManifestEntry[] {
    return this.readDocument().skills;
  }

  get(skillId: string): SkillManifestEntry {
    const entry = this.readDocument().skills.find((skill) => skill.skillId === skillId);
    if (entry === undefined) {
      throw new SkillManifestError(`unknown skill ${skillId}`);
    }
    return entry;
  }

  /** Integrity-checked skill. Vetting status is not required to be `vetted`. */
  readCandidate(skillId: string): LoadedSkill {
    const entry = this.get(skillId);
    return this.hydrate(entry);
  }

  /** Mount path: vetted, hash-matched, and inside the 2,000-token cap. */
  loadForMount(skillId: string): LoadedSkill {
    const loaded = this.readCandidate(skillId);
    if (loaded.entry.vettingStatus === "revoked") {
      throw new SkillMountDeniedError("revoked", `skill ${skillId} is revoked`);
    }
    if (loaded.entry.vettingStatus === "rejected") {
      throw new SkillMountDeniedError("rejected", `skill ${skillId} was rejected in quarantine`);
    }
    if (loaded.entry.vettingStatus !== "vetted") {
      throw new SkillMountDeniedError(
        "unvetted",
        `skill ${skillId} vettingStatus is ${loaded.entry.vettingStatus}`,
      );
    }
    if (loaded.tokenCount > 2000) {
      throw new SkillMountDeniedError(
        "token_budget",
        `skill ${skillId} is ${loaded.tokenCount} tokens (2000 cap)`,
      );
    }
    return loaded;
  }

  setVettingStatus(skillId: string, status: VettingStatus, at: string | null): SkillManifestEntry {
    const document = this.readDocument();
    let updated: SkillManifestEntry | undefined;
    const skills = document.skills.map((entry) => {
      if (entry.skillId !== skillId) return entry;
      updated = {
        skillId: entry.skillId,
        version: entry.version,
        sourceType: entry.sourceType,
        upstreamRepo: entry.upstreamRepo,
        pinnedCommitSha: entry.pinnedCommitSha,
        license: entry.license,
        sha256: entry.sha256,
        tokenCount: entry.tokenCount,
        allowedRoles: entry.allowedRoles,
        allowedTouches: entry.allowedTouches,
        vettingStatus: status,
        lastVettedAt: status === "vetted" ? at : entry.lastVettedAt,
      };
      return updated;
    });
    if (updated === undefined) throw new SkillManifestError(`unknown skill ${skillId}`);
    this.writeDocument({ schemaVersion: 1, skills });
    return updated;
  }

  private hydrate(entry: SkillManifestEntry): LoadedSkill {
    const files = readSkillDirectory(this.skillDirectory(entry.skillId));
    const sha256 = hashSkillPayload(files);
    if (sha256 !== entry.sha256) {
      throw new SkillHashMismatchError(
        `skill ${entry.skillId} SHA-256 mismatch: manifest ${entry.sha256} disk ${sha256}`,
      );
    }
    const markdownBytes = skillMarkdownBytes(files);
    const pinnedCommitSha = gitBlobSha1(markdownBytes);
    if (entry.pinnedCommitSha !== null && entry.pinnedCommitSha !== pinnedCommitSha) {
      throw new SkillHashMismatchError(
        `skill ${entry.skillId} pinnedCommitSha mismatch: manifest ${entry.pinnedCommitSha} disk ${pinnedCommitSha}`,
      );
    }
    const injectedText = promptInjectedText(files);
    const tokenCount = countSkillTokens(injectedText);
    if (tokenCount !== entry.tokenCount) {
      throw new SkillManifestError(
        `skill ${entry.skillId} tokenCount mismatch: manifest ${entry.tokenCount} disk ${tokenCount}`,
      );
    }
    return {
      entry,
      files,
      skillMarkdown: skillMarkdown(files),
      injectedText,
      sha256,
      tokenCount,
      pinnedCommitSha,
    };
  }

  private readDocument(): SkillManifestDocument {
    const file = this.manifestFile();
    if (!fs.existsSync(file)) throw new SkillManifestError(`missing manifest ${file}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    } catch {
      throw new SkillManifestError(`manifest is not valid JSON: ${file}`);
    }
    return parseManifest(parsed);
  }

  private writeDocument(document: SkillManifestDocument): void {
    const file = this.manifestFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
}

function parseManifest(value: unknown): SkillManifestDocument {
  if (!isRecord(value)) throw new SkillManifestError("manifest must be an object");
  if (value.schemaVersion !== 1) throw new SkillManifestError("manifest schemaVersion must be 1");
  if (!Array.isArray(value.skills)) throw new SkillManifestError("manifest skills must be an array");
  const seen = new Set<string>();
  const skills = value.skills.map((entry) => parseEntry(entry, seen));
  return { schemaVersion: 1, skills };
}

function parseEntry(value: unknown, seen: Set<string>): SkillManifestEntry {
  if (!isRecord(value)) throw new SkillManifestError("skill entry must be an object");
  const skillId = requiredString(value, "skillId");
  if (seen.has(skillId)) throw new SkillManifestError(`duplicate skill ${skillId}`);
  seen.add(skillId);
  const sourceType = requiredString(value, "sourceType");
  if (!SOURCE_TYPES.has(sourceType as SkillSourceType)) {
    throw new SkillManifestError(`${skillId}.sourceType is invalid`);
  }
  const vettingStatus = requiredString(value, "vettingStatus");
  if (!VETTING_STATUSES.has(vettingStatus as VettingStatus)) {
    throw new SkillManifestError(`${skillId}.vettingStatus is invalid`);
  }
  const sha256 = requiredString(value, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new SkillManifestError(`${skillId}.sha256 must be 64 lowercase hex characters`);
  }
  const pinnedCommitSha = nullableString(value, "pinnedCommitSha", skillId);
  if (pinnedCommitSha !== null && !/^[0-9a-f]{40}$/.test(pinnedCommitSha)) {
    throw new SkillManifestError(`${skillId}.pinnedCommitSha must be 40 lowercase hex characters`);
  }
  const tokenCount = value.tokenCount;
  if (typeof tokenCount !== "number" || !Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new SkillManifestError(`${skillId}.tokenCount must be a non-negative integer`);
  }
  const lastVettedAt = nullableString(value, "lastVettedAt", skillId);
  if (vettingStatus === "vetted" && lastVettedAt === null) {
    throw new SkillManifestError(`${skillId}.lastVettedAt is required when vetted`);
  }
  return {
    skillId,
    version: requiredString(value, "version"),
    sourceType: sourceType as SkillSourceType,
    upstreamRepo: nullableString(value, "upstreamRepo", skillId),
    pinnedCommitSha,
    license: requiredString(value, "license"),
    sha256,
    tokenCount,
    allowedRoles: stringArray(value, "allowedRoles", skillId),
    allowedTouches: stringArray(value, "allowedTouches", skillId),
    vettingStatus: vettingStatus as VettingStatus,
    lastVettedAt,
  };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    const skillId = typeof record.skillId === "string" ? record.skillId : "skill";
    throw new SkillManifestError(`${skillId}.${key} must be a non-empty string`);
  }
  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  skillId: string,
): string | null {
  if (!(key in record)) throw new SkillManifestError(`${skillId}.${key} is required`);
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new SkillManifestError(`${skillId}.${key} must be a string or null`);
  return value;
}

function stringArray(record: Record<string, unknown>, key: string, skillId: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new SkillManifestError(`${skillId}.${key} must be an array of strings`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
