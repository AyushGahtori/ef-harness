import { UnsafeLogPatternError } from "./errors.js";

const MAX_PATTERN_LENGTH = 256;

interface GroupState {
  hasQuantifier: boolean;
  hasAlternation: boolean;
}

/**
 * Compile a log-search pattern, rejecting nested quantifiers such as `(a+)+`
 * before Node ever executes them. A single `RegExp` execution cannot be preempted,
 * so the check happens before the first frame is decompressed.
 */
export function compileSafeLogPattern(source: string): RegExp {
  if (source.length < 1 || source.length > MAX_PATTERN_LENGTH) {
    throw new UnsafeLogPatternError(
      source,
      "Log search patterns must be between 1 and 256 characters.",
    );
  }
  if (hasCatastrophicQuantifier(source)) {
    throw new UnsafeLogPatternError(
      source,
      "Log search rejected a nested or repeated quantifier that can catastrophically backtrack.",
    );
  }
  try {
    return new RegExp(source, "u");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid regular expression.";
    throw new UnsafeLogPatternError(source, message);
  }
}

export function hasCatastrophicQuantifier(source: string): boolean {
  const stack: GroupState[] = [{ hasQuantifier: false, hasAlternation: false }];
  let lastAtomRisky = false;
  let index = 0;
  while (index < source.length) {
    const ch = source[index] ?? "";
    if (ch === "\\") {
      index = skipEscape(source, index);
      lastAtomRisky = false;
      continue;
    }
    if (ch === "[") {
      index = skipCharacterClass(source, index + 1);
      lastAtomRisky = false;
      continue;
    }
    if (ch === "(") {
      stack.push({ hasQuantifier: false, hasAlternation: false });
      index = skipGroupPrefix(source, index + 1);
      lastAtomRisky = false;
      continue;
    }
    if (ch === ")") {
      const group = stack.pop();
      lastAtomRisky = Boolean(group && (group.hasQuantifier || group.hasAlternation));
      index += 1;
      continue;
    }
    if (ch === "|") {
      const current = stack[stack.length - 1];
      if (current) current.hasAlternation = true;
      lastAtomRisky = false;
      index += 1;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "?") {
      if (lastAtomRisky) return true;
      markQuantifier(stack);
      lastAtomRisky = true;
      index += 1;
      if (source[index] === "?") index += 1;
      continue;
    }
    if (ch === "{") {
      const end = readBraceQuantifier(source, index);
      if (end > index) {
        if (lastAtomRisky) return true;
        markQuantifier(stack);
        lastAtomRisky = true;
        index = end;
        if (source[index] === "?") index += 1;
        continue;
      }
    }
    if (ch === "^" || ch === "$") {
      lastAtomRisky = false;
      index += 1;
      continue;
    }
    lastAtomRisky = false;
    index += 1;
  }
  return false;
}

function markQuantifier(stack: GroupState[]): void {
  const current = stack[stack.length - 1];
  if (current) current.hasQuantifier = true;
}

function skipEscape(source: string, index: number): number {
  const next = source[index + 1];
  if (next === "u" && source[index + 2] === "{") {
    const end = source.indexOf("}", index + 3);
    return end === -1 ? source.length : end + 1;
  }
  if (next === "u") return Math.min(source.length, index + 6);
  if (next === "x") return Math.min(source.length, index + 4);
  return Math.min(source.length, index + 2);
}

function skipCharacterClass(source: string, index: number): number {
  let cursor = index;
  if (source[cursor] === "^") cursor += 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "]") return cursor + 1;
    cursor += 1;
  }
  return cursor;
}

function skipGroupPrefix(source: string, index: number): number {
  if (source[index] !== "?") return index;
  const flag = source[index + 1];
  if (flag === ":") return index + 2;
  if (flag === "=" || flag === "!") return index + 2;
  if (flag === "<") {
    const next = source[index + 2];
    if (next === "=" || next === "!") return index + 3;
    const end = source.indexOf(">", index + 2);
    return end === -1 ? source.length : end + 1;
  }
  return index;
}

function readBraceQuantifier(source: string, index: number): number {
  const end = source.indexOf("}", index);
  if (end === -1) return index;
  const body = source.slice(index, end + 1);
  if (/^\{\d+(,\d*)?\}$/.test(body)) return end + 1;
  return index;
}
