import { describe, expect, it } from "vitest";

import { InMemoryBudgetLedger } from "../../src/final-audit/budget.js";
import { MAX_SHARD_TOKENS } from "../../src/final-audit/constants.js";
import { ShardedFinalProjectAuditor } from "../../src/final-audit/sharded-final-project-auditor.js";
import { estimateTokens } from "../../src/final-audit/text.js";
import type { RepoFile, ShardInputs } from "../../src/final-audit/types.js";
import { emptyAudit } from "./support.js";

describe("layer C sharded final-project-auditor", () => {
  it("keeps 30 feature, seam, and rule shards under 6000 tokens inside the 2% audit budget", async () => {
    const sentinel = "OTHER_FEATURE_ONLY_SENTINEL";
    const features = Array.from({ length: 12 }, (_, index) => {
      const id = `F-${String(index + 1).padStart(2, "0")}`;
      const body = index === 0 ? "A".repeat(50_000) : `export const value = ${index};\n`;
      const content = index === 1 ? `${sentinel}\nexport const marked = 1;\n` : `export const value = ${index};\n${body}`;
      return {
        id,
        requirements: [{ id: `SI-${id}`, text: `Requirement text for ${id} only` }],
        files: [{ path: `src/${id}.ts`, content }],
        diff: `diff ${id}`,
      };
    });
    const seams = Array.from({ length: 8 }, (_, index) => {
      const id = `S-${String(index + 1).padStart(2, "0")}`;
      return {
        id,
        requirements: [{ id: `SI-${id}`, text: `Seam ${id}` }],
        files: [{ path: `src/seams/${id}.ts`, content: `export const ${id.replace("-", "_")} = 1;\n` }],
        diff: `diff ${id}`,
      };
    });
    const rules = [
      ...Array.from({ length: 14 }, (_, index) => {
        const id = `X-${String(index + 1).padStart(2, "0")}`;
        return {
          id,
          active: index < 10,
          requirements: [{ id: `SI-${id}`, text: `Rule ${id}` }],
          files: [{ path: `src/rules/${id}.ts`, content: `export const rule = "${id}";\n` }],
          diff: `diff ${id}`,
        };
      }),
      { id: "X-99", active: true, requirements: [], files: [], diff: "ignored" },
    ];
    const inputs: ShardInputs = { features, seams, rules };
    const auditor = new ShardedFinalProjectAuditor();
    const plan = auditor.plan(inputs);
    expect(plan.filter((shard) => shard.kind === "feature")).toHaveLength(12);
    expect(plan.filter((shard) => shard.kind === "seam")).toHaveLength(8);
    expect(plan.filter((shard) => shard.kind === "rule")).toHaveLength(10);
    expect(plan.some((shard) => shard.subjectId === "X-99")).toBe(false);
    const ledger = new InMemoryBudgetLedger();
    const scopes = ledger.ensureCompletionScopes({ projectId: "kitchen", projectLimitUnits: 10_000n });
    expect(scopes.auditLimitUnits).toBe(200n);
    let inFlight = 0;
    let maxInFlight = 0;
    const prompts: { shardId: string; prompt: string; tokenEstimate: number }[] = [];
    const files: RepoFile[] = [
      ...features.flatMap((feature) => feature.files),
      ...seams.flatMap((seam) => seam.files),
      ...rules.flatMap((rule) => rule.files),
    ];
    const runs = await auditor.run({
      projectId: "kitchen",
      inputs,
      catalog: {
        requirementIds: files.length === 0 ? [] : [...features, ...seams].map((item) => item.requirements[0]?.id ?? "SI"),
        ruleIds: rules.map((rule) => rule.id),
        checkIds: [],
      },
      files,
      receiptSummary: "A:static_audit=pass\nB:teardown=pass",
      ledger,
      auditScopeId: scopes.auditScopeId,
      costPerShardUnits: 1n,
      fixCostUnits: 1n,
      model: {
        async audit(input) {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          prompts.push(input);
          await new Promise((resolve) => setTimeout(resolve, 15));
          inFlight -= 1;
          return emptyAudit();
        },
      },
    });
    expect(runs).toHaveLength(30);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(ledger.spent(scopes.auditScopeId)).toBe(30n);
    expect(ledger.spent(scopes.auditScopeId) <= scopes.auditLimitUnits).toBe(true);
    const first = prompts.find((prompt) => prompt.shardId === "feature:F-01");
    const second = prompts.find((prompt) => prompt.shardId === "feature:F-02");
    if (!first || !second) throw new Error("missing feature prompts");
    expect(first.prompt).toContain("READ ONLY");
    expect(first.prompt).toContain("Requirement text for F-01 only");
    expect(first.prompt).not.toContain("Requirement text for F-02 only");
    expect(first.prompt).not.toContain(sentinel);
    expect(second.prompt).toContain(sentinel);
    expect(first.prompt).toContain("A:static_audit=pass");
    for (const prompt of prompts) {
      expect(prompt.tokenEstimate).toBeLessThan(MAX_SHARD_TOKENS);
      expect(estimateTokens(prompt.prompt)).toBeLessThan(MAX_SHARD_TOKENS);
      expect(prompt.prompt).not.toContain("whole-repo");
    }
  });

  it("collapses duplicate feature ids into one shard", () => {
    const plan = new ShardedFinalProjectAuditor().plan({
      features: [
        { id: "F-Orders", requirements: [{ id: "SI-1", text: "one" }], files: [], diff: "" },
        { id: "F-Orders", requirements: [{ id: "SI-2", text: "two" }], files: [], diff: "" },
      ],
      seams: [],
      rules: [],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.requirements.map((item) => item.id)).toEqual(["SI-1", "SI-2"]);
  });
});
