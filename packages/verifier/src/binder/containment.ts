import { HARNESS_BINDER_DIR } from "./constants.js";
import { BindingDefectError } from "./errors.js";
import type { BinderWrite } from "./types.js";

const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function hasUnsafePath(file: string): boolean {
  const slash = file.replaceAll("\\", "/").trim();
  if (slash.startsWith("/") || /^[A-Za-z]:/.test(slash)) return true;
  let depth = 0;
  for (const part of slash.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

export function normalizeRel(file: string): string {
  const slash = file.replaceAll("\\", "/").trim();
  const noDot = slash.replace(/^\.\//, "");
  const collapsed = noDot
    .split("/")
    .reduce<string[]>((parts, part) => {
      if (part === "" || part === ".") return parts;
      if (part === "..") {
        parts.pop();
        return parts;
      }
      parts.push(part);
      return parts;
    }, [])
    .join("/");
  return collapsed;
}

export function adapterPath(checkId: string): string {
  if (!CHECK_ID.test(checkId)) {
    throw new BindingDefectError(
      "prompt_rejected",
      `check id ${checkId} cannot be used as a binder file name`,
      "non_behavioral",
    );
  }
  return `${HARNESS_BINDER_DIR}/${checkId}.adapter.ts`;
}

export function isBinderPath(file: string): boolean {
  if (hasUnsafePath(file)) return false;
  const rel = normalizeRel(file);
  return rel === HARNESS_BINDER_DIR || rel.startsWith(`${HARNESS_BINDER_DIR}/`);
}

export function cloneFiles(files: Readonly<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [file, contents] of Object.entries(files)) {
    next[normalizeRel(file)] = contents;
  }
  return next;
}

export function productSnapshot(files: Readonly<Record<string, string>>): Map<string, string> {
  const snap = new Map<string, string>();
  for (const [file, contents] of Object.entries(files)) {
    const rel = normalizeRel(file);
    if (isBinderPath(rel)) continue;
    snap.set(rel, contents);
  }
  return snap;
}

export function changedProductPaths(
  before: ReadonlyMap<string, string>,
  after: Readonly<Record<string, string>>,
): string[] {
  const next = productSnapshot(after);
  const changed: string[] = [];
  const keys = new Set<string>([...before.keys(), ...next.keys()]);
  for (const key of keys) {
    if (before.get(key) !== next.get(key)) changed.push(key);
  }
  changed.sort();
  return changed;
}

/**
 * Apply binder file writes. Any path outside `.harness-binder/**` is a hard failure
 * and is not written.
 */
export function applyBinderWrites(
  files: Readonly<Record<string, string>>,
  writes: readonly BinderWrite[],
): Record<string, string> {
  const next = cloneFiles(files);
  for (const write of writes) {
    if (hasUnsafePath(write.path) || !isBinderPath(write.path)) {
      throw new BindingDefectError(
        "product_mutation",
        `Binder modified ${write.path} outside ${HARNESS_BINDER_DIR}/**`,
        "non_behavioral",
      );
    }
    const rel = normalizeRel(write.path);
    if (rel === HARNESS_BINDER_DIR) {
      throw new BindingDefectError(
        "product_mutation",
        `Binder modified ${write.path} outside ${HARNESS_BINDER_DIR}/**`,
        "non_behavioral",
      );
    }
    next[rel] = write.contents;
  }
  return next;
}

export function assertProductUntouched(
  before: ReadonlyMap<string, string>,
  after: Readonly<Record<string, string>>,
): void {
  const changed = changedProductPaths(before, after);
  const first = changed[0];
  if (first) {
    throw new BindingDefectError(
      "product_mutation",
      `Binder modified ${changed.join(", ")} outside ${HARNESS_BINDER_DIR}/**`,
      "non_behavioral",
    );
  }
}
