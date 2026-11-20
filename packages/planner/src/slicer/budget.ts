import { LEVEL_BUDGETS, type SliceItem, type WorkerLevel } from "./types.js";
import { compareText, countTokens, takeTokens } from "./tokens.js";

export interface BudgetItem {
  readonly id: string;
  readonly kind: string;
  readonly relevance: number;
  readonly text: string;
  readonly tokens: number;
}

export interface TrimResult<T extends BudgetItem> {
  readonly kept: readonly T[];
  readonly trimmed: readonly T[];
}

const KIND_RANK: Readonly<Record<string, number>> = {
  research_fact: 0,
  skill: 1,
  contract: 2,
  module_card: 3,
};

export class BandTokenBudgeter {
  count(text: string): number {
    return countTokens(text);
  }

  itemTokens(item: Pick<SliceItem, "text">): number {
    return countTokens(item.text);
  }

  bandTokens(items: readonly Pick<SliceItem, "text">[]): number {
    return items.reduce((sum, item) => sum + countTokens(item.text), 0);
  }

  remainingShouldBudget(level: WorkerLevel, committedTokens: number): number {
    return Math.max(0, LEVEL_BUDGETS[level].targetMax - committedTokens);
  }

  compare(left: BudgetItem, right: BudgetItem): number {
    if (right.relevance !== left.relevance) return right.relevance - left.relevance;
    const leftRank = KIND_RANK[left.kind] ?? 9;
    const rightRank = KIND_RANK[right.kind] ?? 9;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compareText(left.id, right.id);
  }

  /**
   * Keep higher relevance first. Skills that do not fit whole are excerpted
   * down to the remaining words. Every other item moves wholly into the
   * trimmed set so it can become a pull pointer.
   */
  trimShould<T extends BudgetItem>(items: readonly T[], budget: number): TrimResult<T> {
    const ordered = [...items].sort((left, right) => this.compare(left, right));
    const kept: T[] = [];
    const trimmed: T[] = [];
    let used = 0;
    for (const item of ordered) {
      const room = budget - used;
      if (item.tokens <= room) {
        kept.push(item);
        used += item.tokens;
        continue;
      }
      if (item.kind === "skill" && room > 0) {
        const excerpt = takeTokens(item.text, room);
        const excerptTokens = countTokens(excerpt);
        if (excerptTokens > 0 && excerptTokens <= room) {
          kept.push({ ...item, text: excerpt, tokens: excerptTokens });
          used += excerptTokens;
          continue;
        }
      }
      trimmed.push(item);
    }
    return { kept, trimmed };
  }
}

export function shouldPointer(item: Pick<SliceItem, "id" | "kind" | "version"> & { path?: string }): string {
  if (item.kind === "research_fact") return `kb.get_fact('${item.id}')`;
  if (item.kind === "skill") return `kb.get('${item.id}')`;
  if (item.kind === "contract") return `kb.contract('${item.id}@${item.version}')`;
  if (item.kind === "module_card") return `kb.code('${item.path ?? item.id}')`;
  return `kb.get('${item.id}')`;
}
