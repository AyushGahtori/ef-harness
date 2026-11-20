import type { PreparedAuditFile, StaticAuditContext, StaticAuditFinding, StaticAuditLanguage } from "./types.js";
import { scanTextDeadControls } from "./dead-controls.js";
import { findingAt } from "./locate.js";
import { scanMarkersInText } from "./markers.js";
import { languageOf } from "./paths.js";
import { requiresStructuredErrors } from "./swallowed.js";
import { roughCyclomatic, scanTextVisibleExamples } from "./soft-signals.js";
import { isStubThrowMessage } from "./terms.js";

export interface ReducedScan {
  readonly findings: readonly StaticAuditFinding[];
  readonly recordedDeferralIds: readonly string[];
  readonly complexity: number;
}

export function scanReducedFile(
  file: PreparedAuditFile,
  auditContext: StaticAuditContext,
  options: { readonly markers: boolean; readonly swallowed: boolean },
): ReducedScan {
  const language = languageOf(file.path);
  const findings: StaticAuditFinding[] = [];
  const recorded: string[] = [];
  if (options.markers) {
    const masked = maskOutsideSpans(file.content, markerSpans(file.content, language));
    const scan = scanMarkersInText(file.path, file.content, auditContext, masked);
    findings.push(...scan.findings);
    recorded.push(...scan.recordedDeferralIds);
  }
  findings.push(...scanTextStubs(file.path, file.content, auditContext, language));
  if (options.swallowed) findings.push(...scanTextSwallowed(file.path, file.content, auditContext, language));
  findings.push(...scanTextDeadControls(file.path, file.content));
  findings.push(...scanTextVisibleExamples(file.path, file.content, auditContext.brief.visibleExampleLiterals));
  return {
    findings,
    recordedDeferralIds: recorded,
    complexity: roughCyclomatic(file.content),
  };
}

function scanTextStubs(
  file: string,
  text: string,
  auditContext: StaticAuditContext,
  language: StaticAuditLanguage,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const symbol of auditContext.brief.produces) {
    if (symbol.kind === "constant") continue;
    if (!textIncludesName(text, symbol.name)) continue;
    const trivialReturn = symbol.allowsConstantReturn === true;
    const trivialEmpty = symbol.allowsEmptyReturn === true;
    if (matchesStub(text, symbol.name, language, { trivialReturn, trivialEmpty })) {
      const index = text.search(new RegExp(`\\b${escapeRegExp(symbol.name)}\\b`));
      findings.push(
        findingAt({
          ruleId: "stub-body",
          severity: "hard",
          file,
          text,
          index: index < 0 ? 0 : index,
          message: `Contract symbol ${symbol.name} has a trivial stub body.`,
          remediation: "Implement the contract operation. A constant or empty return is allowed only when the contract declares it.",
        }),
      );
    }
  }
  return findings;
}

function matchesStub(
  text: string,
  name: string,
  language: StaticAuditLanguage,
  allowed: { readonly trivialReturn: boolean; readonly trivialEmpty: boolean },
): boolean {
  const escaped = escapeRegExp(name);
  const patterns: RegExp[] = [];
  if (!allowed.trivialEmpty) {
    patterns.push(new RegExp(String.raw`\bfunction\s+${escaped}\s*\([^)]*\)\s*\{\s*\}`));
    patterns.push(new RegExp(String.raw`\b${escaped}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*\}`));
    if (language === "python") patterns.push(new RegExp(String.raw`^\s*def\s+${escaped}\s*\([^)]*\)\s*(?:->[^:\n]+)?\:\s*\n\s+(?:pass|\.\.\.)\s*$`, "m"));
    if (language === "go") patterns.push(new RegExp(String.raw`\bfunc\s+${escaped}\s*\([^)]*\)[^{]*\{\s*\}`));
    if (language === "rust") {
      patterns.push(new RegExp(String.raw`\bfn\s+${escaped}\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{\s*\}`));
      patterns.push(new RegExp(String.raw`\bfn\s+${escaped}\b[^;{]*\{\s*(?:todo|unimplemented)!\s*\(\s*\)\s*;?\s*\}`));
    }
  }
  if (!allowed.trivialReturn) {
    const literal = String.raw`(?:null|\[\]|\{\}|true|0|""|'')`;
    patterns.push(new RegExp(String.raw`\bfunction\s+${escaped}\s*\([^)]*\)\s*\{\s*return\s+${literal}\s*;?\s*\}`));
    patterns.push(new RegExp(String.raw`\b${escaped}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>\s*${literal}\b`));
    if (language === "python") {
      patterns.push(
        new RegExp(
          String.raw`^\s*def\s+${escaped}\s*\([^)]*\)\s*(?:->[^:\n]+)?\:\s*(?:\n\s+)?return\s+(?:None|\[\]|\{\}|True|0|""|'')\s*$`,
          "m",
        ),
      );
    }
    if (language === "go") {
      patterns.push(new RegExp(String.raw`\bfunc\s+${escaped}\s*\([^)]*\)[^{]*\{\s*return\s+(?:nil|0|false|true|""|\[\][A-Za-z0-9_]*)\s*\}`));
    }
  }
  patterns.push(new RegExp(String.raw`\b(?:function\s+${escaped}\s*\([^)]*\)|${escaped}\s*=\s*(?:async\s*)?\([^)]*\))\s*(?:=>)?\s*\{?\s*throw\s+new\s+Error\s*\(\s*(['"\`])([\s\S]*?)\1`));
  return patterns.some((pattern) => {
    const match = pattern.exec(text);
    if (!match) return false;
    const thrown = match[2];
    if (thrown !== undefined) return isStubThrowMessage(thrown);
    return true;
  });
}

