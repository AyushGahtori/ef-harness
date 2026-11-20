import { describe, expect, it } from "vitest";
import {
  InMemorySearchReadStore,
  JUNIOR_MUST_CEILING,
  LocalKnowledgePacketSlicer,
  LocalSlicerPromotionStore,
  NegativeSearchGapDetector,
  PullToPushFeedbackAnalyzer,
  PushNoiseDemotionMetric,
  SENIOR_MUST_CEILING,
  meetsWavePullRatio,
  planPulls,
  toSearchReadRow,
  type LateVerificationFailure,
  type PullObservation,
  type SlicerNode,
  type WaveMembership,
} from "../../src/rule-matching/index.js";

const PROJECT = "kitchen";
const WAVE = "wave-1";

function pull(overrides: Partial<PullObservation> & Pick<PullObservation, "taskId" | "nodeId">): PullObservation {
  return {
    projectId: PROJECT,
    waveId: WAVE,
    waveIndex: 1,
    tags: ["api"],
    workerLevel: "junior",
    currentMustTokens: 400,
    nodeTokenCost: 40,
    currentBand: "COULD",
    ...overrides,
  };
}

function wave(taskIds: readonly string[], waveIndex = 1, waveId = WAVE): WaveMembership {
  return { projectId: PROJECT, waveId, waveIndex, taskIds };
}

