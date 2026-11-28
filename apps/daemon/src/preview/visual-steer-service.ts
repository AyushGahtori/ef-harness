import fs from "node:fs";
import path from "node:path";
import { CodeIndexDb } from "@ef-harness/db";
import { VisualSteerV1Schema } from "@ef-harness/shared-contracts";

export interface DaemonVisualSteerRequest {
  readonly workspaceRoot: string;
  readonly instruction: string;
  readonly file: string | null;
  readonly commitSha?: string;
  readonly codeIndex?: CodeIndexDb;
}

export interface DaemonVisualSteerResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly file?: string;
  readonly screenCount: number;
  readonly needsQuestion: boolean;
  readonly scopePrompt?: string;
}

const SHARED_PRIMITIVE_PATHS = ["src/components/ui/button.tsx", "design/tokens.json"] as const;

export function routeDaemonVisualSteer(request: DaemonVisualSteerRequest): DaemonVisualSteerResult {
  const indexed = request.file ?? fileFromIndex(request.codeIndex, request.commitSha);
  if (!indexed) {
    return { accepted: false, reason: "source file is not in the code index", screenCount: 0, needsQuestion: false };
  }
  const contained = containInWorkspace(indexed, request.workspaceRoot);
  if (!contained.ok) {
    return {
      accepted: false,
      ...(contained.reason !== undefined ? { reason: contained.reason } : {}),
      screenCount: 0,
      needsQuestion: false,
    };
  }
  const screenCount = countScreens(request.codeIndex, request.commitSha, contained.file);
  const shared =
    SHARED_PRIMITIVE_PATHS.some((item) => contained.file.toLowerCase().endsWith(item)) ||
    /\b(all|every|global|primary buttons?|shared|everywhere|token)\b/i.test(request.instruction);
  const localOnly = /\b(only here|just this|this screen)\b/i.test(request.instruction);
  const needsQuestion = shared && !localOnly;
  const component = contained.file.split("/").pop()?.replace(/\.[tj]sx?$/, "") ?? contained.file;
  const steer = {
    target: {
      kind: "behavior" as const,
      node_id: `daemon-${hash(contained.file)}`,
      file: contained.file,
      component,
    },
    intent: request.instruction.trim(),
    needs_question: needsQuestion,
    conflict: null,
  };
  const parsed = VisualSteerV1Schema.safeParse(steer);
  if (!parsed.success) {
    return { accepted: false, reason: "visual-steer@1 output was rejected", screenCount, needsQuestion: false };
  }
  return {
    accepted: true,
    file: contained.file,
    screenCount,
    needsQuestion,
    ...(needsQuestion
      ? {
          scopePrompt:
            screenCount > 0
              ? `This changes shared Button across ${screenCount} screens — Change only here or update the shared design system?`
              : "Change only here or update the shared design system?",
        }
      : {}),
  };
}

function fileFromIndex(index: CodeIndexDb | undefined, commitSha: string | undefined): string | null {
  if (!index || !commitSha) return null;
  const symbols = index.symbolsForCommit(commitSha);
  return symbols[0]?.path ?? null;
}

function countScreens(index: CodeIndexDb | undefined, commitSha: string | undefined, file: string): number {
  if (!index || !commitSha) return 0;
  const symbols = index.symbolsForCommit(commitSha).filter((symbol) => symbol.path === file);
  const hashes = new Set<string>();
  for (const symbol of symbols) {
    for (const ref of index.refsForName(symbol.name)) hashes.add(ref.fileHash);
  }
  if (hashes.size > 0) return hashes.size;
  return index.filesForCommit(commitSha).filter((item) => item.path !== file && item.path.endsWith(".tsx")).length;
}

function containInWorkspace(
  sourceFile: string,
  workspaceRoot: string,
): { readonly ok: true; readonly file: string } | { readonly ok: false; readonly reason?: string } {
  const normalized = sourceFile.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.split("/").includes("..") || normalized.includes("\0")) {
    return { ok: false, reason: "path traversal or external path rejected" };
  }
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const absolute = path.resolve(root, normalized);
  const existing = deepestExisting(absolute);
  const real = fs.realpathSync(existing);
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "resolved path outside workspace" };
  }
  return { ok: true, file: normalized };
}

function deepestExisting(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function hash(input: string): string {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(value).toString(36);
}
