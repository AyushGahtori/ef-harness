/**
 * Canonical `impact_walk` text from schema/queries.sql.
 * The cycle-safe statement is that walk plus a visited-path guard and
 * `belongs_to` / `consumes`, matching Task 087 `ReverseImpactWalker.walkCombined`.
 */
export const CANONICAL_IMPACT_WALK_SQL = `WITH RECURSIVE impact(id, depth) AS (
  SELECT :start, 0
  UNION
  SELECT e.src, i.depth + 1
    FROM impact i
    JOIN edges e ON e.dst = i.id AND e.valid_to_rev IS NULL
    JOIN edge_types t ON t.type = e.type AND t.invalidates = 1
   WHERE i.depth < :max_depth
  LIMIT 5001
)
SELECT id, min(depth) AS depth FROM impact GROUP BY id;`;

export const CYCLE_SAFE_IMPACT_WALK_SQL = `WITH RECURSIVE impact(id, depth, seen) AS (
  SELECT :start, 0, char(1) || :start || char(1)
  UNION
  SELECT e.src, i.depth + 1, i.seen || e.src || char(1)
    FROM impact i
    JOIN edges e ON e.dst = i.id AND e.valid_to_rev IS NULL
    JOIN edge_types t ON t.type = e.type
      AND (t.invalidates = 1 OR t.type = 'belongs_to' OR t.type = 'consumes')
   WHERE i.depth < :max_depth
     AND instr(i.seen, char(1) || e.src || char(1)) = 0
  LIMIT 5001
)
SELECT id, min(depth) AS depth FROM impact GROUP BY id;`;

export const INTENT_GRAPH_SCHEMA_SQL = `
CREATE TABLE edge_types (
  type TEXT PRIMARY KEY,
  invalidates INTEGER NOT NULL
) STRICT;

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  basis TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  built INTEGER NOT NULL,
  landed INTEGER NOT NULL,
  provenance_quote TEXT NOT NULL,
  code_status TEXT NOT NULL,
  revision_source TEXT NOT NULL,
  amber INTEGER NOT NULL,
  dictation_badge INTEGER NOT NULL,
  freshly_dictated INTEGER NOT NULL,
  newly_extracted INTEGER NOT NULL,
  age TEXT NOT NULL,
  fields TEXT NOT NULL
) STRICT;

CREATE TABLE node_versions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL,
  fields TEXT NOT NULL,
  revision_source TEXT NOT NULL,
  PRIMARY KEY (id, version)
) STRICT;

CREATE TABLE edges (
  src TEXT NOT NULL,
  type TEXT NOT NULL,
  dst TEXT NOT NULL,
  valid_to_rev INTEGER,
  PRIMARY KEY (src, type, dst)
) STRICT;

CREATE INDEX edges_reverse_current ON edges(dst, type, src);

CREATE TABLE task_runtime (
  task TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  title TEXT NOT NULL
) STRICT;

CREATE TABLE task_holds (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT;

CREATE TABLE vocabulary_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  heard TEXT NOT NULL,
  intended TEXT NOT NULL,
  pair TEXT NOT NULL
) STRICT;

INSERT INTO edge_types(type, invalidates) VALUES
  ('implements', 1),
  ('verifies', 1),
  ('consumes_contract', 1),
  ('produces_contract', 1),
  ('obeys', 1),
  ('handles_edge_case', 1),
  ('derived_from', 1),
  ('depends_on', 1),
  ('waives', 1),
  ('belongs_to', 0),
  ('consumes', 0);
`;
