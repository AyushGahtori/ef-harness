import type { LocalDualFtsSearch } from "./fts.js";
import { estimateTokens, renderRouterPrompt } from "./prompt.js";
import type { GraphNodeView, InputStartFocus, RecentTurn, Shortlist, ShortlistCard } from "./types.js";
import { ROUTER_PROMPT_TOKEN_BUDGET, ROUTER_SHORTLIST_CAP } from "./types.js";

export interface KnowledgeGraphPort {
  getNode(id: string): GraphNodeView | null;
  listActiveNodes(): readonly GraphNodeView[];
}

export interface FtsSearchPort {
  searchNodes(query: string, limit?: number): readonly { id: string; score: number; source: "kb_words" | "kb_ident" }[];
  searchIdentifiers(needle: string, limit?: number): readonly { id: string; score: number; source: "kb_words" | "kb_ident" }[];
}

export class RouterShortlistRetriever {
  constructor(
    private readonly graph: KnowledgeGraphPort,
    private readonly search: FtsSearchPort,
  ) {}

  retrieve(input: {
    readonly text: string;
    readonly focus: InputStartFocus | null;
    readonly recentTurns: readonly RecentTurn[];
  }): Shortlist {
    const nodes = this.graph.listActiveNodes();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const scores = new Map<string, number>();
    const reasons = new Map<string, Set<string>>();
    const bump = (id: string, amount: number, reason: string) => {
      if (!byId.has(id)) return;
      scores.set(id, (scores.get(id) ?? 0) + amount);
      const bag = reasons.get(id) ?? new Set<string>();
      bag.add(reason);
      reasons.set(id, bag);
    };

    const wordHits = this.search.searchNodes(input.text, ROUTER_SHORTLIST_CAP);
    for (const hit of wordHits) bump(hit.id, hit.score, "kb_words bm25");
    const identNeedles = identifierNeedles(input.text);
    const identIds: string[] = [];
    for (const needle of identNeedles) {
      for (const hit of this.search.searchIdentifiers(needle, ROUTER_SHORTLIST_CAP)) {
        bump(hit.id, hit.score, "kb_ident");
        identIds.push(hit.id);
      }
    }

    const tokens = contentTokens(input.text);
    for (const node of nodes) {
      const hay = haystack(node);
      const overlap = tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0);
      if (overlap > 0) bump(node.id, overlap * 2, "lexical overlap");
      if (node.working && overlap > 0) bump(node.id, 1, "active working set");
      if (node.kind === "question" && node.status === "open" && overlap > 0) {
        bump(node.id, 3, "open question");
      }
    }

    for (const id of focusIds(input.focus)) bump(id, 20, "input_start_focus");
    for (const turn of input.recentTurns.slice(-3)) {
      for (const id of turn.targetIds) bump(id, 2, "recent turn");
    }

    const ranked = [...scores.entries()].sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
    });
    const pinned = focusIds(input.focus).filter((id) => byId.has(id));
    const chosen: string[] = [];
    for (const id of pinned) {
      if (chosen.length < ROUTER_SHORTLIST_CAP && !chosen.includes(id)) chosen.push(id);
    }
    for (const [id] of ranked) {
      if (chosen.length >= ROUTER_SHORTLIST_CAP) break;
      if (!chosen.includes(id)) chosen.push(id);
    }

    const cards: ShortlistCard[] = chosen.map((id) => {
      const node = byId.get(id);
      if (!node) throw new Error(`shortlist lost ${id}`);
      return {
        id: node.id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        aliases: node.aliases,
        featureId: node.featureId,
        ownerRole: node.ownerRole,
        working: node.working,
        score: scores.get(id) ?? 0,
        whyMatched: [...(reasons.get(id) ?? new Set<string>())],
      };
    });
    cards.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
    const fitted = fitBudget(cards, input.text, input.focus);
    return {
      cards: fitted,
      promptTokens: estimateTokens(renderRouterPrompt({
        messageText: input.text,
        cards: fitted,
        focus: input.focus,
        previousTargets: [],
        repair: null,
      }).rendered),
      ftsWordIds: wordHits.map((hit) => hit.id),
      ftsIdentIds: [...new Set(identIds)],
    };
  }
}

export function asFtsPort(search: LocalDualFtsSearch): FtsSearchPort {
  return search;
}

function fitBudget(cards: readonly ShortlistCard[], messageText: string, focus: InputStartFocus | null): ShortlistCard[] {
  const fitted = [...cards];
  const tokensOf = (list: readonly ShortlistCard[]) =>
    estimateTokens(renderRouterPrompt({
      messageText,
      cards: list,
      focus,
      previousTargets: [],
      repair: null,
    }).rendered);
  while (fitted.length > 1 && tokensOf(fitted) >= ROUTER_PROMPT_TOKEN_BUDGET) {
    let dropAt = fitted.length - 1;
    for (let index = fitted.length - 1; index >= 0; index -= 1) {
      const card = fitted[index];
      if (card && !card.whyMatched.includes("input_start_focus")) {
        dropAt = index;
        break;
      }
    }
    fitted.splice(dropAt, 1);
  }
  return fitted;
}

function haystack(node: GraphNodeView): string {
  return `${node.id} ${node.title} ${node.text} ${node.aliases.join(" ")}`.toLowerCase();
}

function focusIds(focus: InputStartFocus | null): string[] {
  if (!focus) return [];
  const ids = [
    ...focus.selectedCanvasNodeIds,
    focus.focusedFeatureId,
    focus.inspectedTaskId,
    focus.openQuestionCardId,
  ];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "that", "this", "with", "from", "into", "have", "what",
  "when", "where", "who", "why", "how", "much", "please", "also", "just", "actually", "wait",
  "instead", "them", "they", "our", "are", "was", "were", "been", "will", "can", "not", "but",
  "its", "it's",   "let", "make", "change", "stop", "pause", "build", "show", "add", "set",
  "switch", "update", "edit", "move", "include", "please",
]);

export function contentTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token));
  return [...new Set(tokens)];
}

function identifierNeedles(text: string): string[] {
  const found = text.match(/\b[A-Za-z]+-[A-Za-z0-9]+\b/g) ?? [];
  return [...new Set(found)];
}
