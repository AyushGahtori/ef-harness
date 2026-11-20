import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FakeModelAdapter,
  LocalExportPauseLock,
  LocalRevisionFeed,
  LocalSqliteKnowledgeGraph,
  LocalViewManifestHashScanner,
  MarkdownDirectEditImporter,
  writeCanonicalViews,
  type DocImportRequest,
  type FieldMap,
} from "../../src/views-import/index.js";

const CLOCK = 1_700_000_000_000;

export interface Harness {
  readonly root: string;
  readonly viewsRoot: string;
  readonly graph: LocalSqliteKnowledgeGraph;
  readonly pause: LocalExportPauseLock;
  readonly revisions: LocalRevisionFeed;
  readonly model: FakeModelAdapter;
  readonly importer: MarkdownDirectEditImporter;
  close(): void;
}

export function createHarness(respond?: (input: DocImportRequest) => unknown): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-import-"));
  const viewsRoot = path.join(root, ".harness", "views");
  const graph = LocalSqliteKnowledgeGraph.open(":memory:");
  const pause = new LocalExportPauseLock();
  const scanner = new LocalViewManifestHashScanner();
  const revisions = new LocalRevisionFeed();
  const model = new FakeModelAdapter(
    respond ??
      (() => {
        throw new Error("doc-import@1 must not run for structured field edits");
      }),
  );
  const importer = new MarkdownDirectEditImporter({
    graph,
    pause,
    scanner,
    model,
    revisions,
    viewsRoot,
    clock: () => CLOCK,
  });
  return {
    root,
    viewsRoot,
    graph,
    pause,
    revisions,
    model,
    importer,
    close() {
      graph.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function orderFields(extra: FieldMap = {}): FieldMap {
  return {
    basis: "explicit",
    cutoff_time: "11:00",
    feature: "F-Orders",
    names: [{ kind: "title", value: "Cutoff Rule R17" }],
    priority: "normal",
    status: "draft",
    touches: ["scheduling"],
    ...extra,
  };
}

export function seedOrders(graph: LocalSqliteKnowledgeGraph, prose = "Orders close at 11:00."): void {
  graph.commitChangeSet({
    id: "CS-SEED-1",
    origin: "planner",
    author: "test",
    summary: "seed orders",
    createdAt: CLOCK,
    nodes: [
      {
        op: "create",
        id: "F-Orders",
        kind: "feature",
        title: "Orders",
        text: "Order feature",
        fields: { feature: "F-Orders" },
        status: "active",
      },
      {
        op: "create",
        id: "R17",
        kind: "rule",
        title: "Cutoff Rule R17",
        text: prose,
        fields: orderFields(),
        status: "active",
      },
      {
        op: "create",
        id: "T-Order",
        kind: "task",
        title: "Order form",
        text: "Build the order form.",
        fields: { feature: "F-Orders" },
        status: "active",
      },
    ],
    edges: [
      { op: "create", src: "R17", type: "belongs_to", dst: "F-Orders" },
      { op: "create", src: "T-Order", type: "obeys", dst: "R17" },
    ],
  });
  graph.insertTaskRuntime("T-Order", "F-Orders", "READY", 1);
}

export function seedMove(graph: LocalSqliteKnowledgeGraph): void {
  graph.commitChangeSet({
    id: "CS-SEED-MOVE",
    origin: "planner",
    author: "test",
    summary: "seed move",
    createdAt: CLOCK,
    nodes: [
      { op: "create", id: "F-A", kind: "feature", title: "Feature A", text: "", fields: { feature: "F-A" } },
      { op: "create", id: "F-B", kind: "feature", title: "Feature B", text: "", fields: { feature: "F-B" } },
      {
        op: "create",
        id: "R17",
        kind: "rule",
        title: "Cutoff Rule R17",
        text: "Orders close at 11:00.",
        fields: { ...orderFields(), feature: "F-A" },
      },
      {
        op: "create",
        id: "T-Order",
        kind: "task",
        title: "Order form",
        text: "Build the order form.",
        fields: { feature: "F-A" },
      },
    ],
    edges: [
      { op: "create", src: "R17", type: "belongs_to", dst: "F-A" },
      { op: "create", src: "T-Order", type: "obeys", dst: "R17" },
    ],
  });
}

export function exportOrders(harness: Harness, proseNodeIds: readonly string[] = ["R17"]): void {
  writeCanonicalViews({
    graph: harness.graph,
    viewsRoot: harness.viewsRoot,
    exportedAt: CLOCK,
    files: [
      {
        filePath: "features/orders.md",
        featureId: "F-Orders",
        efFile: "features/orders",
        title: "Orders",
        nodeIds: proseNodeIds,
      },
    ],
  });
}

export function exportMove(harness: Harness): void {
  writeCanonicalViews({
    graph: harness.graph,
    viewsRoot: harness.viewsRoot,
    exportedAt: CLOCK,
    files: [
      {
        filePath: "features/feature-a.md",
        featureId: "F-A",
        efFile: "features/feature-a",
        title: "Feature A",
        nodeIds: ["R17"],
      },
      {
        filePath: "features/feature-b.md",
        featureId: "F-B",
        efFile: "features/feature-b",
        title: "Feature B",
        nodeIds: [],
      },
    ],
  });
}

export function ordersFile(harness: Harness): string {
  return path.join(harness.viewsRoot, "features", "orders.md");
}

export function readView(harness: Harness, relative: string): string {
  return fs.readFileSync(path.join(harness.viewsRoot, ...relative.split("/")), "utf8");
}

export function writeView(harness: Harness, relative: string, text: string): void {
  const full = path.join(harness.viewsRoot, ...relative.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text.replaceAll("\r\n", "\n"), "utf8");
}

export function replaceLine(text: string, prefix: string, next: string): string {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index < 0) throw new Error(`missing line ${prefix}`);
  lines[index] = next;
  return lines.join("\n");
}

export function remoteFields(graph: LocalSqliteKnowledgeGraph, id: string, patch: FieldMap, changeId: string): void {
  const current = graph.getNode(id);
  if (!current) throw new Error(`missing ${id}`);
  graph.commitChangeSet({
    id: changeId,
    origin: "chat",
    author: "coordinator",
    summary: "remote field update",
    createdAt: CLOCK,
    nodes: [
      {
        op: "update",
        id,
        class: "compatible",
        expectedVersion: current.version,
        fields: { ...current.fields, ...patch },
      },
    ],
  });
}

export function removeBlock(text: string, nodeId: string): string {
  const lines = text.split("\n");
  const open = lines.findIndex((line) => line.startsWith(`<!-- ef:node id=${nodeId} `));
  const close = lines.findIndex((line, index) => index > open && line === "<!-- /ef:node -->");
  if (open < 0 || close < 0) throw new Error(`block ${nodeId} not found`);
  return lines.filter((_, index) => index < open || index > close).join("\n");
}

export function stripMarkers(text: string, nodeId: string): string {
  return text
    .split("\n")
    .filter((line) => !(line.startsWith(`<!-- ef:node id=${nodeId} `) || line === "<!-- /ef:node -->"))
    .join("\n");
}

export function moveBlock(from: string, to: string, nodeId: string): { fromText: string; toText: string } {
  const lines = from.split("\n");
  const open = lines.findIndex((line) => line.startsWith(`<!-- ef:node id=${nodeId} `));
  const close = lines.findIndex((line, index) => index > open && line === "<!-- /ef:node -->");
  if (open < 0 || close < 0) throw new Error(`block ${nodeId} not found`);
  const block = lines.slice(open, close + 1).join("\n");
  return {
    fromText: lines.filter((_, index) => index < open || index > close).join("\n"),
    toText: `${to.replace(/\n$/, "")}\n\n${block}\n`,
  };
}

export function breakTouchesOnLine42(text: string): string {
  const lines = text.split("\n");
  const open = lines.findIndex((line) => line === "```ef-fields");
  const close = lines.findIndex((line, index) => index > open && line === "```");
  if (open < 0 || close < 0) throw new Error("ef-fields fence missing");
  const head = lines.slice(0, open + 1);
  const tail = lines.slice(close);
  const startLine = head.length + 1;
  const blanks = 42 - startLine;
  if (blanks < 0) throw new Error(`exported file is already past line 42 (${String(startLine)})`);
  return [...head, ...Array.from({ length: blanks }, () => ""), "touches: [auth,", ...tail].join("\n");
}

export function markdownCount(graph: LocalSqliteKnowledgeGraph): number {
  return graph.listChangeSets().filter((changeSet) => changeSet.author === "user:markdown_view").length;
}
