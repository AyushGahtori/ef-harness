/**
 * Canonical `impact_walk` from schema/queries.sql.
 * Whitespace matches the named query. The cycle-safe statement below is that
 * walk plus a visited-path guard and the task's `belongs_to` / `consumes` edges.
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

export const REVISION_SCHEMA_SQL = `
CREATE TABLE node_kinds (
  kind TEXT PRIMARY KEY,
  is_requirement INTEGER NOT NULL
) STRICT;

CREATE TABLE edge_types (
  type TEXT PRIMARY KEY,
  invalidates INTEGER NOT NULL
) STRICT;

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
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
  title TEXT NOT NULL DEFAULT '',
  verified_under_rev INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE task_holds (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT;

CREATE TABLE revision_batches (
  revision_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  change_class TEXT NOT NULL,
  edited_node_ids TEXT NOT NULL,
  impacted_node_ids TEXT NOT NULL,
  early_cutoff_node_ids TEXT NOT NULL,
  reverified_passed_ids TEXT NOT NULL,
  rework_task_ids TEXT NOT NULL,
  additive_task_ids TEXT NOT NULL,
  hold_task_ids TEXT NOT NULL,
  conflict_card TEXT,
  preview TEXT NOT NULL,
  llm_calls INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE revision_spawned_tasks (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_task TEXT,
  payload TEXT NOT NULL
) STRICT;

INSERT INTO node_kinds(kind, is_requirement) VALUES
  ('decision', 0),
  ('spec_item', 1),
  ('edge_case', 1),
  ('rule', 1),
  ('journey', 1),
  ('requirement', 1),
  ('contract', 0),
  ('screen', 0),
  ('feature', 0),
  ('entity', 0),
  ('arch_node', 0),
  ('task', 0),
  ('check', 0);

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
  ('documents', 0),
  ('cites', 0),
  ('comments_on', 0),
  ('supersedes', 0),
  ('consumes', 0);
`;
