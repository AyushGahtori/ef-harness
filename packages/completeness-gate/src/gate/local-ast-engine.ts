import { deletionRatio } from "./diff-lines.js";
import { makeFinding } from "./findings.js";
import {
  hasFullAstSupport,
  isFixturePath,
  isGeneratedOrSeed,
  lineSnippet,
  normalizePath,
} from "./path-match.js";
import type { AstScanContext, AstScanResult, StaticAuditAstEngine } from "./ports.js";
import type { StaticAuditFinding } from "./types.js";

const MARKER_TODO = ["TO", "DO"].join("");
const MARKER_FIXME = ["FIX", "ME"].join("");
const MARKER_XXX = ["XX", "X"].join("");
const NOT_IMPLEMENTED = "not implemented";

/**
 * Local stand-in for Task 058 StaticAuditAstEngine.
 * Swap this for the ast-scanners engine at integration.
 */
export function createLocalStaticAuditAstEngine(): StaticAuditAstEngine {
  return { scan };
}

function scan(context: AstScanContext): AstScanResult {
  const findings: StaticAuditFinding[] = [];
  const softFindings: StaticAuditFinding[] = [];
  const deferrals = new Set<string>();
  let reduced = false;
  let addedLines = 0;
  let complexity = 0;

  for (const file of context.files) {
    if (file.status === "deleted") continue;
    const path = normalizePath(file.path);
    addedLines += file.addedLineCount;
    if (!hasFullAstSupport(path)) reduced = true;
    if (isFixturePath(path, context.seedFixturePaths) || isGeneratedOrSeed(path, context.excludedGeneratedPaths, context.seedFixturePaths)) {
      continue;
    }
    const source = file.afterText;
    scanMarkers(source, path, context.approvedDeferralIds, findings, deferrals);
    scanStubs(source, path, context, findings);
    scanSwallowed(source, path, context.errorHandlingRequiresSurface, findings);
    scanDeadControls(source, path, findings);
    scanElision(source, path, findings);
    if (file.status === "modified" && !context.deletionDeclared) {
      const ratio = deletionRatio(file.beforeText, source);
      if (ratio > 0.5) {
        findings.push(
          makeFinding({
            ruleId: "ast.large-deletion",
            file: path,
            line: 1,
            column: 1,
            snippet: lineSnippet(source, 1),
            message: `Unplanned deletion removes ${Math.round(ratio * 100)}% of ${path}.`,
            remediation: "Restore the deleted lines or mark the task as a deletion in the plan.",
          }),
        );
      }
    }
    complexity += cyclomatic(source);
    scanSpecialCases(source, path, context.visibleExampleLiterals, softFindings);
  }

  if (
    context.taskSizeEstimateLines !== null &&
    context.taskSizeEstimateLines >= 40 &&
    addedLines < context.taskSizeEstimateLines * 0.25
  ) {
    softFindings.push(
      makeFinding({
        ruleId: "ast.small-diff",
        severity: "soft",
        file: "(diff)",
        line: 1,
        column: 1,
        snippet: `${addedLines} added lines`,
        message: `Diff is much smaller than the task size estimate of ${context.taskSizeEstimateLines} lines.`,
        remediation: "Reviewer should confirm the change covers the task rather than a special case.",
      }),
    );
  }
  if (
    context.mustBranchCount !== null &&
    context.mustBranchCount >= 4 &&
    complexity * 2 < context.mustBranchCount
  ) {
    softFindings.push(
      makeFinding({
        ruleId: "ast.low-complexity",
        severity: "soft",
        file: "(diff)",
        line: 1,
        column: 1,
        snippet: `complexity ${complexity}`,
        message: `Cyclomatic complexity ${complexity} is far below ${context.mustBranchCount} MUST branches.`,
        remediation: "Reviewer should check that required branches were not dropped.",
      }),
    );
  }

  return {
    findings,
    softFindings,
    coverageMode: reduced ? "reduced_text_only" : "full",
    recordedDeferrals: [...deferrals].sort(),
  };
}

