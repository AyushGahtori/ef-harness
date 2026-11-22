/**
 * Tables Task 113 owns inside state.db.
 * `user_messages` is not in the frozen schema yet. CREATE IF NOT EXISTS keeps a
 * Task 013 database openable. Fold this DDL into schema/state.sql at integration.
 */
export const ROUTER_DDL = `
CREATE TABLE IF NOT EXISTS user_messages (
  msg_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  text TEXT NOT NULL,
  draft_id TEXT,
  input_started_at INTEGER,
  focus_json TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  explicit_action_json TEXT,
  confirmation_required INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_required IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','ROUTING','EXECUTING','DONE','AWAITING_CLARIFICATION')),
  fast_path INTEGER NOT NULL DEFAULT 0 CHECK (fast_path IN (0,1)),
  router_invoked INTEGER NOT NULL DEFAULT 0 CHECK (router_invoked IN (0,1)),
  provider_calls INTEGER NOT NULL DEFAULT 0,
  fast_path_ms REAL,
  clarification_json TEXT
);

CREATE INDEX IF NOT EXISTS user_messages_status ON user_messages(status, msg_seq);

CREATE TABLE IF NOT EXISTS message_clauses (
  message_id TEXT NOT NULL,
  clause_id TEXT NOT NULL,
  clause_index INTEGER NOT NULL,
  execution_index INTEGER NOT NULL,
  clause_text TEXT NOT NULL,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  intent_type TEXT NOT NULL,
  router_intent TEXT NOT NULL,
  target_ids_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  alternate_readings_json TEXT NOT NULL,
  needs_clarification INTEGER NOT NULL CHECK (needs_clarification IN (0,1)),
  router_confidence REAL NOT NULL,
  options_version INTEGER,
  depends_on_json TEXT NOT NULL,
  control_kind TEXT,
  card_decision TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','DISPATCHED','DONE','AWAITING_CLARIFICATION')),
  result_detail TEXT,
  PRIMARY KEY (message_id, clause_id)
);

CREATE INDEX IF NOT EXISTS message_clauses_order ON message_clauses(message_id, execution_index);

CREATE TABLE IF NOT EXISTS input_focus_snapshots (
  draft_id TEXT PRIMARY KEY,
  captured_at INTEGER NOT NULL,
  focus_json TEXT NOT NULL,
  live_focus_json TEXT NOT NULL,
  confirmation_required INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_required IN (0,1))
);

CREATE TABLE IF NOT EXISTS router_catalog (
  id TEXT PRIMARY KEY,
  nid INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  feature_id TEXT,
  aliases_json TEXT NOT NULL,
  working INTEGER NOT NULL CHECK (working IN (0,1)),
  owner_role TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  subject TEXT,
  rev INTEGER,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_deliveries (
  event_id TEXT NOT NULL,
  consumer TEXT NOT NULL,
  delivered_at INTEGER,
  PRIMARY KEY (event_id, consumer)
);
`;