describe("PullToPushFeedbackAnalyzer", () => {
  const analyzer = new PullToPushFeedbackAnalyzer();

  it("promotes a contract pulled by four api tasks into the next wave SHOULD band", () => {
    const taskIds = Array.from({ length: 10 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
    const pulls = taskIds.map((taskId, index) =>
      pull({
        taskId,
        nodeId: index < 4 ? "C-PaginationContract" : `N-Only-${taskId}`,
        tags: ["api"],
        currentMustTokens: 2_900,
        nodeTokenCost: 200,
      }),
    );
    const first = analyzer.analyze({ pulls, lateFailures: [], waves: [wave(taskIds)] });
    const second = analyzer.analyze({ pulls, lateFailures: [], waves: [wave(taskIds)] });
    expect(second).toEqual(first);
    const promotion = first.find((row) => row.nodeId === "C-PaginationContract");
    expect(promotion).toMatchObject({
      tag: "api",
      fromBand: "COULD",
      toBand: "SHOULD",
      effectiveWave: 2,
      distinctTasks: 4,
      capped: false,
    });
    expect(promotion?.reasons).toEqual(["repeated_pull_tag", "wave_pull_ratio"]);
    expect(promotion?.taskIds).toEqual(["T01", "T02", "T03", "T04"]);
    expect(first.filter((row) => row.nodeId.startsWith("N-Only"))).toEqual([]);

    const store = new LocalSlicerPromotionStore();
    analyzer.apply(first, store);
    const nodes: SlicerNode[] = [
      { id: "R-Goal", title: "Goal", band: "MUST", tokens: 2_900, tags: ["api"] },
      { id: "C-PaginationContract", title: "Pagination", band: "COULD", tokens: 200, tags: ["api"] },
      { id: "N-Only-T05", title: "Other", band: "COULD", tokens: 30, tags: ["api"] },
    ];
    const slicer = new LocalKnowledgePacketSlicer(nodes, store);
    const wave1 = slicer.compile({
      taskId: "T01",
      projectId: PROJECT,
      waveIndex: 1,
      tags: ["api"],
      level: "junior",
    });
    expect(wave1.couldIndex).toContain("C-PaginationContract");
    expect(wave1.should.map((item) => item.nodeId)).not.toContain("C-PaginationContract");
    expect(wave1.mustTokens).toBe(2_900);

    const wave2Tasks = ["W2-A", "W2-B", "W2-C"];
    let redundantPulls = 0;
    for (const taskId of wave2Tasks) {
      const brief = slicer.compile({
        taskId,
        projectId: PROJECT,
        waveIndex: 2,
        tags: ["api"],
        level: "junior",
      });
      expect(brief.should.map((item) => item.nodeId)).toContain("C-PaginationContract");
      expect(brief.must.map((item) => item.nodeId)).not.toContain("C-PaginationContract");
      expect(brief.mustTokens).toBeLessThanOrEqual(JUNIOR_MUST_CEILING);
      const planned = planPulls(brief, ["C-PaginationContract", "N-Only-T05"]);
      redundantPulls += planned.redundantPulls;
      expect(planned.issued).toEqual(["N-Only-T05"]);
      expect(planned.avoidedBecausePushed).toEqual(["C-PaginationContract"]);
    }
    expect(redundantPulls).toBe(0);
  });

  it("promotes on a 40 percent wave even when fewer than three tasks share the pull", () => {
    expect(meetsWavePullRatio(2, 5)).toBe(true);
    expect(meetsWavePullRatio(1, 5)).toBe(false);
    const members = ["A", "B", "C", "D", "E"];
    const promoted = analyzer.analyze({
      pulls: [
        pull({ taskId: "A", nodeId: "C-Shared", tags: ["api"] }),
        pull({ taskId: "B", nodeId: "C-Shared", tags: ["api"] }),
      ],
      lateFailures: [],
      waves: [wave(members)],
    });
    expect(promoted).toEqual([
      expect.objectContaining({
        nodeId: "C-Shared",
        tag: "api",
        toBand: "SHOULD",
        reasons: ["wave_pull_ratio"],
        wavePullers: 2,
        waveMembers: 5,
      }),
    ]);
    const quiet = analyzer.analyze({
      pulls: [pull({ taskId: "A", nodeId: "C-Shared", tags: ["api"] })],
      lateFailures: [],
      waves: [wave(members)],
    });
    expect(quiet).toEqual([]);
  });

  it("does not promote four pulls that do not share a tag when the wave ratio is below 40 percent", () => {
    const pulls = ["A", "B", "C", "D"].map((taskId) =>
      pull({ taskId, nodeId: "C-Scatter", tags: [`solo-${taskId}`] }),
    );
    const recommendations = analyzer.analyze({
      pulls,
      lateFailures: [],
      waves: [wave(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"])],
    });
    expect(recommendations).toEqual([]);
  });

  it("promotes a late verification failure to MUST only inside the level ceiling", () => {
    const late = (currentMustTokens: number, workerLevel: "junior" | "senior"): LateVerificationFailure => ({
      projectId: PROJECT,
      waveId: WAVE,
      waveIndex: 1,
      taskId: "T-Late",
      tags: ["api"],
      nodeId: "X-03",
      workerLevel,
      currentMustTokens,
      nodeTokenCost: 200,
      currentBand: "COULD",
      pulledLate: true,
    });
    const fits = analyzer.analyze({
      pulls: [],
      lateFailures: [late(100, "junior")],
      waves: [],
    });
    expect(fits[0]).toMatchObject({
      nodeId: "X-03",
      tag: "api",
      toBand: "MUST",
      capped: false,
      reasons: ["late_verification_failure"],
    });
    const juniorOverflow = analyzer.analyze({
      pulls: [],
      lateFailures: [late(2_900, "junior")],
      waves: [],
    });
    expect(juniorOverflow[0]).toMatchObject({ toBand: "SHOULD", capped: true });
    expect(2_900 + 200).toBeGreaterThan(JUNIOR_MUST_CEILING);
    const seniorOverflow = analyzer.analyze({
      pulls: [],
      lateFailures: [late(5_900, "senior")],
      waves: [],
    });
    expect(seniorOverflow[0]).toMatchObject({ toBand: "SHOULD", capped: true });
    expect(5_900 + 200).toBeGreaterThan(SENIOR_MUST_CEILING);
    const ignored = analyzer.analyze({
      pulls: [],
      lateFailures: [{ ...late(100, "junior"), pulledLate: false }],
      waves: [],
    });
    expect(ignored).toEqual([]);
  });

  it("keeps a MUST override out of a junior brief that would pass 3,000 tokens", () => {
    const store = new LocalSlicerPromotionStore();
    store.upsertBand({
      projectId: PROJECT,
      tag: "api",
      nodeId: "C-Heavy",
      band: "MUST",
      effectiveWave: 2,
      tokenCost: 200,
      capped: false,
    });
    const slicer = new LocalKnowledgePacketSlicer(
      [
        { id: "R-Goal", title: "Goal", band: "MUST", tokens: 2_900, tags: ["api"] },
        { id: "C-Heavy", title: "Heavy", band: "COULD", tokens: 200, tags: ["api"] },
      ],
      store,
    );
    const brief = slicer.compile({
      taskId: "T-Junior",
      projectId: PROJECT,
      waveIndex: 2,
      tags: ["api"],
      level: "junior",
    });
    expect(brief.mustTokens).toBe(2_900);
    expect(brief.mustTokens).toBeLessThanOrEqual(JUNIOR_MUST_CEILING);
    expect(brief.should.map((item) => item.nodeId)).toEqual(["C-Heavy"]);
    expect(brief.mustOverflowAvoided).toEqual(["C-Heavy"]);
  });
});

describe("NegativeSearchGapDetector", () => {
  const detector = new NegativeSearchGapDetector();

  function miss(attempt: string, concept: string, securityProbe = false) {
    return toSearchReadRow({
      attempt,
      query: concept,
      types: [],
      limit: 10,
      resultIds: [],
      rev: 1,
      securityProbe,
      concept,
    });
  }

  it("batches three zero-hit searches of one concept into a single finding", () => {
    const store = new InMemorySearchReadStore();
    for (const row of [
      miss("A1", "csv delimiter"),
      miss("A2", "CSV Delimiter"),
      miss("A3", "csv   delimiter"),
      miss("A4", "date format"),
      miss("A5", "date format"),
      miss("A1", "csv delimiter"),
      miss("P1", "hidden check", true),
      miss("P2", "hidden check", true),
      miss("P3", "hidden check", true),
    ]) {
      store.upsert(row);
    }
    expect(detector.detect(store.list())).toEqual([
      {
        query: "csv delimiter",
        distinctAttempts: 3,
        message: "Undocumented convention searched 3×: 'csv delimiter'",
      },
    ]);
  });
});

describe("PushNoiseDemotionMetric", () => {
  it("flags SHOULD items that were never referenced or correlated with checks", () => {
    const metric = new PushNoiseDemotionMetric();
    metric.recordShouldPush(PROJECT, "T1", "N-Unused");
    metric.recordShouldPush(PROJECT, "T2", "N-Unused");
    metric.recordCouldPull(PROJECT, "T9", "N-Unused");
    metric.recordShouldPush(PROJECT, "T1", "N-Used");
    metric.recordReference(PROJECT, "T1", "N-Used");
    metric.recordShouldPush(PROJECT, "T1", "N-Checked");
    metric.recordCheckCorrelation(PROJECT, "T1", "N-Checked", "AC-1");
    const diagnostics = metric.diagnose(PROJECT);
    const unused = diagnostics.find((row) => row.nodeId === "N-Unused");
    expect(unused).toMatchObject({
      noise: true,
      pushedTaskCount: 2,
      referencedTaskCount: 0,
      correlatedCheckCount: 0,
      couldPullCount: 1,
    });
    expect(unused?.summary).toBe(
      "SHOULD band item N-Unused was pushed to 2 tasks and never referenced or correlated with checks; 1 COULD pulls recorded for comparison",
    );
    expect(diagnostics.find((row) => row.nodeId === "N-Used")?.noise).toBe(false);
    expect(diagnostics.find((row) => row.nodeId === "N-Checked")?.noise).toBe(false);
  });
});
