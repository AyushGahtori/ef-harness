import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { StaticAuditAstEngine, parseNameStatusZ, parseNumstatZ } from "../../src/ast-scanners/index.js";
import { MARKER_TODO, createContext, ruleIds } from "./support.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ast-scanners git diff", () => {
  it("parses name-status and numstat records", () => {
    expect(parseNameStatusZ("A\0src/a.ts\0M\0src/b.ts\0D\0src/c.ts\0")).toEqual([
      { status: "A", path: "src/a.ts" },
      { status: "M", path: "src/b.ts" },
      { status: "D", path: "src/c.ts" },
    ]);
    expect(parseNameStatusZ("R100\0src/old.ts\0src/new.ts\0")).toEqual([
      { status: "M", path: "src/new.ts", oldPath: "src/old.ts" },
    ]);
    expect(parseNumstatZ("8\t2\tsrc/{old.ts => new.ts}\0")).toEqual(
      new Map([["src/new.ts", { additions: 8, deletions: 2 }]]),
    );
  });

  it("scans only the candidate diff from git", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ef-static-audit-"));
    directories.push(directory);
    await runGit(directory, ["init", "-b", "main"]);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(path.join(directory, "src", "unchanged.ts"), `// ${MARKER_TODO}: leave me\nexport const same = true;\n`, "utf8");
    await writeFile(path.join(directory, "src", "changed.ts"), "export const value = 1;\n", "utf8");
    await runGit(directory, ["add", "."]);
    await commit(directory, "base");
    await writeFile(
      path.join(directory, "src", "changed.ts"),
      `export const value = 1;\n// ${MARKER_TODO}: handle error\n`,
      "utf8",
    );
    await runGit(directory, ["add", "."]);
    await commit(directory, "candidate");

    const report = await new StaticAuditAstEngine().audit({
      repoRoot: directory,
      baseRef: "HEAD~1",
      candidateRef: "HEAD",
      auditContext: createContext(),
    });
    expect(report.filesScanned).toEqual(["src/changed.ts"]);
    expect(ruleIds(report)).toContain("unfinished-marker");
    expect(report.hardFindings.every((finding) => finding.file === "src/changed.ts")).toBe(true);
  });
});

function commit(cwd: string, message: string): Promise<void> {
  return runGit(cwd, [
    "-c",
    "user.name=EF Harness",
    "-c",
    "user.email=foundation@ef-harness.local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    message,
  ]);
}

function runGit(cwd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "EF Harness",
        GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
        GIT_COMMITTER_NAME: "EF Harness",
        GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `git ${args.join(" ")} failed`));
    });
  });
}
