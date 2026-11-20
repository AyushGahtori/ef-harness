import { InvalidRegexError, UnsafeRegexError } from "./errors.js";

interface GroupState {
  hasQuantifier: boolean;
  hasAlternation: boolean;
}

export interface SafePattern {
  readonly source: string;
  execAll(line: string): readonly { readonly index: number; readonly length: number }[];
}

/**
 * Accepts ordinary regular expressions and refuses constructs that can freeze
 * the worker loop. Nested quantifiers, backreferences, lookaround, and
 * quantified alternation are rejected before any file byte is scanned.
 */
export function compileSafeRegex(pattern: string): SafePattern {
  if (pattern.length === 0) {
    throw new InvalidRegexError(pattern, "pattern is empty");
  }
  try {
    void new RegExp(pattern);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidRegexError(pattern, detail);
  }
  const unsafe = unsafeReason(pattern);
  if (unsafe !== null) {
    throw new UnsafeRegexError(pattern, unsafe);
  }
  return {
    source: pattern,
    execAll(line: string): readonly { readonly index: number; readonly length: number }[] {
      const expression = new RegExp(pattern, "g");
      const matches: { index: number; length: number }[] = [];
      let found = expression.exec(line);
      while (found !== null) {
        if (found[0].length === 0) {
          expression.lastIndex += 1;
          found = expression.exec(line);
          continue;
        }
        matches.push({ index: found.index, length: found[0].length });
        found = expression.exec(line);
      }
      return matches;
    },
  };
}

function unsafeReason(pattern: string): string | null {
  const root: GroupState = { hasQuantifier: false, hasAlternation: false };
  const stack: GroupState[] = [root];
  let index = 0;
  while (index < pattern.length) {
    const current = pattern[index] ?? "";
    if (current === "\\") {
      const next = pattern[index + 1];
      if (next !== undefined && (/[1-9]/.test(next) || next === "k")) {
        return "backreferences are not allowed";
      }
      index += next === undefined ? 1 : 2;
      continue;
    }
    if (current === "[") {
      index = skipCharacterClass(pattern, index);
      continue;
    }
    if (current === "(") {
      const opened = openGroup(pattern, index);
      if (opened.unsafe !== null) return opened.unsafe;
      stack.push({ hasQuantifier: false, hasAlternation: false });
      index = opened.next;
      continue;
    }
    if (current === ")") {
      if (stack.length === 1) return "unbalanced parenthesis";
      const inner = stack.pop() ?? root;
      const parent = stack[stack.length - 1] ?? root;
      if (isQuantifierStart(pattern, index + 1)) {
        if (inner.hasQuantifier) return "nested quantifiers can catastrophic-backtrack";
        if (inner.hasAlternation) return "quantified alternation can catastrophic-backtrack";
        parent.hasQuantifier = true;
        index = consumeQuantifier(pattern, index + 1);
        continue;
      }
      if (inner.hasQuantifier || inner.hasAlternation) parent.hasQuantifier = true;
      index += 1;
      continue;
    }
    if (current === "|") {
      const group = stack[stack.length - 1] ?? root;
      group.hasAlternation = true;
      index += 1;
      continue;
    }
    if (isQuantifierStart(pattern, index)) {
      const group = stack[stack.length - 1] ?? root;
      group.hasQuantifier = true;
      index = consumeQuantifier(pattern, index);
      continue;
    }
    index += 1;
  }
  return null;
}

function openGroup(pattern: string, index: number): { next: number; unsafe: string | null } {
  if (pattern[index + 1] !== "?") return { next: index + 1, unsafe: null };
  const marker = pattern[index + 2];
  if (marker === ":") return { next: index + 3, unsafe: null };
  if (marker === "<" && pattern[index + 3] !== "=" && pattern[index + 3] !== "!") {
    const close = pattern.indexOf(">", index + 3);
    if (close === -1) return { next: pattern.length, unsafe: "unclosed named group" };
    return { next: close + 1, unsafe: null };
  }
  return { next: index, unsafe: "lookaround is not allowed" };
}

function skipCharacterClass(pattern: string, index: number): number {
  let cursor = index + 1;
  if (pattern[cursor] === "^") cursor += 1;
  if (pattern[cursor] === "]") cursor += 1;
  while (cursor < pattern.length && pattern[cursor] !== "]") {
    if (pattern[cursor] === "\\") cursor += 2;
    else cursor += 1;
  }
  return Math.min(pattern.length, cursor + 1);
}

function isQuantifierStart(pattern: string, index: number): boolean {
  const current = pattern[index];
  if (current === "*" || current === "+" || current === "?") return true;
  if (current !== "{") return false;
  return /^\{\d+,?\d*\}/.test(pattern.slice(index));
}

function consumeQuantifier(pattern: string, index: number): number {
  const current = pattern[index];
  if (current === "*" || current === "+" || current === "?") {
    return pattern[index + 1] === "?" ? index + 2 : index + 1;
  }
  const match = /^\{(\d+,?\d*)\}/.exec(pattern.slice(index));
  if (!match) return index + 1;
  const next = index + match[0].length;
  return pattern[next] === "?" ? next + 1 : next;
}
