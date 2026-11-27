import { describe, expect, it } from "vitest";
import {
  CrossCuttingRuleMatcher,
  InMemoryFtsSearchRepo,
  InMemorySearchReadStore,
  InMemoryTelemetryStore,
  KbPullToolHandlers,
  LocalLeasedMcpServer,
  MAX_PULL_BYTES_PER_TURN,
  MAX_PULL_CALLS_PER_TURN,
  PullReadAnalyticsRecorder,
  PullTurnBudget,
  UnavailableTelemetryStore,
  corpusCrossCuttingRules,
  utf8Bytes,
} from "../../src/rule-matching/index.js";
import { knowledgeNode, projectRule, pullContext, steppingClock } from "./fixtures.js";

function harness(nodes = sampleNodes(), clock = steppingClock()) {
  const telemetry = new InMemoryTelemetryStore();
  const searchReads = new InMemorySearchReadStore();
  const recorder = new PullReadAnalyticsRecorder(telemetry, searchReads, clock);
  const repo = new InMemoryFtsSearchRepo(nodes, 7);
  const matcher = new CrossCuttingRuleMatcher([
    ...corpusCrossCuttingRules(),
    projectRule({
      id: "P-FORMS",
      any: ["web_frontend"],
      all: ["auth", "forms"],
    }),
  ]);
  const handlers = new KbPullToolHandlers({ repo, recorder, matcher });
  return { telemetry, searchReads, recorder, handlers, clock };
}

