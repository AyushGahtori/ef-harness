import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

export const MUTATION_OPERATORS = [
  "flip_comparison",
  "invert_role_guard",
  "drop_role_guard",
  "empty_boundary_return",
] as const;

export type MutationOperator = (typeof MUTATION_OPERATORS)[number];

export type KillReason = "failed_check" | "timeout" | "compile_error" | "runner_error" | null;

export interface BoundaryProbeRequest {
  readonly checkoutDir: string;
  readonly relativeFile: string;
  readonly acceptanceEntry: string;
  readonly baselineMs: number;
  readonly maxTimeoutMs?: number;
  readonly operators?: readonly MutationOperator[];
}

export interface MutantResult {
  readonly id: string;
  readonly operator: MutationOperator;
  readonly description: string;
  readonly relativeFile: string;
  readonly mutatedSource: string;
  readonly killed: boolean;
  readonly survived: boolean;
  readonly timedOut: boolean;
  readonly killReason: KillReason;
  readonly exitCode: number | null;
  readonly syntaxOk: boolean;
}

export interface WeakCheckGap {
  readonly mutantId: string;
  readonly operator: MutationOperator;
  readonly relativeFile: string;
  readonly description: string;
  readonly routeTo: "oracle-author@1";
}

export interface BoundaryProbeReport {
  readonly mutants: readonly MutantResult[];
  readonly surviving: readonly MutantResult[];
  readonly weakCheckGaps: readonly WeakCheckGap[];
  readonly deletedScratchDirectories: readonly string[];
  readonly checkoutUntouched: boolean;
  readonly timeoutMs: number;
}

interface MutationSite {
  readonly operator: MutationOperator;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly description: string;
}

const BOUNDARY_NAMES = new Set([
  "cutoff",
  "limit",
  "threshold",
  "capacity",
  "deadline",
  "boundary",
  "n",
  "length",
  "max",
  "min",
]);

export function mutantTimeoutMs(baselineMs: number, maxTimeoutMs = 10_000): number {
  if (!Number.isFinite(baselineMs) || baselineMs < 0) {
    throw new Error("baselineMs must be a non-negative finite number");
  }
  if (!Number.isFinite(maxTimeoutMs) || maxTimeoutMs < 1) {
    throw new Error("maxTimeoutMs must be a positive finite number");
  }
  return Math.min(baselineMs * 3, maxTimeoutMs);
}

export class TargetedBoundaryMutationProber {
  async probe(request: BoundaryProbeRequest): Promise<BoundaryProbeReport> {
    const timeoutMs = mutantTimeoutMs(request.baselineMs, request.maxTimeoutMs ?? 10_000);
    const relativeFile = normalizeRelative(request.relativeFile);
    const acceptanceEntry = normalizeRelative(request.acceptanceEntry);
    const checkoutFile = path.resolve(request.checkoutDir, relativeFile);
    const before = await readFile(checkoutFile);
    const source = before.toString("utf8");
    const operators = new Set<MutationOperator>(request.operators ?? MUTATION_OPERATORS);
    const sites = collectSites(source, relativeFile, operators);
    const mutants: MutantResult[] = [];
    const deletedScratchDirectories: string[] = [];
    for (const site of sites) {
      const mutatedSource = `${source.slice(0, site.start)}${site.replacement}${source.slice(site.end)}`;
      const outcome = await runOneMutant({
        checkoutDir: request.checkoutDir,
        relativeFile,
        acceptanceEntry,
        mutatedSource,
        timeoutMs,
        site,
      });
      mutants.push(outcome.mutant);
      deletedScratchDirectories.push(outcome.scratch);
    }
    const after = await readFile(checkoutFile);
    const surviving = mutants.filter((mutant) => mutant.survived);
    return {
      mutants,
      surviving,
      weakCheckGaps: surviving.map((mutant) => ({
        mutantId: mutant.id,
        operator: mutant.operator,
        relativeFile,
        description: mutant.description,
        routeTo: "oracle-author@1",
      })),
      deletedScratchDirectories,
      checkoutUntouched: before.equals(after),
      timeoutMs,
    };
  }
}

