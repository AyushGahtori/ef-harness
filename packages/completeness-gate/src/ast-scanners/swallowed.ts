import ts from "typescript";
import type { ProducedSymbol, StaticAuditConventions, StaticAuditFinding } from "./types.js";
import { makeFinding } from "./locate.js";
import { unwrapExpression } from "./ts-utils.js";

type HandlerOutcome = "empty" | "null" | "log-only" | "other";

export function requiresStructuredErrors(conventions: StaticAuditConventions): boolean {
  if (conventions.requireStructuredErrors === true) return true;
  return (conventions.conventionRuleIds ?? []).includes("X-11");
}

export function scanSwallowedErrors(
  file: string,
  sourceFile: ts.SourceFile,
  conventions: StaticAuditConventions,
  produces: readonly ProducedSymbol[],
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const structured = requiresStructuredErrors(conventions);
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) {
      const outcome = blockOutcome(node.block);
      const allowed = swallowAllowed(node, conventions, produces);
      if (!allowed && outcome === "empty") {
        findings.push(swallowedFinding(file, sourceFile, node, "Empty catch swallows an error."));
      } else if (!allowed && outcome === "log-only" && structured) {
        findings.push(
          swallowedFinding(
            file,
            sourceFile,
            node,
            "Catch only logs, and X-11 requires the error to be surfaced, rethrown, or returned as a structured error.",
          ),
        );
      }
    }
    if (ts.isCallExpression(node) && isPromiseCatch(node)) {
      const callback = node.arguments[0];
      if (callback && isHandlerFunction(callback)) {
        const outcome = handlerOutcome(callback);
        const allowed = swallowAllowed(node, conventions, produces);
        if (!allowed && (outcome === "empty" || outcome === "null")) {
          findings.push(swallowedFinding(file, sourceFile, node, "Promise catch swallows the rejection."));
        } else if (!allowed && outcome === "log-only" && structured) {
          findings.push(
            swallowedFinding(file, sourceFile, node, "Promise catch only logs, and X-11 requires a surfaced error."),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function swallowedFinding(file: string, sourceFile: ts.SourceFile, node: ts.Node, message: string): StaticAuditFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const snippet = sourceFile.getFullText().split(/\r?\n/)[position.line] ?? "";
  return makeFinding({
    ruleId: "swallowed-error",
    severity: "hard",
    file,
    line: position.line + 1,
    column: position.character + 1,
    snippet,
    message,
    remediation: "Rethrow, return a structured error, or surface it. Do not drop it in an empty catch.",
  });
}

function swallowAllowed(node: ts.Node, conventions: StaticAuditConventions, produces: readonly ProducedSymbol[]): boolean {
  const name = enclosingFunctionName(node);
  if (!name) return false;
  if ((conventions.cleanupHelperNames ?? []).includes(name)) return true;
  const symbol = produces.find((item) => item.name === name);
  return symbol?.allowsSwallowedErrors === true;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isFunctionExpression(current) && current.name) return current.name.text;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent)) {
      if (ts.isIdentifier(current.parent.name)) return current.parent.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

function isPromiseCatch(node: ts.CallExpression): boolean {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  return expression.name.text === "catch";
}

function isHandlerFunction(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  const expression = ts.isExpression(node) ? unwrapExpression(node) : node;
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

function handlerOutcome(node: ts.ArrowFunction | ts.FunctionExpression): HandlerOutcome {
  const unwrapped = unwrapExpression(node);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) return "other";
  const body = unwrapped.body;
  if (!ts.isBlock(body)) {
    if (isNullish(body)) return "null";
    if (isConsoleLogOrError(body)) return "log-only";
    return "other";
  }
  return blockOutcome(body);
}

function blockOutcome(block: ts.Block): HandlerOutcome {
  const statements = block.statements.filter((statement) => !ts.isEmptyStatement(statement));
  if (statements.length === 0) return "empty";
  if (
    statements.length === 1 &&
    statements[0] &&
    ts.isReturnStatement(statements[0]) &&
    statements[0].expression &&
    isNullish(statements[0].expression)
  ) {
    return "null";
  }
  if (statements.every((statement) => ts.isExpressionStatement(statement) && isConsoleLogOrError(statement.expression))) {
    return "log-only";
  }
  return "other";
}

function isNullish(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isVoidExpression(node)) {
    const operand = unwrapExpression(node.expression);
    if (ts.isNumericLiteral(operand) && operand.text === "0") return true;
  }
  return false;
}

function isConsoleLogOrError(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  const call = ts.isVoidExpression(node) ? unwrapExpression(node.expression) : node;
  if (!ts.isCallExpression(call)) return false;
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  if (!ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== "console") return false;
  return call.expression.name.text === "log" || call.expression.name.text === "error";
}
