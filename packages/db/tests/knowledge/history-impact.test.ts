import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidCursorError,
  KnowledgeGraphRepo,
  UnknownNodeVersionError,
  openKnowledgeGraph,
} from "../../src/knowledge/index.js";
import type { ChangeSetProposal, EdgeAsOf } from "../../src/knowledge/index.js";

let repo: KnowledgeGraphRepo | undefined;

afterEach(() => {
  repo?.close();
  repo = undefined;
});

function openRepo(): KnowledgeGraphRepo {
  repo = openKnowledgeGraph();
  return repo;
}

function proposal(
  partial: Omit<ChangeSetProposal, "origin" | "author"> & Partial<ChangeSetProposal>,
): ChangeSetProposal {
  return {
    origin: partial.origin ?? "planner",
    author: partial.author ?? "tester",
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    ...partial,
  };
}

function filler(graph: KnowledgeGraphRepo, id: string): number {
  const committed = graph.commitChangeSet(
    proposal({ nodes: [{ op: "create", id, kind: "comment", title: id, text: "" }] }),
  );
  return committed.rev;
}

describe("temporal history, dirty export, and impact", () => {
  it("returns the historical node and excludes edges that were not yet valid", () => {
    const graph = openRepo();
    const r1 = graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "10:45" },
          { op: "create", id: "NOTE-1", kind: "comment", title: "Note", text: "" },
        ],
      }),
    ).rev;
    const r2 = graph.commitChangeSet(
      proposal({ edges: [{ op: "create", src: "NOTE-1", type: "comments_on", dst: "R17" }] }),
    ).rev;
    const r3 = graph.commitChangeSet(
      proposal({
        reads: [{ target: "R17", version: 1 }],
        nodes: [{ op: "update", id: "R17", class: "breaking", text: "10:30" }],
      }),
    ).rev;

    const early = graph.getSnapshotAsOf(r1);
    const later = graph.getSnapshotAsOf(r3);
    expect(early.nodes.find((node) => node.id === "R17")).toMatchObject({ version: 1, title: "Cutoff" });
    expect(later.nodes.find((node) => node.id === "R17")).toMatchObject({ version: 2, title: "Cutoff" });
    expect(early.edges.some((edge) => edge.src === "NOTE-1")).toBe(false);
    expect(later.edges).toEqual<EdgeAsOf[]>([{ src: "NOTE-1", type: "comments_on", dst: "R17" }]);
    expect(graph.getNodeAsOf("R17", r1)?.text).toBe("10:45");
    expect(graph.getNodeAsOf("R17", r1)?.validToRev).toBe(r3);
    expect(graph.getNodeAsOf("R17", r3)?.text).toBe("10:30");
    expect(graph.getNodeAsOf("R17", r3)?.validToRev).toBeNull();
    expect(graph.getEdgesAsOf(r1).edges).toEqual([]);
    expect(graph.getEdgesAsOf(r2).edges).toHaveLength(1);

    const history = graph.connection
      .prepare("SELECT version, text, valid_to_rev FROM node_versions WHERE id = 'R17' ORDER BY version")
      .all();
    expect(history).toEqual([
      { version: 1, text: "10:45", valid_to_rev: r3 },
      { version: 2, text: "10:30", valid_to_rev: null },
    ]);
  });

  it("pages snapshots with keyset cursors and rejects a tampered cursor", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "A", kind: "rule", title: "A", text: "" },
          { op: "create", id: "B", kind: "rule", title: "B", text: "" },
          { op: "create", id: "C", kind: "rule", title: "C", text: "" },
        ],
        edges: [
          { op: "create", src: "B", type: "depends_on", dst: "A" },
          { op: "create", src: "C", type: "depends_on", dst: "A" },
        ],
      }),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = graph.getSnapshotAsOf(1, {
        limit: 1,
        ...(cursor === undefined ? {} : { nodeAfter: cursor }),
      });
      pages += 1;
      expect(page.nodes).toHaveLength(1);
      const id = page.nodes[0]?.id;
      expect(id).toBeDefined();
      if (id) seen.push(id);
      cursor = page.nodesNextCursor ?? undefined;
      expect(page.hasMoreNodes).toBe(cursor !== undefined);
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(["A", "B", "C"]);
    expect(() => graph.getSnapshotAsOf(1, { nodeAfter: "not a cursor" })).toThrow(InvalidCursorError);

    const wide = graph.getSnapshotAsOf(1, { limit: 99_999 });
    expect(wide.nodes).toHaveLength(3);
    expect(wide.edges).toHaveLength(2);
  });

  it("retires an edge at revision 5 and re-adds it at revision 8", () => {
    const graph = openRepo();
    const created = graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "SRC", kind: "task", title: "Src", text: "" },
          { op: "create", id: "DST", kind: "task", title: "Dst", text: "" },
        ],
        edges: [{ op: "create", src: "SRC", type: "depends_on", dst: "DST" }],
      }),
    );
    expect(created.rev).toBe(1);
    expect(filler(graph, "F2")).toBe(2);
    expect(filler(graph, "F3")).toBe(3);
    expect(filler(graph, "F4")).toBe(4);
    const retired = graph.commitChangeSet(
      proposal({ edges: [{ op: "retire", src: "SRC", type: "depends_on", dst: "DST" }] }),
    );
    expect(retired.rev).toBe(5);
    expect(filler(graph, "F6")).toBe(6);
    expect(filler(graph, "F7")).toBe(7);
    const again = graph.commitChangeSet(
      proposal({ edges: [{ op: "create", src: "SRC", type: "depends_on", dst: "DST" }] }),
    );
    expect(again.rev).toBe(8);
    const intervals = graph.connection
      .prepare(
        `SELECT valid_from_rev, valid_to_rev FROM edges
          WHERE src = 'SRC' AND type = 'depends_on' AND dst = 'DST'
          ORDER BY valid_from_rev`,
      )
      .all();
    expect(intervals).toEqual([
      { valid_from_rev: 1, valid_to_rev: 5 },
      { valid_from_rev: 8, valid_to_rev: null },
    ]);
    expect(graph.getEdgesAsOf(4).edges).toEqual([{ src: "SRC", type: "depends_on", dst: "DST" }]);
    expect(graph.getEdgesAsOf(5).edges).toEqual([]);
    expect(graph.getEdgesAsOf(8).edges).toEqual([{ src: "SRC", type: "depends_on", dst: "DST" }]);
  });

  it("exports nodes dirtied by node changes and edge intervals", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "A", kind: "rule", title: "A", text: "one" },
          { op: "create", id: "B", kind: "task", title: "B", text: "" },
        ],
      }),
    );
    expect(graph.exportDirtyNodes(0)).toEqual(["A", "B"]);
    expect(graph.getDirtyNodesSince(1)).toEqual([]);
    graph.commitChangeSet(
      proposal({
        reads: [{ target: "A", version: 1 }],
        nodes: [{ op: "update", id: "A", class: "breaking", text: "two" }],
        edges: [{ op: "create", src: "B", type: "obeys", dst: "A" }],
      }),
    );
    expect(graph.getDirtyNodesSince(1).sort()).toEqual(["A", "B"]);
  });

  it("walks a cycle without hanging and stops a long chain at depth 6", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "A", kind: "task", title: "A", text: "" },
          { op: "create", id: "B", kind: "task", title: "B", text: "" },
        ],
        edges: [
          { op: "create", src: "A", type: "depends_on", dst: "B" },
          { op: "create", src: "B", type: "depends_on", dst: "A" },
        ],
      }),
    );
    const started = performance.now();
    const cycle = graph.impactWalk("A", 100);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(cycle.nodes.map((node) => node.id).sort()).toEqual(["A", "B"]);
    expect(cycle.reason === undefined || cycle.reason === "time_budget_exceeded").toBe(true);

    const chainNodes = Array.from({ length: 9 }, (_, index) => ({
      op: "create" as const,
      id: `H${String(index)}`,
      kind: "task" as const,
      title: `H${String(index)}`,
      text: "",
    }));
    const chainEdges = Array.from({ length: 8 }, (_, index) => ({
      op: "create" as const,
      src: `H${String(index + 1)}`,
      type: "depends_on" as const,
      dst: `H${String(index)}`,
    }));
    graph.commitChangeSet(proposal({ nodes: chainNodes, edges: chainEdges }));
    const bounded = graph.impactWalk("H0", 100);
    expect(bounded.nodes.map((node) => node.id)).toEqual(["H0", "H1", "H2", "H3", "H4", "H5", "H6"]);
    expect(bounded.partial).toBe(true);
    expect(bounded.reason).toBe("depth_cap");
    expect(bounded.frontier).toContain("H7");
    expect(bounded.frontier).not.toContain("H8");
  });

  it("marks a 5100-node fanout partial at the 5000-node cap", () => {
    const graph = openRepo();
    const childCount = 5_100;
    const nodes = [
      { op: "create" as const, id: "HUB", kind: "rule" as const, title: "Hub", text: "" },
    ];
    const edges = [];
    for (let index = 0; index < childCount; index += 1) {
      const id = `N${String(index).padStart(4, "0")}`;
      nodes.push({ op: "create", id, kind: "task", title: id, text: "" });
      edges.push({ op: "create" as const, src: id, type: "depends_on" as const, dst: "HUB" });
    }
    graph.commitChangeSet(proposal({ nodes, edges }));
    const impact = graph.impactWalk("HUB");
    expect(impact.partial).toBe(true);
    expect(impact.reason).toBe("node_cap_exceeded");
    expect(impact.nodes).toHaveLength(5_000);
    expect(impact.nodes[0]).toEqual({ id: "HUB", depth: 0 });
    expect(impact.frontier).toHaveLength(101);
    const seen = new Set(impact.nodes.map((node) => node.id));
    for (const id of impact.frontier) expect(seen.has(id)).toBe(false);
    expect(impact.nodes.every((node) => node.depth <= 6)).toBe(true);
  }, 180_000);

  it("rejects evidence that cites a version the node never had", () => {
    const graph = openRepo();
    graph.commitChangeSet(proposal({ nodes: [{ op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "" }] }));
    expect(() =>
      graph.recordEvidence({
        node: "R17",
        nodeVersion: 9,
        sourceKind: "repo",
        sourceRef: "path@abc",
        locator: { line: 1 },
        quote: "Cutoff",
      }),
    ).toThrow(UnknownNodeVersionError);
    expect(graph.connection.prepare("SELECT count(*) AS n FROM evidence").get()).toEqual({ n: 0 });
  });
});
