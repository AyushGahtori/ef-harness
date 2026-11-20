import ts from "typescript";
import type { StaticAuditBrief, StaticAuditFinding } from "./types.js";
import { makeFinding } from "./locate.js";
import { stringLiteralValue, unwrapExpression } from "./ts-utils.js";

const MIN_SIZE_ESTIMATE = 40;
const SMALL_DIFF_RATIO = 0.25;

export function unquotedExamples(literals: readonly string[]): string[] {
  const values = new Set<string>();
  for (const literal of literals) {
    const trimmed = literal.trim();
    if (trimmed.length === 0) continue;
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(trimmed);
    values.add(quoted?.[2] ?? trimmed);
  }
  return [...values];
}

export function scanVisibleExampleBranches(
  file: string,
  sourceFile: ts.SourceFile,
  literals: readonly string[],
): StaticAuditFinding[] {
  const examples = new Set(unquotedExamples(literals));
  if (examples.size === 0) return [];
  const findings: StaticAuditFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      findings.push(...comparisons(file, sourceFile, node.expression, examples));
    } else if (ts.isConditionalExpression(node)) {
      findings.push(...comparisons(file, sourceFile, node.condition, examples));
    } else if (ts.isCaseClause(node) && node.expression) {
      const value = stringLiteralValue(node.expression);
      if (value !== undefined && examples.has(value)) {
        findings.push(specialCaseFinding(file, sourceFile, node.expression, value));
      }
    } else if (ts.isForStatement(node) && node.condition) {
      findings.push(...comparisons(file, sourceFile, node.condition, examples));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function scanTextVisibleExamples(file: string, text: string, literals: readonly string[]): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const example of unquotedExamples(literals)) {
    const expression = new RegExp(
      `\\b(?:if|while)\\s*\\([^\\n]*===?\\s*(['"\`])${escapeRegExp(example)}\\1`,
      "g",
    );
    for (const match of text.matchAll(expression)) {
      findings.push(
        makeFinding({
          ruleId: "visible-example-special-case",
          severity: "soft",
          file,
          line: lineOf(text, match.index ?? 0),
          column: 1,
          snippet: lineText(text, lineOf(text, match.index ?? 0)),
          message: `Branch compares against visible example ${JSON.stringify(example)}.`,
          remediation: "Implement the rule for the whole input domain, not one visible example.",
        }),
      );
    }
  }
  return findings;
}

export function cyclomaticComplexity(node: ts.Node): number {
  let score = 1;
  const visit = (current: ts.Node): void => {
    if (
      ts.isIfStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isCatchClause(current) ||
      ts.isConditionalExpression(current) ||
      ts.isCaseClause(current)
    ) {
      score += 1;
    }
    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        score += 1;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return score;
}

export function maxCyclomatic(sourceFile: ts.SourceFile): number {
  let max = 0;
  let sawFunction = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      sawFunction = true;
      max = Math.max(max, cyclomaticComplexity(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sawFunction ? max : roughCyclomatic(sourceFile.getFullText());
}

export function roughCyclomatic(text: string): number {
  const hits = text.match(/\b(?:if|for|while|case|catch)\b|&&|\|\|/g);
  return 1 + (hits?.length ?? 0);
}

export function complexityIsFarBelow(maxComplexity: number, mustCount: number): boolean {
  if (mustCount < 3) return false;
  return maxComplexity * 2 < mustCount;
}

export function diffIsDramaticallySmall(addedLines: number, estimate: number | undefined): boolean {
  if (estimate === undefined || estimate < MIN_SIZE_ESTIMATE) return false;
  return addedLines < estimate * SMALL_DIFF_RATIO;
}

export function softSummaryFindings(input: {
  readonly file: string;
  readonly addedLines: number;
  readonly maxComplexity: number;
  readonly brief: StaticAuditBrief;
}): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  if (diffIsDramaticallySmall(input.addedLines, input.brief.sizeEstimateLines)) {
    findings.push(
      makeFinding({
        ruleId: "diff-smaller-than-estimate",
        severity: "soft",
        file: input.file,
        line: 1,
        column: 1,
        snippet: `${input.addedLines} added lines`,
        message: `Diff adds ${input.addedLines} lines, dramatically under the ${input.brief.sizeEstimateLines ?? 0} line estimate.`,
        remediation: "Reviewer should confirm the candidate did not drop requirements.",
      }),
    );
  }
  if (complexityIsFarBelow(input.maxComplexity, input.brief.must.length)) {
    findings.push(
      makeFinding({
        ruleId: "complexity-below-must",
        severity: "soft",
        file: input.file,
        line: 1,
        column: 1,
        snippet: `complexity ${input.maxComplexity}`,
        message: `Cyclomatic complexity ${input.maxComplexity} is far below ${input.brief.must.length} MUST rules.`,
        remediation: "Reviewer should confirm each MUST rule has a real branch, not a shortcut.",
      }),
    );
  }
  return findings;
}

function comparisons(
  file: string,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  examples: ReadonlySet<string>,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const visit = (node: ts.Expression): void => {
    const current = unwrapExpression(node);
    if (!ts.isBinaryExpression(current)) return;
    const operator = current.operatorToken.kind;
    const compares =
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken;
    if (compares) {
      const literal = stringLiteralValue(current.left) ?? stringLiteralValue(current.right);
      if (literal !== undefined && examples.has(literal)) {
        findings.push(specialCaseFinding(file, sourceFile, current, literal));
      }
    }
    if (ts.isExpression(current.left)) visit(current.left);
    if (ts.isExpression(current.right)) visit(current.right);
  };
  visit(expression);
  return findings;
}

function specialCaseFinding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  literal: string,
): StaticAuditFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const snippet = sourceFile.getFullText().split(/\r?\n/)[position.line] ?? "";
  return makeFinding({
    ruleId: "visible-example-special-case",
    severity: "soft",
    file,
    line: position.line + 1,
    column: position.character + 1,
    snippet,
    message: `Branch compares against visible example ${JSON.stringify(literal)}.`,
    remediation: "Implement the rule for the whole input domain, not one visible example.",
  });
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function lineText(text: string, line: number): string {
  return text.split(/\r?\n/)[line - 1] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