async function runOneMutant(input: {
  readonly checkoutDir: string;
  readonly relativeFile: string;
  readonly acceptanceEntry: string;
  readonly mutatedSource: string;
  readonly timeoutMs: number;
  readonly site: MutationSite;
}): Promise<{ mutant: MutantResult; scratch: string }> {
  const scratch = await mkdtemp(path.join(tmpdir(), "ef-boundary-mutant-"));
  const scratchRoot = path.resolve(scratch);
  try {
    if (!isInside(tmpdir(), scratchRoot) || path.resolve(input.checkoutDir) === scratchRoot) {
      throw new Error("scratch copy must stay in a disposable temp directory");
    }
    await copyTree(input.checkoutDir, scratchRoot);
    const target = path.resolve(scratchRoot, input.relativeFile);
    if (!isInside(scratchRoot, target)) throw new Error("mutation path escaped the scratch copy");
    await writeFile(target, input.mutatedSource);
    const syntaxOk = syntaxErrorCount(input.mutatedSource, input.relativeFile) === 0;
    if (!syntaxOk) {
      return { scratch: scratchRoot, mutant: mutantResult(input, syntaxOk, null, false, "compile_error") };
    }
    const transpiled = ts.transpileModule(input.mutatedSource, {
      fileName: input.relativeFile,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        strict: false,
        sourceMap: false,
      },
    });
    const diagnostics = transpiled.diagnostics ?? [];
    const compileErrors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (compileErrors.length > 0) {
      return { scratch: scratchRoot, mutant: mutantResult(input, false, null, false, "compile_error") };
    }
    const emittedRelative = input.relativeFile.replace(/\.(tsx|mts|cts|ts)$/, "") + ".mjs";
    const emitted = path.resolve(scratchRoot, emittedRelative);
    if (!isInside(scratchRoot, emitted)) throw new Error("emitted module escaped the scratch copy");
    await mkdir(path.dirname(emitted), { recursive: true });
    await writeFile(emitted, transpiled.outputText);
    const entry = path.resolve(scratchRoot, input.acceptanceEntry);
    if (!isInside(scratchRoot, entry)) throw new Error("acceptance entry escaped the scratch copy");
    const outcome = await runNode(entry, scratchRoot, input.timeoutMs);
    if (outcome.timedOut) {
      return { scratch: scratchRoot, mutant: mutantResult(input, true, null, true, "timeout") };
    }
    if (outcome.code !== 0) {
      return { scratch: scratchRoot, mutant: mutantResult(input, true, outcome.code, false, "failed_check") };
    }
    return { scratch: scratchRoot, mutant: mutantResult(input, true, 0, false, null) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scratch: scratchRoot,
      mutant: {
        ...mutantResult(input, syntaxErrorCount(input.mutatedSource, input.relativeFile) === 0, null, false, "runner_error"),
        description: `${input.site.description} (${message})`,
      },
    };
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

function mutantResult(
  input: {
    readonly relativeFile: string;
    readonly mutatedSource: string;
    readonly site: MutationSite;
  },
  syntaxOk: boolean,
  exitCode: number | null,
  timedOut: boolean,
  killReason: KillReason,
): MutantResult {
  const survived = killReason === null && exitCode === 0 && !timedOut && syntaxOk;
  return {
    id: `${input.site.operator}:${input.site.start}`,
    operator: input.site.operator,
    description: input.site.description,
    relativeFile: input.relativeFile,
    mutatedSource: input.mutatedSource,
    killed: !survived,
    survived,
    timedOut,
    killReason,
    exitCode,
    syntaxOk,
  };
}

function collectSites(source: string, fileName: string, operators: ReadonlySet<MutationOperator>): MutationSite[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: MutationSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && operators.has("flip_comparison")) {
      const replacement = replacementOperator(node.operatorToken.kind);
      if (replacement && (isLoopCondition(node) || hasBoundaryName(node))) {
        const start = node.operatorToken.getStart(sourceFile);
        const end = node.operatorToken.getEnd();
        sites.push({
          operator: "flip_comparison",
          start,
          end,
          replacement,
          description: `flip ${source.slice(start, end)} to ${replacement} in ${fileName}`,
        });
      }
    }
    if (ts.isIfStatement(node) && isRoleCheck(node.expression, sourceFile)) {
      if (operators.has("invert_role_guard")) {
        const start = node.expression.getStart(sourceFile);
        const end = node.expression.getEnd();
        sites.push({
          operator: "invert_role_guard",
          start,
          end,
          replacement: `!(${source.slice(start, end)})`,
          description: `invert role guard in ${fileName}`,
        });
      }
      if (operators.has("drop_role_guard")) {
        sites.push({
          operator: "drop_role_guard",
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          replacement: node.thenStatement.getText(sourceFile),
          description: `drop role guard in ${fileName}`,
        });
      }
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      operators.has("empty_boundary_return") &&
      !isAlreadyEmpty(node.expression) &&
      enclosingBoundaryIf(node)
    ) {
      const expression = node.expression;
      sites.push({
        operator: "empty_boundary_return",
        start: expression.getStart(sourceFile),
        end: expression.getEnd(),
        replacement: emptyTextFor(node),
        description: `return empty on boundary branch in ${fileName}`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

function replacementOperator(kind: ts.SyntaxKind): string | null {
  switch (kind) {
    case ts.SyntaxKind.LessThanToken:
      return "<=";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<";
    case ts.SyntaxKind.GreaterThanToken:
      return ">=";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">";
    default:
      return null;
  }
}

function isLoopCondition(node: ts.Expression): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) return parent.expression === node;
  if (ts.isForStatement(parent)) return parent.condition === node;
  return false;
}

function hasBoundaryName(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && BOUNDARY_NAMES.has(current.text)) found = true;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isRoleCheck(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return /\b(role|hasRole|requireRole|checkRole)\b/.test(expression.getText(sourceFile));
}

function isAlreadyEmpty(expression: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0) return true;
  if (ts.isStringLiteral(expression) && expression.text === "") return true;
  if (ts.isObjectLiteralExpression(expression) && expression.properties.length === 0) return true;
  return false;
}

function enclosingBoundaryIf(node: ts.Node): ts.IfStatement | undefined {
  let current = node.parent;
  while (current) {
    if (ts.isIfStatement(current) && containsBoundaryComparison(current.expression)) return current;
    current = current.parent;
  }
  return undefined;
}

function containsBoundaryComparison(expression: ts.Expression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      replacementOperator(node.operatorToken.kind) &&
      (isLoopCondition(node) || hasBoundaryName(node))
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function emptyTextFor(statement: ts.ReturnStatement): string {
  const declaration = nearestFunction(statement);
  const typeNode = declaration?.type;
  if (typeNode && (ts.isArrayTypeNode(typeNode) || isArrayReference(typeNode))) return "[]";
  if (typeNode?.kind === ts.SyntaxKind.StringKeyword) return '""';
  if (typeNode?.kind === ts.SyntaxKind.NumberKeyword) return "0";
  const expression = statement.expression;
  if (expression && ts.isStringLiteral(expression)) return '""';
  if (expression && ts.isObjectLiteralExpression(expression)) return "{}";
  if (expression && ts.isNumericLiteral(expression)) return "0";
  return "[]";
}

function isArrayReference(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) return false;
  return typeNode.typeName.text === "Array" || typeNode.typeName.text === "ReadonlyArray";
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function syntaxErrorCount(source: string, fileName: string): number {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parsed = sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] };
  return parsed.parseDiagnostics?.length ?? 0;
}

function normalizeRelative(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`path must stay inside the checkout: ${file}`);
  }
  return normalized;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function copyTree(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest);
    } else if (entry.isFile()) {
      await cp(src, dest);
    }
  }
}

function runNode(script: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd,
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    let killedByTimer = false;
    const finish = (code: number | null, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(bail);
      resolve({ code, timedOut });
    };
    const timer = setTimeout(() => {
      killedByTimer = true;
      child.kill();
    }, timeoutMs);
    const bail = setTimeout(() => {
      killedByTimer = true;
      child.kill();
      finish(null, true);
    }, timeoutMs + 1_000);
    child.once("exit", (code) => {
      finish(killedByTimer ? null : code, killedByTimer);
    });
    child.once("error", () => {
      finish(killedByTimer ? null : 1, killedByTimer);
    });
  });
}
