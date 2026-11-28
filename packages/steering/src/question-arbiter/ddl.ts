export const QUESTION_ARBITER_DDL = `
CREATE TABLE IF NOT EXISTS qa_inbox_items (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  scope_id TEXT,
  criterion_id TEXT,
  feature_id TEXT,
  contract_id TEXT,
  kind TEXT NOT NULL,
  human_reason TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  priority_tier TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','superseded','dismissed','retired')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  options_version INTEGER NOT NULL,
  blocked_worker_count INTEGER NOT NULL,
  on_critical_path INTEGER NOT NULL CHECK (on_critical_path IN (0, 1)),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  retired_reason TEXT,
  settled_answer TEXT,
  settled_option_id TEXT,
  settled_by TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS qa_one_open_question
  ON qa_inbox_items(question_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS qa_open_feature
  ON qa_inbox_items(feature_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS qa_inbox_subscribers (
  question_id TEXT NOT NULL REFERENCES qa_inbox_items(id),
  waiting_task_id TEXT NOT NULL,
  waiting_role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  PRIMARY KEY (question_id, waiting_task_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS qa_wakes (
  wake_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  waiting_task_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS qa_pending_replies (
  pending_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  options_version INTEGER NOT NULL,
  option_id TEXT,
  reply_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('pending','kept','changed'))
) STRICT;

CREATE TABLE IF NOT EXISTS qa_holds (
  task_id TEXT NOT NULL,
  reason_type TEXT NOT NULL,
  reason_ref_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  PRIMARY KEY (task_id, reason_type, reason_ref_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS qa_settled_facts (
  fact_id TEXT PRIMARY KEY,
  scope_id TEXT,
  criterion_id TEXT,
  topic_key TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL,
  table_name TEXT,
  column_name TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS qa_settled_text ON qa_settled_facts(normalized_text);
CREATE INDEX IF NOT EXISTS qa_settled_topic ON qa_settled_facts(topic_key);
CREATE INDEX IF NOT EXISTS qa_settled_scope ON qa_settled_facts(scope_id, criterion_id);

CREATE VIRTUAL TABLE IF NOT EXISTS qa_settled_fts USING fts5(fact_id UNINDEXED, body);

CREATE TABLE IF NOT EXISTS qa_id_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT,
  owner_role TEXT,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','superseded','dismissed')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  needed_by INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS inbox_subscribers (
  item TEXT NOT NULL REFERENCES inbox_items(id),
  task TEXT NOT NULL,
  PRIMARY KEY (item, task)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  subject TEXT,
  rev INTEGER,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS outbox_deliveries (
  event_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  consumer TEXT NOT NULL,
  delivered_at INTEGER,
  PRIMARY KEY (event_id, consumer)
) STRICT, WITHOUT ROWID;
`;

export const TELEMETRY_DDL = `
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY,
  attempt TEXT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS telemetry_attempt ON telemetry(attempt, ts);
`;
