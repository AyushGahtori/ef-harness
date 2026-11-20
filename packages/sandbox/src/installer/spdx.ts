import type { LicenseCheck, LicensePolicy, LicenseStatus } from "./types.js";

const KNOWN_LICENSES = [
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Zlib",
  "BSL-1.0",
  "Python-2.0",
  "PSF-2.0",
  "Artistic-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "EUPL-1.2",
  "OSL-3.0",
  "CPAL-1.0",
  "SSPL-1.0",
  "CECILL-2.1",
  "CC-BY-SA-4.0",
] as const;

const CANONICAL = new Map<string, string>(KNOWN_LICENSES.map((id) => [id.toLowerCase(), id]));

const COPYLEFT = new Set<string>([
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "EUPL-1.2",
  "OSL-3.0",
  "CPAL-1.0",
  "SSPL-1.0",
  "CECILL-2.1",
  "CC-BY-SA-4.0",
]);

export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  allowed: ["MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0"],
};

type LicenseNode =
  | { readonly type: "id"; readonly id: string }
  | { readonly type: "and" | "or"; readonly left: LicenseNode; readonly right: LicenseNode }
  | { readonly type: "with"; readonly id: string; readonly exception: string };

function canonicalize(id: string, allowed: ReadonlySet<string>): string {
  return CANONICAL.get(id.toLowerCase()) ?? [...allowed].find((item) => item.toLowerCase() === id.toLowerCase()) ?? id;
}

function tokenize(input: string): string[] {
  return input.match(/\(|\)|[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
}

function parsePrimary(tokens: readonly string[], index: { i: number }, allowed: ReadonlySet<string>): LicenseNode {
  const token = tokens[index.i];
  if (token === "(") {
    index.i += 1;
    const expression = parseOr(tokens, index, allowed);
    if (tokens[index.i] !== ")") throw new Error("unclosed license expression");
    index.i += 1;
    return expression;
  }
  if (!token || token === "AND" || token === "OR" || token === "WITH" || token === ")") {
    throw new Error("invalid license expression");
  }
  index.i += 1;
  return { type: "id", id: canonicalize(token, allowed) };
}

function parseWith(tokens: readonly string[], index: { i: number }, allowed: ReadonlySet<string>): LicenseNode {
  const node = parsePrimary(tokens, index, allowed);
  if (tokens[index.i] !== "WITH") return node;
  index.i += 1;
  const exception = tokens[index.i];
  if (!exception) throw new Error("license exception missing");
  index.i += 1;
  if (node.type !== "id") throw new Error("WITH applies to a license id");
  return { type: "with", id: node.id, exception };
}

function parseAnd(tokens: readonly string[], index: { i: number }, allowed: ReadonlySet<string>): LicenseNode {
  let left = parseWith(tokens, index, allowed);
  while (tokens[index.i] === "AND") {
    index.i += 1;
    left = { type: "and", left, right: parseWith(tokens, index, allowed) };
  }
  return left;
}

function parseOr(tokens: readonly string[], index: { i: number }, allowed: ReadonlySet<string>): LicenseNode {
  let left = parseAnd(tokens, index, allowed);
  while (tokens[index.i] === "OR") {
    index.i += 1;
    left = { type: "or", left, right: parseAnd(tokens, index, allowed) };
  }
  return left;
}

function keyword(token: string | undefined): string | undefined {
  if (!token) return token;
  const upper = token.toUpperCase();
  if (upper === "AND" || upper === "OR" || upper === "WITH") return upper;
  return token;
}

function classify(node: LicenseNode, allowed: ReadonlySet<string>): LicenseStatus {
  if (node.type === "id" || node.type === "with") {
    if (allowed.has(node.id)) return "allowed";
    if (!CANONICAL.has(node.id.toLowerCase())) return "unknown";
    if (COPYLEFT.has(node.id)) return "copyleft";
    return "disallowed";
  }
  const left = classify(node.left, allowed);
  const right = classify(node.right, allowed);
  if (node.type === "or") {
    if (left === "allowed" || right === "allowed") return "allowed";
    if (left === "unknown" || right === "unknown") return "unknown";
    if (left === "copyleft" || right === "copyleft") return "copyleft";
    return "disallowed";
  }
  if (left === "unknown" || right === "unknown") return "unknown";
  if (left === "copyleft" || right === "copyleft") return "copyleft";
  if (left === "allowed" && right === "allowed") return "allowed";
  return "disallowed";
}

export function evaluateLicense(expression: string | null, policy: LicensePolicy): LicenseCheck {
  const trimmed = expression?.trim() ?? "";
  if (!trimmed || /^(UNLICENSED|NONE|NOASSERTION)$/i.test(trimmed) || /^SEE LICENSE IN\b/i.test(trimmed)) {
    return { expression: trimmed || null, status: "missing", flagged: true };
  }
  const allowed = new Set(policy.allowed.map((id) => canonicalize(id, new Set(policy.allowed))));
  try {
    const tokens = tokenize(trimmed).map((token) => keyword(token) ?? token);
    const index = { i: 0 };
    const node = parseOr(tokens, index, allowed);
    if (index.i !== tokens.length) return { expression: trimmed, status: "unknown", flagged: true };
    const status = classify(node, allowed);
    return { expression: trimmed, status, flagged: status !== "allowed" };
  } catch {
    return { expression: trimmed, status: "unknown", flagged: true };
  }
}
