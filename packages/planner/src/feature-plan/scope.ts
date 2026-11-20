import { FeaturePlanError } from "./errors.js";
import { MAX_LEAF_FILES, MIN_LEAF_FILES, type PlannedTask } from "./types.js";

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function assertTaskBounds(task: PlannedTask): void {
  if (task.files.length < MIN_LEAF_FILES || task.files.length > MAX_LEAF_FILES) {
    throw new FeaturePlanError(
      "oversized_task",
      `Task ${task.id} touches ${task.files.length} files, which is outside the ${MIN_LEAF_FILES}-${MAX_LEAF_FILES} file bound`,
      { taskId: task.id, fileCount: task.files.length, files: task.files },
    );
  }
  if (task.writeScope.length === 0) {
    throw new FeaturePlanError("oversized_task", `Task ${task.id} has an empty write scope`, { taskId: task.id });
  }
  for (const pattern of task.writeScope) {
    if (normalizePath(pattern).includes("**")) {
      throw new FeaturePlanError(
        "oversized_task",
        `Task ${task.id} declares unbounded write scope ${pattern}; slice the task so each leaf owns 1-5 concrete files`,
        { taskId: task.id, pattern },
      );
    }
  }
  for (const file of task.files) {
    const matched = task.writeScope.some((pattern) => globMatches(pattern, file));
    if (!matched) {
      throw new FeaturePlanError(
        "oversized_task",
        `Task ${task.id} file ${file} is outside its write scope`,
        { taskId: task.id, file },
      );
    }
  }
}

export function assertDisjointWriteScopes(tasks: readonly PlannedTask[]): void {
  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const a = tasks[left];
      const b = tasks[right];
      if (!a || !b) continue;
      if (scopesOverlap(a, b)) {
        throw new FeaturePlanError(
          "write_scope_overlap",
          `Tasks ${a.id} and ${b.id} have overlapping write scopes`,
          { left: a.id, right: b.id, leftScope: a.writeScope, rightScope: b.writeScope },
        );
      }
    }
  }
}

export function scopesOverlap(left: PlannedTask, right: PlannedTask): boolean {
  const leftFiles = left.files.map(normalizePath);
  const rightFiles = right.files.map(normalizePath);
  for (const file of leftFiles) {
    if (rightFiles.includes(file)) return true;
  }
  for (const pattern of left.writeScope) {
    if (rightFiles.some((file) => globMatches(pattern, file))) return true;
    for (const other of right.writeScope) {
      if (normalizePath(pattern) === normalizePath(other)) return true;
      if (globMatches(pattern, sample(other)) || globMatches(other, sample(pattern))) return true;
    }
  }
  for (const pattern of right.writeScope) {
    if (leftFiles.some((file) => globMatches(pattern, file))) return true;
  }
  return false;
}

export function globMatches(pattern: string, file: string): boolean {
  const expression = globToRegExp(pattern);
  return expression.test(normalizePath(file));
}

function sample(pattern: string): string {
  return normalizePath(pattern).replaceAll("**", "sample").replaceAll("*", "sample");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      if (normalized[index + 1] === "/") index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char && ".+?^${}()|[]\\".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char ?? "";
  }
  return new RegExp(`^${source}$`, "i");
}
