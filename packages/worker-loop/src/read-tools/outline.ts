import { createRequire } from "node:module";
import { OUTLINE_ENTRY_CAP } from "./model-profile.js";
import { clampText, isPascalCase, lineLabel, splitLines } from "./text-util.js";

export type SymbolKind = "class" | "function" | "interface" | "component" | "type" | "export";

export interface SymbolOutlineEntry {
  readonly line: number;
  readonly kind: SymbolKind;
  readonly name: string;
  readonly exported: boolean;
  readonly signature: string;
}

interface TsIdentifier {
  readonly text?: string;
  readonly escapedText?: string;
  getText?(sourceFile?: TsSourceFile): string;
}

interface TsNode {
  readonly kind: number;
  getStart(sourceFile?: TsSourceFile): number;
  getText(sourceFile?: TsSourceFile): string;
}

interface TsSourceFile extends TsNode {
  readonly statements: readonly TsNode[];
  getLineAndCharacterOfPosition(position: number): { line: number; character: number };
}

interface TsVariableDeclaration {
  readonly name: TsIdentifier;
  readonly initializer?: TsNode;
}

interface TsVariableStatement extends TsNode {
  readonly declarationList: { readonly declarations: readonly TsVariableDeclaration[] };
}

interface TsNamedNode extends TsNode {
  readonly name?: TsIdentifier;
}

interface TsApi {
  readonly ScriptKind: { readonly TS: number; readonly TSX: number; readonly JS: number; readonly JSX: number };
  readonly ScriptTarget: { readonly Latest: number };
  readonly SyntaxKind: {
    readonly FunctionDeclaration: number;
    readonly ClassDeclaration: number;
    readonly InterfaceDeclaration: number;
    readonly TypeAliasDeclaration: number;
    readonly EnumDeclaration: number;
    readonly VariableStatement: number;
    readonly ExportAssignment: number;
    readonly ExportDeclaration: number;
    readonly ArrowFunction: number;
    readonly FunctionExpression: number;
  };
  createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes: boolean,
    scriptKind: number,
  ): TsSourceFile;
}

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

export class FileOutlineExtractor {
  extract(fileName: string, source: string): readonly SymbolOutlineEntry[] {
    const extension = extensionOf(fileName);
    const entries =
      EXTENSIONS.has(extension) ? extractScript(fileName, source, extension) : extractByLanguage(fileName, source);
    return capOutline(entries);
  }

  format(entries: readonly SymbolOutlineEntry[], totalLines: number): string {
    if (entries.length === 0) return "";
    const lines = ["outline:"];
    for (const entry of entries) {
      const exported = entry.exported ? "export " : "";
      lines.push(`${lineLabel(entry.line, totalLines)} ${exported}${entry.kind} ${entry.name}`);
    }
    return lines.join("\n");
  }
}

function extractScript(fileName: string, source: string, extension: string): readonly SymbolOutlineEntry[] {
  const typescript = loadTypeScript();
  if (typescript) {
    try {
      return extractWithCompiler(typescript, fileName, source, extension);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return extractJsRegex(source);
    }
  }
  return extractJsRegex(source);
}

function loadTypeScript(): TsApi | null {
  try {
    const require = createRequire(import.meta.url);
    return require("typescript") as TsApi;
  } catch {
    return null;
  }
}

function extractWithCompiler(
  typescript: TsApi,
  fileName: string,
  source: string,
  extension: string,
): readonly SymbolOutlineEntry[] {
  const scriptKind =
    extension === ".tsx" || extension === ".jsx"
      ? typescript.ScriptKind.TSX
      : extension === ".js" || extension === ".mjs" || extension === ".cjs"
        ? typescript.ScriptKind.JS
        : typescript.ScriptKind.TS;
  const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.Latest, true, scriptKind);
  const sourceLines = splitLines(source);
  const entries: SymbolOutlineEntry[] = [];
  for (const statement of sourceFile.statements) {
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    const signature = clampText((sourceLines[line - 1] ?? "").trim(), 200);
    pushStatement(typescript, sourceFile, statement, line, signature, entries);
  }
  return entries;
}

