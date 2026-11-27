import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UiInteractionContractVerifier } from "@ef-harness/verifier";
import {
  AdvisoryTasteVisionReviewer,
  FakeModelAdapter,
  HighRiskDiffReviewer,
  bindUiInteractionContractVerifier,
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
  it("keeps a subjective suggestion advisory and offers one user-approved polish", async () => {
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
    const result = await reviewer.review(request());
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

  it("can offer a high-confidence layout escalation without blocking the merge", async () => {
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
    const result = await new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.blocksMerge).toBe(false);
    expect(result.layoutEscalation?.blocksMerge).toBe(false);
    expect(result.layoutEscalation?.confidence).toBe("high");
    expect(result.layoutEscalation?.requiresUserApproval).toBe(true);
  });

  it("drops a finding that cites a file outside the captured screens", async () => {
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
    const result = await new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.findings).toHaveLength(0);
    expect(result.blocksMerge).toBe(false);
  });

  it("enforces actual file line bounds instead of a hardcoded 1..400 range", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ef-taste-lines-"));
    try {
      mkdirSync(path.join(root, "src"), { recursive: true });
      const lines500 = Array.from({ length: 500 }, (_, i) => `export const line${String(i + 1)} = ${String(i)};`).join("\n");
      writeFileSync(path.join(root, "src", "Kitchen.tsx"), lines500, "utf8");

      const smallModel = new FakeModelAdapter().enqueue("taste-reviewer@1", {
        advisory: true,
        findings: [
          {
            screen: "kitchen",
            region: "header",
            kind: "spacing",
            severity: "low",
            suggestion: "Reject fabricated line range file:src/Kitchen.tsx:25-30",
          },
          {
            screen: "kitchen",
            region: "footer",
            kind: "spacing",
            severity: "low",
            suggestion: "Keep real line range file:src/Kitchen.tsx:2-4",
          },
        ],
      });
      const smallResult = await new AdvisoryTasteVisionReviewer({ model: smallModel }).review(
        request({ fileLineCounts: { "src/Kitchen.tsx": 8 } }),
      );
      expect(smallResult.findings).toHaveLength(1);
      expect(smallResult.findings[0]?.suggestion).toContain("2-4");

      const largeModel = new FakeModelAdapter().enqueue("taste-reviewer@1", {
        advisory: true,
        findings: [
          {
            screen: "kitchen",
            region: "footer",
            kind: "alignment",
            severity: "low",
            suggestion: "Adjust footer padding file:src/Kitchen.tsx:450-460",
          },
        ],
      });
      const largeResult = await new AdvisoryTasteVisionReviewer({ model: largeModel }).review(
        request({ repoRoot: root }),
      );
      expect(largeResult.findings).toHaveLength(1);
      expect(largeResult.findings[0]?.suggestion).toContain("450-460");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips when no vision model is configured", async () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", { advisory: true, findings: [] });
    const result = await new AdvisoryTasteVisionReviewer({ model }).review(
      request({ roster: [{ family: "openai", vision: false, level: "Senior" }] }),
    );
    expect(result.status).toBe("skipped_no_vision_model");
    expect(result.blocksMerge).toBe(false);
    expect(result.tokensSpent).toBe(0);
    expect(result.modelInvoked).toBe(false);
    expect(model.calls).toHaveLength(0);
  });

  it("skips on Prototype, Cheapest, and high budget pressure while security review still runs", async () => {
    const tasteModel = new FakeModelAdapter();
    const taste = new AdvisoryTasteVisionReviewer({ model: tasteModel });
    expect((await taste.review(request({ stage: "Prototype" }))).status).toBe("skipped_prototype");
    expect((await taste.review(request({ preset: "Cheapest" }))).status).toBe("skipped_cheapest");
    expect(
      (await taste.review(request({ budgetLimitUnits: 100, budgetSpentUnits: 90 }))).status,
    ).toBe("skipped_budget_pressure");
    expect(tasteModel.calls).toHaveLength(0);

    const reviewModel = new FakeModelAdapter().enqueue("reviewer@1", { findings: [], verdict: "ok" });
    const security = new HighRiskDiffReviewer({
      model: reviewModel,
      roster: [{ family: "anthropic", vision: false, level: "Senior" }],
    });
    const reviewed = await security.review({
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

  it("refuses production and live-customer screenshots before any vision call", async () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", { advisory: true, findings: [] });
    const reviewer = new AdvisoryTasteVisionReviewer({ model });
    const production = await reviewer.review(request({ screenshots: shots({ environment: "production" }) }));
    expect(production.status).toBe("rejected_non_synthetic");
    const live = await reviewer.review(
      request({ screenshots: shots({ bytes: Buffer.from("contact ada@real-customers.io") }) }),
    );
    expect(live.status).toBe("rejected_non_synthetic");
    const secret = await reviewer.review(
      request({ screenshots: shots({ bytes: Buffer.from(["pass", "word=hunter2hunter2"].join("")) }) }),
    );
    expect(secret.status).toBe("rejected_non_synthetic");
    expect(model.calls).toHaveLength(0);
  });

  it("does not accept a taste payload that clears the advisory flag", async () => {
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", {
      advisory: false,
      findings: [],
    });
    const result = await new AdvisoryTasteVisionReviewer({ model }).review(request());
    expect(result.blocksMerge).toBe(false);
    expect(result.findings).toHaveLength(0);
    expect(result.label).toBe("ADVISORY ONLY");
  });

  it("binds @ef-harness/verifier UiInteractionContractVerifier asynchronously", async () => {
    const casBlobs = new Map<string, Uint8Array>();
    let blobSeq = 0;
    const casStore = {
      get(digest: string) {
        return Promise.resolve(casBlobs.get(digest) ?? null);
      },
      put(bytes: Uint8Array) {
        blobSeq += 1;
        const digest = `sha256:blob-${String(blobSeq)}`;
        casBlobs.set(digest, bytes);
        return Promise.resolve(digest);
      },
      promote() {
        return Promise.resolve();
      },
    };
    const makeLocator = (): {
      count: () => Promise<number>;
      nth: () => ReturnType<typeof makeLocator>;
      click: () => Promise<void>;
      fill: () => Promise<void>;
      selectOption: () => Promise<readonly string[]>;
      ariaSnapshot: () => Promise<string>;
      focus: () => Promise<void>;
      getByRole: () => ReturnType<typeof makeLocator>;
      getByLabel: () => ReturnType<typeof makeLocator>;
      getByText: () => ReturnType<typeof makeLocator>;
      getByTestId: () => ReturnType<typeof makeLocator>;
    } => ({
      count: () => Promise.resolve(0),
      nth: () => makeLocator(),
      click: () => Promise.resolve(),
      fill: () => Promise.resolve(),
      selectOption: () => Promise.resolve([]),
      ariaSnapshot: () => Promise.resolve("- document"),
      focus: () => Promise.resolve(),
      getByRole: () => makeLocator(),
      getByLabel: () => makeLocator(),
      getByText: () => makeLocator(),
      getByTestId: () => makeLocator(),
    });
    const verifier = new UiInteractionContractVerifier({
      cas: casStore,
      launchBrowser: () =>
        Promise.resolve({
          newContext: () =>
            Promise.resolve({
              tracing: {
                start: () => Promise.resolve(),
                stop: () => Promise.resolve(),
              },
              addCookies: () => Promise.resolve(),
              close: () => Promise.resolve(),
              newPage: () =>
                Promise.resolve({
                  goto: () => Promise.resolve({ status: () => 200 }),
                  route: () => Promise.resolve(),
                  on: () => {
                    return;
                  },
                  keyboard: { press: () => Promise.resolve() },
                  screenshot: () => Promise.resolve(Buffer.from("synthetic playwright frame")),
                  ariaSnapshot: () => Promise.resolve("- main"),
                  getByRole: () => makeLocator(),
                  getByLabel: () => makeLocator(),
                  getByText: () => makeLocator(),
                  getByTestId: () => makeLocator(),
                  evaluate: <T>() => Promise.resolve(0 as T),
                }),
            }),
          close: () => Promise.resolve(),
        }),
    });
    const bound = bindUiInteractionContractVerifier(
      verifier,
      () => [
        {
          id: "shot-ui-1",
          screenId: "kitchen",
          kind: "desktop",
          viewportWidth: 1440,
          sourceFiles: ["src/Kitchen.tsx"],
          request: {
            env: { id: "taste", vars: () => ({ APP_URL: "http://env-taste.localhost:4173" }) },
            contract: {
              contract: "kitchen/ui@1",
              route: "/kitchen",
              as: { role: "customer" },
              landmarks: [],
              actions: [],
              states: [],
              testids: [],
            },
          },
        },
      ],
      casStore,
    );
    const model = new FakeModelAdapter().enqueue("taste-reviewer@1", { advisory: true, findings: [] });
    const reviewer = new AdvisoryTasteVisionReviewer({ model, verifier: bound });
    const result = await reviewer.review(request({ screenshots: [] }));
    expect(result.status).toBe("advisory");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.imageBytes).toBeGreaterThan(0);
    expect(casBlobs.size).toBeGreaterThan(0);
  });
});
