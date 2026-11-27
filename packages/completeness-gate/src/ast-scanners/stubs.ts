import ts from "typescript";
import type { ProducedSymbol, StaticAuditFinding } from "./types.js";
import { makeFinding } from "./locate.js";
import { isStubThrowMessage } from "./terms.js";
import { isExported, isFunctionLike, stringLiteralValue, unwrapExpression } from "./ts-utils.js";

interface ContractFunction {
  readonly name: string;
  readonly node: ts.Node;
  readonly body: ts.ConciseBody | undefined;
}

export function scanStubBodies(
  file: string,
  sourceFile: ts.SourceFile,
  produces: readonly ProducedSymbol[],
): StaticAuditFinding[] {
  const checked = new Map<string, ProducedSymbol>();
  for (const symbol of produces) {
    if (symbol.kind === "constant") continue;
    checked.set(symbol.name, symbol);
  }
  if (checked.size === 0) return [];

  const findings: StaticAuditFinding[] = [];
  for (const candidate of collectExportedFunctions(sourceFile)) {
    const symbol = checked.get(candidate.name);
    if (!symbol || candidate.body === undefined) continue;
    const kind = classifyBody(candidate.body);
    if (kind === "real") continue;
    if ((kind === "constant" && symbol.allowsConstantReturn) || (kind === "empty" && symbol.allowsEmptyReturn)) {
      continue;
    }
    const position = sourceFile.getLineAndCharacterOfPosition(candidate.node.getStart(sourceFile));
    const line = position.line + 1;
    const snippet = sourceFile.getFullText().split(/\r?\n/)[position.line] ?? candidate.name;
    findings.push(
      makeFinding({
        ruleId: "stub-body",
        severity: "hard",
        file,
        line,
        column: position.character + 1,
        snippet,
        message: `Contract symbol ${candidate.name} has a trivial ${kind} body.`,
        remediation:
          "Implement the contract operation. A constant or empty return is allowed only when the contract declares it.",
      }),
    );
  }
  return findings;
}

function classifyBody(body: ts.ConciseBody): "empty" | "constant" | "throw" | "real" {
  if (ts.isBlock(body)) {
    const statements = body.statements.filter((statement) => !ts.isEmptyStatement(statement));
    if (statements.length === 0) return "empty";
    if (statements.length !== 1) return "real";
    const only = statements[0];
    if (!only) return "empty";
    if (ts.isReturnStatement(only)) {
      if (!only.expression) return "empty";
      return isTrivialConstant(only.expression) ? "constant" : "real";
    }
    if (ts.isThrowStatement(only) && only.expression && isUnimplementedThrow(only.expression)) return "throw";
    return "real";
  }
  if (isTrivialConstant(body)) return "constant";
  return "real";
}

function isTrivialConstant(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text === "";
  if (ts.isNumericLiteral(node)) return Number(node.text) === 0;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return Number(node.operand.text) === 0;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.length === 0;
  if (ts.isObjectLiteralExpression(node)) return node.properties.length === 0;
  return false;
}

function isUnimplementedThrow(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error") {
    const argument = node.arguments?.[0];
    if (!argument || !ts.isExpression(argument)) return false;
    const message = stringLiteralValue(argument);
    return message !== undefined && isStubThrowMessage(message);
  }
  const message = stringLiteralValue(node);
  return message !== undefined && isStubThrowMessage(message);
}

function collectExportedFunctions(sourceFile: ts.SourceFile): ContractFunction[] {
  const locals = new Map<string, ContractFunction>();
  const exported = new Set<string>();

  const addFunction = (name: string, node: ts.Node, body: ts.ConciseBody | undefined) => {
    const existing = locals.get(name);
    if (existing?.body && body === undefined) return;
    locals.set(name, { name, node, body });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addFunction(statement.name.text, statement, statement.body);
      if (isExported(statement)) exported.add(statement.name.text);
    } else if (ts.isFunctionDeclaration(statement) && !statement.name && isExported(statement)) {
      addFunction("default", statement, statement.body);
      exported.add("default");
    }

    if (ts.isVariableStatement(statement)) {
      const statementExported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const initializer = unwrapExpression(declaration.initializer);
        if (isFunctionLike(initializer)) {
          addFunction(declaration.name.text, initializer, initializer.body);
          if (statementExported) exported.add(declaration.name.text);
        }
        if (ts.isObjectLiteralExpression(initializer)) {
          for (const property of initializer.properties) {
            if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
              addFunction(property.name.text, property, property.body);
              if (statementExported) exported.add(property.name.text);
            }
          }
        }
      }
    }

    if ((ts.isClassDeclaration(statement) || ts.isClassExpression(statement)) && isExported(statement)) {
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) continue;
        addFunction(member.name.text, member, member.body);
        exported.add(member.name.text);
      }
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const localName = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
        const exportedName = element.name.text;
        exported.add(exportedName);
        const local = locals.get(localName);
        if (local && exportedName !== localName) {
          locals.set(exportedName, { ...local, name: exportedName });
        }
      }
    }

    if (ts.isExportAssignment(statement)) {
      const initializer = unwrapExpression(statement.expression);
      if (isFunctionLike(initializer)) {
        addFunction("default", initializer, initializer.body);
        exported.add("default");
      }
    }
  }

  const functions: ContractFunction[] = [];
  for (const name of exported) {
    const found = locals.get(name);
    if (found) functions.push(found);
  }
  return functions;
}