function scanMarkers(
  source: string,
  file: string,
  approvedIds: readonly string[],
  findings: StaticAuditFinding[],
  deferrals: Set<string>,
): void {
  const approved = new Set(approvedIds);
  const pattern = markerPattern();
  for (const match of source.matchAll(pattern)) {
    const word = match[0] ?? "";
    const index = match.index ?? 0;
    if (isPlaceholderAttribute(source, index, word)) continue;
    const after = source.slice(index + word.length);
    const deferral = /^\(DEF-([A-Za-z0-9-]+)\)/.exec(after);
    if (word.toUpperCase() === MARKER_TODO && deferral?.[1]) {
      const id = `DEF-${deferral[1]}`;
      if (approved.has(id) || approved.has(deferral[1])) {
        deferrals.add(id);
        continue;
      }
    }
    const line = source.slice(0, index).split(/\r?\n/).length;
    findings.push(
      makeFinding({
        ruleId: "ast.marker",
        file,
        line,
        column: 1,
        snippet: lineSnippet(source, line),
        message: `Unfinished marker "${word}" is not an approved deferral.`,
        remediation: `Remove the marker, or reference an active kernel-approved deferral as ${MARKER_TODO}(DEF-<id>).`,
      }),
    );
  }
}

function isPlaceholderAttribute(source: string, index: number, word: string): boolean {
  if (word.toLowerCase() !== "placeholder") return false;
  let cursor = index + word.length;
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  return source[cursor] === "=";
}

function markerPattern(): RegExp {
  const words = [MARKER_TODO, MARKER_FIXME, MARKER_XXX, "HACK", NOT_IMPLEMENTED, "placeholder", "lorem ipsum"];
  const body = words.map(escapeRegExp).join("|");
  return new RegExp(`\\b(?:${body})\\b`, "gi");
}

function scanStubs(
  source: string,
  file: string,
  context: AstScanContext,
  findings: StaticAuditFinding[],
): void {
  const contracts = new Map(context.contractFunctions.map((item) => [item.name, item]));
  if (contracts.size === 0) return;
  const seen = new Set<string>();
  const functionDecl = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\{/g;
  for (const match of source.matchAll(functionDecl)) {
    const name = match[1];
    const open = (match.index ?? 0) + match[0].length - 1;
    if (!name) continue;
    noteStub(name, readBlock(source, open), open, source, file, contracts, seen, findings);
  }
  const arrows = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
  for (const match of source.matchAll(arrows)) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    if (!name) continue;
    const body = source[start] === "{" ? readBlock(source, start) : readExpression(source, start);
    noteStub(name, body, start, source, file, contracts, seen, findings);
  }
}

function noteStub(
  name: string,
  body: string,
  index: number,
  source: string,
  file: string,
  contracts: Map<string, { readonly allowsConstantReturn: boolean }>,
  seen: Set<string>,
  findings: StaticAuditFinding[],
): void {
  if (seen.has(name)) return;
  const contract = contracts.get(name);
  if (!contract || contract.allowsConstantReturn) return;
  if (!isTrivialBody(body)) return;
  seen.add(name);
  const line = source.slice(0, index).split(/\r?\n/).length;
  findings.push(
    makeFinding({
      ruleId: "ast.stub",
      file,
      line,
      column: 1,
      snippet: lineSnippet(source, line),
      message: `Contract function ${name} is a stub body.`,
      remediation: "Implement the contract function. A constant return is allowed only when the contract declares it.",
    }),
  );
}

function isTrivialBody(body: string): boolean {
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (stripped === "") return true;
  if (/^(?:null|true|false|0|\[\]|\{\}|""|''|``)$/.test(stripped)) return true;
  if (/^return(?:\s+(?:null|true|false|0|\[\]|\{\}|""|''|``))?$/.test(stripped)) return true;
  const thrown = new RegExp(
    `^throw\\s+new\\s+Error\\(\\s*['"\`](?:${escapeRegExp(NOT_IMPLEMENTED)}|${escapeRegExp(MARKER_TODO)})['"\`]\\s*\\)$`,
  );
  return thrown.test(stripped);
}

