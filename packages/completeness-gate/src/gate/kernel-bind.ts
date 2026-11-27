import {
  CodeNameAuditError,
  type CodeNameAuditFailure,
  type NameRegistryService as DbNameRegistryService,
} from "@ef-harness/db";
import type { DiffSecretScanResult, GitSafetyScanner as LiveGitSafetyScanner } from "@ef-harness/git-engine";
import type {
  ExtractedCodeName,
  NameAuditFailure,
  NameRegistryService,
  SafetyScanReport,
} from "./ports.js";

/**
 * Calls `NameRegistryService.auditCodeNamesAgainstRegistry({ feature, names })`.
 * The live method throws `CodeNameAuditError`; the gate port returns those failures.
 */
export function bindNameRegistryService(service: DbNameRegistryService): NameRegistryService {
  return {
    auditCodeNamesAgainstRegistry(names, featureId) {
      try {
        service.auditCodeNamesAgainstRegistry({
          feature: featureId,
          names: names.map((name) => ({
            kind: name.kind,
            value: name.value,
            source: sourceOf(name),
          })),
        });
        return [];
      } catch (error) {
        if (!(error instanceof CodeNameAuditError)) throw error;
        return error.failures.map((failure) => toNameFailure(failure, names));
      }
    },
  };
}

/**
 * Calls `GitSafetyScanner.scanCommitDiffForSecrets(base, candidate)`.
 * The live method takes two revisions and returns `DiffSecretScanResult`.
 * The gate report type stays `SafetyScanReport`.
 */
export function bindGitSafetyScanner(scanner: LiveGitSafetyScanner): {
  scanCommitDiffForSecrets(base: string, candidate: string): Promise<SafetyScanReport>;
} {
  return {
    async scanCommitDiffForSecrets(base, candidate) {
      return toSafetyReport(await scanner.scanCommitDiffForSecrets(base, candidate));
    },
  };
}

function sourceOf(name: ExtractedCodeName): string {
  return `${name.file}:${String(name.line)}`;
}

function toNameFailure(failure: CodeNameAuditFailure, names: readonly ExtractedCodeName[]): NameAuditFailure {
  const located = locateFailure(failure, names);
  return {
    kind: failure.kind,
    value: failure.value,
    reason: failure.code,
    file: located.file,
    line: located.line,
    owner: failure.ownerFeature ?? failure.ownerNode ?? null,
  };
}

function locateFailure(
  failure: CodeNameAuditFailure,
  names: readonly ExtractedCodeName[],
): { file: string; line: number } {
  const fromSource = failure.source === undefined ? null : splitSource(failure.source);
  if (fromSource) return fromSource;
  const match = names.find((name) => name.kind === failure.kind && name.value === failure.value);
  if (match) return { file: match.file, line: match.line };
  return { file: "(registry)", line: 1 };
}

function splitSource(source: string): { file: string; line: number } | null {
  const index = source.lastIndexOf(":");
  if (index <= 0) return null;
  const line = Number(source.slice(index + 1));
  if (!Number.isInteger(line) || line < 1) return null;
  return { file: source.slice(0, index), line };
}

function toSafetyReport(result: DiffSecretScanResult): SafetyScanReport {
  return {
    blockedSecrets: result.findings.map((finding) => ({
      file: finding.file,
      line: finding.line,
      ruleId: finding.ruleId,
      maskedPreview: finding.preview,
    })),
    largeFiles: result.findings
      .filter((finding) => finding.ruleId === "large-file")
      .map((finding) => finding.file),
    recommendedIgnores: [],
    proposedGitignoreDiff: "",
    safeToCommit: !result.rejected,
  };
}
