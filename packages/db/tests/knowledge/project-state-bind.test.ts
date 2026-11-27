import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DuplicateLogicalNameError,
  InvalidProposalError,
  bindKnowledgeGraph,
  type ChangeSetProposal,
} from "../../src/knowledge/index.js";
import { CodeNameAuditError, bindNameRegistry } from "../../src/registry/index.js";
import { bindKnowledgeSearch } from "../../src/search/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function proposal(
  partial: Omit<ChangeSetProposal, "origin" | "author"> & Partial<ChangeSetProposal>,
): ChangeSetProposal {
  return {
    origin: partial.origin ?? "kernel",
    author: partial.author ?? "tester",
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

function openBundle() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c07-state-"));
  dirs.push(rootDir);
  const stateDb = openProjectStateDb({ projectId: "C07State", rootDir });
  closers.unshift(() => {
    if (!stateDb.isClosed()) stateDb.close();
  });
  return {
    stateDb,
    graph: bindKnowledgeGraph(stateDb),
    search: bindKnowledgeSearch(stateDb),
    registry: bindNameRegistry(stateDb),
  };
}

describe("ProjectStateDb knowledge, search, and name registry", () => {
  it("writes a node, fills kb_words and names, and keeps sha256: content hashes", () => {
    const { graph, search, registry } = openBundle();
    const fields = {
      feature: "F12",
      basis: "explicit" as const,
      names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
    };
    graph.commitChangeSet(
      proposal({
        nodes: [
          {
            op: "create",
            id: "R17",
            kind: "rule",
            title: "XMLHttpRequest cutoff",
            text: "Parse XMLHttpRequest bodies before cutoff",
            fields,
          },
        ],
      }),
    );

    const stored = graph.getNode("R17");
    expect(stored?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored?.fields).toMatchObject({
      names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
    });
    expect(search.searchNodes({ query: "XML Http", feature: "F12" }).items.map((item) => item.id)).toContain(
      "R17",
    );
    expect(() => search.searchNodes({ query: 'XMLHttpRequest NEAR "cutoff":*' })).not.toThrow();
    expect(
      registry.auditCodeNamesAgainstRegistry({
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/kitchen/totals", access: "read" }],
      }).ok,
    ).toBe(true);

    graph.commitChangeSet(
      proposal({
        reads: [{ target: "R17", version: 1 }],
        nodes: [
          {
            op: "update",
            id: "R17",
            class: "clarifying",
            fields: {
              feature: "F12",
              basis: "explicit",
              names: [{ kind: "http_route", value: "/api/kitchen/export" }],
            },
          },
        ],
      }),
    );
    expect(graph.getNode("R17")?.version).toBe(2);
    expect(graph.getNode("R17")?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() =>
      registry.auditCodeNamesAgainstRegistry({
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/kitchen/totals", access: "read" }],
      }),
    ).toThrow(CodeNameAuditError);
    expect(
      registry.auditCodeNamesAgainstRegistry({
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/kitchen/export", access: "read" }],
      }).ok,
    ).toBe(true);
    expect(search.searchNodes({ query: "XMLHttpRequest" }).items.map((item) => item.id)).toContain("R17");

    expect(() =>
      graph.commitChangeSet(
        proposal({
          nodes: [
            {
              op: "create",
              id: "T08",
              kind: "task",
              title: "Second owner",
              text: "",
              fields: {
                feature: "F12",
                names: [{ kind: "http_route", value: "/api/kitchen/export" }],
              },
            },
          ],
        }),
      ),
    ).toThrow(DuplicateLogicalNameError);
    expect(graph.getNode("T08")).toBeNull();
  });

  it("rejects a bare string in fields.names before the trigger runs", () => {
    const { graph } = openBundle();
    expect(() =>
      graph.commitChangeSet(
        proposal({
          nodes: [
            {
              op: "create",
              id: "R18",
              kind: "rule",
              title: "Bad names",
              text: "",
              fields: { names: ["/kitchen"] },
            },
          ],
        }),
      ),
    ).toThrow(InvalidProposalError);
    expect(graph.getNode("R18")).toBeNull();
  });
});
