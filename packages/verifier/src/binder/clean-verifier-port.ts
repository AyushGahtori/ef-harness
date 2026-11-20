import ts from "typescript";
import { CleanRunError } from "./errors.js";
import type { CleanFailureClass } from "./errors.js";

const VIRTUAL_ROOT = "C:/ef-harness-clean/";

export interface CleanVerifierPort {
  invoke(input: {
    files: Readonly<Record<string, string>>;
    modulePath: string;
    exportName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

export interface CompileSuccess {
  ok: true;
  emitted: ReadonlyMap<string, string>;
}

export interface CompileFailure {
  ok: false;
  classification: CleanFailureClass;
  message: string;
}

export type CompileResult = CompileSuccess | CompileFailure;

/**
 * In-memory clean tree. Local port of Task 060 `CleanVerifierRunner` execution:
 * typecheck the materialized base or candidate, then call one export outside the
 * worker process. Swap this for a real clean worktree when Task 060 is wired.
 */
export class InProcessCleanVerifierPort implements CleanVerifierPort {
  async invoke(input: {
    files: Readonly<Record<string, string>>;
    modulePath: string;
    exportName: string;
    args: readonly unknown[];
  }): Promise<unknown> {
    const compiled = compileCleanTree(input.files);
    if (!compiled.ok) {
      throw new CleanRunError(compiled.classification, compiled.message);
    }
    const jsFile = virtualJs(input.modulePath);
    const exports = loadCommonJs(compiled.emitted, jsFile);
    const exported = exports[input.exportName];
    if (typeof exported !== "function") {
      throw new CleanRunError(
        "binder_crash",
        `Export ${input.exportName} is not a function in ${input.modulePath}`,
      );
    }
    const called = (exported as (...args: unknown[]) => unknown)(...input.args);
    return called;
  }
}

export function compileCleanTree(files: Readonly<Record<string, string>>): CompileResult {
  const virtualFiles = new Map<string, string>();
  for (const [file, contents] of Object.entries(files)) {
    virtualFiles.set(virtualPath(file), rewriteSpecifiers(contents));
  }
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    rootDir: virtualRootNoSlash(),
    noEmitOnError: false,
  };
  const defaultHost = ts.createCompilerHost(options);
  const host = createHost(virtualFiles, defaultHost);
  const program = ts.createProgram({
    rootNames: [...virtualFiles.keys()],
    options,
    host,
  });
  const syntactic = program
    .getSyntacticDiagnostics()
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error && isRelevant(diagnostic));
  if (syntactic.length > 0) {
    return {
      ok: false,
      classification: "syntax",
      message: syntactic.map(diagnosticText).join("\n"),
    };
  }
  const semantic = [...program.getSemanticDiagnostics(), ...program.getOptionsDiagnostics()].filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error && isRelevant(diagnostic),
  );
  if (semantic.length > 0) {
    return {
      ok: false,
      classification: classifySemantic(semantic),
      message: semantic.map(diagnosticText).join("\n"),
    };
  }
  const emitted = new Map<string, string>();
  const emitResult = program.emit(undefined, (fileName, text) => {
    if (fileName.endsWith(".js")) {
      emitted.set(fileName.replaceAll("\\", "/"), text);
    }
  });
  const emitErrors = emitResult.diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error && isRelevant(diagnostic),
  );
  if (emitErrors.length > 0) {
    return {
      ok: false,
      classification: classifySemantic(emitErrors),
      message: emitErrors.map(diagnosticText).join("\n"),
    };
  }
  return { ok: true, emitted };
}

