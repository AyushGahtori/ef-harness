import type { AgentOfficeTag } from "./types.js";

/** Owner-mandated ceiling for `AgentID · short task title`. */
export const AGENT_TAG_MAX_CHARS = 22;

/** Middle dot used by Office tags, Board tags, and pod fractions. */
export const AGENT_TAG_SEPARATOR = " \u00b7 ";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "and",
  "or",
  "to",
  "with",
  "from",
  "into",
  "on",
  "in",
  "by",
  "at",
  "via",
  "using",
  "over",
  "per",
  "its",
  "their",
  "as",
]);

const GENERIC_VERBS = new Set([
  "implement",
  "implementing",
  "implemented",
  "add",
  "adding",
  "added",
  "update",
  "updating",
  "updated",
  "create",
  "creating",
  "created",
  "build",
  "building",
  "built",
  "make",
  "making",
  "made",
  "fix",
  "fixing",
  "fixed",
  "support",
  "supporting",
  "supported",
  "handle",
  "handling",
  "handled",
  "write",
  "writing",
  "written",
  "enable",
  "enabling",
  "enabled",
]);

const GENERIC_MODIFIERS = new Set([
  "responsive",
  "existing",
  "new",
  "simple",
  "basic",
  "custom",
  "various",
  "multiple",
]);

function stemContentWord(word: string): string {
  if (word.endsWith("able") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ible") && word.length > 6) return word.slice(0, -4);
  return word;
}

function clampText(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  const words = text.split(" ");
  const last = words[words.length - 1] ?? "";
  if (words.length > 1 && last.length > 0 && last.length <= budget) return last;
  return text.slice(0, budget).trim();
}

function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "\u2026";
  return `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

const SMART_SHORTEN_PREFIX = /^(implement|add|update|create|build|fix)\b/i;

/**
 * Short title is the first and last content words after stop-word, generic-verb,
 * and generic-modifier removal. `printable` stems to `print`, so the kitchen
 * meal-summary title becomes `print page`.
 */
export function shortenTaskTitle(fullTitle: string, budget: number): string {
  if (budget <= 0) return "";
  const content = fullTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map(stemContentWord)
    .filter(
      (word) => !STOP_WORDS.has(word) && !GENERIC_VERBS.has(word) && !GENERIC_MODIFIERS.has(word),
    );
  if (content.length === 0) {
    const fallback = fullTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return clampText(fallback, budget);
  }
  const first = content[0] ?? "";
  const last = content[content.length - 1] ?? "";
  const phrase = content.length === 1 ? first : `${first} ${last}`;
  return clampText(phrase, budget);
}

/** `A0014 · print page`, never longer than 22 characters. Full title stays on hover. */
export function formatAgentOfficeTag(agentId: string, fullTitle: string): AgentOfficeTag {
  const id = agentId.trim();
  const title = fullTitle.trim();
  const prefix = `${id}${AGENT_TAG_SEPARATOR}`;
  const budget = AGENT_TAG_MAX_CHARS - prefix.length;
  const useSmartShorten = SMART_SHORTEN_PREFIX.test(title) || title.length > 48;
  let shortTitle = "";
  if (budget > 0) {
    if (useSmartShorten) {
      shortTitle = shortenTaskTitle(title, budget);
    } else {
      shortTitle = title.length <= budget ? title : truncateWithEllipsis(title, budget);
    }
  }
  let text = shortTitle.length > 0 ? `${prefix}${shortTitle}` : id;
  if (text.length > AGENT_TAG_MAX_CHARS) {
    text = truncateWithEllipsis(text, AGENT_TAG_MAX_CHARS);
  }
  return {
    agentId: id,
    shortTitle,
    fullTitle: title,
    text,
    maxChars: AGENT_TAG_MAX_CHARS,
  };
}
