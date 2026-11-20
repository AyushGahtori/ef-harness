import ts from "typescript";
import { normalizeRel } from "./containment.js";
import type { BindingDefectCode } from "./errors.js";
import type { AcceptanceCheck, ObservationsSchema, SetupHelper } from "./types.js";

export interface AdapterAudit {
  ok: boolean;
  code?: BindingDefectCode;
  message: string;
}

const PROTECTED_PATTERN =
  /expectation|expected-values|oracle|rubric|(^|\/)__checks(\/|$)|protected[-_/]check|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|(^|\/)checks\//i;

const FILE_MUTATORS = new Set([
  "fs",
  "node:fs",
  "node:fs/promises",
  "fs/promises",
  "child_process",
  "node:child_process",
]);

const LANGUAGE_GLOBALS = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Set",
  "String",
  "Symbol",
  "BigInt",
  "undefined",
  "NaN",
  "Infinity",
]);

interface AllowedSymbol {
  name: string;
  modulePath: string;
}

/**
 * Static proof that a binder adapter stays inside the contract:
 * no product writes, no expectation imports, only declared entries and setup helpers,
 * and the returned observation is not a constant that skips the entry call.
 */
export function auditBinderAdapter(source: string, fileName: string, check: AcceptanceCheck): AdapterAudit {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowed = allowList(check);
  const entryNames = new Set(check.entries.map((entry) => entry.exportName));
  const protectedSpecs = check.protectedModules ?? [];

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const verdict = auditImport(statement, fileName, allowed, protectedSpecs);
      if (verdict) return verdict;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isProtectedModule(statement.moduleSpecifier.text, fileName, protectedSpecs)
    ) {
      return fail(
        "expectation_import",
        `Adapter re-exports protected module ${statement.moduleSpecifier.text}`,
      );
    }
  }

  const requireVerdict = auditRequireCalls(parsed, fileName, protectedSpecs);
  if (requireVerdict) return requireVerdict;

  const callVerdict = auditFreeCalls(parsed, entryNames, new Set(allowed.map((symbol) => symbol.name)));
  if (callVerdict) return callVerdict;

  const observe = findObserve(parsed);
  if (!observe) {
    return fail("schema_mismatch", "Adapter must export function observe");
  }
  if (!callsEntry(observe, entryNames)) {
    return fail(
      "entry_not_invoked",
      "Adapter returns observations without calling the declared contract entry",
    );
  }
  const derived = derivedIdentifiers(observe, entryNames);
  if (!returnsDerived(observe, entryNames, derived)) {
    return fail(
      "constant_adapter",
      "Adapter returns a constant observation that does not use the declared entry",
    );
  }
  const shape = returnedObjectKeys(observe);
  if (shape && !keysMatchSchema(shape, check.observationsSchema)) {
    return fail(
      "schema_mismatch",
      `Adapter observation keys [${shape.join(", ")}] do not match observations_schema`,
    );
  }
  return { ok: true, message: "adapter is contained" };
}

function allowList(check: AcceptanceCheck): AllowedSymbol[] {
  const helpers: readonly SetupHelper[] = [
    ...(check.phase0Helpers ?? []),
    ...(check.baseHelpers ?? []),
  ];
  return [
    ...check.entries.map((entry) => ({ name: entry.exportName, modulePath: entry.modulePath })),
    ...helpers.map((helper) => ({ name: helper.name, modulePath: helper.modulePath })),
  ];
}

function auditImport(
  statement: ts.ImportDeclaration,
  fileName: string,
  allowed: readonly AllowedSymbol[],
  protectedSpecs: readonly string[],
): AdapterAudit | undefined {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
  const spec = statement.moduleSpecifier.text;
  if (FILE_MUTATORS.has(spec)) {
    return fail("product_mutation", `Adapter imports ${spec} and could modify product files`);
  }
  if (isProtectedModule(spec, fileName, protectedSpecs)) {
    return fail("expectation_import", `Adapter imports protected module ${spec}`);
  }
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return undefined;
  if (clause.name && !moduleAllowed(spec, fileName, allowed)) {
    return fail("undeclared_helper", `Default import from ${spec} is not a declared entry or setup helper`);
  }
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings) && !moduleAllowed(spec, fileName, allowed)) {
    return fail("undeclared_helper", `Namespace import from ${spec} is not a declared entry or setup helper`);
  }
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (!nameAllowed(imported, spec, fileName, allowed)) {
        return fail(
          "undeclared_helper",
          `import { ${imported} } is not a declared contract entry or Phase 0 / base setup helper`,
        );
      }
    }
  }
  return undefined;
}

