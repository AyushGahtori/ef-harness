import { describe, expect, it } from "vitest";
import {
  BandTokenBudgeter,
  BriefLayoutCompiler,
  BriefManifestStore,
  KnowledgePacketSlicer,
  LocalSkillSelector,
  OracleLeakError,
  OversizedMustTaskError,
  SqliteSliceGraph,
  countTokens,
  createSliceDatabase,
  insertAttempt,
  insertEdge,
  insertModuleCard,
  insertNode,
  insertRuntime,
  insertScope,
  reviseNode,
  shouldPointer,
  tokenIndexOf,
  words,
  type ProjectPrefix,
  type SkillRecord,
} from "../../src/slicer/index.js";

const PROJECT: ProjectPrefix = {
  projectId: "cafe",
  stackOverview: "typescript node sqlite",
  universalRules: ["integer money", "utc storage"],
};

function skill(id: string, touches: readonly string[], text: string, status: SkillRecord["vettingStatus"] = "vetted"): SkillRecord {
  return {
    skillId: id,
    version: "1",
    sha256: `sha256:${id}`,
    tokenCount: countTokens(text),
    vettingStatus: status,
    allowedRoles: ["leaf-worker"],
    allowedTouches: touches,
    text,
  };
}

function compileOf(
  db: ReturnType<typeof createSliceDatabase>,
  taskId: string,
  extra: { level?: "junior" | "senior"; skills?: readonly SkillRecord[]; attemptId?: string } = {},
) {
  return new KnowledgePacketSlicer().compile(new SqliteSliceGraph(db).neighborhood(taskId), {
    project: PROJECT,
    ...extra,
  });
}

