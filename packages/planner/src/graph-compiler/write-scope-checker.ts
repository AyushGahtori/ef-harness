import type { OrderingIndex } from "./reachability.js";
import { tasksAreConcurrent } from "./reachability.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput, PlanTask } from "./types.js";
import { firstPatternIntersection, foldAsciiCase, normalizeWritePattern } from "./windows-glob.js";
import type { NormalizedPattern } from "./windows-glob.js";

interface PreparedTask {
  readonly task: PlanTask;
  readonly patterns: readonly NormalizedPattern[];
}

export class WriteScopeDisjointnessChecker {
  check(input: CompilationInput, tasks: OrderingIndex, features: OrderingIndex): CompilationDiagnostic[] {
    const prepared: PreparedTask[] = [...input.tasks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        task,
        patterns: task.writeScope.map((pattern) => normalizeWritePattern(pattern, input.platform)),
      }));
    const diagnostics: CompilationDiagnostic[] = [];
    for (const item of prepared) {
      if (item.task.taskKind !== "leaf") continue;
      for (const pattern of item.patterns) {
        if (!pattern.broad) continue;
        diagnostics.push(
          diagnostic({
            pass: 2,
            code: "broad_leaf_wildcard",
            message: `Leaf task ${item.task.id} declares broad write scope "${pattern.original}". Patterns ${"`**/*`"} and ${"`src/**`"} are compilation errors.`,
            taskIds: [item.task.id],
            paths: [pattern.original],
            details: { normalized: pattern.posix },
          }),
        );
      }
    }
    const exact = new Map<string, ScopedPattern[]>();
    const globs: ScopedPattern[] = [];
    for (const item of prepared) {
      for (const pattern of item.patterns) {
        const scoped = { task: item.task, pattern };
        if (pattern.hasMeta || pattern.broad) globs.push(scoped);
        else {
          const bucket = exact.get(pattern.posix) ?? [];
          bucket.push(scoped);
          exact.set(pattern.posix, bucket);
        }
      }
    }
    const reported = new Set<string>();
    const consider = (left: ScopedPattern, right: ScopedPattern): void => {
      if (left.task.id === right.task.id) return;
      const pair = [left.task.id, right.task.id].sort((a, b) => a.localeCompare(b)).join("\u0000");
      if (reported.has(pair)) return;
      if (
        !tasksAreConcurrent(
          left.task.id,
          left.task.featureId,
          right.task.id,
          right.task.featureId,
          tasks,
          features,
        )
      ) {
        return;
      }
      const hit = firstPatternIntersection([left.pattern], [right.pattern]);
      if (!hit) return;
      reported.add(pair);
      const caseClash = caseOnlyCollision(input.platform, hit.left, hit.right);
      diagnostics.push(
        diagnostic({
          pass: 2,
          code: "parallel_write_overlap",
          message: caseClash
            ? `Tasks ${left.task.id} and ${right.task.id} collide on Windows after case folding ("${hit.left.original}" and "${hit.right.original}").`
            : `Parallel tasks ${left.task.id} and ${right.task.id} write intersecting paths "${hit.left.original}" ∩ "${hit.right.original}".`,
          taskIds: [left.task.id, right.task.id].sort((a, b) => a.localeCompare(b)),
          paths: [hit.left.original, hit.right.original],
          details: { normalizedLeft: hit.left.posix, normalizedRight: hit.right.posix },
        }),
      );
      if (!caseClash) return;
      diagnostics.push(
        diagnostic({
          pass: 2,
          code: "windows_case_collision",
          message: `Tasks ${left.task.id} and ${right.task.id} differ only by ASCII case on Windows ("${hit.left.original}" and "${hit.right.original}").`,
          taskIds: [left.task.id, right.task.id].sort((a, b) => a.localeCompare(b)),
          paths: [hit.left.original, hit.right.original],
          details: { normalizedLeft: hit.left.posix, normalizedRight: hit.right.posix },
        }),
      );
    };
    for (const bucket of exact.values()) {
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const left = bucket[i];
          const right = bucket[j];
          if (left && right) consider(left, right);
        }
      }
    }
    for (const glob of globs) {
      for (const item of prepared) {
        for (const pattern of item.patterns) consider(glob, { task: item.task, pattern });
      }
    }
    return diagnostics;
  }
}

interface ScopedPattern {
  readonly task: PlanTask;
  readonly pattern: NormalizedPattern;
}

function caseOnlyCollision(platform: CompilationInput["platform"], left: NormalizedPattern, right: NormalizedPattern): boolean {
  if (platform !== "windows" || left.posix !== right.posix) return false;
  const slash = (value: string): string => value.replaceAll("\\", "/");
  return slash(left.original) !== slash(right.original) && foldAsciiCase(slash(left.original)) === foldAsciiCase(slash(right.original));
}
