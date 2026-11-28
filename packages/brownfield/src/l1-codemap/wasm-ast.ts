import path from "node:path";
import type { Language, Node as SyntaxNode, Parser, Tree } from "web-tree-sitter";
import { buildSymbol } from "./symbol-build.js";
import type { ExtractedRef, ExtractedSymbol, SymbolKind } from "./types.js";
import type { LoadedGrammars } from "./web-tree-sitter-loader.js";
import { collectBarrelReExports } from "./tsconfig-paths.js";
import { parseStructurally, type StructuralParseResult } from "./structural-parser.js";

const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

export function languageForPath(filePath: string, grammars: LoadedGrammars): Language | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx" || ext === ".jsx") return grammars.tsx;
  if (ext === ".ts") return grammars.typescript;
  if (JS_EXTENSIONS.has(ext)) return grammars.javascript;
  return null;
}

export function parseWithWasm(
  filePath: string,
  content: string,
  parser: Parser,
  grammars: LoadedGrammars,
): StructuralParseResult | null {
  const language = languageForPath(filePath, grammars);
  if (!language) return null;
  parser.setLanguage(language);
  const tree = parser.parse(content);
  if (!tree) return parseStructurally(filePath, content);
  const extracted = extractTree(filePath, content, tree);
  tree.delete();
  if (!extracted.hasError) return extracted.result;
  return mergeParse(extracted.result, parseStructurally(filePath, content));
}

function extractTree(filePath: string, content: string, tree: Tree): {
  readonly result: StructuralParseResult;
  readonly hasError: boolean;
} {
  const symbols: ExtractedSymbol[] = [];
  const refs: ExtractedRef[] = [];
  const imports: string[] = [];
  const seen = new Set<string>();
  walk(tree.rootNode, filePath, content, symbols, refs, imports, seen, false);
  const barrels = path.basename(filePath).startsWith("index") ? collectBarrelReExports(content) : [];
  return {
    hasError: tree.rootNode.hasError,
    result: { symbols, refs, imports, barrels },
  };
}

function walk(
  node: SyntaxNode,
  filePath: string,
  content: string,
  symbols: ExtractedSymbol[],
  refs: ExtractedRef[],
  imports: string[],
  seen: Set<string>,
  exported: boolean,
): void {
  if (node.type === "export_statement") {
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      if (child) walk(child, filePath, content, symbols, refs, imports, seen, true);
    }
    return;
  }
  if (node.type === "import_statement") {
    recordImport(node, imports, refs);
    return;
  }
  const symbol = declarationSymbol(node, filePath, exported);
  if (symbol) {
    const key = `${symbol.name}:${String(symbol.line)}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push(symbol);
    }
  }
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) walk(child, filePath, content, symbols, refs, imports, seen, exported);
  }
}

function declarationSymbol(node: SyntaxNode, filePath: string, exported: boolean): ExtractedSymbol | null {
  const line = node.startPosition.row + 1;
  const nameNode =
    node.childForFieldName("name") ??
    findChild(node, "identifier") ??
    findChild(node, "type_identifier") ??
    findChild(node, "property_identifier");
  if (node.type === "function_declaration" || node.type === "method_definition") {
    const name = nameNode?.text;
    if (!name) return null;
    return buildSymbol({
      name,
      kind: kindForPath(filePath, "function"),
      line,
      exported,
      signature: firstLine(node.text),
    });
  }
  if (node.type === "class_declaration") {
    const name = nameNode?.text;
    if (!name) return null;
    return buildSymbol({
      name,
      kind: "class",
      line,
      exported,
      signature: firstLine(node.text),
    });
  }
  if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
    const name = nameNode?.text;
    if (!name) return null;
    return buildSymbol({
      name,
      kind: "interface",
      line,
      exported,
      signature: firstLine(node.text),
    });
  }
  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const declarator = findChild(node, "variable_declarator");
    const name = declarator ? (findChild(declarator, "identifier")?.text ?? null) : null;
    if (!name) return null;
    return buildSymbol({
      name,
      kind: kindForPath(filePath, "const"),
      line,
      exported,
      signature: firstLine(node.text),
    });
  }
  return null;
}

function recordImport(node: SyntaxNode, imports: string[], refs: ExtractedRef[]): void {
  const source = findDescendant(node, "string_fragment");
  const spec = source?.text;
  if (!spec) return;
  imports.push(spec);
  const line = node.startPosition.row + 1;
  const clause = findChild(node, "import_clause");
  if (!clause) {
    refs.push({ name: path.basename(spec).replace(/\.[^.]+$/, ""), line, targetPath: spec });
    return;
  }
  collectIdentifiers(clause, (name) => {
    refs.push({ name, line, targetPath: spec });
  });
}

function collectIdentifiers(node: SyntaxNode, visit: (name: string) => void): void {
  if (node.type === "identifier" || node.type === "type_identifier") {
    if (node.text) visit(node.text);
    return;
  }
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) collectIdentifiers(child, visit);
  }
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child?.type === type) return child;
  }
  return null;
}

function findDescendant(node: SyntaxNode, type: string): SyntaxNode | null {
  if (node.type === type) return node;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child) continue;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

function kindForPath(filePath: string, fallback: SymbolKind): SymbolKind {
  if (filePath.includes("/app/") || filePath.includes("/pages/")) return "component";
  return fallback;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? text;
}

function mergeParse(primary: StructuralParseResult, fallback: StructuralParseResult): StructuralParseResult {
  const symbols = [...primary.symbols];
  const seen = new Set(symbols.map((symbol) => `${symbol.name}:${String(symbol.line)}`));
  for (const symbol of fallback.symbols) {
    const key = `${symbol.name}:${String(symbol.line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    symbols.push(symbol);
  }
  const imports = [...new Set([...primary.imports, ...fallback.imports])];
  const refs = primary.refs.length > 0 ? primary.refs : fallback.refs;
  return {
    symbols,
    refs,
    imports,
    barrels: primary.barrels.length > 0 ? primary.barrels : fallback.barrels,
  };
}

export function supportsWasm(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext);
}
