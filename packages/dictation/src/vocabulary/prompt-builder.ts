import { encodeWhisperBpe } from "./whisper-bpe.js";
import { tierForEntry, WEIGHT, PROMPT_TIER } from "./weights.js";
import {
  CARRY_INITIAL_PROMPT_FLAG,
  GLOBAL_PROJECT_ID,
  WHISPER_PROMPT_TOKEN_LIMIT,
  type RankedPromptTerm,
  type VocabularyEntry,
  type WhisperInitialPrompt,
} from "./types.js";

export interface PromptCandidateInput {
  readonly projectId: string;
  readonly entries: readonly VocabularyEntry[];
  readonly focusTerms?: readonly string[];
  readonly neighborTerms?: readonly string[];
  readonly recentlyEditedTerms?: readonly string[];
}

function compareAsc(left: RankedPromptTerm, right: RankedPromptTerm): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.weight !== right.weight) return left.weight - right.weight;
  if (left.lastUsedAt !== right.lastUsedAt) return left.lastUsedAt - right.lastUsedAt;
  if (left.term < right.term) return -1;
  if (left.term > right.term) return 1;
  return 0;
}

function compareDesc(left: RankedPromptTerm, right: RankedPromptTerm): number {
  return -compareAsc(left, right);
}

/**
 * Builds the whisper.cpp initial prompt.
 * Highest-weight terms are selected first, then written lowest-weight first
 * so the tail next to the audio frame is the focused / highest-weight text.
 * The result always carries `--carry-initial-prompt` and never exceeds 224 BPE tokens.
 */
interface TermPieces {
  readonly spacedTokens: number;
  readonly firstPieceIds: readonly number[];
  readonly spacedPieceIds: readonly number[];
}

export class WhisperInitialPromptBuilder {
  private readonly pieces = new Map<string, TermPieces>();

  build(input: PromptCandidateInput): WhisperInitialPrompt {
    const scored = this.score(input);
    const pool = scored.slice().sort(compareDesc);
    const chosen: RankedPromptTerm[] = [];
    let used = 0;
    for (const candidate of pool) {
      if (candidate.spacedTokens > WHISPER_PROMPT_TOKEN_LIMIT) continue;
      if (used + candidate.spacedTokens <= WHISPER_PROMPT_TOKEN_LIMIT) {
        chosen.push(candidate);
        used += candidate.spacedTokens;
      }
    }
    let ordered = chosen.slice().sort(compareAsc);
    let start = 0;
    while (start < ordered.length && this.tokenLength(ordered, start) > WHISPER_PROMPT_TOKEN_LIMIT) {
      start += 1;
    }
    ordered = start > 0 ? ordered.slice(start) : ordered;
    const tokenIds = this.assemble(ordered);
    const text = ordered.map((term) => term.term).join(" ");
    return {
      flag: CARRY_INITIAL_PROMPT_FLAG,
      carryInitialPrompt: true,
      args: ["--prompt", text, CARRY_INITIAL_PROMPT_FLAG],
      text,
      tokenCount: tokenIds.length,
      terms: ordered.map((term) => term.term),
      tokenIds,
    };
  }

  /**
   * Whisper's BPE does not merge across regex pre-token boundaries, so the
   * joined prompt is the first term plus each later term with its leading space.
   */
  private tokenLength(ordered: readonly RankedPromptTerm[], start: number): number {
    if (start >= ordered.length) return 0;
    const first = ordered[start];
    if (!first) return 0;
    let count = first.firstPieceIds.length;
    for (let index = start + 1; index < ordered.length; index += 1) {
      count += ordered[index]?.spacedPieceIds.length ?? 0;
    }
    return count;
  }

  private assemble(ordered: readonly RankedPromptTerm[]): number[] {
    const ids: number[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const piece = ordered[index];
      if (!piece) continue;
      ids.push(...(index === 0 ? piece.firstPieceIds : piece.spacedPieceIds));
    }
    return ids;
  }

  private score(input: PromptCandidateInput): RankedPromptTerm[] {
    const focus = new Set(input.focusTerms ?? []);
    const neighbors = new Set(input.neighborTerms ?? []);
    const recent = new Set(input.recentlyEditedTerms ?? []);
    const byTerm = new Map<string, VocabularyEntry>();
    const suppressedHere = new Set<string>();
    for (const entry of input.entries) {
      if (entry.project_id !== input.projectId && entry.project_id !== GLOBAL_PROJECT_ID) continue;
      if (entry.suppressed) {
        if (entry.project_id === input.projectId || entry.project_id === GLOBAL_PROJECT_ID) {
          suppressedHere.add(entry.term);
        }
        continue;
      }
      if (entry.source === "user_correction" && entry.occurrence_count < 2) continue;
      const current = byTerm.get(entry.term);
      if (!current || (current.project_id === GLOBAL_PROJECT_ID && entry.project_id === input.projectId)) {
        byTerm.set(entry.term, entry);
      }
    }
    const boostTerms = new Set<string>([...focus, ...neighbors, ...recent]);
    for (const term of boostTerms) {
      if (!term.trim() || suppressedHere.has(term)) continue;
      if (!byTerm.has(term)) {
        byTerm.set(term, {
          term,
          project_id: input.projectId,
          weight: WEIGHT.older,
          source: "entity_auto",
          correction_from: null,
          heard_forms: [],
          occurrence_count: 0,
          occurrence_ids: [],
          last_used_at: 0,
          suppressed: false,
        });
      }
    }
    const scored: RankedPromptTerm[] = [];
    for (const entry of byTerm.values()) {
      const focused = focus.has(entry.term) || recent.has(entry.term);
      const neighbor = neighbors.has(entry.term);
      const tier = focused || neighbor ? PROMPT_TIER.focused : tierForEntry(entry, false);
      let weight = entry.weight;
      if (focus.has(entry.term) || recent.has(entry.term)) {
        weight = Math.max(weight, WEIGHT.focused);
      } else if (neighbor) {
        weight = Math.max(weight, WEIGHT.neighbor);
      }
      const piece = this.termPieces(entry.term);
      scored.push({
        term: entry.term,
        weight,
        tier,
        lastUsedAt: entry.last_used_at,
        spacedTokens: piece.spacedTokens,
        firstPieceIds: piece.firstPieceIds,
        spacedPieceIds: piece.spacedPieceIds,
      });
    }
    return scored;
  }

  private termPieces(term: string): TermPieces {
    const cached = this.pieces.get(term);
    if (cached) return cached;
    const firstPieceIds = encodeWhisperBpe(term);
    const spacedPieceIds = encodeWhisperBpe(` ${term}`);
    const piece: TermPieces = {
      firstPieceIds,
      spacedPieceIds,
      spacedTokens: spacedPieceIds.length,
    };
    this.pieces.set(term, piece);
    return piece;
  }
}
