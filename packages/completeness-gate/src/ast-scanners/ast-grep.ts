import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AstGrepMatch, AstGrepRule, AstGrepRunner, AstGrepScanResult } from "./types.js";

export const STATIC_AUDIT_AST_GREP_RULES: readonly AstGrepRule[] = [
  {
    id: "py-except-binding-pass",
    language: "python",
    pattern: "except $ERR:\n    pass",
    ruleId: "swallowed-error",
    message: "Empty except swallows an error.",
    remediation: "Surface, rethrow, or return a structured error.",
    contractSymbolOnly: false,
  },
  {
    id: "py-bare-except-pass",
    language: "python",
    pattern: "except:\n    pass",
    ruleId: "swallowed-error",
    message: "Bare except swallows every error.",
    remediation: "Catch the specific error and surface it.",
    contractSymbolOnly: false,
  },
  {
    id: "py-return-none",
    language: "python",
    pattern: "def $NAME($$$ARGS):\n    return None",
    ruleId: "stub-body",
    message: "Function returns None.",
    remediation: "Implement the contract operation unless the contract declares this return.",
    contractSymbolOnly: true,
  },
  {
    id: "go-empty-err",
    language: "go",
    pattern: "if err != nil { }",
    ruleId: "swallowed-error",
    message: "Empty err check swallows the error.",
    remediation: "Return or wrap the error.",
    contractSymbolOnly: false,
  },
  {
    id: "go-return-nil",
    language: "go",
    pattern: "func $NAME($$$) $RET {\n  return nil\n}",
    ruleId: "stub-body",
    message: "Function returns nil.",
    remediation: "Implement the contract operation unless the contract declares this return.",
    contractSymbolOnly: true,
  },
  {
    id: "rust-empty-err",
    language: "rust",
    pattern: "if let Err(_) = $EXPR { }",
    ruleId: "swallowed-error",
    message: "Empty Err branch swallows the error.",
    remediation: "Propagate the error with ? or return it.",
    contractSymbolOnly: false,
  },
  {
    id: "rust-todo-macro",
    language: "rust",
    pattern: "fn $NAME($$$) {\n  todo!()\n}",
    ruleId: "stub-body",
    message: "Function body is an unfinished macro.",
    remediation: "Replace the unfinished macro with the real implementation.",
    contractSymbolOnly: true,
  },
];

export function createProcessAstGrepRunner(): AstGrepRunner {
  return {
    async scan(input): Promise<AstGrepScanResult> {
      const binary = await resolveAstGrep();
      if (!binary) return { available: false, matches: [] };
      const directory = await mkdtemp(path.join(tmpdir(), "ef-ast-grep-"));
      try {
        const filePath = path.join(directory, path.basename(input.path) || "source.txt");
        await writeFile(filePath, input.source, "utf8");
        const matches: AstGrepMatch[] = [];
        let parsed = false;
        for (const rule of input.rules) {
          if (rule.language !== input.language) continue;
          const result = await run(binary, ["run", "-p", rule.pattern, "-l", input.language, "--json=stream", filePath]);
          if (result.code === 127) return { available: false, matches: [] };
          const parsedMatches = parseAstGrepJson(result.stdout, rule);
          if (parsedMatches) {
            parsed = true;
            matches.push(...parsedMatches);
          }
        }
        return parsed ? { available: true, matches } : { available: false, matches: [] };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

let binaryPromise: Promise<string | null> | undefined;

function resolveAstGrep(): Promise<string | null> {
  binaryPromise ??= (async () => {
    for (const candidate of ["ast-grep", "sg"]) {
      const result = await run(candidate, ["--version"]);
      if (result.code === 0) return candidate;
    }
    return null;
  })();
  return binaryPromise;
}

function parseAstGrepJson(stdout: string, rule: AstGrepRule): AstGrepMatch[] | null {
  const matches: AstGrepMatch[] = [];
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        start?: { line?: number; column?: number };
        range?: { start?: { line?: number; column?: number } };
        text?: string;
        lines?: string;
      };
      const position = parsed.start ?? parsed.range?.start;
      matches.push({
        ruleId: rule.ruleId,
        line: (position?.line ?? 0) + 1,
        column: (position?.column ?? 0) + 1,
        snippet: (parsed.text ?? parsed.lines ?? rule.pattern).replace(/\s+/g, " ").trim().slice(0, 240),
        message: rule.message,
        remediation: rule.remediation,
      });
    } catch {
      return null;
    }
  }
  return matches;
}

function run(command: string, args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { shell: false, windowsHide: true });
    const stdout: Buffer[] = [];
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8") });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(124);
    }, 8_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      finish(127);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}
