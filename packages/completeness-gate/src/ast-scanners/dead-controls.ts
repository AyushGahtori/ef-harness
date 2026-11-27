import ts from "typescript";
import type { StaticAuditFinding } from "./types.js";
import { findingAt, makeFinding } from "./locate.js";
import {
  attributeByName,
  elementName,
  hasSpreadAttribute,
  jsxAttributeString,
  unwrapExpression,
} from "./ts-utils.js";

const EMPTY_ARROW =
  /\b(onClick|onChange|onSubmit)\s*=\s*\{\s*(?:function\s*)?\([^)]*\)\s*(?:=>)?\s*\{\s*\}\s*\}/g;
const HREF_HASH = /\bhref\s*=\s*(?:\{\s*)?(['"])\s*#\s*\1\s*\}?/gi;
const HREF_VOID = /\bhref\s*=\s*(?:\{\s*)?(['"])\s*javascript:\s*void\s*\(\s*0\s*\)\s*;?\s*\1\s*\}?/gi;

export function scanJsxDeadControls(file: string, sourceFile: ts.SourceFile): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      findings.push(...inspectOpening(file, sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function scanTextDeadControls(file: string, text: string): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const match of text.matchAll(EMPTY_ARROW)) {
    const name = match[1] ?? "handler";
    findings.push(
      findingAt({
        ruleId: "dead-ui-control",
        severity: "hard",
        file,
        text,
        index: match.index ?? 0,
        message: `${name} is wired to an empty function.`,
        remediation: "Point the control at a real handler.",
      }),
    );
  }
  for (const match of text.matchAll(HREF_HASH)) {
    findings.push(
      findingAt({
        ruleId: "dead-ui-control",
        severity: "hard",
        file,
        text,
        index: match.index ?? 0,
        message: 'Anchor uses href="#".',
        remediation: "Use a real URL or a button with a handler.",
      }),
    );
  }
  for (const match of text.matchAll(HREF_VOID)) {
    findings.push(
      findingAt({
        ruleId: "dead-ui-control",
        severity: "hard",
        file,
        text,
        index: match.index ?? 0,
        message: 'Anchor uses href="javascript:void(0)".',
        remediation: "Use a real URL or a button with a handler.",
      }),
    );
  }
  if (languageLooksLikeHtml(file)) findings.push(...scanHtmlStructure(file, text));
  return findings;
}

function inspectOpening(
  file: string,
  sourceFile: ts.SourceFile,
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const name = elementName(element.tagName);
  for (const eventName of ["onClick", "onChange", "onSubmit"] as const) {
    const attribute = attributeByName(element, eventName);
    if (attribute?.initializer && isEmptyHandlerAttribute(attribute)) {
      findings.push(
        jsxFinding(file, sourceFile, attribute, `${eventName} is wired to an empty function.`, "Point the control at a real handler."),
      );
    }
  }
  if (name === "a") {
    const href = attributeByName(element, "href");
    const value = href ? jsxAttributeString(href) : undefined;
    if (href && value !== undefined && isDeadHref(value)) {
      findings.push(
        jsxFinding(
          file,
          sourceFile,
          href,
          value.trim() === "#" ? 'Anchor uses href="#".' : 'Anchor uses href="javascript:void(0)".',
          "Use a real URL or a button with a handler.",
        ),
      );
    }
  }
  if (name === "form" && !hasSpreadAttribute(element) && !formHasHandler(element)) {
    findings.push(
      jsxFinding(
        file,
        sourceFile,
        element,
        "Form has no onSubmit handler and no action.",
        "Add onSubmit or a non-empty action.",
      ),
    );
  }
  if (name === "button" && !hasSpreadAttribute(element)) {
    const inForm = insideForm(element);
    if (inForm && !buttonIsLive(element)) {
      findings.push(
        jsxFinding(
          file,
          sourceFile,
          element,
          'Button inside a form has neither onClick nor type="submit".',
          'Set type="submit" or a real onClick handler.',
        ),
      );
    } else if (!inForm && !attributeByName(element, "onClick") && !standaloneButtonIsLive(element)) {
      findings.push(
        jsxFinding(
          file,
          sourceFile,
          element,
          "Button outside a form has no onClick handler.",
          "Add an onClick handler or associate it with a form.",
        ),
      );
    }
  }
  return findings;
}

function formHasHandler(element: ts.JsxOpeningLikeElement): boolean {
  const action = attributeByName(element, "action");
  const actionValue = action ? jsxAttributeString(action) : undefined;
  if (action && actionValue === undefined) return true;
  if (actionValue !== undefined && actionValue.trim().length > 0 && !isDeadHref(actionValue)) return true;
  const onSubmit = attributeByName(element, "onSubmit");
  if (!onSubmit) return false;
  if (!onSubmit.initializer) return true;
  return !isEmptyHandlerAttribute(onSubmit);
}

function buttonIsLive(element: ts.JsxOpeningLikeElement): boolean {
  const onClick = attributeByName(element, "onClick");
  if (onClick && !isEmptyHandlerAttribute(onClick)) return true;
  const type = attributeByName(element, "type");
  const typeValue = type ? jsxAttributeString(type)?.toLowerCase() : undefined;
  return typeValue === "submit";
}

function standaloneButtonIsLive(element: ts.JsxOpeningLikeElement): boolean {
  const onClick = attributeByName(element, "onClick");
  if (onClick && !isEmptyHandlerAttribute(onClick)) return true;
  const type = attributeByName(element, "type");
  const typeValue = type ? jsxAttributeString(type)?.toLowerCase() : undefined;
  const formAttr = attributeByName(element, "form");
  return typeValue === "submit" && formAttr !== undefined;
}

function insideForm(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && elementName(current.openingElement.tagName) === "form") return true;
    current = current.parent;
  }
  return false;
}

function isEmptyHandlerAttribute(attribute: ts.JsxAttribute): boolean {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return false;
  return isEmptyHandler(unwrapExpression(initializer.expression));
}

function isEmptyHandler(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isBlock(node.body)) {
      return node.body.statements.filter((statement) => !ts.isEmptyStatement(statement)).length === 0;
    }
    return false;
  }
  return false;
}

function isDeadHref(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "#") return true;
  return /^javascript:\s*void\s*\(\s*0\s*\)\s*;?$/.test(trimmed);
}

function jsxFinding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  remediation: string,
): StaticAuditFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const snippet = sourceFile.getFullText().split(/\r?\n/)[position.line] ?? "";
  return makeFinding({
    ruleId: "dead-ui-control",
    severity: "hard",
    file,
    line: position.line + 1,
    column: position.character + 1,
    snippet,
    message,
    remediation,
  });
}

