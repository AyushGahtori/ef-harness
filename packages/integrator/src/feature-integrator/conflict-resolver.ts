import {
  assertAllowedPaths,
  assertBothSidesSurvive,
  buildScopedConflictPrompt,
  resolveConflictText,
} from "./conflict-text.js";
import { UnrelatedEditError } from "./errors.js";
import { verifyRouteResolution } from "./route-verify.js";
import { assertNoTestWeakening, isTestPath } from "./test-weakening.js";
import { snapshotFiles } from "./trees.js";
import type { FileText, PreflightReport, ScopedConflictPacket } from "./types.js";

export interface ConflictResolution {
  readonly files: readonly FileText[];
  readonly prompt: string;
  readonly summaries: readonly { readonly path: string; readonly summary: string }[];
}

export function resolvePreflight(input: {
  readonly repo: string;
  readonly report: PreflightReport;
  readonly objectives: readonly { readonly taskId: string; readonly objective: string }[];
  readonly overrides?: readonly FileText[];
  readonly extraAllowed?: readonly string[];
}): ConflictResolution {
  const packet: ScopedConflictPacket = {
    hunks: input.report.conflicts.flatMap((conflict) => conflict.hunks),
    objectives: input.objectives,
  };
  const prompt = buildScopedConflictPrompt(packet);
  const allowed = new Set<string>([
    ...input.report.conflicts.map((conflict) => conflict.path),
    ...(input.extraAllowed ?? []),
  ]);
  const overrides = input.overrides ?? [];
  for (const override of overrides) {
    if (!allowed.has(override.path)) {
      if (isTestPath(override.path)) {
        const previous = snapshotFiles(input.repo, input.report.treeOid).get(override.path) ?? "";
        assertNoTestWeakening([{ path: override.path, text: previous }], [override]);
      }
      throw new UnrelatedEditError(override.path);
    }
  }
  const files: FileText[] = [];
  for (const conflict of input.report.conflicts) {
    const override = overrides.find((file) => file.path === conflict.path);
    const text = override
      ? override.text
      : resolveConflictText({
          path: conflict.path,
          conflicted: snapshotText(input.repo, input.report.treeOid, conflict.path),
          hunks: conflict.hunks,
          oursText: conflict.oursText,
          theirsText: conflict.theirsText,
        });
    assertBothSidesSurvive(conflict.path, conflict.oursText, conflict.theirsText, text);
    files.push({ path: conflict.path, text });
  }
  assertAllowedPaths(files.map((file) => file.path), allowed);
  const before = testFiles(snapshotFiles(input.repo, input.report.treeOid));
  const afterMap = snapshotFiles(input.repo, input.report.treeOid);
  for (const file of files) afterMap.set(file.path, file.text);
  assertNoTestWeakening(before, testFiles(afterMap));
  const support = [...afterMap.entries()]
    .filter(([filePath]) => filePath.endsWith(".ts") || filePath.endsWith(".tsx"))
    .map(([filePath, text]) => ({ path: filePath, text }));
  verifyRouteResolution(support);
  return {
    files,
    prompt,
    summaries: files.map((file) => ({
      path: file.path,
      summary: `Kept both sides of ${file.path}`,
    })),
  };
}

function snapshotText(repo: string, treeOid: string, path: string): string {
  return snapshotFiles(repo, treeOid).get(path) ?? "";
}

function testFiles(files: ReadonlyMap<string, string>): { path: string; text: string }[] {
  return [...files.entries()]
    .filter(([filePath]) => isTestPath(filePath))
    .map(([filePath, text]) => ({ path: filePath, text }));
}
