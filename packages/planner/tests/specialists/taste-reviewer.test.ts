import { describe, expect, it } from "vitest";
import {
  AdvisoryTasteVisionReviewer,
  FakeModelAdapter,
  HighRiskDiffReviewer,
} from "../../src/specialists/index.js";
import type {
  ModelRosterEntry,
  TasteReviewRequest,
  TasteScreenshot,
} from "../../src/specialists/index.js";

const VISION: readonly ModelRosterEntry[] = [
  { family: "anthropic", vision: true, level: "Senior" },
];

function shots(patch?: Partial<TasteScreenshot>): TasteScreenshot[] {
  const kinds = [
    ["full_page", 1280],
    ["mobile", 375],
    ["desktop", 1440],
    ["styleguide", 1440],
  ] as const;
  return kinds.map(([kind, viewportWidth], index) => ({
    id: `shot-${kind}`,
    screenId: "kitchen",
    kind,
    viewportWidth,
    bytes: Buffer.from(`synthetic frame ${String(index)}`),
    environment: "synthetic_test_env",
    seeded: true,
    seedReceiptId: "seed-052",
    sourceFiles: ["src/Kitchen.tsx"],
    ...patch,
  }));
}

function request(overrides: Partial<TasteReviewRequest> = {}): TasteReviewRequest {
  return {
    taskId: "T-UI",
    stage: "MVP",
    preset: "Balanced",
    budgetLimitUnits: 1_000,
    budgetSpentUnits: 100,
    screenshots: shots(),
    roster: VISION,
    workerFamily: "openai",
    knownFiles: ["src/Kitchen.tsx"],
    knownNodeIds: ["N-UI"],
    knownReceiptIds: ["seed-052"],
    ...overrides,
  };
}

describe("AdvisoryTasteVisionReviewer", () => {
  it("keeps a subjective suggestion advisory and offers one user-approved polish", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", {
      advisory: true,
      findings: [
        {
          screen: "kitchen",
          region: "header",
          kind: "color",
          severity: "low",
          suggestion: "Try a warmer header shadow",
        },
      ],
    });
    const reviewer = new AdvisoryTasteVisionReviewer({ model });
    const result = reviewer.review(request());
    expect(result.status).toBe("advisory");
    expect(result.label).toBe("ADVISORY ONLY");
    expect(result.blocksMerge).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.blocksMerge).toBe(false);
    expect(result.layoutEscalation).toBeNull();
    expect(result.polishOffer).toEqual({ shots: 1, requiresUserApproval: true, applied: false });
    expect(result.missingCaptures).toEqual([]);
    expect(result.preserves.deterministicUiChecks).toBe(true);
    expect(model.calls[0]?.vision).toBe(true);
    expect(model.calls[0]?.imageBytes).toBeGreaterThan(0);
    expect(model.calls[0]?.prompt).toContain("ADVISORY ONLY");
    expect(model.calls[0]?.prompt).toContain("375");
    expect(model.calls[0]?.prompt).toContain("1440");
    expect(model.calls[0]?.prompt).toContain("styleguide");
  });

  it("can offer a high-confidence layout escalation without blocking the merge", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", {
      advisory: true,
      findings: [
        {
          screen: "kitchen",
          region: "title",
          kind: "alignment",
          severity: "high",
          suggestion: "Primary button overlaps the title at 375px",
        },
      ],
    });
    const result = new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.blocksMerge).toBe(false);
    expect(result.layoutEscalation?.blocksMerge).toBe(false);
    expect(result.layoutEscalation?.confidence).toBe("high");
    expect(result.layoutEscalation?.requiresUserApproval).toBe(true);
  });

  it("drops a finding that cites a file outside the captured screens", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", {
      advisory: true,
      findings: [
        {
          screen: "kitchen",
          region: "header",
          kind: "spacing",
          severity: "medium",
          suggestion: "Tighten the header file:src/Missing.tsx:4-8",
        },
      ],
    });
    const result = new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.findings).toHaveLength(0);
    expect(result.blocksMerge).toBe(false);
  });

  it("skips when no vision model is configured", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", { advisory: true, findings: [] });
    const result = new AdvisoryTasteVisionReviewer({ model }).review(
      request({ roster: [{ family: "openai", vision: false, level: "Senior" }] }),
    );
    expect(result.status).toBe("skipped_no_vision_model");
    expect(result.blocksMerge).toBe(false);
    expect(result.tokensSpent).toBe(0);
    expect(result.modelInvoked).toBe(false);
    expect(model.calls).toHaveLength(0);
  });

  it("skips on Prototype, Cheapest, and high budget pressure while security review still runs", () => {
    const tasteModel = new FakeModelAdapter();
    const taste = new AdvisoryTasteVisionReviewer({ model: tasteModel });
    expect(taste.review(request({ stage: "Prototype" })).status).toBe("skipped_prototype");
    expect(taste.review(request({ preset: "Cheapest" })).status).toBe("skipped_cheapest");
    expect(
      taste.review(request({ budgetLimitUnits: 100, budgetSpentUnits: 90 })).status,
    ).toBe("skipped_budget_pressure");
    expect(tasteModel.calls).toHaveLength(0);

    const reviewModel = new FakeModelAdapter().enqueue("reviewer@1", { findings: [], verdict: "ok" });
    const security = new HighRiskDiffReviewer({
      model: reviewModel,
      roster: [{ family: "anthropic", vision: false, level: "Senior" }],
    });
    const reviewed = security.review({
      taskId: "T-PAY",
      attemptId: "A-1",
      touches: ["payments"],
      hintRetryLevel: 0,
      tagDrift: false,
      diff: "diff --git a/src/pay.ts b/src/pay.ts\n--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1 +1,2 @@\n+export const pay = 1;\n",
      must: [],
      rules: [],
      staticAudit: null,
      workerFamily: "openai",
    });
    expect(reviewed.status).toBe("clean");
    expect(reviewModel.calls).toHaveLength(1);
  });

  it("refuses production and live-customer screenshots before any vision call", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", { advisory: true, findings: [] });
    const reviewer = new AdvisoryTasteVisionReviewer({ model });
    const production = reviewer.review(request({ screenshots: shots({ environment: "production" }) }));
    expect(production.status).toBe("rejected_non_synthetic");
    const live = reviewer.review(
      request({ screenshots: shots({ bytes: Buffer.from("contact ada@real-customers.io") }) }),
    );
    expect(live.status).toBe("rejected_non_synthetic");
    const secret = reviewer.review(
      request({ screenshots: shots({ bytes: Buffer.from("password=hunter2hunter2") }) }),
    );
    expect(secret.status).toBe("rejected_non_synthetic");
    expect(model.calls).toHaveLength(0);
  });

  it("does not accept a taste payload that clears the advisory flag", () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", {
      advisory: false,
      findings: [],
    });
    const result = new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.blocksMerge).toBe(false);
    expect(result.findings).toHaveLength(0);
    expect(result.label).toBe("ADVISORY ONLY");
  });
});