function languageLooksLikeHtml(file: string): boolean {
  return file.toLowerCase().endsWith(".html") || file.toLowerCase().endsWith(".htm");
}

interface HtmlTag {
  readonly name: string;
  readonly start: number;
  readonly attributes: ReadonlyMap<string, string>;
  readonly selfClosing: boolean;
}

function scanHtmlStructure(file: string, text: string): StaticAuditFinding[] {
  const tags = readHtmlTags(text);
  const findings: StaticAuditFinding[] = [];
  const stack: HtmlTag[] = [];
  for (const tag of tags) {
    if (tag.name.startsWith("/")) {
      const closing = tag.name.slice(1);
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]?.name === closing) {
          stack.splice(index, 1);
          break;
        }
      }
      continue;
    }
    if (tag.name === "form" && !htmlFormHasHandler(tag)) {
      findings.push(
        findingAt({
          ruleId: "dead-ui-control",
          severity: "hard",
          file,
          text,
          index: tag.start,
          message: "Form has no onSubmit handler and no action.",
          remediation: "Add onSubmit or a non-empty action.",
        }),
      );
    }
    if (tag.name === "button" && stack.some((parent) => parent.name === "form") && !htmlButtonIsLive(tag)) {
      findings.push(
        findingAt({
          ruleId: "dead-ui-control",
          severity: "hard",
          file,
          text,
          index: tag.start,
          message: 'Button inside a form has neither onClick nor type="submit".',
          remediation: 'Set type="submit" or a real onClick handler.',
        }),
      );
    }
    if (!tag.selfClosing && !VOID_HTML.has(tag.name)) stack.push(tag);
  }
  return findings;
}

const VOID_HTML = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function htmlFormHasHandler(tag: HtmlTag): boolean {
  const action = tag.attributes.get("action");
  if (action !== undefined && action.trim().length > 0 && action.trim() !== "#") return true;
  const onSubmit = tag.attributes.get("onsubmit");
  if (onSubmit === undefined) return false;
  return !/\(\s*\)\s*=>\s*\{\s*\}/.test(onSubmit) && !/function\s*\([^)]*\)\s*\{\s*\}/.test(onSubmit);
}

function htmlButtonIsLive(tag: HtmlTag): boolean {
  const type = tag.attributes.get("type")?.toLowerCase();
  if (type === "submit") return true;
  const onClick = tag.attributes.get("onclick");
  if (onClick === undefined) return false;
  return !/\(\s*\)\s*=>\s*\{\s*\}/.test(onClick);
}

function readHtmlTags(text: string): HtmlTag[] {
  const tags: HtmlTag[] = [];
  const expression = /<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  for (const match of text.matchAll(expression)) {
    const name = (match[1] ?? "").toLowerCase();
    const rawAttributes = match[2] ?? "";
    const selfClosing = rawAttributes.trim().endsWith("/") || name.startsWith("/");
    tags.push({
      name,
      start: match.index ?? 0,
      attributes: readAttributes(rawAttributes),
      selfClosing,
    });
  }
  return tags;
}

function readAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const expression = /([:@\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of raw.matchAll(expression)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(name, value);
  }
  return attributes;
}
