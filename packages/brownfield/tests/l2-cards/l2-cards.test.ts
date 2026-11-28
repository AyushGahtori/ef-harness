import { describe, expect, it } from "vitest";
import {
  CodeEgressSecretMasker,
  DEFAULT_MAX_FOCUS_FILES,
  FakeModelAdapter,
  InMemoryCodeMap,
  InMemoryModuleCardStore,
  InMemoryObservedModuleGraph,
  InMemoryRepoCloudEgressLedger,
  L2BrownfieldSummarizer,
  L2PreSpendEstimator,
  ModuleCardCacheEngine,
  PRE_SPEND_TOKEN_THRESHOLD,
  RequestDrivenFocusSelector,
  StaleDocsDetector,
} from "../../src/l2-cards/index.js";
import { buildLargeFixture, TestL0GroundTruth } from "./fixtures.js";

describe("RequestDrivenFocusSelector", () => {
  it("narrows a 200-file fixture to <= 20 relevant files", () => {
    const { codeMap, sources } = buildLargeFixture("pdf");
    const selector = new RequestDrivenFocusSelector();
    const result = selector.select(
      "Fix PDF page-break clipping on long achievement lists",
      { commitSha: "cafebabe", codeMap, churnByPath: new Map() },
    );
    expect(result.selected.length).toBeLessThanOrEqual(DEFAULT_MAX_FOCUS_FILES);
    expect(result.selected).toContain("src/pdf/resume.ts");
    expect(sources.size).toBeGreaterThan(100);
  });
});

describe("L2PreSpendEstimator", () => {
  it("outputs exact uncached token/cost counts before calling models", () => {
    const store = new InMemoryModuleCardStore();
    const estimator = new L2PreSpendEstimator();
    const files = ["src/a.ts", "src/b.ts"];
    const content = { "src/a.ts": "x".repeat(8000), "src/b.ts": "y".repeat(4000) };
    const first = estimator.estimate({
      repoId: "repo-1",
      selectedFiles: files,
      readFile: (p) => content[p as keyof typeof content] ?? "",
      store,
      firstCloudEgress: true,
    });
    expect(first.breakdown.uncachedFiles).toEqual(files);
    expect(first.breakdown.uncachedInputTokens).toBe(3000);
    expect(first.breakdown.requiresConfirmation).toBe(true);
    expect(first.headline).toMatch(/Reading 2 uncached files/);
    expect(first.breakdown.reasons).toContain("first_repo_cloud_egress");

  const repeat = estimator.estimate({
      repoId: "repo-1",
      selectedFiles: files,
      readFile: (p) => content[p as keyof typeof content] ?? "",
      store,
      firstCloudEgress: false,
    });
    expect(repeat.breakdown.uncachedInputTokens).toBe(3000);
    expect(repeat.breakdown.requiresConfirmation).toBe(false);
    expect(PRE_SPEND_TOKEN_THRESHOLD).toBe(25_000);
  });
});

describe("CodeEgressSecretMasker", () => {
  it("redacts legacy credentials before outbound model calls", () => {
    const secret = ["sk", "_live_", "old12345"].join("");
    const masker = new CodeEgressSecretMasker();
    const masked = masker.maskFile(
      "src/legacy/mailer.ts",
      `const key = "${secret}";\n`,
    );
    expect(masked.maskedContent).not.toContain(secret);
    expect(masked.notices.length).toBeGreaterThan(0);
    const fake = new FakeModelAdapter(() => ({
      module: "src/legacy/mailer.ts",
      purpose: "mail",
      key_exports: [],
      reads: [],
      writes: [],
      side_effects: [],
      tests: [],
      confidence: "medium",
    }));
    return fake
      .generateModuleCard({ filePath: "src/legacy/mailer.ts", maskedSource: masked.maskedContent })
      .then(() => {
        expect(fake.outbound[0]!.maskedSource).not.toContain(secret);
        expect(CodeEgressSecretMasker.containsRawLegacySecret(fake.outbound[0]!.maskedSource, secret)).toBe(
          false,
        );
      });
  });
});

