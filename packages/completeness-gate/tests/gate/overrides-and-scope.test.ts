import { describe, expect, it } from "vitest";
import { createCompletenessGateRunner } from "../../src/gate/index.js";
import { added, auditLeaf, makeLeaf, ruleIds } from "./support.js";

describe("human override, integrator scope, and marker false positives", () => {
  const runner = createCompletenessGateRunner();

  it("shows findings and records a developer override, never for a worker", () => {
    const source = `export const sample = { name: "John Doe" };\n`;
    const human = runner.runLeafStaticAudit(
      makeLeaf({
        actor: "human",
        files: [added("src/kitchen/sample.ts", source)],
        entryPoints: ["src/kitchen/sample.ts"],
        humanOverride: {
          signedBy: "developer",
          reason: "Accepted the sample label for the demo landing summary.",
        },
      }),
    );
    expect(human.passed).toBe(true);
    expect(human.overrideApplied).toBe(true);
    expect(ruleIds(human)).toContain("check6.fake-data");
    expect(human.landingSummary).toContain("Accepted the sample label");
    expect(human.receipt.humanOverride?.signedBy).toBe("developer");

    const worker = runner.runLeafStaticAudit(
      makeLeaf({
        actor: "worker",
        files: [added("src/kitchen/sample.ts", source)],
        entryPoints: ["src/kitchen/sample.ts"],
        humanOverride: {
          signedBy: "developer",
          reason: "Accepted the sample label for the demo landing summary.",
        },
      }),
    );
    expect(worker.passed).toBe(false);
    expect(worker.overrideApplied).toBe(false);
    expect(ruleIds(worker)).toContain("check.override-forbidden");
  });

  it("runs integrator commits through the same gate", () => {
    const outside = auditLeaf({
      actor: "integrator",
      files: [added("src/billing/extra.ts", `export const extra = 1;\n`)],
      entryPoints: ["src/billing/extra.ts"],
      declaredSharedFiles: ["src/index.ts"],
      integratorConflictHunks: [{ file: "src/kitchen/group.ts", startLine: 1, endLine: 20 }],
    });
    expect(ruleIds(outside)).toContain("check11.out-of-scope");

    const marker = ["TO", "DO"].join("");
    const inside = auditLeaf({
      actor: "integrator",
      files: [added("src/index.ts", `export const extra = 1;\n// ${marker}: later\n`)],
      entryPoints: ["src/index.ts"],
      declaredSharedFiles: ["src/index.ts"],
    });
    expect(inside.passed).toBe(false);
    expect(ruleIds(inside)).toContain("ast.marker");

    const inHunk = auditLeaf({
      actor: "integrator",
      files: [
        {
          path: "src/kitchen/group.ts",
          status: "modified",
          beforeText: "export const a = 1;\nexport const b = 2;\n",
          afterText: "export const a = 1;\nexport const b = 3;\n",
        },
      ],
      entryPoints: ["src/kitchen/group.ts"],
      integratorConflictHunks: [{ file: "src/kitchen/group.ts", startLine: 2, endLine: 2 }],
    });
    expect(ruleIds(inHunk)).not.toContain("check11.out-of-scope");

    const outOfHunk = auditLeaf({
      actor: "integrator",
      files: [
        {
          path: "src/kitchen/group.ts",
          status: "modified",
          beforeText: "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
          afterText: "export const a = 1;\nexport const b = 2;\nexport const c = 4;\n",
        },
      ],
      entryPoints: ["src/kitchen/group.ts"],
      integratorConflictHunks: [{ file: "src/kitchen/group.ts", startLine: 1, endLine: 2 }],
    });
    expect(ruleIds(outOfHunk)).toContain("check11.out-of-scope");
  });

  it("does not flag a placeholder attribute and still flags placeholder copy", () => {
    const clean = auditLeaf({
      files: [
        added(
          "src/kitchen/field.tsx",
          `export function Field() {\n  return <input placeholder="Enter dish name" />;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/field.tsx"],
    });
    expect(clean.passed).toBe(true);
    expect(clean.findings).toEqual([]);

    const copy = auditLeaf({
      files: [
        added(
          "src/kitchen/note.tsx",
          `export function Note() {\n  return <p>Placeholder text</p>;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/note.tsx"],
    });
    expect(ruleIds(copy)).toContain("ast.marker");
  });

  it("records a soft special-case finding without failing the leaf", () => {
    const report = auditLeaf({
      files: [
        added(
          "src/kitchen/price.ts",
          `export function price(dish: string) {\n  if (dish === "Soup") {\n    return 2;\n  }\n  return 0;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/price.ts"],
      visibleExampleLiterals: ["Soup"],
      produces: [{ kind: "function", name: "price" }],
    });
    expect(report.passed).toBe(true);
    expect(report.softFindings.some((finding) => finding.ruleId === "ast.special-case")).toBe(true);
    expect(report.receipt.softFindingCount).toBe(1);
  });
});