function sampleNodes() {
  return [
    knowledgeNode({
      id: "C-PaginationContract",
      kind: "contract",
      title: "Pagination contract",
      prose: "Cursor pagination for list endpoints.",
      tags: ["api"],
      couldIndex: true,
      band: "COULD",
      tokenCost: 40,
      schemas: [{ name: "Page", fields: ["cursor", "limit"] }],
      seams: [{ name: "list", method: "GET" }],
      errorCodes: ["INVALID_CURSOR"],
      canonical: { name: "C-PaginationContract" },
      outgoingContractLinks: [
        { contractId: "C-ErrEnv", relation: "uses" },
        { contractId: "ORACLE-007", relation: "sealed" },
      ],
    }),
    knowledgeNode({
      id: "C-ErrEnv",
      kind: "contract",
      title: "Shared error envelope",
      prose: "Errors use the shared error format.",
      band: "SHOULD",
      couldIndex: false,
      tokenCost: 20,
    }),
    knowledgeNode({
      id: "C-014",
      kind: "contract",
      title: "Cutoff rule",
      prose: "Cutoff stays at 10:45.",
      band: "COULD",
      couldIndex: true,
    }),
    knowledgeNode({
      id: "N-Body",
      kind: "note",
      title: "Notes",
      prose: "Pagination appears in the body only.",
      band: "COULD",
      couldIndex: true,
    }),
    knowledgeNode({
      id: "ORACLE-007",
      kind: "hidden_check",
      title: "hidden check",
      prose: "Sealed oracle for pagination cutoff.",
      hidden: true,
      visibility: "sealed",
    }),
    knowledgeNode({
      id: "CHK-HIDDEN-01",
      kind: "contract",
      title: "Hidden contract",
      prose: "hidden check sealed contract",
      hidden: true,
      visibility: "hidden_check",
      schemas: [{ secret: true }],
    }),
    knowledgeNode({
      id: "N-Retired",
      title: "Retired pagination note",
      status: "retired",
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      knowledgeNode({
        id: `N-Widget-${String(index).padStart(2, "0")}`,
        title: `Widget ${index}`,
        prose: "widget catalog entry",
      }),
    ),
  ];
}

describe("KbPullToolHandlers", () => {
  it("ranks title above body, finds ident substrings, and clamps the limit to 10", () => {
    const { handlers } = harness();
    const ranked = handlers.call(
      "kb.search",
      { query: "pagination", limit: 10 },
      pullContext({ attemptId: "rank" }),
    );
    expect(ranked).toMatchObject({
      ok: true,
      source: "kb.search",
      trust: "kb",
      label: "data",
    });
    const hits = (ranked as { hits: { nodeId: string }[] }).hits;
    expect(hits.map((hit) => hit.nodeId)).toEqual(["C-PaginationContract", "N-Body"]);
    const ident = handlers.call(
      "kb.search",
      { query: "C-01", limit: 10 },
      pullContext({ attemptId: "ident" }),
    ) as { hits: { nodeId: string }[] };
    expect(ident.hits.map((hit) => hit.nodeId)).toContain("C-014");
    expect(ident.hits.map((hit) => hit.nodeId)).not.toContain("ORACLE-007");
    const clamped = handlers.call(
      "kb.search",
      { query: "widget", limit: 50 },
      pullContext({ attemptId: "clamp" }),
    ) as { hits: unknown[]; limit: number };
    expect(clamped.limit).toBe(10);
    expect(clamped.hits).toHaveLength(10);
  });

  it("returns canonical node fields and exact contract schemas without sealed links", () => {
    const { handlers } = harness();
    const node = handlers.call(
      "kb.get_node",
      { node_id: "C-PaginationContract" },
      pullContext({ attemptId: "node" }),
    ) as {
      node: {
        prose: string;
        canonical: { name: string };
        outgoingContractLinks: { contractId: string }[];
      };
    };
    expect(node.node.canonical.name).toBe("C-PaginationContract");
    expect(node.node.prose).toContain("Cursor pagination");
    expect(node.node.outgoingContractLinks.map((link) => link.contractId)).toEqual(["C-ErrEnv"]);
    const contract = handlers.call(
      "kb.get_contract",
      { contract_id: "C-PaginationContract" },
      pullContext({ attemptId: "contract" }),
    ) as { contract: { schemas: unknown[]; seams: unknown[]; errorCodes: string[] } };
    expect(contract.contract.schemas).toEqual([{ name: "Page", fields: ["cursor", "limit"] }]);
    expect(contract.contract.seams).toEqual([{ name: "list", method: "GET" }]);
    expect(contract.contract.errorCodes).toEqual(["INVALID_CURSOR"]);
    const notContract = handlers.call(
      "kb.get_contract",
      { contract_id: "N-Body" },
      pullContext({ attemptId: "not-contract" }),
    ) as { code: string };
    expect(notContract.code).toBe("NOT_A_CONTRACT");
  });

  it("lists rules for tags using any and combined any+all", () => {
    const { handlers } = harness();
    const money = handlers.call(
      "kb.list_rules_for_tags",
      { tags: ["money"] },
      pullContext({ attemptId: "rules-money" }),
    ) as { rules: { id: string }[] };
    expect(money.rules.map((rule) => rule.id)).toContain("X-04");
    expect(money.rules.map((rule) => rule.id)).not.toContain("X-07");
    const partial = handlers.call(
      "kb.list_rules_for_tags",
      { tags: ["web_frontend", "auth"] },
      pullContext({ attemptId: "rules-partial" }),
    ) as { rules: { id: string }[] };
    expect(partial.rules.map((rule) => rule.id)).not.toContain("P-FORMS");
    const full = handlers.call(
      "kb.list_rules_for_tags",
      { tags: ["web_frontend", "auth", "forms"] },
      pullContext({ attemptId: "rules-full" }),
    ) as { rules: { id: string; matchedVia: string }[] };
    expect(full.rules.find((rule) => rule.id === "P-FORMS")?.matchedVia).toBe("direct_tag");
  });

  it("returns identical NOT_FOUND for hidden oracles and ids that do not exist", () => {
    const { handlers, recorder } = harness();
    const oracle = handlers.call(
      "kb.get_node",
      { node_id: "ORACLE-007" },
      pullContext({ attemptId: "oracle" }),
    );
    const missing = handlers.call(
      "kb.get_node",
      { node_id: "NONEXISTENT-999" },
      pullContext({ attemptId: "missing" }),
    );
    expect(oracle).toEqual(missing);
    expect(oracle).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Not found",
      trust: "kb",
      label: "data",
      source: "kb.get_node",
    });
    expect(JSON.stringify(oracle)).not.toContain("ORACLE");
    const hiddenContract = handlers.call(
      "kb.get_contract",
      { contract_id: "CHK-HIDDEN-01" },
      pullContext({ attemptId: "hidden-contract" }),
    );
    const missingContract = handlers.call(
      "kb.get_contract",
      { contract_id: "NONEXISTENT-999" },
      pullContext({ attemptId: "missing-contract" }),
    );
    expect(hiddenContract).toEqual(missingContract);
    const hiddenSearch = handlers.call(
      "kb.search",
      { query: "hidden check" },
      pullContext({ attemptId: "hidden-search" }),
    );
    const emptySearch = handlers.call(
      "kb.search",
      { query: "no-such-concept-zz" },
      pullContext({ attemptId: "empty-search" }),
    );
    expect(hiddenSearch).toEqual(emptySearch);
    expect(hiddenSearch).toMatchObject({ ok: true, hits: [] });
    expect(JSON.stringify(hiddenSearch)).not.toContain("ORACLE");
    expect(JSON.stringify(hiddenSearch)).not.toContain("CHK-HIDDEN");
    const { handlers: oracleHandlers } = harness([
      knowledgeNode({
        id: "CHK-ORACLE-ONLY",
        kind: "check",
        title: "Held acceptance",
        prose: "ORACLEONLYMARKER must stay out of the pull",
        hidden: false,
        visibility: "oracle_only",
      }),
      knowledgeNode({ id: "N-Visible", title: "Visible note", prose: "ORACLEONLYMARKER is not here" }),
    ]);
    const oracleOnly = oracleHandlers.call(
      "kb.get_node",
      { node_id: "CHK-ORACLE-ONLY" },
      pullContext({ attemptId: "oracle-only" }),
    );
    const absent = oracleHandlers.call(
      "kb.get_node",
      { node_id: "NO-SUCH" },
      pullContext({ attemptId: "oracle-only-miss" }),
    );
    expect(oracleOnly).toEqual(absent);
    const oracleSearch = oracleHandlers.call(
      "kb.search",
      { query: "ORACLEONLYMARKER" },
      pullContext({ attemptId: "oracle-only-search" }),
    ) as { hits: { nodeId: string }[] };
    expect(oracleSearch.hits.map((hit) => hit.nodeId)).toEqual(["N-Visible"]);
    expect(JSON.stringify(oracleOnly)).not.toContain("ORACLEONLYMARKER");
    expect(recorder.anomalies.map((row) => row.queriedNodeId).sort()).toEqual([
      "CHK-HIDDEN-01",
      "ORACLE-007",
      null,
    ]);
  });

  it("logs search_reads and the pull analytics fields, including a zero-hit search", () => {
    const clock = steppingClock();
    const { handlers, searchReads, telemetry } = harness(sampleNodes(), clock);
    handlers.call(
      "kb.search",
      { query: "csv delimiter", types: ["note"] },
      pullContext({ attemptId: "A-1", taskId: "T-9", taskTags: ["api", "export"] }),
    );
    const row = searchReads.list()[0];
    expect(row?.hitCount).toBe(0);
    expect(row?.attempt).toBe("A-1");
    expect(row?.rev).toBe(7);
    expect(JSON.parse(row?.query ?? "{}")).toMatchObject({ query: "csv delimiter", limit: 10 });
    const payload = JSON.parse(telemetry.rows[0]?.data ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({
      attemptId: "A-1",
      taskId: "T-9",
      taskTags: ["api", "export"],
      toolName: "kb.search",
      queriedNodeId: null,
      wasInCouldIndex: false,
      wasNegativeMiss: true,
      latencyMs: clock.latency(),
    });
  });

  it("returns PULL_BUDGET_EXCEEDED after 25 calls in one turn and resets on the next turn", () => {
    const { handlers } = harness();
    const codes: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const response = handlers.call(
        "kb.get_node",
        { node_id: "C-ErrEnv" },
        pullContext({ attemptId: "budget", turnId: "turn-a" }),
      ) as { code: string; message?: string };
      codes.push(response.code);
      if (response.code === "PULL_BUDGET_EXCEEDED") {
        expect(response.message).toContain("proceed with current context or escalate");
        expect(response.message).toContain("harness.ask_owner");
      }
    }
    expect(codes.slice(0, MAX_PULL_CALLS_PER_TURN).every((code) => code === "OK")).toBe(true);
    expect(codes.slice(MAX_PULL_CALLS_PER_TURN).every((code) => code === "PULL_BUDGET_EXCEEDED")).toBe(
      true,
    );
    const nextTurn = handlers.call(
      "kb.get_node",
      { node_id: "C-ErrEnv" },
      pullContext({ attemptId: "budget", turnId: "turn-b" }),
    ) as { code: string };
    expect(nextTurn.code).toBe("OK");
  });

  it("refuses a response that would pass 24 KB and keeps returned bytes inside the cap", () => {
    const budget = new PullTurnBudget();
    expect(budget.consume("solo", MAX_PULL_BYTES_PER_TURN)).toBe(true);
    expect(budget.consume("solo", 1)).toBe(false);
    expect(budget.usage("solo")).toEqual({ calls: 2, bytes: MAX_PULL_BYTES_PER_TURN });

    const { handlers } = harness([
      knowledgeNode({
        id: "N-Wide",
        title: "Wide",
        prose: "w".repeat(2_000),
        band: "COULD",
      }),
    ]);
    const accepted: unknown[] = [];
    let exceeded = false;
    for (let index = 0; index < 40 && !exceeded; index += 1) {
      const response = handlers.call(
        "kb.get_node",
        { node_id: "N-Wide" },
        pullContext({ attemptId: "bytes", turnId: "wide" }),
      ) as { code: string };
      if (response.code === "PULL_BUDGET_EXCEEDED") exceeded = true;
      else accepted.push(response);
    }
    expect(exceeded).toBe(true);
    const returned = accepted.reduce((sum, response) => sum + utf8Bytes(response), 0);
    expect(returned).toBeLessThanOrEqual(MAX_PULL_BYTES_PER_TURN);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThan(MAX_PULL_CALLS_PER_TURN);
  });

  it("drops telemetry when telemetry.db is unavailable and still returns the node", () => {
    const recorder = new PullReadAnalyticsRecorder(
      new UnavailableTelemetryStore(),
      new InMemorySearchReadStore(),
    );
    const handlers = new KbPullToolHandlers({
      repo: new InMemoryFtsSearchRepo([knowledgeNode({ id: "N-1", title: "Kept" })]),
      recorder,
    });
    const response = handlers.call(
      "kb.get_node",
      { node_id: "N-1" },
      pullContext({ attemptId: "degraded" }),
    ) as { ok: boolean; node: { id: string } };
    expect(response.ok).toBe(true);
    expect(response.node.id).toBe("N-1");
    expect(recorder.warnings.map((warning) => warning.code)).toEqual(["TELEMETRY_DROPPED"]);
    expect(recorder.pulls).toHaveLength(1);
  });

  it("registers the four read-only tools on the leased MCP server and fences a stale epoch", () => {
    const { handlers } = harness();
    const server = new LocalLeasedMcpServer(4);
    handlers.register(server);
    expect(server.definitions().map((tool) => tool.name)).toEqual([
      "kb.search",
      "kb.get_node",
      "kb.get_contract",
      "kb.list_rules",
      "kb.list_rules_for_tags",
    ]);
    const listed = server.call(
      "kb.list_rules",
      { tags: ["money"] },
      pullContext({ attemptId: "rules-alias" }),
    ) as { rules: { id: string }[] };
    expect(listed.rules.map((rule) => rule.id)).toContain("X-04");
    expect(server.definitions().every((tool) => tool.readOnly)).toBe(true);
    const fenced = server.call(
      "kb.get_node",
      { node_id: "C-ErrEnv" },
      pullContext({ attemptId: "fenced", leaseEpoch: 3 }),
    ) as { code: string };
    expect(fenced.code).toBe("LEASE_FENCED");
    const current = server.call(
      "kb.get_node",
      { node_id: "C-ErrEnv" },
      pullContext({ attemptId: "current", leaseEpoch: 4 }),
    ) as { ok: boolean };
    expect(current.ok).toBe(true);
  });
});