function scanSwallowed(
  source: string,
  file: string,
  requireSurface: boolean,
  findings: StaticAuditFinding[],
): void {
  const empty = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;
  for (const match of source.matchAll(empty)) {
    const body = (match[1] ?? "").trim();
    const onlyLog = /^console\.(?:log|error)\s*\([^;]*\)\s*;?$/.test(body);
    if (body === "" || (onlyLog && requireSurface)) {
      const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
      findings.push(
        makeFinding({
          ruleId: "ast.swallowed-error",
          file,
          line,
          column: 1,
          snippet: lineSnippet(source, line),
          message: "Catch block swallows an error instead of surfacing it.",
          remediation: "Rethrow, return a structured error, or handle it with the project error convention.",
        }),
      );
    }
  }
  const promise = /\.catch\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*(?:\{\s*\}|null)\s*\)/g;
  for (const match of source.matchAll(promise)) {
    const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
    findings.push(
      makeFinding({
        ruleId: "ast.swallowed-error",
        file,
        line,
        column: 1,
        snippet: lineSnippet(source, line),
        message: "Promise catch swallows the rejection.",
        remediation: "Surface the rejection instead of returning null or an empty handler.",
      }),
    );
  }
}

function scanDeadControls(source: string, file: string, findings: StaticAuditFinding[]): void {
  if (!/\.(tsx|jsx|html)$/.test(file) && !source.includes("<")) return;
  const emptyHandler = /on(?:Click|Change|Submit)\s*=\s*\{\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\}/g;
  for (const match of source.matchAll(emptyHandler)) {
    pushControl(source, file, match.index ?? 0, "Empty UI handler does nothing.", findings);
  }
  const href = /href\s*=\s*(?:\{\s*)?['"](?:#|javascript:void\(0\))['"]/g;
  for (const match of source.matchAll(href)) {
    pushControl(source, file, match.index ?? 0, "Link target is a dead placeholder.", findings);
  }
  const forms = /<form\b([^>]*)>/gi;
  for (const match of source.matchAll(forms)) {
    const attrs = match[1] ?? "";
    if (!/\bonSubmit\s*=/.test(attrs) && !/\baction\s*=/.test(attrs)) {
      pushControl(source, file, match.index ?? 0, "Form has no submit handler or action.", findings);
    }
  }
  const buttons = /<button\b([^>]*)>/gi;
  for (const match of source.matchAll(buttons)) {
    const attrs = match[1] ?? "";
    const submit = /type\s*=\s*(?:\{\s*)?['"]submit['"]/.test(attrs);
    if (!/\bonClick\s*=/.test(attrs) && !submit) {
      pushControl(source, file, match.index ?? 0, "Button has no click handler or submit type.", findings);
    }
  }
}

function pushControl(
  source: string,
  file: string,
  index: number,
  message: string,
  findings: StaticAuditFinding[],
): void {
  const line = source.slice(0, index).split(/\r?\n/).length;
  findings.push(
    makeFinding({
      ruleId: "ast.dead-control",
      file,
      line,
      column: 1,
      snippet: lineSnippet(source, line),
      message,
      remediation: "Wire the control to a real handler or remove it.",
    }),
  );
}

function scanElision(source: string, file: string, findings: StaticAuditFinding[]): void {
  const patterns = [
    /\/\/\s*\.\.\.\s*existing code\s*\.\.\./i,
    /\/\/\s*\.\.\.\s*rest of file/i,
    /\/\*\s*unchanged\s*\*\//i,
    /^# \.\.\./m,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    findings.push(
      makeFinding({
        ruleId: "ast.elision",
        file,
        line,
        column: 1,
        snippet: lineSnippet(source, line),
        message: "Elision placeholder left truncated code in the file.",
        remediation: "Write the full file contents instead of an elision marker.",
      }),
    );
  }
}

function scanSpecialCases(
  source: string,
  file: string,
  literals: readonly string[],
  softFindings: StaticAuditFinding[],
): void {
  for (const literal of literals) {
    if (!literal) continue;
    const pattern = new RegExp(`===?\\s*['"\`]${escapeRegExp(literal)}['"\`]`);
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    softFindings.push(
      makeFinding({
        ruleId: "ast.special-case",
        severity: "soft",
        file,
        line,
        column: 1,
        snippet: lineSnippet(source, line),
        message: `Branch compares against visible example literal "${literal}".`,
        remediation: "Reviewer should confirm this is not a special case for a visible example.",
      }),
    );
  }
}

function cyclomatic(source: string): number {
  const matches = source.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g);
  return matches?.length ?? 0;
}

function readBlock(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

function readExpression(source: string, start: number): string {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if ((char === ";" || char === "\n") && depth === 0) {
      break;
    }
    index += 1;
  }
  return source.slice(start, index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
