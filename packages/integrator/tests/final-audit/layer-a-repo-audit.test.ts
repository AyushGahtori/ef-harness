import { describe, expect, it } from "vitest";

import { DeterministicRepoAuditor } from "../../src/final-audit/deterministic-repo-auditor.js";
import { cleanSnapshot, liveSecret, marker, passingCases } from "./support.js";

const auditor = new DeterministicRepoAuditor({ fixCostUnits: 1n });

describe("layer A deterministic repo audit", () => {
  it("passes a clean tree with zero model tokens and records build, typecheck, lint, and the combined suite", async () => {
    const commands: string[] = [];
    const snapshot = cleanSnapshot();
    snapshot.files.push({
      path: "src/deferral.ts",
      content: `export const kept = true;\n// ${marker("todo")}(DEF-12) approved deferral\n`,
    });
    const report = await auditor.auditAll(
      snapshot,
      {
        async run(check) {
          commands.push(check);
          return { passed: true, detail: "ok" };
        },
      },
      {
        async runCombined() {
          return { passed: true, cases: passingCases() };
        },
      },
    );
    expect(report.llmTokens).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
    expect(commands).toEqual(["production_build", "typecheck", "lint"]);
    expect(report.suiteCases.map((item) => item.kind).sort()).toEqual(["feature_journey", "leaf", "sealed_hidden"]);
    expect(report.checks.every((check) => check.llmTokens === 0)).toBe(true);
  });

  it("flags marker, stub, mock, dead route, orphan handler, unused export, broken import, secret, migration, and env gaps", async () => {
    const snapshot = cleanSnapshot();
    const nav = snapshot.files.find((file) => file.path === "src/nav.ts");
    if (!nav) throw new Error("missing nav");
    nav.content = "export const links = [{ href: \"/orders\" }, { href: \"/print\" }];\n";
    const mod = snapshot.files.find((file) => file.path === "src/mod.ts");
    if (!mod) throw new Error("missing mod");
    mod.content = "export function used() { return 1; }\nexport function unused() { return 2; }\n";
    snapshot.files.push(
      { path: "src/handlers/print.ts", content: "export function handlePrint() { return 0; }\n" },
      { path: "src/leak.ts", content: `export const pending = 1;\n// ${marker("todo")} ship this\n// ${marker("fix")} later\n` },
      { path: "src/stub.ts", content: "export function save() { throw new Error(\"not implemented\"); }\n" },
      { path: "src/mocked.ts", content: "vi.mock(\"./mod\");\nexport const mocked = true;\n" },
      { path: "src/broken.ts", content: "import { missing } from \"./missing\";\nexport const broken = missing;\n" },
      { path: "src/pay.ts", content: `export const key = "${liveSecret()}";\n` },
      { path: "migrations/002_drop.sql", content: "DROP TABLE orders;\n" },
      { path: "src/env.ts", content: "export const origin = process.env.APP_ORIGIN;\n" },
    );
    const report = await auditor.auditAll(
      snapshot,
      { async run() { return { passed: true, detail: "ok" }; } },
      { async runCombined() { return { passed: true, cases: passingCases() }; } },
    );
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining([
      "marker-leak",
      "stub-leak",
      "mock-leak",
      "dead-route",
      "orphan-handler",
      "unused-export",
      "broken-import",
      "secret",
      "migration-dirty",
      "env-example-gap",
    ]));
    expect(report.passed).toBe(false);
    expect(report.llmTokens).toBe(0);
    expect(report.findings.find((finding) => finding.code === "dead-route")?.detail).toContain("/print");
    expect(report.findings.find((finding) => finding.code === "secret")?.detail).toContain("src/pay.ts");
  });
});