function createHost(
  files: ReadonlyMap<string, string>,
  defaultHost: ts.CompilerHost,
): ts.CompilerHost {
  return {
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const normalized = fileName.replaceAll("\\", "/");
      const text = files.get(normalized);
      if (text !== undefined) {
        return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
    getDefaultLibFileName: (compilerOptions) => defaultHost.getDefaultLibFileName(compilerOptions),
    writeFile: () => {
      return undefined;
    },
    getCurrentDirectory: () => virtualRootNoSlash(),
    getCanonicalFileName: (fileName) => fileName.replaceAll("\\", "/"),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => {
      const normalized = fileName.replaceAll("\\", "/");
      if (files.has(normalized)) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      const normalized = fileName.replaceAll("\\", "/");
      const text = files.get(normalized);
      if (text !== undefined) return text;
      return defaultHost.readFile(fileName);
    },
    directoryExists: (dir) => {
      const normalized = dir.replaceAll("\\", "/").replace(/\/$/, "");
      const root = virtualRootNoSlash();
      if (normalized === root || normalized.startsWith(`${root}/`)) {
        for (const file of files.keys()) {
          if (file === normalized || file.startsWith(`${normalized}/`)) return true;
        }
        return false;
      }
      return defaultHost.directoryExists?.(dir) ?? false;
    },
  };
}

function loadCommonJs(emitted: ReadonlyMap<string, string>, entry: string): Record<string, unknown> {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const load = (fileJs: string): Record<string, unknown> => {
    const normalized = fileJs.replaceAll("\\", "/");
    const cached = cache.get(normalized);
    if (cached) return cached.exports;
    const source = lookupEmitted(emitted, normalized);
    if (source === undefined) {
      throw new CleanRunError("module_not_found", `Cannot find module '${normalized}'`);
    }
    const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
    cache.set(normalized, moduleRecord);
    const localRequire = (spec: string): Record<string, unknown> => {
      if (!spec.startsWith(".")) {
        const error = new Error(`Cannot find module '${spec}'`) as Error & { code: string };
        error.code = "MODULE_NOT_FOUND";
        throw error;
      }
      const resolved = resolveJs(normalized, spec);
      return load(resolved);
    };
    const dirname = normalized.slice(0, normalized.lastIndexOf("/"));
    const runner = new Function(
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
      source,
    ) as (
      exports: Record<string, unknown>,
      require: (spec: string) => Record<string, unknown>,
      module: { exports: Record<string, unknown> },
      filename: string,
      dirname: string,
    ) => void;
    runner(moduleRecord.exports, localRequire, moduleRecord, normalized, dirname);
    return moduleRecord.exports;
  };
  return load(entry);
}

function resolveJs(fromJs: string, spec: string): string {
  const dir = fromJs.slice(0, fromJs.lastIndexOf("/"));
  const joined = `${dir}/${spec}`.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  let file = parts.join("/");
  if (!file.startsWith("C:")) file = `C:/${file}`;
  if (!file.endsWith(".js")) file = `${file}.js`;
  return file;
}

function virtualPath(rel: string): string {
  return `${VIRTUAL_ROOT}${rel.replaceAll("\\", "/").replace(/^\.?\//, "")}`;
}

function virtualJs(rel: string): string {
  const file = virtualPath(rel).replace(/\.(tsx|ts|mts|cts)$/, "");
  return file.endsWith(".js") ? file : `${file}.js`;
}

function virtualRootNoSlash(): string {
  return VIRTUAL_ROOT.replace(/\/$/, "");
}

function rewriteSpecifiers(source: string): string {
  return source.replace(
    /(from\s+["']|import\s*\(\s*["']|require\(\s*["'])(\.\.?\/[^"']+?)\.js(["'])/g,
    "$1$2$3",
  );
}

function lookupEmitted(emitted: ReadonlyMap<string, string>, file: string): string | undefined {
  const direct = emitted.get(file);
  if (direct !== undefined) return direct;
  const wanted = file.toLowerCase();
  for (const [key, value] of emitted) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function isRelevant(diagnostic: ts.Diagnostic): boolean {
  if (!diagnostic.file) return true;
  const file = diagnostic.file.fileName.replaceAll("\\", "/").toLowerCase();
  return file.startsWith(VIRTUAL_ROOT.toLowerCase());
}

function classifySemantic(diagnostics: readonly ts.Diagnostic[]): CleanFailureClass {
  const texts = diagnostics.map(diagnosticText);
  if (texts.some((text) => /cannot find module/i.test(text) || /ERR_MODULE_NOT_FOUND/.test(text))) {
    return "module_not_found";
  }
  return "typescript";
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const file = diagnostic.file.fileName.replaceAll("\\", "/");
  return `${file}:${pos.line + 1}:${pos.character + 1} ${message}`;
}
