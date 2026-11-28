import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Language, Parser as ParserClass } from "web-tree-sitter";

export interface LoadedGrammars {
  readonly javascript: Language;
  readonly typescript: Language;
  readonly tsx: Language;
}

let initPromise: Promise<LoadedGrammars | null> | undefined;
let parserCtor: typeof ParserClass | undefined;

export function grammarCandidates(fileName: string): readonly string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromPackage = [
    path.join(here, "grammars", fileName),
    path.join(here, "..", "grammars", fileName),
    path.join(here, "..", "..", "dist", "grammars", fileName),
    path.join(here, "..", "..", "grammars", fileName),
  ];
  return fromPackage;
}

export function resolveGrammarWasm(fileName: string): string | null {
  for (const candidate of grammarCandidates(fileName)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function ensureWebTreeSitterInitialized(): Promise<boolean> {
  const loaded = await loadGrammars();
  return loaded !== null;
}

export async function loadGrammars(): Promise<LoadedGrammars | null> {
  if (!initPromise) initPromise = loadGrammarsOnce();
  return initPromise;
}

export async function createWasmParser(): Promise<{
  readonly Parser: typeof ParserClass;
  readonly grammars: LoadedGrammars;
} | null> {
  const grammars = await loadGrammars();
  if (!grammars || !parserCtor) return null;
  return { Parser: parserCtor, grammars };
}

async function loadGrammarsOnce(): Promise<LoadedGrammars | null> {
  const javascriptPath = resolveGrammarWasm("tree-sitter-javascript.wasm");
  const typescriptPath = resolveGrammarWasm("tree-sitter-typescript.wasm");
  const tsxPath = resolveGrammarWasm("tree-sitter-tsx.wasm");
  if (!javascriptPath || !typescriptPath || !tsxPath) return null;
  try {
    const mod = (await import("web-tree-sitter")) as typeof import("web-tree-sitter");
    await mod.Parser.init();
    parserCtor = mod.Parser;
    const [javascript, typescript, tsx] = await Promise.all([
      mod.Language.load(javascriptPath),
      mod.Language.load(typescriptPath),
      mod.Language.load(tsxPath),
    ]);
    return { javascript, typescript, tsx };
  } catch {
    return null;
  }
}
