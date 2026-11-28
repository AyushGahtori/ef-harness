/**
 * Local stand-ins for the knowledge graph and question card.
 * `human_steps`, `human_step_counter`, and `task_holds` come from `ProjectStateDb`.
 */
export const HUMAN_STEP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS human_step_graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  status TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS human_step_graph_evidence (
  id INTEGER PRIMARY KEY,
  node TEXT NOT NULL,
  node_version INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  quote TEXT NOT NULL,
  verified INTEGER NOT NULL CHECK (verified IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS human_step_questions (
  question_id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  waiting_task_id TEXT NOT NULL,
  waiting_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL
) STRICT;
`;
