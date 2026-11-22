import ts from "typescript";
import { TestWeakeningError } from "./errors.js";

const SKIP_LINE = /\.(?:skip|only)\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/;
const ASSERT_LINE = /\b(?:expect|assert(?:\.\w+)?)\s*\(/;

export function isTestPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/sealed/")
  );
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

interface AstFacts {
  readonly assertions: number;
  readonly skips: number;
  readonly onlys: number;
}

function astFacts(filePath: string, text: string): AstFacts {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
  let assertions = 0;
  let skips = 0;
  let onlys = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (name === "expect" || name === "assert" || name.startsWith("assert.")) assertions += 1;
      if (name.endsWith(".skip") || name === "xit" || name === "xtest" || name === "xdescribe") skips += 1;
      if (name.endsWith(".only")) onlys += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { assertions, skips, onlys };
}

function addedLines(before: string, after: string): string[] {
  const beforeCounts = new Map<string, number>();
  for (const line of splitLines(before)) {
    beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of splitLines(after)) {
    const remaining = beforeCounts.get(line) ?? 0;
    if (remaining > 0) beforeCounts.set(line, remaining - 1);
    else added.push(line);
  }
  return added;
}

function removedLines(before: string, after: string): string[] {
  const afterCounts = new Map<string, number>();
  for (const line of splitLines(after)) {
    afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
  }
  const removed: string[] = [];
  for (const line of splitLines(before)) {
    const remaining = afterCounts.get(line) ?? 0;
    if (remaining > 0) afterCounts.set(line, remaining - 1);
    else removed.push(line);
  }
  return removed;
}

/** AST and diff guard. project-integrator@1 cannot skip, exclusive-run, or delete passing assertions. */
export function assertNoTestWeakening(
  before: readonly { path: string; text: string }[],
  after: readonly { path: string; text: string }[],
): void {
  const afterMap = new Map(after.map((file) => [file.path.replaceAll("\\", "/"), file.text]));
  for (const file of before) {
    const path = file.path.replaceAll("\\", "/");
    if (!isTestPath(path)) continue;
    const next = afterMap.get(path);
    if (next === undefined) {
      throw new TestWeakeningError(path, "deleted_test", "feature test or sealed check was deleted");
    }
    if (next === file.text) continue;
    for (const line of addedLines(file.text, next)) {
      if (/\.skip\s*\(/.test(line) || /\bxit\s*\(/.test(line) || /\bxdescribe\s*\(/.test(line) || /\bxtest\s*\(/.test(line)) {
        throw new TestWeakeningError(path, "skip", line.trim());
      }
      if (/\.only\s*\(/.test(line)) {
        throw new TestWeakeningError(path, "only", line.trim());
      }
    }
    for (const line of removedLines(file.text, next)) {
      if (ASSERT_LINE.test(line) && !splitLines(next).includes(line)) {
        throw new TestWeakeningError(path, "deleted_assertion", line.trim());
      }
    }
    const beforeAst = astFacts(path, file.text);
    const afterAst = astFacts(path, next);
    if (afterAst.skips > beforeAst.skips) {
      throw new TestWeakeningError(path, "skip", "AST gained a skipped test");
    }
    if (afterAst.onlys > beforeAst.onlys) {
      throw new TestWeakeningError(path, "only", "AST gained an exclusive test");
    }
    if (afterAst.assertions < beforeAst.assertions) {
      throw new TestWeakeningError(path, "deleted_assertion", "assertion call count decreased");
    }
  }
  for (const file of after) {
    const path = file.path.replaceAll("\\", "/");
    if (!isTestPath(path)) continue;
    if (before.some((item) => item.path.replaceAll("\\", "/") === path)) continue;
    if (SKIP_LINE.test(file.text)) {
      const reason = /\.only\s*\(/.test(file.text) ? "only" : "skip";
      throw new TestWeakeningError(path, reason, "new test file contains skip or only");
    }
  }
}
