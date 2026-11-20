import { type WildcardOverlapConflict } from "./errors.js";
import { type WildcardNameKind } from "./name-kinds.js";

export interface WildcardRegistration {
  kind: WildcardNameKind;
  value: string;
  feature: string;
  ownerNode: string;
}

/**
 * Prefix and `*` patterns for cache keys, permissions, and i18n namespaces.
 * Overlap is reported only across two different feature owners.
 */
export function detectWildcardOverlap(
  entries: readonly WildcardRegistration[],
): WildcardOverlapConflict[] {
  const ordered = [...entries].sort(compareEntries);
  const conflicts: WildcardOverlapConflict[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const left = ordered[i];
    if (!left) continue;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const right = ordered[j];
      if (!right || left.kind !== right.kind || left.feature === right.feature) continue;
      if (!globsOverlap(left.value, right.value)) continue;
      conflicts.push({
        kind: left.kind,
        left: { value: left.value, feature: left.feature, ownerNode: left.ownerNode },
        right: { value: right.value, feature: right.feature, ownerNode: right.ownerNode },
        message: `${left.kind} pattern ${left.value} (${left.feature}) overlaps ${right.value} (${right.feature}).`,
      });
    }
  }
  return conflicts;
}

function compareEntries(left: WildcardRegistration, right: WildcardRegistration): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.value.localeCompare(right.value) ||
    left.feature.localeCompare(right.feature) ||
    left.ownerNode.localeCompare(right.ownerNode)
  );
}

export function globsOverlap(left: string, right: string): boolean {
  const memo = new Map<string, boolean>();
  const visit = (i: number, j: number): boolean => {
    const key = `${String(i)}:${String(j)}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const result = visitUncached(left, right, i, j, visit);
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

function visitUncached(
  left: string,
  right: string,
  i: number,
  j: number,
  visit: (i: number, j: number) => boolean,
): boolean {
  if (i === left.length && j === right.length) return true;
  const leftStar = i < left.length && left[i] === "*";
  const rightStar = j < right.length && right[j] === "*";
  if (leftStar && rightStar) {
    return visit(i + 1, j) || visit(i, j + 1) || visit(i + 1, j + 1);
  }
  if (leftStar) return visit(i + 1, j) || (j < right.length && visit(i, j + 1));
  if (rightStar) return visit(i, j + 1) || (i < left.length && visit(i + 1, j));
  if (i < left.length && j < right.length && left[i] === right[j]) return visit(i + 1, j + 1);
  return false;
}