function scanTextSwallowed(
  file: string,
  text: string,
  auditContext: StaticAuditContext,
  language: StaticAuditLanguage,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const patterns = [
    /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
    /\.catch\s*\(\s*(?:\(\s*\)|[A-Za-z_]\w*)\s*=>\s*\{\s*\}\s*\)/g,
    /\.catch\s*\(\s*(?:\(\s*\)|[A-Za-z_]\w*)\s*=>\s*null\b/g,
    /\.catch\s*\(\s*(?:\(\s*\)|[A-Za-z_]\w*)\s*=>\s*\{\s*return\s+null\s*;?\s*\}\s*\)/g,
  ];
  if (language === "python") patterns.push(/except[^:\n]*:[ \t]*(?:pass\b|\n[ \t]*pass\b)/g);
  if (language === "go") patterns.push(/if\s+err\s*!=\s*nil\s*\{\s*\}/g);
  if (language === "rust") patterns.push(/if\s+let\s+Err\s*\([^)]*\)\s*=\s*[^;{]+\{[\s\n]*\}/g);
  if (requiresStructuredErrors(auditContext.conventions)) {
    patterns.push(/catch\s*(?:\([^)]*\))?\s*\{\s*console\.(?:log|error)\s*\([^)]*\)\s*;?\s*\}/g);
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (cleanupOwns(text, index, auditContext)) continue;
      findings.push(
        findingAt({
          ruleId: "swallowed-error",
          severity: "hard",
          file,
          text,
          index,
          message: "Error is swallowed instead of being surfaced.",
          remediation: "Rethrow, return a structured error, or surface it.",
        }),
      );
    }
  }
  return findings;
}

function cleanupOwns(text: string, index: number, auditContext: StaticAuditContext): boolean {
  const names = auditContext.conventions.cleanupHelperNames ?? [];
  if (names.length === 0) return false;
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/\b(?:function|def|fn|func)\s+([A-Za-z_]\w*)/g)];
  const name = matches.length > 0 ? matches[matches.length - 1]?.[1] : undefined;
  return name !== undefined && names.includes(name);
}

function markerSpans(text: string, language: StaticAuditLanguage): readonly { readonly start: number; readonly end: number }[] {
  if (language === "html") return htmlSpans(text);
  if (language === "python") return pythonSpans(text);
  return genericSpans(text, language !== "go" && language !== "rust");
}

function maskOutsideSpans(text: string, spans: readonly { readonly start: number; readonly end: number }[]): string {
  const keep = new Array<boolean>(text.length).fill(false);
  for (const span of spans) {
    const start = Math.max(0, span.start);
    const end = Math.min(text.length, span.end);
    for (let index = start; index < end; index += 1) keep[index] = true;
  }
  let masked = "";
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (ch === "\n" || ch === "\r" || keep[index]) masked += ch;
    else masked += " ";
  }
  return masked;
}

function htmlSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) {
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  for (const match of text.matchAll(/=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
    const value = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].length - value.length;
    spans.push({ start, end: start + value.length });
  }
  let cursor = 0;
  for (const match of text.matchAll(/<[^>]+>/g)) {
    const start = match.index ?? 0;
    if (start > cursor) spans.push({ start: cursor, end: start });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) spans.push({ start: cursor, end: text.length });
  return spans;
}

function pythonSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
      const quote = text.slice(index, index + 3);
      const start = index;
      const end = text.indexOf(quote, index + 3);
      index = end === -1 ? text.length : end + 3;
      spans.push({ start, end: index });
      continue;
    }
    const ch = text[index];
    if (ch === "#") {
      const start = index;
      while (index < text.length && text[index] !== "\n") index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const span = readQuoted(text, index, ch);
      spans.push(span);
      index = span.end;
      continue;
    }
    index += 1;
  }
  return spans;
}

function genericSpans(text: string, hashComments: boolean): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    const next = text[index + 1];
    if (ch === "/" && next === "/") {
      const start = index;
      while (index < text.length && text[index] !== "\n") index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (ch === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index = Math.min(text.length, index + 2);
      spans.push({ start, end: index });
      continue;
    }
    if (hashComments && ch === "#") {
      const start = index;
      while (index < text.length && text[index] !== "\n") index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const span = readQuoted(text, index, ch);
      spans.push(span);
      index = span.end;
      continue;
    }
    index += 1;
  }
  return spans;
}

function readQuoted(text: string, start: number, quote: string): { start: number; end: number } {
  let index = start + 1;
  while (index < text.length && text[index] !== quote && text[index] !== "\n") {
    if (text[index] === "\\") index += 2;
    else index += 1;
  }
  return { start, end: Math.min(text.length, index + 1) };
}

function textIncludesName(text: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