function pushStatement(
  typescript: TsApi,
  sourceFile: TsSourceFile,
  statement: TsNode,
  line: number,
  signature: string,
  entries: SymbolOutlineEntry[],
): void {
  const kind = typescript.SyntaxKind;
  const exported = /^\s*export\b/.test(statement.getText(sourceFile));
  if (statement.kind === kind.FunctionDeclaration) {
    const name = nodeName(statement, sourceFile) ?? "default";
    entries.push(functionEntry(name, line, exported, signature));
    return;
  }
  if (statement.kind === kind.ClassDeclaration) {
    entries.push({ line, kind: "class", name: nodeName(statement, sourceFile) ?? "default", exported, signature });
    return;
  }
  if (statement.kind === kind.InterfaceDeclaration) {
    entries.push({
      line,
      kind: "interface",
      name: nodeName(statement, sourceFile) ?? "default",
      exported,
      signature,
    });
    return;
  }
  if (statement.kind === kind.TypeAliasDeclaration || statement.kind === kind.EnumDeclaration) {
    entries.push({ line, kind: "type", name: nodeName(statement, sourceFile) ?? "default", exported, signature });
    return;
  }
  if (statement.kind === kind.VariableStatement) {
    const variable = statement as TsVariableStatement;
    for (const declaration of variable.declarationList.declarations) {
      const name = identifierText(declaration.name, sourceFile) ?? "default";
      const initializerKind = declaration.initializer?.kind;
      const isFunction =
        initializerKind === kind.ArrowFunction || initializerKind === kind.FunctionExpression;
      if (isFunction) {
        entries.push(functionEntry(name, line, exported, signature));
      } else if (exported) {
        entries.push({ line, kind: "export", name, exported: true, signature });
      }
    }
    return;
  }
  if (statement.kind === kind.ExportAssignment || statement.kind === kind.ExportDeclaration) {
    const name = nodeName(statement, sourceFile) ?? clampText(signature.replace(/^export\s+/, ""), 80);
    entries.push({ line, kind: "export", name, exported: true, signature });
  }
}

function functionEntry(name: string, line: number, exported: boolean, signature: string): SymbolOutlineEntry {
  return {
    line,
    kind: isPascalCase(name) ? "component" : "function",
    name,
    exported,
    signature,
  };
}

function nodeName(node: TsNode, sourceFile: TsSourceFile): string | null {
  return identifierText((node as TsNamedNode).name, sourceFile);
}

function identifierText(name: TsIdentifier | undefined, sourceFile: TsSourceFile): string | null {
  if (!name) return null;
  if (typeof name.escapedText === "string" && name.escapedText.length > 0) return name.escapedText;
  if (typeof name.text === "string" && name.text.length > 0) return name.text;
  if (typeof name.getText === "function") {
    const text = name.getText(sourceFile);
    return text.length > 0 ? text : null;
  }
  return null;
}

function extractByLanguage(fileName: string, source: string): readonly SymbolOutlineEntry[] {
  const extension = extensionOf(fileName);
  if (extension === ".py") return extractIndented(source, [
    { expression: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
    { expression: /^class\s+([A-Za-z_]\w*)/, kind: "class" },
  ], "#");
  if (extension === ".go") return extractIndented(source, [
    { expression: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: "function" },
    { expression: /^type\s+([A-Za-z_]\w*)\s+interface\b/, kind: "interface" },
    { expression: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: "class" },
  ], "//");
  if (extension === ".rs") return extractIndented(source, [
    { expression: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
    { expression: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: "class" },
    { expression: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: "interface" },
    { expression: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "type" },
  ], "//");
  return [];
}

function extractJsRegex(source: string): readonly SymbolOutlineEntry[] {
  return extractIndented(source, [
    { expression: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { expression: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { expression: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
    { expression: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
    { expression: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, kind: "function" },
  ], "//");
}

interface LanguageRule {
  readonly expression: RegExp;
  readonly kind: SymbolKind;
}

function extractIndented(
  source: string,
  rules: readonly LanguageRule[],
  commentPrefix: string,
): readonly SymbolOutlineEntry[] {
  const entries: SymbolOutlineEntry[] = [];
  const lines = splitLines(source);
  let blockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (blockComment) {
      if (trimmed.includes("*/")) blockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) blockComment = true;
      continue;
    }
    if (trimmed.startsWith(commentPrefix) || trimmed.startsWith("*")) continue;
    for (const rule of rules) {
      const match = rule.expression.exec(trimmed);
      const name = match?.[1];
      if (!name) continue;
      const kind = rule.kind === "function" && isPascalCase(name) ? "component" : rule.kind;
      entries.push({
        line: index + 1,
        kind,
        name,
        exported: /\b(?:export|pub)\b/.test(trimmed),
        signature: clampText(trimmed, 200),
      });
      break;
    }
  }
  return entries;
}

function capOutline(entries: readonly SymbolOutlineEntry[]): readonly SymbolOutlineEntry[] {
  if (entries.length <= OUTLINE_ENTRY_CAP) return entries;
  return entries.slice(0, OUTLINE_ENTRY_CAP);
}

function extensionOf(fileName: string): string {
  const base = fileName.replaceAll("\\", "/");
  const slash = base.lastIndexOf("/");
  const leaf = slash === -1 ? base : base.slice(slash + 1);
  const dot = leaf.lastIndexOf(".");
  return dot === -1 ? "" : leaf.slice(dot).toLowerCase();
}
