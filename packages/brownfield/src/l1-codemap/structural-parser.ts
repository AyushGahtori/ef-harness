import path from "node:path";
import type { ExtractedRef, ExtractedSymbol, SymbolKind } from "./types.js";
import { buildSymbol } from "./symbol-build.js";
import { collectBarrelReExports } from "./tsconfig-paths.js";

const IMPORT_RE =
  /^\s*import\s+(?:type\s+)?(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]+\}|\w+))?\s+from\s+)?['"]([^'"]+)['"]/gm;
const EXPORT_FN = /export\s+(?:async\s+)?function\s+(\w+)/g;
const EXPORT_CONST = /export\s+const\s+(\w+)/g;
const EXPORT_CLASS = /export\s+(?:default\s+)?class\s+(\w+)/g;
const EXPORT_TYPE = /export\s+(?:type|interface)\s+(\w+)/g;
const EXPORT_DEFAULT_FN = /export\s+default\s+(?:async\s+)?function\s*(\w+)?/g;
const PY_DEF = /^(\s*)def\s+(\w+)\s*\(/gm;
const PY_CLASS = /^(\s*)class\s+(\w+)\s*[:(]/gm;
const GO_FUNC = /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/gm;
const GO_TYPE = /^type\s+(\w+)\s+/gm;
const SQL_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi;
const FALLBACK_IMPORT = /^\s*(?:import|from|require|use|include)\s+['"]([^'"]+)['"]/gim;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function componentNameFromPath(filePath: string): string {
  const base = path.basename(filePath).replace(/\.(tsx|jsx)$/i, "");
  return base.slice(0, 1).toUpperCase() + base.slice(1);
}

export interface StructuralParseResult {
  readonly symbols: readonly ExtractedSymbol[];
  readonly refs: readonly ExtractedRef[];
  readonly imports: readonly string[];
  readonly barrels: readonly string[];
}

export function parseStructurally(filePath: string, content: string): StructuralParseResult {
  const ext = path.extname(filePath).toLowerCase();
  const symbols: ExtractedSymbol[] = [];
  const refs: ExtractedRef[] = [];
  const imports: string[] = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    extractTsJs(content, filePath, symbols, refs, imports);
  } else if (ext === ".py") {
    extractPython(content, symbols);
  } else if (ext === ".go") {
    extractGo(content, symbols);
  } else if (ext === ".sql") {
    extractSql(content, symbols);
  } else {
    extractFallbackImports(content, imports, refs);
  }

  const barrels = path.basename(filePath).startsWith("index") ? collectBarrelReExports(content) : [];

  return { symbols, refs, imports, barrels };
}

function extractTsJs(
  content: string,
  filePath: string,
  symbols: ExtractedSymbol[],
  refs: ExtractedRef[],
  imports: string[],
): void {
  for (const re of [EXPORT_FN, EXPORT_CONST, EXPORT_CLASS, EXPORT_TYPE, EXPORT_DEFAULT_FN]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      const name = match[1] ?? componentNameFromPath(filePath);
      const kind: SymbolKind =
        re === EXPORT_CLASS
          ? "class"
          : re === EXPORT_TYPE
            ? "interface"
            : filePath.includes("/app/") || filePath.includes("/pages/")
              ? "component"
              : "function";
      const head = match[0].split("\n")[0]?.trim();
      symbols.push(
        buildSymbol({
          name,
          kind,
          line: lineOf(content, match.index),
          exported: true,
          ...(head ? { signature: head } : {}),
        }),
      );
    }
  }

  if (/export\s+default/.test(content) && !symbols.some((s) => s.name === componentNameFromPath(filePath))) {
    symbols.push({
      name: componentNameFromPath(filePath),
      kind: filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? "component" : "const",
      line: lineOf(content, content.indexOf("export default")),
      exported: true,
    });
  }

  let importMatch: RegExpExecArray | null;
  while ((importMatch = IMPORT_RE.exec(content))) {
    const spec = importMatch[1];
    if (!spec) continue;
    imports.push(spec);
    const line = lineOf(content, importMatch.index);
    const clause = importMatch[0];
    const named = /\{([^}]+)\}/.exec(clause);
    if (named?.[1]) {
      for (const part of named[1].split(",")) {
        const trimmed = part.trim();
        const imported = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (imported) refs.push({ name: imported, line, targetPath: spec });
      }
    }
  }
}

function extractPython(content: string, symbols: ExtractedSymbol[]): void {
  let match: RegExpExecArray | null;
  while ((match = PY_DEF.exec(content))) {
    const exported = (match[1] ?? "").length === 0;
    const fn = match[2];
    if (!fn) continue;
    symbols.push({
      name: fn,
      kind: "function",
      line: lineOf(content, match.index),
      exported,
      signature: `def ${fn}(...`,
    });
  }
  while ((match = PY_CLASS.exec(content))) {
    const cls = match[2];
    if (!cls) continue;
    symbols.push({
      name: cls,
      kind: "class",
      line: lineOf(content, match.index),
      exported: (match[1] ?? "").length === 0,
    });
  }
}

function extractGo(content: string, symbols: ExtractedSymbol[]): void {
  let match: RegExpExecArray | null;
  while ((match = GO_FUNC.exec(content))) {
    const fn = match[1];
    if (!fn) continue;
    const exported = fn[0] === fn[0]!.toUpperCase();
    symbols.push({
      name: fn,
      kind: "function",
      line: lineOf(content, match.index),
      exported,
    });
  }
  while ((match = GO_TYPE.exec(content))) {
    const typ = match[1];
    if (!typ) continue;
    const exported = typ[0] === typ[0]!.toUpperCase();
    symbols.push({
      name: typ,
      kind: "type",
      line: lineOf(content, match.index),
      exported,
    });
  }
}

function extractSql(content: string, symbols: ExtractedSymbol[]): void {
  let match: RegExpExecArray | null;
  while ((match = SQL_TABLE.exec(content))) {
    const table = match[1];
    if (!table) continue;
    symbols.push({
      name: table,
      kind: "sql_table",
      line: lineOf(content, match.index),
      exported: true,
    });
  }
}

function extractFallbackImports(content: string, imports: string[], refs: ExtractedRef[]): void {
  let match: RegExpExecArray | null;
  while ((match = FALLBACK_IMPORT.exec(content))) {
    const spec = match[1];
    if (!spec) continue;
    imports.push(spec);
    refs.push({ name: path.basename(spec).replace(/\.[^.]+$/, ""), line: lineOf(content, match.index) });
  }
}