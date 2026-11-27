import {
  type GenerationRun,
  type MatrixId,
  type RawMatrixCell,
} from "./types.js";

export interface UniversalRule {
  readonly id: string;
  readonly matrixId: MatrixId;
  readonly scopeKey: string;
  readonly signature: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly text: string;
  readonly coveredCount: number;
  readonly domainNodeIds: readonly string[];
}

export interface CollapsedMatrices {
  readonly rules: readonly UniversalRule[];
  readonly exceptions: readonly RawMatrixCell[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toRule(
  cells: readonly RawMatrixCell[],
  coveredCount: number,
  domains: ReadonlyMap<string, readonly string[]>,
): UniversalRule {
  const first = cells[0];
  if (!first) throw new Error("cannot collapse an empty cell group");
  let text = first.ruleText;
  if (text !== null) {
    for (const cell of cells) {
      if (cell.ruleText !== text) {
        text = null;
        break;
      }
    }
  }
  const indexed = domains.get(`${first.matrixId}\n${first.scopeKey}`);
  const domainNodeIds = indexed ? indexed : collectDomains(cells);
  return {
    id: `rule:${first.matrixId}:${first.scopeKey}:${first.signature}`,
    matrixId: first.matrixId,
    scopeKey: first.scopeKey,
    signature: first.signature,
    outcome: first.outcome,
    reason: first.reason,
    text: text ?? `ALL ${first.scopeKey} => ${first.outcome}`,
    coveredCount,
    domainNodeIds,
  };
}

function collectDomains(cells: readonly RawMatrixCell[]): readonly string[] {
  const domains = new Set<string>();
  for (const cell of cells) {
    for (const id of cell.domainNodeIds) domains.add(id);
  }
  return [...domains].sort(compareText);
}

interface ScopeBucket {
  readonly firstSig: string;
  readonly firstCells: RawMatrixCell[];
  others: Map<string, RawMatrixCell[]> | null;
}

export class ScopedRuleCollapser {
  collapse(run: GenerationRun): CollapsedMatrices {
    const exceptions: RawMatrixCell[] = [];
    const groups = new Map<string, Map<string, ScopeBucket>>();
    for (const cell of run.rawCells) {
      if (cell.forceException) {
        exceptions.push(cell);
        continue;
      }
      let byScope = groups.get(cell.matrixId);
      if (!byScope) {
        byScope = new Map();
        groups.set(cell.matrixId, byScope);
      }
      const bucket = byScope.get(cell.scopeKey);
      if (!bucket) {
        byScope.set(cell.scopeKey, {
          firstSig: cell.signature,
          firstCells: [cell],
          others: null,
        });
        continue;
      }
      if (cell.signature === bucket.firstSig) {
        bucket.firstCells.push(cell);
        continue;
      }
      let others = bucket.others;
      if (!others) {
        others = new Map();
        bucket.others = others;
      }
      let list = others.get(cell.signature);
      if (!list) {
        list = [cell];
        others.set(cell.signature, list);
      } else {
        list.push(cell);
      }
    }
    const rules: UniversalRule[] = [];
    for (const byScope of groups.values()) {
      for (const bucket of byScope.values()) {
        let bestSig = bucket.firstSig;
        let bestCells = bucket.firstCells;
        if (bucket.others) {
          for (const [sig, cells] of bucket.others) {
            if (
              cells.length > bestCells.length ||
              (cells.length === bestCells.length && compareText(sig, bestSig) < 0)
            ) {
              bestSig = sig;
              bestCells = cells;
            }
          }
        }
        if (bestCells.length >= 2) {
          rules.push(toRule(bestCells, bestCells.length, run.domains));
          if (bestSig !== bucket.firstSig) {
            for (const cell of bucket.firstCells) exceptions.push(cell);
          }
          if (bucket.others) {
            for (const [sig, cells] of bucket.others) {
              if (sig !== bestSig) {
                for (const cell of cells) exceptions.push(cell);
              }
            }
          }
        } else {
          for (const cell of bucket.firstCells) exceptions.push(cell);
          if (bucket.others) {
            for (const cells of bucket.others.values()) {
              for (const cell of cells) exceptions.push(cell);
            }
          }
        }
      }
    }
    rules.sort((left, right) => compareText(left.id, right.id));
    exceptions.sort((left, right) => compareText(left.id, right.id));
    return { rules, exceptions };
  }

  /**
   * Reconstruct every raw pair from universal rules plus exception cells.
   * Exception cells win over the rule that covers the same scope.
   */
  expand(collapsed: CollapsedMatrices, rawCells: readonly RawMatrixCell[]): Map<string, string> {
    const exceptions = new Map<string, string>();
    for (const cell of collapsed.exceptions) exceptions.set(cell.id, cell.signature);
    const rules = new Map<string, UniversalRule>();
    for (const rule of collapsed.rules) rules.set(`${rule.matrixId}\n${rule.scopeKey}`, rule);
    const expanded = new Map<string, string>();
    for (const cell of rawCells) {
      const exception = exceptions.get(cell.id);
      if (exception !== undefined) {
        expanded.set(cell.id, exception);
        continue;
      }
      const rule = rules.get(`${cell.matrixId}\n${cell.scopeKey}`);
      if (!rule) throw new Error(`collapsed matrix does not cover ${cell.id}`);
      expanded.set(cell.id, rule.signature);
    }
    if (expanded.size !== rawCells.length) {
      throw new Error("collapsed expansion dropped raw pairs");
    }
    return expanded;
  }
}