describe("ModuleCardCacheEngine", () => {
  it("serves cache hits, invalidates on edit, and strips hallucinated exports", async () => {
    const store = new InMemoryModuleCardStore();
    const symbols = [
      {
        fileHash: "h1",
        name: "renderResumePdf",
        kind: "function",
        line: 1,
        exported: true,
      },
    ];
    const codeMap = new InMemoryCodeMap(
      ["src/pdf.ts"],
      new Map([["src/pdf.ts", 1]]),
      new Map([["src/pdf.ts", symbols]]),
    );
    let calls = 0;
    const model = new FakeModelAdapter(() => {
      calls += 1;
      return {
        module: "src/pdf.ts",
        purpose: "pdf",
        key_exports: [
          { name: "renderResumePdf" },
          { name: "generateDocx" },
        ],
        reads: [],
        writes: [],
        side_effects: [],
        tests: [],
        confidence: "high",
      };
    });
    const engine = new ModuleCardCacheEngine();
    const source = "export function renderResumePdf() {}\n";
    const first = await engine.resolve({
      commitSha: "c",
      filePath: "src/pdf.ts",
      source,
      store,
      codeMap,
      model,
    });
    expect(first.cacheHit).toBe(false);
    expect(first.modelCalls).toBe(1);
    expect(first.card.key_exports.map((e) => e.name)).toEqual(["renderResumePdf"]);

    const second = await engine.resolve({
      commitSha: "c",
      filePath: "src/pdf.ts",
      source,
      store,
      codeMap,
      model,
    });
    expect(second.cacheHit).toBe(true);
    expect(second.modelCalls).toBe(0);
    expect(calls).toBe(1);

    engine.invalidateOnEdit("src/pdf.ts", source, `${source}// edited\n`, store);
    const third = await engine.resolve({
      commitSha: "c",
      filePath: "src/pdf.ts",
      source: `${source}// edited\n`,
      store,
      codeMap,
      model,
    });
    expect(third.cacheHit).toBe(false);
    expect(calls).toBe(2);
  });
});

describe("StaleDocsDetector", () => {
  it("flags broken refs and churn skew without marking stable ADRs stale", () => {
    const now = Date.now();
    const old = now - 400 * 86_400_000;
    const l0 = new TestL0GroundTruth(
      new Set(["src/api/v2.ts", "src/core/live.ts"]),
      new Set(["dev", "build", "test"]),
      new Map([
        ["src/core/live.ts", 2],
      ]),
      new Map([
        ["docs/old-api.md", old],
        ["docs/adr-01.md", old],
      ]),
      new Map([
        ["src/core/live.ts", old + 1_000],
      ]),
    );
    const detector = new StaleDocsDetector();
    const findings = detector.analyze({
      l0,
      docs: [
        {
          path: "docs/old-api.md",
          content:
            "Legacy route `src/api/v1.ts` and POST /api/legacy. Run `npm run start`.",
        },
        {
          path: "docs/adr-01.md",
          content: "We use `src/core/live.ts` with export `renderResumePdf`.",
        },
      ],
      symbolNames: new Set(["renderResumePdf", "/api/v2"]),
    });
    const stale = findings.find((f) => f.docPath === "docs/old-api.md");
    const adr = findings.find((f) => f.docPath === "docs/adr-01.md");
    expect(stale?.status).toBe("likely_stale");
    expect(stale?.evidence.some((e) => e.includes("src/api/v1.ts"))).toBe(true);
    expect(adr?.status).toBe("fresh");
  });
});

describe("L2BrownfieldSummarizer integration", () => {
  it("skips cloud when user declines egress", async () => {
    const { codeMap, sources } = buildLargeFixture("pdf");
    const summarizer = new L2BrownfieldSummarizer();
    const result = await summarizer.run({
      request: "Fix PDF page-break clipping",
      readFile: (p) => sources.get(p) ?? "",
      confirmed: false,
      ctx: {
        repoId: "resume-changer",
        commitSha: "cafebabe",
        codeMap,
        l0: new TestL0GroundTruth(new Set(), new Set(), new Map(), new Map(), new Map()),
        store: new InMemoryModuleCardStore(),
        model: new FakeModelAdapter(() => ({
          module: "x",
          purpose: "p",
          key_exports: [],
          reads: [],
          writes: [],
          side_effects: [],
          tests: [],
          confidence: "low",
        })),
        graph: new InMemoryObservedModuleGraph(),
        egressLedger: new InMemoryRepoCloudEgressLedger(),
        egress: { kind: "cloud", userDeclinedCloud: true },
      },
    });
    expect(result.skippedCloud).toBe(true);
    expect(result.modelCalls).toBe(0);
  });
});