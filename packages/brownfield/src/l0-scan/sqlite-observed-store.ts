import {
  bindKnowledgeGraph,
  openProjectStateDb,
  type KnowledgeGraphRepo,
  type ProjectStateDb,
} from "@ef-harness/db";
import type { KnowledgeGraphRepoPort, ObservedNodeInput, StateMetaStore } from "./knowledge-graph-port.js";

export interface SqliteObservedFacts {
  readonly graph: KnowledgeGraphRepoPort;
  readonly meta: StateMetaStore;
  close(): void;
}

export function openSqliteObservedFacts(options: {
  readonly projectId: string;
  readonly rootDir: string;
}): SqliteObservedFacts {
  const stateDb = openProjectStateDb({ projectId: options.projectId, rootDir: options.rootDir });
  stateDb.writer.exec(
    "INSERT OR IGNORE INTO node_kinds(kind, is_requirement) VALUES ('component', 0)",
  );
  const repo = bindKnowledgeGraph(stateDb);
  return {
    graph: new SqliteObservedGraph(repo),
    meta: new SqliteMetaStore(stateDb),
    close() {
      repo.close();
      stateDb.close();
    },
  };
}

class SqliteMetaStore implements StateMetaStore {
  constructor(private readonly stateDb: ProjectStateDb) {}

  get(key: string): string | null {
    return this.stateDb.getMeta(key);
  }

  set(key: string, value: string): void {
    this.stateDb.setMeta(key, value);
  }
}

class SqliteObservedGraph implements KnowledgeGraphRepoPort {
  constructor(private readonly repo: KnowledgeGraphRepo) {}

  upsertObservedNode(input: ObservedNodeInput): void {
    const fields = jsonFields(input.fields);
    const current = this.repo.getNode(input.id);
    if (!current) {
      this.repo.commitChangeSet({
        origin: "research",
        author: "brownfield",
        summary: `observe ${input.id}`,
        nodes: [
          {
            op: "create",
            id: input.id,
            kind: input.kind,
            title: input.title,
            text: input.text,
            status: "active",
            fields,
          },
        ],
      });
      return;
    }
    this.repo.commitChangeSet({
      origin: "research",
      author: "brownfield",
      summary: `refresh ${input.id}`,
      nodes: [
        {
          op: "update",
          id: input.id,
          class: "clarifying",
          title: input.title,
          text: input.text,
          fields,
        },
      ],
    });
  }

  listObserved(): readonly ObservedNodeInput[] {
    const rows = this.repo.connection
      .prepare(
        `SELECT id, kind, title, text, fields
           FROM nodes
          WHERE json_extract(fields, '$.basis') = 'observed'
          ORDER BY id`,
      )
      .all({});
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      title: String(row.title),
      text: String(row.text),
      fields: parseFields(row.fields),
    }));
  }
}

function jsonFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fields)) as Record<string, unknown>;
}

function parseFields(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}
