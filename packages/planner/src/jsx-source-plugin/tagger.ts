import path from "node:path";
import ts from "typescript";

const SOURCE_ATTR = "data-ef-source";

interface Insert {
  readonly pos: number;
  readonly text: string;
}

export function tagJsxSource(code: string, fileName: string, projectRoot: string): string {
  const cleanName = fileName.replaceAll("\\", "/");
  if (cleanName.endsWith(".vue")) return tagVueSfc(code, cleanName, projectRoot);
  return tagJsxModule(code, cleanName, projectRoot, null);
}

function tagJsxModule(
  code: string,
  fileName: string,
  projectRoot: string,
  relativeOverride: string | null,
): string {
  const kind =
    fileName.endsWith(".jsx") ||
    fileName.endsWith(".js") ||
    fileName.endsWith(".mjs") ||
    fileName.endsWith(".cjs")
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TSX;
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
  const relative = relativeOverride ?? projectRelative(fileName, projectRoot);
  if (!relative) return code;
  const inserts: Insert[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (!hasSourceAttribute(node)) {
        const start = node.getStart(sourceFile);
        const loc = sourceFile.getLineAndCharacterOfPosition(start);
        const value = `${relative}:${loc.line + 1}:${loc.character + 1}`;
        const end = node.getEnd();
        const pos = ts.isJsxSelfClosingElement(node) ? end - 2 : end - 1;
        inserts.push({ pos, text: ` ${SOURCE_ATTR}="${escapeAttr(value)}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return applyInserts(code, inserts);
}

function hasSourceAttribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  return node.attributes.properties.some((prop) => {
    if (!ts.isJsxAttribute(prop)) return false;
    return attributeName(prop.name) === SOURCE_ATTR;
  });
}

function attributeName(name: ts.JsxAttributeName): string {
  if (ts.isIdentifier(name)) return name.text;
  return `${name.namespace.text}:${name.name.text}`;
}

export function projectRelative(fileName: string, projectRoot: string): string | null {
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(fileName) ? path.resolve(fileName) : path.resolve(root, fileName);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const normalized = relative.split(path.sep).join("/");
  if (normalized.split("/").includes("..")) return null;
  return normalized;
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function applyInserts(code: string, inserts: readonly Insert[]): string {
  const ordered = [...inserts].sort((left, right) => right.pos - left.pos);
  let next = code;
  for (const insert of ordered) {
    if (insert.pos < 0 || insert.pos > next.length) continue;
    next = `${next.slice(0, insert.pos)}${insert.text}${next.slice(insert.pos)}`;
  }
  return next;
}

function tagVueSfc(code: string, fileName: string, projectRoot: string): string {
  const relative = projectRelative(fileName, projectRoot);
  if (!relative) return code;
  return tagVueScripts(tagVueTemplate(code, relative), fileName, projectRoot, relative);
}

function tagVueTemplate(code: string, relative: string): string {
  const open = /<template\b[^>]*>/i.exec(code);
  if (!open) return code;
  const bodyStart = open.index + open[0].length;
  const close = code.toLowerCase().indexOf("</template>", bodyStart);
  if (close < 0) return code;
  const body = code.slice(bodyStart, close);
  const tagged = tagHtmlTags(body, code.slice(0, bodyStart), relative);
  if (tagged === body) return code;
  return `${code.slice(0, bodyStart)}${tagged}${code.slice(close)}`;
}

function tagHtmlTags(body: string, prefix: string, relative: string): string {
  const inserts: Insert[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);
    if (start < 0) break;
    const next = body[start + 1];
    if (next === "!" || next === "/" || next === "?" || next === undefined) {
      cursor = start + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) {
      cursor = start + 1;
      continue;
    }
    const nameEnd = readNameEnd(body, start + 1);
    const tagName = body.slice(start + 1, nameEnd);
    const tagEnd = findTagEnd(body, nameEnd);
    if (tagEnd < 0) break;
    if (tagName.toLowerCase() !== "template" && !sliceHasAttr(body.slice(start, tagEnd), SOURCE_ATTR)) {
      const absoluteIndex = prefix.length + start;
      const loc = lineCol(`${prefix}${body}`, absoluteIndex);
      const value = `${relative}:${loc.line}:${loc.column}`;
      inserts.push({ pos: insertAtTagEnd(body, tagEnd), text: ` ${SOURCE_ATTR}="${escapeAttr(value)}"` });
    }
    cursor = tagEnd + 1;
  }
  return applyInserts(body, inserts);
}

function readNameEnd(body: string, start: number): number {
  let index = start;
  while (index < body.length) {
    const char = body[index];
    if (char === undefined || /[\s/>]/.test(char)) break;
    index += 1;
  }
  return index;
}

function findTagEnd(body: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function insertAtTagEnd(body: string, tagEnd: number): number {
  let index = tagEnd - 1;
  while (index >= 0 && /\s/.test(body[index] ?? "")) index -= 1;
  if (body[index] === "/") return index;
  return tagEnd;
}

function sliceHasAttr(slice: string, name: string): boolean {
  return slice.includes(`${name}=`);
}

function lineCol(code: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = code.charCodeAt(cursor);
    if (char === 13) continue;
    if (char === 10) {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }
  return { line, column };
}

function tagVueScripts(
  code: string,
  fileName: string,
  projectRoot: string,
  relative: string,
): string {
  const pattern = /<script\b([^>]*)>/gi;
  const replacements: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null = pattern.exec(code);
  while (match) {
    const attrs = match[1] ?? "";
    const bodyStart = match.index + match[0].length;
    const close = code.indexOf("</script>", bodyStart);
    if (close < 0) break;
    if (/\blang\s*=\s*["'](?:tsx|jsx)["']/i.test(attrs)) {
      const body = code.slice(bodyStart, close);
      const startLine = lineCol(code, bodyStart).line;
      const padded = `${"\n".repeat(Math.max(0, startLine - 1))}${body}`;
      const tagged = tagJsxModule(padded, `${fileName}.tsx`, projectRoot, relative);
      const stripped = tagged.slice(Math.max(0, startLine - 1));
      if (stripped !== body) replacements.push({ start: bodyStart, end: close, text: stripped });
    }
    pattern.lastIndex = close + "</script>".length;
    match = pattern.exec(code);
  }
  let next = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}
