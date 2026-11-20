import { afterEach, describe, expect, it } from "vitest";
import {
  DanglingReferenceError,
  DuplicateLogicalNameError,
  InvalidBasisError,
  KnowledgeBarrierError,
  KnowledgeGraphRepo,
  StaleReadSetError,
  computeNodeContentHash,
  formatEntityId,
  openKnowledgeGraph,
} from "../../src/knowledge/index.js";
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
    origin: partial.origin ?? "planner",
    author: partial.author ?? "tester",
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    ...partial,
  };
}

describe("knowledge change sets", () => {
  it("commits disjoint edits and rejects a second writer that read the same node version", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "10:45", fields: { basis: "explicit" } },
          { op: "create", id: "LOGIN-1", kind: "rule", title: "Login", text: "password", fields: { basis: "explicit" } },
        ],
      }),
    );

    const first = graph.commitChangeSet(
      proposal({
        origin: "chat",
        reads: [{ target: "R17", version: 1 }],
        nodes: [{ op: "update", id: "R17", class: "breaking", text: "10:30" }],
      }),
    );
    const second = graph.commitChangeSet(
      proposal({
        origin: "markdown_edit",
        reads: [{ target: "LOGIN-1", version: 1 }],
        nodes: [{ op: "update", id: "LOGIN-1", class: "clarifying", text: "password or email" }],
      }),
    );
    expect(first.noop).toBe(false);
    expect(second.noop).toBe(false);
    expect(first.rev).not.toBe(second.rev);
    expect(graph.getNode("R17")?.version).toBe(2);
    expect(graph.getNode("LOGIN-1")?.version).toBe(2);

    let caught: unknown;
    try {
      graph.commitChangeSet(
        proposal({
          reads: [{ target: "R17", version: 1 }],
          nodes: [{ op: "update", id: "R17", class: "breaking", text: "10:00" }],
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StaleReadSetError);
    expect((caught as StaleReadSetError).entries).toEqual([
      { target: "R17", readVersion: 1, currentVersion: 2 },
    ]);
    expect(graph.getNode("R17")?.text).toBe("10:30");
    expect(graph.currentRevision()).toBe(second.rev);
  });

  it("keeps a negative edge-set read at version 0 stale after the first consumer arrives", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "C-014", kind: "contract", title: "Totals", text: "" },
          { op: "create", id: "T07", kind: "task", title: "Print", text: "" },
          { op: "create", id: "LOGIN-1", kind: "rule", title: "Login", text: "v1" },
        ],
      }),
    );
    expect(graph.getEdgeSetVersion("C-014", "in", "consumes_contract")).toBe(0);

    graph.commitChangeSet(
      proposal({
        edges: [{ op: "create", src: "T07", type: "consumes_contract", dst: "C-014" }],
      }),
    );
    expect(graph.getEdgeSetVersion("C-014", "in", "consumes_contract")).toBe(1);

    let caught: unknown;
    try {
      graph.commitChangeSet(
        proposal({
          reads: [
            { target: "C-014", dir: "in", edgeType: "consumes_contract", version: 0 },
            { target: "LOGIN-1", version: 1 },
          ],
          nodes: [{ op: "update", id: "LOGIN-1", class: "compatible", text: "v2" }],
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StaleReadSetError);
    expect((caught as StaleReadSetError).entries).toEqual([
      {
        target: "C-014",
        dir: "in",
        edgeType: "consumes_contract",
        readVersion: 0,
        currentVersion: 1,
      },
    ]);
    expect(graph.getNode("LOGIN-1")?.text).toBe("v1");
  });

  it("does not let a comment edge bump consumes_contract or enter the impact walk", () => {
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
    const before = graph.getEdgeSetVersion("C-014", "in", "consumes_contract");
    graph.commitChangeSet(
      proposal({
        edges: [{ op: "create", src: "NOTE-1", type: "comments_on", dst: "C-014" }],
      }),
    );
    expect(graph.getEdgeSetVersion("C-014", "in", "comments_on")).toBe(1);
    expect(graph.getEdgeSetVersion("NOTE-1", "out", "comments_on")).toBe(1);
    expect(graph.getEdgeSetVersion("C-014", "in", "consumes_contract")).toBe(before);
    const committed = graph.commitChangeSet(
      proposal({
        reads: [{ target: "C-014", dir: "in", edgeType: "consumes_contract", version: before }],
        nodes: [{ op: "update", id: "C-014", class: "cosmetic", title: "Totals contract" }],
      }),
    );
    expect(committed.noop).toBe(false);
    const impact = graph.impactWalk("C-014");
    expect(impact.nodes.map((node) => node.id)).toContain("T07");
    expect(impact.nodes.map((node) => node.id)).not.toContain("NOTE-1");
    if (impact.partial) expect(impact.reason).toBe("time_budget_exceeded");
  });

  it("normalizes NFC text, skips identical content, and hashes key order identically", () => {
    const graph = openRepo();
    const nfd = "cafe\u0301";
    const nfc = "caf\u00e9";
    graph.commitChangeSet(
      proposal({
        nodes: [
          { op: "create", id: "R1", kind: "rule", title: nfd, text: nfd, fields: { note: nfd, b: 1, a: -0 } },
          { op: "create", id: "R2", kind: "rule", title: nfc, text: nfc, fields: { a: 0, b: 1, note: nfc } },
        ],
      }),
    );
    const first = graph.getNode("R1");
    const second = graph.getNode("R2");
    expect(first?.title).toBe(nfc);
    expect(first?.text).toBe(nfc);
    expect(first?.title).toHaveLength(4);
    expect(first?.fields).toEqual({ note: nfc, b: 1, a: 0 });
    expect(first?.contentHash).toBe(second?.contentHash);
    expect(first?.contentHash).toBe(
      computeNodeContentHash({ kind: "rule", title: nfc, text: nfc, fields: { a: 0, note: nfc, b: 1 } }),
    );

    const revision = graph.currentRevision();
    const versions = graph.connection.prepare("SELECT count(*) AS n FROM node_versions").get();
    const noop = graph.commitChangeSet(
      proposal({
        reads: [{ target: "R1", version: 1 }],
        nodes: [{ op: "update", id: "R1", class: "cosmetic", title: nfd, text: nfd, fields: { b: 1, a: 0, note: nfc } }],
      }),
    );
    expect(noop).toEqual({ rev: revision, changeSetId: null, noop: true, idempotent: false });
    expect(graph.getNode("R1")?.version).toBe(1);
    expect(graph.connection.prepare("SELECT count(*) AS n FROM node_versions").get()).toEqual(versions);
  });

  it("rejects an unknown basis before write and rolls a dangling edge back completely", () => {
    const graph = openRepo();
    expect(() =>
      graph.commitChangeSet(
        proposal({
          nodes: [
            {
              op: "create",
              id: "D-BAD",
              kind: "decision",
              title: "Bad",
              text: "",
              fields: { basis: "chosen under delegation" },
            },
          ],
        }),
      ),
    ).toThrow(InvalidBasisError);
    expect(graph.currentRevision()).toBe(0);

    expect(() =>
      graph.commitChangeSet(
        proposal({
          nodes: [{ op: "create", id: "A", kind: "rule", title: "A", text: "" }],
          edges: [{ op: "create", src: "A", type: "depends_on", dst: "MISSING" }],
        }),
      ),
    ).toThrow(DanglingReferenceError);
    expect(graph.getNode("A")).toBeNull();
    expect(graph.connection.prepare("SELECT count(*) AS n FROM change_sets").get()).toEqual({ n: 0 });
    expect(graph.currentRevision()).toBe(0);
  });

  it("refuses to join an open transaction and retries an explicit change set id", () => {
    const graph = openRepo();
    graph.connection.exec("BEGIN IMMEDIATE");
    try {
      expect(() =>
        graph.commitChangeSet(
          proposal({ nodes: [{ op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "" }] }),
        ),
      ).toThrow(KnowledgeBarrierError);
    } finally {
      graph.connection.exec("ROLLBACK");
    }
    expect(graph.getNode("R17")).toBeNull();

    const committed = graph.commitChangeSet(
      proposal({
        id: "CS-88",
        nodes: [{ op: "create", id: "R17", kind: "rule", title: "Cutoff", text: "10:45" }],
      }),
    );
    const retry = graph.commitChangeSet(
      proposal({
        id: "CS-88",
        nodes: [{ op: "create", id: "OTHER", kind: "rule", title: "Other", text: "" }],
      }),
    );
    expect(retry).toEqual({ rev: committed.rev, changeSetId: "CS-88", noop: false, idempotent: true });
    expect(graph.getNode("OTHER")).toBeNull();
    expect(graph.getNode("R17")?.version).toBe(1);
  });

  it("allocates ids once, including after retirement, and stores turns plus evidence", () => {
    const graph = openRepo();
    expect(formatEntityId("T", 7)).toBe("T07");
    expect(formatEntityId("R", 17)).toBe("R17");
    expect(formatEntityId("A", 14)).toBe("A0014");
    expect(graph.allocateEntityId("T")).toBe("T01");
    const retired = graph.allocateEntityId("R");
    expect(retired).toBe("R01");
    graph.commitChangeSet(
      proposal({
        nodes: [{ op: "create", id: retired, kind: "rule", title: "Temp", text: "one" }],
      }),
    );
    graph.commitChangeSet(
      proposal({
        reads: [{ target: retired, version: 1 }],
        nodes: [{ op: "retire", id: retired, status: "retired" }],
      }),
    );
    expect(graph.allocateEntityId("R")).toBe("R02");
    expect(graph.getNode(retired)?.status).toBe("retired");
    const allocated = graph.commitChangeSet(
      proposal({
        nodes: [{ op: "create", idPrefix: "C-", kind: "contract", title: "Generated", text: "" }],
      }),
    );
    expect(allocated.changeSetId).toMatch(/^CS-/);
    const generated = graph.connection.prepare("SELECT id FROM nodes WHERE title = 'Generated'").get();
    expect(generated).toEqual({ id: "C-001" });

    const turn = graph.recordTurn({
      id: "turn-1",
      author: "developer",
      target: retired,
      text: "cafe\u0301",
      audioArtifact: null,
      createdAt: 10,
    });
    expect(turn.text).toBe("caf\u00e9");
    const evidence = graph.recordEvidence({
      node: retired,
      nodeVersion: 2,
      sourceKind: "turn",
      sourceRef: "turn-1",
      sourceHash: "sha256:abc",
      locator: { quote: "cafe\u0301", page: 1 },
      quote: "cafe\u0301",
      verified: true,
    });
    expect(evidence.quote).toBe("caf\u00e9");
    expect(evidence.verified).toBe(true);
    expect(evidence.id).toBeGreaterThan(0);
    const stored = graph.connection.prepare("SELECT quote, locator FROM evidence WHERE id = :id").get({ id: evidence.id });
    expect(stored?.quote).toBe("caf\u00e9");
    expect(String(stored?.locator)).toContain("caf\u00e9");
  });

  it("aborts a duplicate logical name inside the publishing change set", () => {
    const graph = openRepo();
    graph.commitChangeSet(
      proposal({
        nodes: [
          {
            op: "create",
            id: "T07",
            kind: "task",
            title: "Print",
            text: "",
            fields: { names: [{ kind: "page_route", value: "/kitchen" }] },
          },
        ],
      }),
    );
    expect(() =>
      graph.commitChangeSet(
        proposal({
          nodes: [
            {
              op: "create",
              id: "T99",
              kind: "task",
              title: "Other",
              text: "",
              fields: { names: [{ kind: "page_route", value: "/kitchen" }] },
            },
          ],
        }),
      ),
    ).toThrow(DuplicateLogicalNameError);
    expect(graph.getNode("T99")).toBeNull();
  });
});