function auditRequireCalls(
  source: ts.SourceFile,
  fileName: string,
  protectedSpecs: readonly string[],
): AdapterAudit | undefined {
  let verdict: AdapterAudit | undefined;
  const visit = (node: ts.Node): void => {
    if (verdict) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        if (FILE_MUTATORS.has(arg.text)) {
          verdict = fail("product_mutation", `Adapter requires ${arg.text}`);
          return;
        }
        if (isProtectedModule(arg.text, fileName, protectedSpecs)) {
          verdict = fail("expectation_import", `Adapter requires protected module ${arg.text}`);
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return verdict;
}

function auditFreeCalls(
  source: ts.SourceFile,
  entryNames: ReadonlySet<string>,
  allowedNames: ReadonlySet<string>,
): AdapterAudit | undefined {
  const locals = localBindings(source);
  let verdict: AdapterAudit | undefined;
  const visit = (node: ts.Node): void => {
    if (verdict) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (!entryNames.has(name) && !allowedNames.has(name) && !locals.has(name) && !LANGUAGE_GLOBALS.has(name)) {
        verdict = fail(
          "undeclared_helper",
          `Call to ${name} is not a declared contract entry or Phase 0 / base setup helper`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return verdict;
}

function localBindings(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function findObserve(source: ts.SourceFile): ts.Block | undefined {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "observe" &&
      hasExport(statement) &&
      statement.body
    ) {
      return statement.body;
    }
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "observe") continue;
      const init = declaration.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) {
        if (ts.isBlock(init.body)) return init.body;
      }
    }
  }
  return undefined;
}

function hasExport(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function callsEntry(body: ts.Node, entryNames: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && calleeIsEntry(node.expression, entryNames)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function calleeIsEntry(expression: ts.Expression, entryNames: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) return entryNames.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return entryNames.has(expression.name.text);
  return false;
}

function derivedIdentifiers(body: ts.Node, entryNames: ReadonlySet<string>): Set<string> {
  const derived = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (expressionDerived(node.initializer, entryNames, derived)) {
        derived.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return derived;
}

function returnsDerived(body: ts.Block, entryNames: ReadonlySet<string>, derived: ReadonlySet<string>): boolean {
  let sawReturn = false;
  let allDerived = true;
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      sawReturn = true;
      if (!node.expression || !expressionDerived(node.expression, entryNames, derived)) {
        allDerived = false;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return sawReturn && allDerived;
}

function expressionDerived(
  expression: ts.Expression,
  entryNames: ReadonlySet<string>,
  derived: ReadonlySet<string>,
): boolean {
  const expr = unwrap(expression);
  if (ts.isCallExpression(expr) && calleeIsEntry(expr.expression, entryNames)) return true;
  if (ts.isIdentifier(expr)) return derived.has(expr.text);
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return expressionDerived(expr.expression, entryNames, derived);
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.some((property) => {
      if (ts.isSpreadAssignment(property)) {
        return expressionDerived(property.expression, entryNames, derived);
      }
      if (ts.isShorthandPropertyAssignment(property)) return derived.has(property.name.text);
      if (ts.isPropertyAssignment(property)) {
        return expressionDerived(property.initializer, entryNames, derived);
      }
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.some((element) => {
      if (ts.isSpreadElement(element)) return expressionDerived(element.expression, entryNames, derived);
      return ts.isExpression(element) && expressionDerived(element, entryNames, derived);
    });
  }
  if (ts.isBinaryExpression(expr)) {
    return (
      expressionDerived(expr.left, entryNames, derived) ||
      expressionDerived(expr.right, entryNames, derived)
    );
  }
  if (ts.isConditionalExpression(expr)) {
    return (
      expressionDerived(expr.condition, entryNames, derived) ||
      expressionDerived(expr.whenTrue, entryNames, derived) ||
      expressionDerived(expr.whenFalse, entryNames, derived)
    );
  }
  if (ts.isTemplateExpression(expr)) {
    return expr.templateSpans.some((span) => expressionDerived(span.expression, entryNames, derived));
  }
  return false;
}

function returnedObjectKeys(body: ts.Block): string[] | undefined {
  let keys: string[] | undefined;
  let incompatible = false;
  const visit = (node: ts.Node): void => {
    if (incompatible) return;
    if (ts.isReturnStatement(node)) {
      if (!node.expression) {
        incompatible = true;
        return;
      }
      const expr = unwrap(node.expression);
      if (!ts.isObjectLiteralExpression(expr)) return;
      if (expr.properties.some((property) => ts.isSpreadAssignment(property))) return;
      const found: string[] = [];
      for (const property of expr.properties) {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
            found.push(property.name.text);
          }
        }
      }
      keys = found;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (incompatible) return undefined;
  return keys;
}

function keysMatchSchema(keys: readonly string[], schema: ObservationsSchema): boolean {
  if (keys.length !== schema.fields.length) return false;
  const expected = new Set(schema.fields.map((field) => field.name));
  return keys.every((key) => expected.has(key));
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAwaitExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function isProtectedModule(spec: string, fileName: string, extra: readonly string[]): boolean {
  const resolved = spec.startsWith(".") ? resolveSpec(fileName, spec) : spec;
  if (PROTECTED_PATTERN.test(spec) || PROTECTED_PATTERN.test(resolved)) return true;
  return extra.some((item) => item === spec || normalizeRel(item) === resolved);
}

function moduleAllowed(spec: string, fileName: string, allowed: readonly AllowedSymbol[]): boolean {
  if (!spec.startsWith(".")) return false;
  const resolved = resolveSpec(fileName, spec);
  return allowed.some((symbol) => moduleStemsMatch(resolved, symbol.modulePath));
}

function nameAllowed(
  name: string,
  spec: string,
  fileName: string,
  allowed: readonly AllowedSymbol[],
): boolean {
  if (!spec.startsWith(".")) return false;
  const resolved = resolveSpec(fileName, spec);
  return allowed.some(
    (symbol) => symbol.name === name && moduleStemsMatch(resolved, symbol.modulePath),
  );
}

function resolveSpec(fromFile: string, spec: string): string {
  const dir = normalizeRel(fromFile).split("/").slice(0, -1).join("/");
  const joined = `${dir}/${spec}`.split("/");
  const parts: string[] = [];
  for (const part of joined) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function moduleStemsMatch(resolved: string, modulePath: string): boolean {
  return stripExt(normalizeRel(resolved)) === stripExt(normalizeRel(modulePath));
}

function stripExt(file: string): string {
  return file.replace(/\.(tsx|ts|jsx|mjs|cjs|js)$/, "");
}

function fail(code: BindingDefectCode, message: string): AdapterAudit {
  return { ok: false, code, message };
}
