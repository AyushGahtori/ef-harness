import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindKnowledgeGraph, bindTaskHolds, openProjectStateDb } from "@ef-harness/db";
import { KnowledgeViewExporter } from "../../src/views-export/exporter.js";
import { MemoryKnowledgeViewSource, type ViewEdge, type ViewNode } from "../../src/views-export/knowledge-graph-port.js";
import { ExportPauseLock } from "../../src/views-export/locks.js";
import { FakeModelAdapter } from "../../src/views-import/model.js";
import { MarkdownDirectEditImporter } from "../../src/views-import/importer.js";
import { ProjectStateKnowledgeGraph } from "../../src/views-import/project-graph.js";
import { LocalRevisionFeed } from "../../src/views-import/revisions.js";
import { LocalViewManifestHashScanner } from "../../src/views-import/scanner.js";
import { HybridRevisionEngine, ProjectStateHoldWriter, openRevisionDatabase } from "../../src/revisions/index.js";
import { edit, insertNode, insertTask } from "../revisions/fixture.js";
import { fakeGit } from "../views-export/fixtures.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("views round trip on ProjectStateDb", () => {
  it("imports one edited requirement and places requirement_change holds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c33-views-"));
    dirs.push(root);
    const stateDb = openProjectStateDb({ projectId: `C33Views${String(Date.now())}`, rootDir: root });
    const graph = new ProjectStateKnowledgeGraph(stateDb);
    closers.unshift(() => {
      if (!stateDb.isClosed()) stateDb.close();
    });

    const nodes = seedNodes();
    graph.commitChangeSet({
      id: "CS-SEED-VIEWS",
      origin: "planner",
      author: "test",
      summary: "seed views",
      createdAt: 1_700_000_000_000,
      nodes,
      edges: [{ op: "create", src: "T-Orders", type: "implements", dst: "SI-Cutoff" }],
    });
    stateDb.writer
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
         VALUES (?, 'F-Orders', 'CODING', 'Mid', 1, 1)`,
      )
      .run(["T-Orders"]);
    expect(graph.listNodeIds()).toHaveLength(20);

    const source = new MemoryKnowledgeViewSource();
    for (const id of graph.listNodeIds()) {
      const node = graph.getNode(id);
      if (node) source.upsertNode(toViewNode(node));
    }
    source.replaceEdges(graph.listCurrentEdges().map(toViewEdge));
    const exporter = new KnowledgeViewExporter({
      projectRoot: root,
      source,
      pauseLock: new ExportPauseLock(),
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const exported = await exporter.exportAll();
    expect(exported.paused).toEqual([]);
    expect(exported.written.length).toBeGreaterThan(0);

    const viewsRoot = path.join(root, ".harness", "views");
    const absolute = findView(viewsRoot, "SI-Cutoff");
    const relative = path.relative(viewsRoot, absolute).replaceAll("\\", "/");
    expect(relative).toBe("requirements.md");
    const original = fs.readFileSync(absolute, "utf8");
    expect(original).toContain('cutoff: "11:00"');
    expect(original).toContain("base_hash=sha256:");
    fs.writeFileSync(absolute, original.replace('cutoff: "11:00"', 'cutoff: "10:30"'), "utf8");

    const importer = new MarkdownDirectEditImporter({
      graph,
      pause: new ExportPauseLock(),
      scanner: new LocalViewManifestHashScanner(),
      model: new FakeModelAdapter(() => {
        throw new Error("doc-import@1 must not run for a structured field edit");
      }),
      revisions: new LocalRevisionFeed(),
      viewsRoot,
      clock: () => 1_700_000_000_000,
    });
    const session = importer.reconcile();
    expect(session.blockedBatch).toBe(false);
    expect(session.conflicts).toEqual([]);
    expect(session.schemaErrors).toEqual([]);
    const saved = graph.getNode("SI-Cutoff");
    expect(saved?.text).toBe("Orders close at 11:00.");
    expect(saved?.fields.cutoff).toBe("10:30");
    expect(saved?.version).toBe(2);

    const knowledge = bindKnowledgeGraph(stateDb);
    const revisionDb = openRevisionDatabase();
    insertNode(revisionDb, {
      id: "SI-Cutoff",
      kind: "spec_item",
      title: "Cutoff requirement",
      text: "Orders close at 11:00.",
      fields: { basis: "explicit", cutoff: "11:00", touches: ["scheduling"] },
    });
    insertNode(revisionDb, { id: "T-Orders", kind: "task", title: "Order form", text: "Build the order form." });
    insertTask(revisionDb, { id: "T-Orders", state: "CODING", title: "Order form" });
    const engine = new HybridRevisionEngine({
      db: revisionDb,
      impact: {
        impactWalk(startId, maxDepth) {
          return knowledge.impactWalk(startId, maxDepth).nodes;
        },
      },
      holds: new ProjectStateHoldWriter(bindTaskHolds(stateDb), () => knowledge.currentRevision()),
    });
    const batch = engine.commitBatch({
      edits: [
        edit({
          nodeId: "SI-Cutoff",
          nodeKind: "spec_item",
          beforeText: "Orders close at 11:00.",
          afterText: "Orders close at 11:00.",
          beforeFields: { cutoff: "11:00" },
          afterFields: { cutoff: "10:30" },
        }),
      ],
      triggerSource: "markdown",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("breaking");
    expect(batch.holdTaskIds).toEqual(["T-Orders"]);
    const holds = stateDb.writer.prepare("SELECT task, reason FROM task_holds ORDER BY task, reason").all();
    expect(holds).toEqual([{ task: "T-Orders", reason: "requirement_change" }]);
    revisionDb.close();
  });
});

interface SeedNode {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: { readonly basis: "explicit"; readonly touches?: readonly string[]; readonly cutoff?: string; readonly feature?: string };
  readonly status: "active";
}

function seedNodes(): SeedNode[] {
  const nodes: SeedNode[] = [
    {
      op: "create",
      id: "F-Orders",
      kind: "feature",
      title: "Orders",
      text: "Order feature",
      fields: { basis: "explicit", feature: "F-Orders" },
      status: "active",
    },
    {
      op: "create",
      id: "SI-Cutoff",
      kind: "spec_item",
      title: "Cutoff requirement",
      text: "Orders close at 11:00.",
      fields: { basis: "explicit", touches: ["scheduling"], cutoff: "11:00" },
      status: "active",
    },
    {
      op: "create",
      id: "T-Orders",
      kind: "task",
      title: "Order form",
      text: "Build the order form.",
      fields: { basis: "explicit", feature: "F-Orders" },
      status: "active",
    },
  ];
  for (let index = 1; index <= 17; index += 1) {
    const id = `R${String(index).padStart(2, "0")}`;
    nodes.push({
      op: "create",
      id,
      kind: "rule",
      title: `Rule ${id}`,
      text: `Rule body ${id}.`,
      fields: { basis: "explicit", touches: ["logging"] },
      status: "active",
    });
  }
  return nodes;
}

function toViewNode(node: {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly createdRev: number;
  readonly updatedRev: number;
}): ViewNode {
  return {
    id: node.id,
    kind: node.kind,
    version: node.version,
    contentHash: node.contentHash,
    title: node.title,
    text: node.text,
    fields: node.fields,
    status: node.status === "draft" || node.status === "retired" || node.status === "superseded" ? node.status : "active",
    feature: node.feature,
    basis: node.basis,
    ownerRole: null,
    createdRev: node.createdRev,
    updatedRev: node.updatedRev,
  };
}

function toViewEdge(edge: { readonly src: string; readonly type: string; readonly dst: string }): ViewEdge {
  return {
    src: edge.src,
    type: edge.type,
    dst: edge.dst,
    dstVersionPin: null,
    validFromRev: 1,
    validToRev: null,
  };
}

function findView(viewsRoot: string, id: string): string {
  const stack = [viewsRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const text = fs.readFileSync(full, "utf8");
      if (text.includes(`id=${id} `)) return full;
    }
  }
  throw new Error(`missing view for ${id}`);
}
