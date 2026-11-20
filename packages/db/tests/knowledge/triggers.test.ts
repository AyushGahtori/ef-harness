import { afterEach, describe, expect, it } from "vitest";
import { QueryCatalogError, KnowledgeGraphRepo, loadQueryCatalog, openKnowledgeGraph, readQueriesSql } from "../../src/knowledge/index.js";
import type { ChangeSetProposal } from "../../src/knowledge/index.js";

let repo: KnowledgeGraphRepo | undefined;

afterEach(() => {
  repo?.close();
  repo = undefined;
});

function openRepo(): KnowledgeGraphRepo {
  repo = openKnowledgeGraph();
  return repo;
}

function proposal(partial: Omit<ChangeSetProposal, "origin" | "author"> & Partial<ChangeSetProposal>): ChangeSetProposal {
  return {
    origin: partial.origin ?? "kernel",
    author: partial.author ?? "tester",
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

describe("schema trigger guards", () => {
  it("maintains node history, blocks deletes and version skips, and checks basis", () => {
    const graph = openRepo();
    const committed = graph.commitChangeSet(
      proposal({
        nodes: [{ op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "10:45", fields: { basis: "explicit" } }],
      }),
    );
    expect(graph.connection.prepare("SELECT version, valid_to_rev FROM node_versions WHERE id = 'R17'").all()).toEqual([
      { version: 1, valid_to_rev: null },
    ]);

    graph.commitChangeSet(
      proposal({
        reads: [{ target: "R17", version: 1 }],
        nodes: [{ op: "update", id: "R17", class: "breaking", text: "10:30" }],
      }),
    );
    expect(
      graph.connection.prepare("SELECT version, valid_from_rev, valid_to_rev FROM node_versions WHERE id = 'R17' ORDER BY version").all(),
    ).toEqual([
      { version: 1, valid_from_rev: committed.rev, valid_to_rev: committed.rev + 1 },
      { version: 2, valid_from_rev: committed.rev + 1, valid_to_rev: null },
    ]);
    const preserved = graph.connection.prepare("SELECT text FROM node_versions WHERE id = 'R17' AND version = 1").get();
    expect(preserved).toEqual({ text: "10:45" });

    expect(() => graph.connection.prepare("UPDATE nodes SET text = 'sneaky' WHERE id = 'R17'").run()).toThrow(/version/);
    expect(() => graph.connection.exec("DELETE FROM nodes WHERE id = 'R17'")).toThrow(/retired/);
    expect(graph.getNode("R17")?.text).toBe("10:30");

    expect(() =>
      graph.connection
        .prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
           VALUES ('D-BAD', 'decision', 1, 'hash', 'Bad', '', '{"basis":"chosen under delegation"}', :change_set, :rev, :rev)`,
        )
        .run({ change_set: committed.changeSetId, rev: committed.rev }),
    ).toThrow(/basis|CHECK/);
    expect(graph.getNode("D-BAD")).toBeNull();
  });

  it("bumps only the touched edge-set counters when an edge is added and retired", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "C-014", kind: "contract", title: "Totals", text: "" },
          { op: "create", id: "T07", kind: "task", title: "Print", text: "" },
          { op: "create", id: "NOTE-1", kind: "comment", title: "Note", text: "" },
        ],
        edges: [{ op: "create", src: "T07", type: "consumes_contract", dst: "C-014" }],
      }),
    );
    const consumersBefore = graph.getEdgeSetVersion("C-014", "in", "consumes_contract");
    const producerOutBefore = graph.getEdgeSetVersion("T07", "out", "consumes_contract");
    graph.commitChangeSet(
      proposal({ edges: [{ op: "create", src: "NOTE-1", type: "comments_on", dst: "C-014" }] }),
    );
    expect(graph.getEdgeSetVersion("C-014", "in", "comments_on")).toBe(1);
    expect(graph.getEdgeSetVersion("NOTE-1", "out", "comments_on")).toBe(1);
    expect(graph.getEdgeSetVersion("C-014", "in", "consumes_contract")).toBe(consumersBefore);
    expect(graph.getEdgeSetVersion("T07", "out", "consumes_contract")).toBe(producerOutBefore);

    graph.commitChangeSet(
      proposal({ edges: [{ op: "retire", src: "NOTE-1", type: "comments_on", dst: "C-014" }] }),
    );
    expect(graph.getEdgeSetVersion("C-014", "in", "comments_on")).toBe(2);
    expect(graph.getEdgeSetVersion("NOTE-1", "out", "comments_on")).toBe(2);
    expect(graph.getEdgeSetVersion("C-014", "in", "consumes_contract")).toBe(consumersBefore);
    expect(graph.getEdgeSetVersion("C-014", "in", "documents")).toBe(0);
  });

  it("loads canonical queries by name and rejects a bad binding", () => {
    const graph = openRepo();
    const catalog = loadQueryCatalog(graph.connection, readQueriesSql());
    expect(catalog.sql("allocate_id")).toContain("id_counters");
    expect(catalog.sql("validate_change_set_reads")).toContain("json_each");
    expect(catalog.sql("impact_walk")).toContain("invalidates = 1");
    expect(catalog.sql("asof_nodes")).toContain("valid_from_rev");
    expect(catalog.sql("asof_edges")).toContain("valid_to_rev");
    expect(catalog.sql("export_dirty_nodes")).toContain("node_changes");
    expect(() => catalog.sql("not_a_query")).toThrow(QueryCatalogError);
    expect(() => catalog.all("allocate_id", {})).toThrow(QueryCatalogError);
    expect(() => catalog.all("allocate_id", { prefix: "T", extra: 1 })).toThrow(QueryCatalogError);
  });
});