describe("knowledge packet slicer", () => {
  it("partitions must, should, and could and keeps a stable slice hash", () => {
    const db = createSliceDatabase();
    insertNode(db, {
      id: "T-Api",
      kind: "task",
      title: "T-Api",
      text: "Expose the order endpoint",
      fields: { tags: ["api", "data"], role: "leaf-worker" },
    });
    insertRuntime(db, { task: "T-Api", feature: "F-Orders", level: "junior" });
    insertScope(db, "T-Api", "src/orders/**", "write");
    insertNode(db, { id: "REQ-1", kind: "spec_item", title: "List orders", text: "When the caller is signed in the endpoint shall return the page." });
    insertEdge(db, { src: "T-Api", type: "implements", dst: "REQ-1" });
    insertNode(db, {
      id: "F-9",
      kind: "research_fact",
      title: "Pagination fact",
      text: "FACT9 verified page size",
      fields: { verified: true, relevance: 100 },
    });
    insertEdge(db, { src: "T-Api", type: "cites", dst: "F-9" });
    insertNode(db, { id: "C-Stub", kind: "contract", title: "Sibling stub", text: "stub signature", fields: { stub: true } });
    insertEdge(db, { src: "T-Api", type: "depends_on", dst: "C-Stub" });
    insertModuleCard(db, { path: "src/orders/list.ts", fileHash: "abc", summary: "list handler card" });
    insertNode(db, { id: "F-Print", kind: "feature", title: "Print feature", text: words(50, "printbody") });
    insertEdge(db, { src: "T-Api", type: "depends_on", dst: "F-Print" });
    insertNode(db, {
      id: "U-Fact",
      kind: "research_fact",
      title: "Unverified",
      text: "UNVERIFIED should stay out",
      fields: { verified: false },
    });
    insertEdge(db, { src: "T-Api", type: "cites", dst: "U-Fact" });

    const first = compileOf(db, "T-Api", { skills: [skill("api-security-hardening@1", ["api"], "check auth on every route")] });
    const second = compileOf(db, "T-Api", { skills: [skill("api-security-hardening@1", ["api"], "check auth on every route")] });

    expect(first.must.map((item) => item.id)).toContain("REQ-1");
    expect(first.must.map((item) => item.kind)).toContain("rule");
    expect(first.should.map((item) => item.id)).toEqual(expect.arrayContaining(["F-9", "C-Stub", "src/orders/list.ts", "api-security-hardening@1"]));
    expect(first.should.map((item) => item.id)).not.toContain("U-Fact");
    expect(first.could.map((item) => item.pointer)).toEqual(expect.arrayContaining(["kb.search", "kb.get_fact", "Print feature"]));
    expect(first.text).not.toContain("UNVERIFIED");
    expect(first.text).not.toContain("printbody0");
    expect(first.text).toBe(second.text);
    expect(first.manifest.sliceSha256).toBe(second.manifest.sliceSha256);
    expect(first.manifest.sliceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.packet.schema).toBe("task-packet@1");
    expect(first.packet.budget.usd).toBe(0);
    expect(first.manifest.includedNodeIds).toEqual([...first.manifest.includedNodeIds].sort());
  });

  it("keeps junior briefs inside 2-3k and senior briefs inside 4-6k", () => {
    const db = createSliceDatabase();
    insertNode(db, {
      id: "T-Level",
      kind: "task",
      title: "T-Level",
      text: "Compile a sized brief",
      fields: { tags: ["api", "data"] },
    });
    insertRuntime(db, { task: "T-Level", feature: "F-Level", level: "junior" });
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
    const junior = compileOf(db, "T-Level", { level: "junior" });
    const senior = compileOf(db, "T-Level", { level: "senior" });
    expect(junior.manifest.tokenBreakdown.total).toBeGreaterThanOrEqual(2000);
    expect(junior.manifest.tokenBreakdown.total).toBeLessThanOrEqual(3000);
    expect(junior.manifest.tokenBreakdown.total).toBeLessThanOrEqual(3200);
    expect(senior.manifest.tokenBreakdown.total).toBeGreaterThanOrEqual(4000);
    expect(senior.manifest.tokenBreakdown.total).toBeLessThanOrEqual(6000);
    expect(senior.manifest.tokenBreakdown.total).toBeLessThanOrEqual(6400);
    expect(junior.must.map((item) => item.id)).toEqual(senior.must.map((item) => item.id));
    expect(junior.trimmed.length).toBeGreaterThan(0);
    expect(senior.should.length).toBeGreaterThan(junior.should.length);
  });

  it("refuses an oversized checkout must band with per-node attribution", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Checkout", kind: "task", title: "T-Checkout", text: "Checkout", fields: {} });
    insertRuntime(db, { task: "T-Checkout", feature: "F-Checkout", level: "junior" });
    insertScope(db, "T-Checkout", "src/checkout/**", "write");
    const entities: ReadonlyArray<readonly [string, number]> = [
      ["Order", 2100],
      ["Payment", 2400],
      ["Tax", 1800],
      ["Discount", 1],
      ["Address", 1],
    ];
    for (const [title, count] of entities) {
      insertNode(db, { id: `E-${title}`, kind: "arch_node", title, text: words(count, title.toLowerCase()), fields: { archKind: "entity" } });
      insertEdge(db, { src: "T-Checkout", type: "touches", dst: `E-${title}` });
    }
    for (let index = 0; index < 8; index += 1) {
      insertNode(db, { id: `EP-${index}`, kind: "contract", title: `Endpoint ${index}`, text: `endpoint${index}` });
      insertEdge(db, { src: "T-Checkout", type: "consumes_contract", dst: `EP-${index}` });
    }
    for (let index = 0; index < 33; index += 1) {
      insertNode(db, { id: `REQ-${index}`, kind: "spec_item", title: `Requirement ${index}`, text: `req${index}` });
      insertEdge(db, { src: "T-Checkout", type: "implements", dst: `REQ-${index}` });
    }
    const padding = 7800 - (1 + 1 + 1 + 2100 + 2400 + 1800 + 1 + 1 + 8 + 33);
    insertNode(db, { id: "REQ-Ship", kind: "spec_item", title: "Shipping", text: words(padding, "ship") });
    insertEdge(db, { src: "T-Checkout", type: "implements", dst: "REQ-Ship" });

    const slicer = new KnowledgePacketSlicer();
    expect(() => compileOf(db, "T-Checkout")).toThrow(OversizedMustTaskError);
    try {
      slicer.compile(new SqliteSliceGraph(db).neighborhood("T-Checkout"), { project: PROJECT });
    } catch (error) {
      expect(error).toBeInstanceOf(OversizedMustTaskError);
      const refusal = error as OversizedMustTaskError;
      expect(refusal.mustTokens).toBe(7800);
      expect(refusal.attribution.find((row) => row.title === "Order")?.label).toBe("Order: 2.1k");
      expect(refusal.attribution.find((row) => row.title === "Payment")?.label).toBe("Payment: 2.4k");
      expect(refusal.attribution.find((row) => row.title === "Tax")?.label).toBe("Tax: 1.8k");
      expect(refusal.summary.length).toBeGreaterThan(0);
    }
  });

  it("recommends a junior split or a senior assignment when must is 3400", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Mid", kind: "task", title: "T-Mid", text: words(3398, "mid"), fields: {} });
    insertRuntime(db, { task: "T-Mid", feature: "F-Mid", level: "junior" });
    insertScope(db, "T-Mid", "src/mid/**", "write");
    try {
      compileOf(db, "T-Mid");
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(OversizedMustTaskError);
      const refusal = error as OversizedMustTaskError;
      expect(refusal.mustTokens).toBe(3400);
      expect(refusal.recommendations.map((row) => row.action)).toEqual(["Split into 2 Junior tasks", "Assign Senior level"]);
      expect(refusal.recommendations.map((row) => row.estimatedUsd)).toEqual([0.1, 0.4]);
      expect(refusal.summary).toContain("Split into 2 Junior tasks");
      expect(refusal.summary).toContain("Assign Senior level");
    }
  });

  it("strips sealed oracle nodes and logs OracleLeakPreventedAssertion", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Leak", kind: "task", title: "T-Leak", text: "Keep the oracle sealed", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Leak", feature: "F-Leak", level: "junior" });
    insertScope(db, "T-Leak", "src/leak/**", "write");
    insertNode(db, { id: "REQ-05", kind: "spec_item", title: "Visible requirement", text: "VISIBLE-REQ-05 stays in the brief" });
    insertEdge(db, { src: "T-Leak", type: "implements", dst: "REQ-05" });
    insertNode(db, {
      id: "sealed_oracle:HC-1",
      kind: "check",
      title: "Hidden check",
      text: "SEALED-ORACLE-BODY must not leak",
      fields: { sealed: true, hidden: true, author: "oracle-author@1", nodeClass: "hidden_check" },
    });
    insertEdge(db, { src: "T-Leak", type: "verifies", dst: "sealed_oracle:HC-1" });
    insertEdge(db, { src: "sealed_oracle:HC-1", type: "verifies", dst: "REQ-05" });
    const brief = compileOf(db, "T-Leak");
    expect(brief.leaks.map((leak) => leak.code)).toContain("OracleLeakPreventedAssertion");
    expect(brief.leaks.find((leak) => leak.nodeId === "sealed_oracle:HC-1")?.linkedTo).toContain("REQ-05");
    expect(brief.text).not.toContain("SEALED-ORACLE-BODY");
    expect(brief.text).not.toContain("sealed_oracle:HC-1");
    expect(brief.packet.checks_hidden_count).toBe(1);
    expect(brief.packet.checks_visible).not.toContain("sealed_oracle:HC-1");
    for (const band of [brief.must, brief.should, brief.could]) {
      expect(band.map((item) => item.id)).not.toContain("sealed_oracle:HC-1");
    }
    expect(() =>
      new BriefLayoutCompiler().compile({
        level: "junior",
        project: PROJECT,
        goal: "x",
        writeScope: ["src/**"],
        readScope: ["anything"],
        must: [
          {
            id: "sealed_oracle:HC-1",
            kind: "check",
            title: "Hidden",
            text: "nope",
            band: "must",
            version: 1,
            contentHash: "x",
            reasons: [],
            relevance: 1,
            contractRole: null,
            synthetic: false,
            pointer: null,
            excerpt: false,
            sealed: true,
          },
        ],
        should: [],
        could: [],
      }),
    ).toThrow(OracleLeakError);
  });

  it("lays out start, middle, and an end checklist and moves overflow should items to could", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Lay", kind: "task", title: "T-Lay", text: "Lay out the brief", fields: { tags: ["api", "data"] } });
    insertRuntime(db, { task: "T-Lay", feature: "F-Lay", level: "junior" });
    insertScope(db, "T-Lay", "src/lay/**", "write");
    insertNode(db, { id: "REQ-Keep", kind: "spec_item", title: "Keep me", text: words(1800, "keptreq") });
    insertEdge(db, { src: "T-Lay", type: "implements", dst: "REQ-Keep" });
    insertNode(db, {
      id: "F-High",
      kind: "research_fact",
      title: "High fact",
      text: `HIGHFACT ${words(400, "high")}`,
      fields: { verified: true, relevance: 100 },
    });
    insertNode(db, {
      id: "F-12",
      kind: "research_fact",
      title: "Low fact",
      text: `LOWFACT12 ${words(1500, "low")}`,
      fields: { verified: true, relevance: 1 },
    });
    insertEdge(db, { src: "T-Lay", type: "cites", dst: "F-High" });
    insertEdge(db, { src: "T-Lay", type: "cites", dst: "F-12" });
    const brief = compileOf(db, "T-Lay", {
      skills: [skill("skill-a", ["api"], words(200, "skilla")), skill("skill-b", ["data"], words(200, "skillb"))],
    });
    const start = brief.text.indexOf("## START");
    const middle = brief.text.indexOf("## MIDDLE");
    const end = brief.text.indexOf("## END");
    const checklist = brief.text.indexOf("## Verification & Non-Negotiable Acceptance Checklist");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(middle);
    expect(middle).toBeLessThan(end);
    expect(end).toBeLessThan(checklist);
    expect(brief.text).toContain("kb.get_fact('F-12')");
    expect(brief.text).not.toContain("LOWFACT12");
    expect(brief.text).toContain("HIGHFACT");
    expect(brief.text).toContain("keptreq0");
    expect(brief.must.map((item) => item.id)).toContain("REQ-Keep");
    const body = brief.text.slice(0, checklist);
    const ruleLine = "X-02 validates boundary input and bounds every list query.";
    expect(body.split(ruleLine).length - 1).toBe(1);
    expect(brief.manifest.trimmedShouldIds).toContain("F-12");
    expect(brief.manifest.tokenBreakdown.total).toBeLessThanOrEqual(3200);
  });

  it("includes only api and data rules and stays near 2100 tokens", () => {
    const db = createSliceDatabase();
    insertNode(db, {
      id: "T-Crisp",
      kind: "task",
      title: "T-Crisp",
      text: "Serve the api",
      fields: { tags: ["api", "data"] },
    });
    insertRuntime(db, { task: "T-Crisp", feature: "F-Crisp", level: "junior" });
    insertScope(db, "T-Crisp", "src/api/**", "write");
    insertNode(db, {
      id: "Screen-Print",
      kind: "arch_node",
      title: "Print screen",
      text: `WEBSPEC ${words(20000, "web")}`,
      fields: { archKind: "screen" },
    });
    insertEdge(db, { src: "T-Crisp", type: "documents", dst: "Screen-Print" });
    insertNode(db, { id: "F-Web", kind: "feature", title: "Print feature", text: `WEBSPEC ${words(5000, "dump")}` });
    insertEdge(db, { src: "F-Crisp", type: "depends_on", dst: "F-Web" });
    const probe = compileOf(db, "T-Crisp");
    expect(probe.matchedRuleIds).toEqual(["UP-02", "UP-03", "X-01", "X-02"]);
    expect(probe.text).not.toContain("WEBSPEC");
    expect(probe.text).not.toContain("X-04 uses integer");
    expect(probe.text).not.toContain("X-13 gives interactive");
    const withOne = addFact(1);
    const overhead = withOne.total - probe.manifest.tokenBreakdown.total - 1;
    const body = 2100 - probe.manifest.tokenBreakdown.total - overhead;
    const landed = addFact(body);
    expect(landed.total).toBe(2100);
    expect(landed.text).not.toContain("WEBSPEC");
    const regions = new BriefLayoutCompiler().regions(landed.text);
    expect(tokenIndexOf(landed.text, "goal:") / regions.total).toBeLessThan(0.2);
    expect(regions.checklistStartsAt / regions.total).toBeGreaterThanOrEqual(0.85);

    function addFact(count: number) {
      const next = createSliceDatabase();
      insertNode(next, {
        id: "T-Crisp",
        kind: "task",
        title: "T-Crisp",
        text: "Serve the api",
        fields: { tags: ["api", "data"] },
      });
      insertRuntime(next, { task: "T-Crisp", feature: "F-Crisp", level: "junior" });
      insertScope(next, "T-Crisp", "src/api/**", "write");
      insertNode(next, {
        id: "Screen-Print",
        kind: "arch_node",
        title: "Print screen",
        text: `WEBSPEC ${words(20000, "web")}`,
        fields: { archKind: "screen" },
      });
      insertEdge(next, { src: "T-Crisp", type: "documents", dst: "Screen-Print" });
      insertNode(next, { id: "F-Web", kind: "feature", title: "Print feature", text: `WEBSPEC ${words(5000, "dump")}` });
      insertEdge(next, { src: "F-Crisp", type: "depends_on", dst: "F-Web" });
      insertNode(next, {
        id: "F-Fill",
        kind: "research_fact",
        title: "Fill",
        text: words(count, "fill"),
        fields: { verified: true, relevance: 100 },
      });
      insertEdge(next, { src: "T-Crisp", type: "cites", dst: "F-Fill" });
      const brief = compileOf(next, "T-Crisp");
      return { total: brief.manifest.tokenBreakdown.total, text: brief.text };
    }
  });

  it("dedupes a rule reached by feature, entity, and tag paths", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Dedup", kind: "task", title: "T-Dedup", text: "Dedup the rule", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Dedup", feature: "F-Dedup", level: "junior" });
    insertScope(db, "T-Dedup", "src/dedup/**", "write");
    insertNode(db, { id: "F-Dedup", kind: "feature", title: "Dedup feature", text: "feature body" });
    insertEdge(db, { src: "T-Dedup", type: "belongs_to", dst: "F-Dedup" });
    insertNode(db, {
      id: "X-01",
      kind: "rule",
      title: "Role check",
      text: "RULEBODY X-01 appears once",
      fields: { ruleId: "X-01" },
    });
    insertEdge(db, { src: "F-Dedup", type: "obeys", dst: "X-01" });
    insertNode(db, { id: "E-Order", kind: "arch_node", title: "Order", text: "entity body", fields: { archKind: "entity", tags: ["api"] } });
    insertEdge(db, { src: "T-Dedup", type: "touches", dst: "E-Order" });
    insertEdge(db, { src: "E-Order", type: "obeys", dst: "X-01" });
    const brief = compileOf(db, "T-Dedup");
    const rule = brief.must.find((item) => item.id === "X-01");
    expect(rule?.reasons).toEqual(["task→entity→rule", "task→feature→rule", "task→tag→rule"]);
    const checklist = brief.text.indexOf("## Verification");
    expect(brief.text.slice(0, checklist).split("RULEBODY X-01 appears once").length - 1).toBe(1);
  });

  it("emits each directly linked and inherited rule once", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Once", kind: "task", title: "T-Once", text: "Once each", fields: { tags: ["api", "data"] } });
    insertRuntime(db, { task: "T-Once", feature: "F-Once", level: "junior" });
    insertNode(db, { id: "X-01", kind: "rule", title: "Role", text: "ONCE-X01", fields: { ruleId: "X-01" } });
    insertNode(db, { id: "X-02", kind: "rule", title: "Input", text: "ONCE-X02", fields: { ruleId: "X-02" } });
    insertEdge(db, { src: "T-Once", type: "obeys", dst: "X-01" });
    insertEdge(db, { src: "T-Once", type: "obeys", dst: "X-02" });
    insertNode(db, { id: "E-1", kind: "arch_node", title: "Entity", text: "e", fields: { archKind: "entity" } });
    insertEdge(db, { src: "T-Once", type: "touches", dst: "E-1" });
    insertEdge(db, { src: "E-1", type: "obeys", dst: "X-01" });
    insertEdge(db, { src: "E-1", type: "obeys", dst: "X-02" });
    const brief = compileOf(db, "T-Once");
    expect(brief.must.filter((item) => item.id === "X-01")).toHaveLength(1);
    expect(brief.must.filter((item) => item.id === "X-02")).toHaveLength(1);
    const checklist = brief.text.indexOf("## Verification");
    const body = brief.text.slice(0, checklist);
    expect(body.split("ONCE-X01").length - 1).toBe(1);
    expect(body.split("ONCE-X02").length - 1).toBe(1);
  });

  it("keeps the project prefix identical for sibling tasks", () => {
    const db = createSliceDatabase();
    for (const id of ["T-A", "T-B"]) {
      insertNode(db, { id, kind: "task", title: id, text: id === "T-A" ? "alpha goal" : "beta goal", fields: { tags: ["data"] } });
      insertRuntime(db, { task: id, feature: "F-Shared", level: "junior" });
    }
    const left = compileOf(db, "T-A").text.split("## START")[0];
    const right = compileOf(db, "T-B").text.split("## START")[0];
    expect(left).toBe(right);
    expect(left?.startsWith("project: cafe\nstack: typescript node sqlite\nuniversal:\n- integer money\n- utc storage")).toBe(true);
  });

  it("reconstructs the pinned brief after a later requirement revision", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Hist", kind: "task", title: "T-Hist", text: "Historical brief", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Hist", feature: "F-Hist", level: "junior" });
    insertNode(db, { id: "R-7", kind: "spec_item", title: "Cutoff", text: "cutoff stays 10:45 Berlin" });
    insertEdge(db, { src: "T-Hist", type: "implements", dst: "R-7" });
    insertAttempt(db, { id: "attempt-1", task: "T-Hist", briefVersion: 1 });
    const slicer = new KnowledgePacketSlicer();
    const original = slicer.compile(new SqliteSliceGraph(db).neighborhood("T-Hist"), {
      project: PROJECT,
      attemptId: "attempt-1",
    });
    new BriefManifestStore(db).save(original.manifest);
    reviseNode(db, "R-7", "cutoff moved to 10:00");
    const current = slicer.compile(new SqliteSliceGraph(db).neighborhood("T-Hist"), { project: PROJECT });
    const restored = slicer.reconstruct(new SqliteSliceGraph(db), original.manifest);
    expect(current.text).not.toBe(original.text);
    expect(current.text).toContain("cutoff moved to 10:00");
    expect(restored).toBe(original.text);
    expect(restored).toContain("cutoff stays 10:45 Berlin");
    const stored = new BriefManifestStore(db).read("attempt-1");
    expect(stored?.sliceSha256).toBe(original.manifest.sliceSha256);
    const read = db.prepare(`SELECT how, hash FROM read_sets WHERE attempt = ? AND node = ?`).get("attempt-1", "R-7") as {
      how: string;
      hash: string;
    };
    expect(read.how).toBe("pushed");
    expect(read.hash).toBe(original.manifest.nodeHashes["R-7"]);
  });

  it("selects at most two vetted skills under the combined token cap", () => {
    const selector = new LocalSkillSelector();
    const chosen = selector.selectForTask({
      role: "leaf-worker",
      touches: ["api"],
      skills: [
        skill("quarantine@1", ["api"], words(10, "q"), "quarantined"),
        skill("big-a@1", ["api"], words(2000, "a")),
        skill("big-b@1", ["api"], words(2000, "b")),
        skill("small@1", ["api"], words(20, "s")),
      ],
    });
    expect(chosen.selected.every((entry) => entry.vettingStatus === "vetted")).toBe(true);
    expect(chosen.selected.length).toBeLessThanOrEqual(2);
    expect(chosen.selected.reduce((sum, entry) => sum + countTokens(entry.text), 0)).toBeLessThanOrEqual(3500);
    expect(chosen.selected.map((entry) => entry.skillId)).not.toContain("quarantine@1");
  });

  it("trims a 4200 token should band down to an 1800 token budget", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Trim", kind: "task", title: "T-Trim", text: "Trim", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Trim", feature: "F-Trim", level: "junior" });
    const facts = [
      ["F-1", 100, 1050],
      ["F-2", 90, 1050],
      ["F-3", 80, 1050],
      ["F-12", 10, 1050],
    ] as const;
    for (const [id, relevance, count] of facts) {
      insertNode(db, {
        id,
        kind: "research_fact",
        title: id,
        text: words(count, id.toLowerCase()),
        fields: { verified: true, relevance },
      });
    }
    const graph = new SqliteSliceGraph(db).neighborhood("T-Trim");
    const loaded = facts.map(([id, relevance]) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      if (!node) throw new Error(`missing ${id}`);
      return { id, kind: "research_fact", relevance, text: node.text, tokens: countTokens(node.text) };
    });
    const skills = [skill("skill-a", ["api"], words(200, "sa")), skill("skill-b", ["api"], words(200, "sb"))];
    const budgeter = new BandTokenBudgeter();
    const result = budgeter.trimShould(
      [
        ...loaded,
        ...skills.map((entry) => ({
          id: entry.skillId,
          kind: "skill",
          relevance: 50,
          text: entry.text,
          tokens: countTokens(entry.text),
        })),
      ],
      1800,
    );
    expect(result.kept.reduce((sum, item) => sum + item.tokens, 0)).toBeLessThanOrEqual(1800);
    expect(result.trimmed.map((item) => item.id)).toContain("F-12");
    expect(shouldPointer({ id: "F-12", kind: "research_fact", version: 1 })).toBe("kb.get_fact('F-12')");
    expect(result.kept.map((item) => item.id)).toContain("F-1");
  });

  it("adds senior failure-mode excerpts and leaves them out of the junior brief", () => {
    const db = createSliceDatabase();
    insertNode(db, { id: "T-Fail", kind: "task", title: "T-Fail", text: "Handle failure", fields: { tags: ["api"] } });
    insertRuntime(db, { task: "T-Fail", feature: "F-Fail", level: "senior" });
    insertNode(db, {
      id: "C-Pay",
      kind: "contract",
      title: "Payment contract",
      text: "payment contract body",
      fields: { failureModes: "FAILMODE timeout then dead letter" },
    });
    insertEdge(db, { src: "T-Fail", type: "consumes_contract", dst: "C-Pay" });
    const senior = compileOf(db, "T-Fail", { level: "senior" });
    const junior = compileOf(db, "T-Fail", { level: "junior" });
    expect(senior.text).toContain("FAILMODE timeout then dead letter");
    expect(junior.text).not.toContain("FAILMODE");
    expect(senior.packet.contracts).toEqual([{ id: "C-Pay", v: 1, role: "consume" }]);
  });
});
