import ts from "typescript";
import type { StaticAuditLanguage } from "./types.js";

export function parseTypeScript(file: string, content: string, language: StaticAuditLanguage): ts.SourceFile {
  const scriptKind = scriptKindFor(language);
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function scriptKindFor(language: StaticAuditLanguage): ts.ScriptKind {
  if (language === "tsx") return ts.ScriptKind.TSX;
  if (language === "jsx") return ts.ScriptKind.JSX;
  if (language === "javascript") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

export function isExported(node: ts.Node): boolean {
  const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (flags & ts.ModifierFlags.Export) !== 0;
}

export function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

export function stringLiteralValue(expression: ts.Expression): string | undefined {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

export function collectComments(sourceFile: ts.SourceFile): readonly ts.CommentRange[] {
  const text = sourceFile.getFullText();
  const comments: ts.CommentRange[] = [];
  const seen = new Set<number>();
  const add = (range: ts.CommentRange | undefined) => {
    if (!range || seen.has(range.pos)) return;
    seen.add(range.pos);
    comments.push(range);
  };
  const visit = (node: ts.Node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) add(range);
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) add(range);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return comments;
}

export function syntaxDiagnosticCount(sourceFile: ts.SourceFile): number {
  const parsed = sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly unknown[] };
  return parsed.parseDiagnostics?.length ?? 0;
}

export function elementName(name: ts.JsxTagNameExpression): string | undefined {
  if (ts.isIdentifier(name)) return name.text.toLowerCase();
  if (ts.isPropertyAccessExpression(name)) return name.name.text.toLowerCase();
  return undefined;
}

export function jsxAttributeString(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return stringLiteralValue(initializer.expression);
  }
  return undefined;
}

export function attributeByName(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  const attributes = element.attributes.properties;
  for (const attribute of attributes) {
    if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
    if (attribute.name.text === name) return attribute;
  }
  return undefined;
}

export function hasSpreadAttribute(element: ts.JsxOpeningLikeElement): boolean {
  return element.attributes.properties.some((attribute) => ts.isJsxSpreadAttribute(attribute));
}
