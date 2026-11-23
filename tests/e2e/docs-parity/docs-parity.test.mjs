import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DocsAndSchemaParitySuite } from "./DocsAndSchemaParitySuite.mjs";

const repoRoot = DocsAndSchemaParitySuite.defaultRoot();
const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempFixture(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ef-docs-parity-${name}-`));
  tempRoots.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("DocsAndSchemaParitySuite", () => {
  it("passes all positive parity checks on the real workspace", () => {
    const suite = new DocsAndSchemaParitySuite(repoRoot);
    const started = performance.now();
    const result = suite.runAll();
    const elapsed = (performance.now() - started) / 1000;
    expect(result.ok, DocsAndSchemaParitySuite.formatIssues(result.issues)).toBe(true);
    expect(elapsed).toBeLessThan(5);
    const cli = suite.runCli();
    expect(cli.ok, cli.stderr || cli.stdout).toBe(true);
  });

  it("detects a broken internal markdown link", () => {
    const root = makeTempFixture("broken-link", {
      "broken.md": "[see foo](missing-doc.md)\n",
    });
    const suite = new DocsAndSchemaParitySuite(root);
    const result = suite.runCheck("links");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("missing-doc.md"))).toBe(true);
  });

  it("detects stale resume-changer benchmark pins", () => {
    const root = makeTempFixture("benchmark", {
      "resume-changer-benchmark.json": JSON.stringify({
        commit: "0000000000000000000000000000000000000000",
        summary: { markdown_files: 1, plan_or_task_files: 1, plan_or_task_lines: 1 },
      }),
    });
    const suite = new DocsAndSchemaParitySuite(root);
    const result = suite.runCheck("benchmark");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("commit pin"))).toBe(true);
  });

  it("detects missing prompt contracts in docs", () => {
    const root = makeTempFixture("missing-contract", {
      "prompt-contracts.md": "# contracts\n\n`router@1` only\n",
      "v1-knowledge-corpus.md": fs.readFileSync(path.join(repoRoot, "v1-knowledge-corpus.md"), "utf8"),
    });
    const suite = new DocsAndSchemaParitySuite(root);
    const result = suite.runCheck("contract");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("32 prompt contracts"))).toBe(true);
  });

  it("detects forbidden owner-decision policy regressions in packages", () => {
    const forbidden = ["anti", "gravity"].join("");
    const root = makeTempFixture("policy", {
      "packages/demo/src/index.ts": `export const provider = '${forbidden}';\n`,
      "prompt-contracts.md": fs.readFileSync(path.join(repoRoot, "prompt-contracts.md"), "utf8"),
      "v1-knowledge-corpus.md": fs.readFileSync(path.join(repoRoot, "v1-knowledge-corpus.md"), "utf8"),
    });
    const suite = new DocsAndSchemaParitySuite(root);
    const result = suite.runCheck("policy");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.toLowerCase().includes(forbidden))).toBe(true);
  });
});