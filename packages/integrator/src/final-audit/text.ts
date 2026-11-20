import { createHash } from "node:crypto";

import type { ConfirmedFinding, RepoFile } from "./types.js";

export function lineCount(content: string): number {
  if (content.length === 0) return 1;
  const parts = content.split(/\r?\n/);
  if (content.endsWith("\n") || content.endsWith("\r\n")) {
    return Math.max(1, parts.length - 1);
  }
  return parts.length;
}

export function lineOfIndex(content: string, index: number): number {
  let line = 1;
  const end = Math.min(index, content.length);
  for (let i = 0; i < end; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

export function findingFingerprint(input: {
  readonly code: string;
  readonly filePath: string | null;
  readonly lineStart: number | null;
  readonly requirementId: string | null;
  readonly ruleId: string | null;
  readonly detail: string;
}): string {
  return fingerprint([
    input.code,
    input.filePath ?? "",
    String(input.lineStart ?? ""),
    input.requirementId ?? "",
    input.ruleId ?? "",
    input.detail.trim(),
  ]);
}

export function makeFinding(input: {
  readonly code: string;
  readonly shardId?: string | null;
  readonly kind: ConfirmedFinding["kind"];
  readonly severity: ConfirmedFinding["severity"];
  readonly advisory?: boolean;
  readonly filePath?: string | null;
  readonly lineStart?: number | null;
  readonly lineEnd?: number | null;
  readonly requirementId?: string | null;
  readonly ruleId?: string | null;
  readonly detail: string;
  readonly fixCostUnits: bigint;
}): ConfirmedFinding {
  const filePath = input.filePath ?? null;
  const lineStart = input.lineStart ?? null;
  const lineEnd = input.lineEnd ?? lineStart;
  const requirementId = input.requirementId ?? null;
  const ruleId = input.ruleId ?? null;
  const shardId = input.shardId ?? null;
  const digest = findingFingerprint({
    code: input.code,
    filePath,
    lineStart,
    requirementId,
    ruleId,
    detail: input.detail,
  });
  return {
    id: `F-${digest}`,
    fingerprint: digest,
    code: input.code,
    shardId,
    kind: input.kind,
    severity: input.severity,
    advisory: input.advisory ?? false,
    filePath,
    lineStart,
    lineEnd,
    requirementId,
    ruleId,
    detail: input.detail.trim(),
    fixCostUnits: input.fixCostUnits,
  };
}

export function fileMap(files: readonly RepoFile[]): Map<string, RepoFile> {
  const map = new Map<string, RepoFile>();
  for (const file of files) map.set(file.path.replaceAll("\\", "/"), file);
  return map;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

const MARKER_SOURCE = ["TO", "DO"].join("");
const FIX_SOURCE = ["FIX", "ME"].join("");

export function markerPattern(): RegExp {
  return new RegExp(`\\b(?:${MARKER_SOURCE}|${FIX_SOURCE})\\b(?!\\(DEF-[A-Za-z0-9-]+\\))`);
}

export function approvedDeferral(content: string): boolean {
  const approved = new RegExp(`\\b(?:${MARKER_SOURCE}|${FIX_SOURCE})\\(DEF-[A-Za-z0-9-]+\\)`);
  return approved.test(content);
}

function joined(parts: readonly string[]): string {
  return parts.join("");
}

export function secretRules(): readonly { readonly id: string; readonly pattern: RegExp }[] {
  return [
    { id: "private-key", pattern: new RegExp(joined(["BEGIN ", "PRIVATE KEY"])) },
    { id: "aws-access-key", pattern: new RegExp(`${joined(["AK", "IA"])}[A-Z0-9]{16}`) },
    { id: "github-token", pattern: new RegExp(`${joined(["ghp", "_"])}[A-Za-z0-9]{20,}`) },
    { id: "live-secret", pattern: new RegExp(`${joined(["sk", "_live_"])}[A-Za-z0-9]`) },
    { id: "vendor-secret-a", pattern: new RegExp(joined(["sk-ant", "-"])) },
    { id: "vendor-secret-b", pattern: new RegExp(joined(["sk-proj", "-"])) },
  ];
}
