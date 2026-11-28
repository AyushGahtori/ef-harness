export const HUMAN_STEP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS human_steps (
  step_id TEXT PRIMARY KEY,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions_json TEXT NOT NULL,
  probe_spec_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'probing', 'verified', 'attested', 'failed')),
  last_probe_json TEXT,
  attested_at INTEGER,
  verified_at INTEGER,
  attestation_note TEXT,
  blocking_tasks_json TEXT NOT NULL,
  question_id TEXT,
  hard_local INTEGER NOT NULL CHECK (hard_local IN (0, 1)),
  resolution TEXT,
  graph_node_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS task_holds (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS human_step_counter (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

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
