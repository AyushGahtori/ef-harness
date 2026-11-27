import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { bindKnowledgeGraph, openProjectStateDb } from "@ef-harness/db";
import { parseDataEnvelope, responseText } from "../../../mcp-server/src/index.js";
import type { AttemptMcpServer, CallToolResult } from "../../../mcp-server/src/index.js";
import { createWorld } from "../../../mcp-server/tests/support.js";
import {
  InMemorySearchReadStore,
  InMemoryTelemetryStore,
  KbPullToolHandlers,
  PullReadAnalyticsRecorder,
  projectStateFtsRepo,
} from "../../src/rule-matching/index.js";
import {
  BROWNFIELD_CONVENTION_TOKEN_CAP,
  KnowledgePacketSlicer,
  LEVEL_BUDGETS,
  SWEEP_SYMBOL_MAP_TOKEN_CAP,
  SqliteSliceGraph,
  countTokens,
  createSliceDatabase,
  insertEdge,
  insertNode,
  insertRuntime,
  insertScope,
  words,
  type ProjectPrefix,
} from "../../src/slicer/index.js";

const PROJECT: ProjectPrefix = {
  projectId: "cafe",
  stackOverview: "typescript node sqlite",
  universalRules: ["integer money", "utc storage"],
};

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("canonical brief and kb pull tools", () => {
  it("keeps Junior and Senior briefs inside their caps and refuses an oversized MUST band", () => {
    const db = createSliceDatabase();
    insertNode(db, {
      id: "T-Level",
      kind: "task",
      title: "T-Level",
      text: "Compile a sized brief",
      fields: { tags: ["api", "data"] },
    });
    insertRuntime(db, { task: "T-Level", feature: "F-Level", level: "Junior" });
    insertScope(db, "T-Level", "src/level/**", "write");
    for (let index = 0; index < 14; index += 1) {
      const id = `F-${index}`;
      insertNode(db, {
        id,
        kind: "research_fact",
        title: id,
        text: words(400, `fact${index}x`),
        fields: { verified: true, relevance: 100 - index },
      });
      insertEdge(db, { src: "T-Level", type: "depends_on", dst: id });
    }
    const graph = new SqliteSliceGraph(db).neighborhood("T-Level");
    const slicer = new KnowledgePacketSlicer();
    const junior = slicer.compileTaskBrief({ graph, project: PROJECT, tier: "Junior" });
    const senior = slicer.compileTaskBrief({ graph, project: PROJECT, tier: "Senior" });
    expect("code" in junior).toBe(false);
    expect("code" in senior).toBe(false);
    if ("code" in junior || "code" in senior) return;
    expect(junior.tier).toBe("Junior");
    expect(senior.tier).toBe("Senior");
    expect(junior.bands.MUST.every((item) => item.band === "MUST")).toBe(true);
    expect(junior.bands.SHOULD.every((item) => item.band === "SHOULD")).toBe(true);
    expect(junior.bands.COULD.every((item) => item.band === "COULD")).toBe(true);
    expect(junior.bands.COULD.map((item) => item.pointer)).toEqual(
      expect.arrayContaining(["kb.search", "kb.get_node", "kb.list_rules", "kb.get_contract"]),
    );
    expect(junior.brief.manifest.tokenBreakdown.total).toBeGreaterThanOrEqual(LEVEL_BUDGETS.junior.targetMin);
    expect(junior.brief.manifest.tokenBreakdown.total).toBeLessThanOrEqual(LEVEL_BUDGETS.junior.targetMax);
    expect(senior.brief.manifest.tokenBreakdown.total).toBeGreaterThanOrEqual(LEVEL_BUDGETS.senior.targetMin);
    expect(senior.brief.manifest.tokenBreakdown.total).toBeLessThanOrEqual(LEVEL_BUDGETS.senior.targetMax);

    const heavy = createSliceDatabase();
    insertNode(heavy, { id: "T-Mid", kind: "task", title: "T-Mid", text: words(3398, "mid"), fields: {} });
    insertRuntime(heavy, { task: "T-Mid", feature: "F-Mid", level: "junior" });
    insertScope(heavy, "T-Mid", "src/mid/**", "write");
    const heavyGraph = new SqliteSliceGraph(heavy).neighborhood("T-Mid");
    const refused = slicer.compileTaskBrief({ graph: heavyGraph, project: PROJECT, tier: "Junior" });
    expect(refused).toMatchObject({
      code: "MustBandOversizeRefusal",
      tier: "Junior",
      mustTokens: 3400,
      ceiling: LEVEL_BUDGETS.junior.mustRefusal,
    });
    const seniorHeavy = slicer.compileTaskBrief({ graph: heavyGraph, project: PROJECT, tier: "Senior" });
    expect("code" in seniorHeavy).toBe(false);
  });

  it("caps brownfield and sweep headers and promotes a could fact without cutting MUST", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Head", kind: "task", title: "T-Head", text: "Keep the must line", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Head", feature: "F-Head", level: "Mid" });
    insertScope(db, "T-Head", "src/head/**", "write");
    insertNode(db, { id: "REQ-1", kind: "spec_item", title: "Visible requirement", text: "MUSTBODY stays whole" });
    insertEdge(db, { src: "T-Head", type: "implements", dst: "REQ-1" });
    insertNode(db, { id: "F-Side", kind: "feature", title: "Side feature", text: "SIDEBODY stays available" });
    insertEdge(db, { src: "T-Head", type: "depends_on", dst: "F-Side" });
    const graph = new SqliteSliceGraph(db).neighborhood("T-Head");
    const slicer = new KnowledgePacketSlicer();
    const conventions = words(BROWNFIELD_CONVENTION_TOKEN_CAP + 100, "convention");
    const sweep = words(SWEEP_SYMBOL_MAP_TOKEN_CAP + 100, "symbol");
    const brief = slicer.compileTaskBrief({
      graph,
      project: PROJECT,
      tier: "Mid",
      brownfieldConventions: conventions,
      recentSweepSymbolMap: sweep,
    });
    expect("code" in brief).toBe(false);
    if ("code" in brief) return;
    expect(brief.tier).toBe("Mid");
    expect(brief.text).toContain("MUSTBODY stays whole");
    expect(brief.text).toContain("brownfield conventions:");
    expect(brief.text).toContain("[RECENT SWEEP SYMBOL MAP]");
    expect(brief.text).not.toContain(`convention${BROWNFIELD_CONVENTION_TOKEN_CAP}`);
    expect(brief.text).not.toContain(`symbol${SWEEP_SYMBOL_MAP_TOKEN_CAP}`);
    const conventionBody = sectionBody(brief.text, "brownfield conventions:", "[RECENT SWEEP SYMBOL MAP]");
    const sweepBody = sectionBody(brief.text, "[RECENT SWEEP SYMBOL MAP]", "## START");
    expect(countTokens(conventionBody)).toBeLessThanOrEqual(BROWNFIELD_CONVENTION_TOKEN_CAP);
    expect(countTokens(sweepBody)).toBeLessThanOrEqual(SWEEP_SYMBOL_MAP_TOKEN_CAP);
    expect(countTokens(conventionBody)).toBe(BROWNFIELD_CONVENTION_TOKEN_CAP);
    expect(countTokens(sweepBody)).toBe(SWEEP_SYMBOL_MAP_TOKEN_CAP);

    const before = slicer.compile(graph, { project: PROJECT, level: "junior" });
    expect(before.could.map((item) => item.id)).toContain("F-Side");
    slicer.upsertBand({
      projectId: PROJECT.projectId,
      tag: "api",
      nodeId: "F-Side",
      band: "SHOULD",
      effectiveWave: 0,
      tokenCost: 4,
      capped: false,
    });
    const promoted = slicer.compile(graph, { project: PROJECT, level: "junior" });
    expect(promoted.should.map((item) => item.id)).toContain("F-Side");
    expect(promoted.could.map((item) => item.id)).not.toContain("F-Side");
    expect(promoted.must.map((item) => item.text).join("\n")).toContain("MUSTBODY stays whole");
  });

  it("serves kb.search, kb.get_node, kb.list_rules, and kb.get_contract through AttemptMcpServer over ProjectStateDb", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c34-pull-"));
    dirs.push(root);
    const state = openProjectStateDb({ projectId: `C34Pull${String(Date.now())}`, rootDir: root });
    closers.unshift(() => {
      if (!state.isClosed()) state.close();
    });
    const graph = bindKnowledgeGraph(state);
    graph.commitChangeSet({
      id: "CS-C34-PULL",
      origin: "planner",
      author: "tester",
      summary: "seed pull nodes",
      createdAt: 1_700_000_000_000,
      nodes: [
        {
          op: "create",
          id: "C-Page",
          kind: "contract",
          title: "Pagination contract",
          text: "Cursor pagination for list endpoints.",
          status: "active",
          fields: {
            band: "COULD",
            schemas: [{ name: "Page", fields: ["cursor", "limit"] }],
            seams: [{ name: "list", method: "GET" }],
            errorCodes: ["INVALID_CURSOR"],
            canonical: { name: "C-Page" },
            tags: ["api"],
            couldIndex: true,
          },
        },
        {
          op: "create",
          id: "CHK-SEALED",
          kind: "check",
          title: "Held acceptance",
          text: "ORACLEONLYMARKER stays sealed",
          status: "active",
          fields: { visibility: "oracle_only", sealed: true, band: "MUST" },
        },
      ],
    });
    const recorder = new PullReadAnalyticsRecorder(new InMemoryTelemetryStore(), new InMemorySearchReadStore());
    const handlers = new KbPullToolHandlers({ repo: projectStateFtsRepo(state), recorder });
    const world = createWorld({ memory: true, kbPull: handlers });
    const client = await connect(world.server);
    closers.unshift(() => {
      void world.server.stop("accepted");
      void client.close();
    });

    const search = bodyOf(await call(client, "kb.search", { query: "pagination", limit: 10 }));
    expect(search).toMatchObject({ ok: true, source: "kb.search" });
    const searchHits = hitsOf(search);
    expect(searchHits).toContain("C-Page");
    expect(searchHits).not.toContain("CHK-SEALED");
    expect(JSON.stringify(search)).not.toContain("ORACLEONLYMARKER");

    const sealedSearch = bodyOf(await call(client, "kb.search", { query: "ORACLEONLYMARKER" }));
    expect(hitsOf(sealedSearch)).toEqual([]);
    expect(JSON.stringify(sealedSearch)).not.toContain("ORACLEONLYMARKER");

    const node = bodyOf(await call(client, "kb.get_node", { node_id: "C-Page" }));
    expect(node).toMatchObject({ ok: true, source: "kb.get_node", node: { id: "C-Page" } });
    const sealedNode = bodyOf(await call(client, "kb.get_node", { node_id: "CHK-SEALED" }));
    const missingNode = bodyOf(await call(client, "kb.get_node", { node_id: "NO-SUCH" }));
    expect(sealedNode).toEqual(missingNode);
    expect(sealedNode).toMatchObject({ ok: false, code: "NOT_FOUND", source: "kb.get_node" });
    expect(JSON.stringify(sealedNode)).not.toContain("ORACLEONLYMARKER");

    const contract = bodyOf(await call(client, "kb.get_contract", { contract_id: "C-Page" }));
    expect(contract).toMatchObject({
      ok: true,
      source: "kb.get_contract",
      contract: { id: "C-Page", errorCodes: ["INVALID_CURSOR"] },
    });
    const rules = bodyOf(await call(client, "kb.list_rules", { tags: ["money"] }));
    expect(rules).toMatchObject({ ok: true, source: "kb.list_rules" });
    const ruleIds = Array.isArray((rules as { rules?: unknown }).rules)
      ? (rules as { rules: { id: string }[] }).rules.map((rule) => rule.id)
      : [];
    expect(ruleIds).toContain("X-04");
    expect(recorder.pulls.map((row) => row.toolName)).toEqual([
      "kb.search",
      "kb.search",
      "kb.get_node",
      "kb.get_node",
      "kb.get_node",
      "kb.get_contract",
      "kb.list_rules",
    ]);
    expect(recorder.pulls.every((row) => row.workerLevel === "junior" || row.workerLevel === "senior")).toBe(true);
  });
});

function sectionBody(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < 0 || to <= from) return "";
  return text.slice(from + start.length, to).trim();
}

async function connect(server: AttemptMcpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ef-c34-pull", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
}

function bodyOf(result: CallToolResult): unknown {
  const text = responseText(result);
  const parsed = parseDataEnvelope(text);
  return parsed ? parsed.body : text;
}

function hitsOf(body: unknown): string[] {
  if (typeof body !== "object" || body === null || !("hits" in body)) return [];
  const hits = body.hits;
  if (!Array.isArray(hits)) return [];
  const ids: string[] = [];
  for (const hit of hits) {
    if (typeof hit === "object" && hit !== null && "nodeId" in hit && typeof hit.nodeId === "string") {
      ids.push(hit.nodeId);
    }
  }
  return ids;
}
