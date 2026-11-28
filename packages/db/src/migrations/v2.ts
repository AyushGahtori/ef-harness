import { SchemaInvariantError } from "./errors.js";
import type { MigrationDefinition, SqliteConnection } from "./types.js";

/** Steering message tables. Duplicate outbox and router_catalog tables are not created. */
const STEERING_ROUTER_SQL = `
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
`;

export const STATE_V2_MIGRATION_NAME = "state-v2-edge-types-and-tables";
export const CODE_INDEX_V2_MIGRATION_NAME = "code-index-v2-module-cards";
export const CODE_INDEX_BASELINE_NAME = "code-index-schema-v1";

/** Audit table shared by every database. Code-index v1 SQL does not create it. */
export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT
`;

const STATE_V2_SQL = `
INSERT OR IGNORE INTO edge_types(type, invalidates) VALUES
  ('expands', 1),
  ('contradicts', 1),
  ('informs', 1),
  ('waits_on', 0);

CREATE TABLE IF NOT EXISTS canvas_layout (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  view_level INTEGER NOT NULL CHECK (view_level BETWEEN 1 AND 4),
  x REAL NOT NULL,
  y REAL NOT NULL,
  pinned_by_user INTEGER NOT NULL CHECK (pinned_by_user IN (0, 1)),
  PRIMARY KEY (node_id, view_level)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN (
    'INTAKE',
    'CLEAN_REPRO',
    'QUARANTINED_LOCALIZE',
    'PROVEN_MINIMAL_FLIP_ROOT_CAUSE',
    'SCOPED_FIX',
    'PERMANENT_REPRO_AND_MECHANISM_TESTS'
  )),
  symptom_summary TEXT NOT NULL DEFAULT '',
  repro_command TEXT,
  hypothesis_ledger TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hypothesis_ledger)),
  root_cause TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sweep_symbol_maps (
  sweep_id TEXT NOT NULL,
  old_path TEXT NOT NULL,
  new_path TEXT NOT NULL,
  old_symbol TEXT NOT NULL,
  new_symbol TEXT NOT NULL,
  persisted_exclusions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(persisted_exclusions)),
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (sweep_id, old_path, old_symbol)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS stop_events (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('budget_100','window_exhausted','user_stop','disk_red')),
  occurred_at INTEGER NOT NULL,
  checkpoint_shas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checkpoint_shas)),
  recovery_option TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS id_sequences (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS handoff_artifacts (
  handoff_id TEXT PRIMARY KEY,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  pinned_base_commit_sha TEXT NOT NULL,
  pinned_slice_sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  blob_bytes INTEGER NOT NULL,
  prior_handoff_id TEXT REFERENCES handoff_artifacts(handoff_id),
  supersedes TEXT REFERENCES handoff_artifacts(handoff_id),
  superseded_by TEXT REFERENCES handoff_artifacts(handoff_id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS active_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  pinned_base_commit_sha TEXT NOT NULL,
  pinned_slice_sha256 TEXT NOT NULL,
  bound_handoff_id TEXT NOT NULL REFERENCES handoff_artifacts(handoff_id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS role_mailbox (
  mailbox_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_role TEXT NOT NULL,
  target_owner_task_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'escalated')),
  resolution_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  escalated_to TEXT,
  owner_turns INTEGER NOT NULL,
  dedup_key TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS role_mailbox_open_dedup
  ON role_mailbox(dedup_key) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS role_mailbox_role ON role_mailbox(target_role, status);

CREATE TABLE IF NOT EXISTS mailbox_waiters (
  mailbox_id TEXT NOT NULL REFERENCES role_mailbox(mailbox_id),
  waiter_task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mailbox_id, waiter_task_id)
) STRICT;

CREATE TABLE IF NOT EXISTS mailbox_wakes (
  wake_id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  waiter_task_id TEXT NOT NULL,
  resolution_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS handoff_watches (
  handoff_id TEXT NOT NULL REFERENCES handoff_artifacts(handoff_id),
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (handoff_id, task_id)
) STRICT;

CREATE TABLE IF NOT EXISTS handoff_wakes (
  wake_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  previous_handoff_id TEXT NOT NULL,
  fresh_handoff_id TEXT NOT NULL,
  fresh_base_sha TEXT NOT NULL,
  fresh_slice_sha TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS wait_graph_deadlock_breaks (
  break_id TEXT PRIMARY KEY,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  cycle_json TEXT NOT NULL,
  escalated_to TEXT NOT NULL,
  notified_roles_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS escalation_notices (
  notice_id TEXT PRIMARY KEY,
  target_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS role_claims (
  claim_id TEXT PRIMARY KEY,
  target_role TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS feature_coordination (
  feature_id TEXT PRIMARY KEY,
  feature_slug TEXT NOT NULL,
  wave_id TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  base_integration_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  verified_head_sha TEXT NOT NULL,
  pinned_base_commit_sha TEXT NOT NULL,
  active_leaf_slots_json TEXT NOT NULL,
  behind_integration_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  sync_reason TEXT,
  landed_by_task INTEGER,
  lease_holder TEXT NOT NULL,
  lease_epoch INTEGER NOT NULL,
  worktree_path TEXT,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS feature_read_sets (
  feature_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (feature_id, path)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_write_scopes (
  feature_id TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (feature_id, path_prefix)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_turns (
  feature_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  PRIMARY KEY (feature_id, slot_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_worktree_slots (
  slot_id TEXT PRIMARY KEY,
  feature_id TEXT,
  ref TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT NOT NULL
) STRICT;
`;

/** Merge queue, CCR ledger, and undo archival. No second ref_leases, feature_queue_runtime, or undo_nodes. */
const INTEGRATOR_M3_SQL = `
INSERT OR IGNORE INTO feature_states (state, terminal) VALUES ('UNDONE', 1);

CREATE TABLE IF NOT EXISTS merge_queue_items (
  id               TEXT PRIMARY KEY,
  feature_id       TEXT NOT NULL,
  feature_ref      TEXT NOT NULL,
  priority         INTEGER NOT NULL,
  sequence         INTEGER NOT NULL,
  status           TEXT NOT NULL,
  phase            TEXT NOT NULL,
  enqueued_at      INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  eviction_count   INTEGER NOT NULL DEFAULT 0,
  failure_trace    TEXT NOT NULL DEFAULT '',
  request_json     TEXT NOT NULL,
  merge_sha        TEXT NOT NULL DEFAULT '',
  escalation_json  TEXT NOT NULL DEFAULT '',
  gate_json        TEXT NOT NULL DEFAULT '',
  runtime_state    TEXT NOT NULL DEFAULT 'QUEUED_FOR_MERGE',
  runtime_epoch    INTEGER NOT NULL DEFAULT 0,
  runtime_branch   TEXT NOT NULL DEFAULT '',
  runtime_updated_at INTEGER NOT NULL DEFAULT 0,
  runtime_done_json TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS merge_queue_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merge_queue_worktrees (
  path       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ccr_requests (
  id TEXT PRIMARY KEY,
  target_contract_node_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  requesting_task_id TEXT NOT NULL,
  requesting_feature_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  queue_state TEXT NOT NULL,
  classification TEXT NOT NULL,
  overridden INTEGER NOT NULL,
  claimed_class TEXT,
  rationale TEXT NOT NULL,
  urgency TEXT NOT NULL,
  owner_task_id TEXT,
  owner_role TEXT NOT NULL,
  owner_commit_sha TEXT,
  woken_task_ids TEXT NOT NULL,
  subscriber_task_ids TEXT NOT NULL,
  ccr_v1 TEXT NOT NULL,
  migration_name TEXT,
  schema_diff TEXT NOT NULL,
  decision_json TEXT,
  owner_task_json TEXT,
  semantic_breaking INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ccr_audit_ledger (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ccr_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ccr_wait_edges (
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ccr_id TEXT,
  PRIMARY KEY (from_task_id, to_task_id, kind)
);

CREATE TABLE IF NOT EXISTS ccr_notices (
  notice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ccr_id_sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_edges (
  src           TEXT NOT NULL,
  type          TEXT NOT NULL,
  dst           TEXT NOT NULL,
  artifact_path TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src, type, dst, artifact_path)
);

CREATE TABLE IF NOT EXISTS undo_inbox (
  id          TEXT PRIMARY KEY,
  feature_id  TEXT NOT NULL,
  exclusive   INTEGER NOT NULL,
  status      TEXT NOT NULL,
  text        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_workers (
  id          TEXT PRIMARY KEY,
  feature_id  TEXT NOT NULL,
  pid         INTEGER NOT NULL,
  halted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS undo_ownership (
  path              TEXT PRIMARY KEY,
  owner_feature_id  TEXT NOT NULL,
  previous_owner    TEXT NOT NULL,
  transferred_at    INTEGER NOT NULL
);
`;

const CODE_INDEX_MODULE_CARDS_DDL = `
CREATE TABLE IF NOT EXISTS module_cards (
  file_path TEXT NOT NULL,
  file_content_sha256 TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  card_json TEXT NOT NULL CHECK (json_valid(card_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_path, file_content_sha256, prompt_version)
) STRICT, WITHOUT ROWID;
`;

const SEEDED_EDGE_TYPES = ["expands", "contradicts", "informs", "waits_on"] as const;
const STATE_V2_TABLES = [
  "canvas_layout",
  "investigations",
  "sweep_symbol_maps",
  "stop_events",
  "handoff_artifacts",
  "role_mailbox",
  "feature_coordination",
  "feature_read_sets",
  "feature_write_scopes",
  "feature_turns",
  "feature_worktree_slots",
  "merge_queue_items",
  "merge_queue_events",
  "merge_queue_worktrees",
  "ccr_requests",
  "ccr_audit_ledger",
  "ccr_wait_edges",
  "ccr_notices",
  "ccr_id_sequences",
  "undo_edges",
  "undo_inbox",
  "undo_workers",
  "undo_ownership",
  "user_messages",
  "message_clauses",
  "input_focus_snapshots",
] as const;

/** Additive state v2 DDL, including handoff pointers, feature coordination, integrator m3, and steering messages. */
export function stateV2Sql(): string {
  return `${STATE_V2_SQL}\n${INTEGRATOR_M3_SQL}\n${STEERING_ROUTER_SQL}`;
}

function flag(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function assertTable(conn: SqliteConnection, name: string): void {
  const row = conn.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (!row) throw new SchemaInvariantError(`migration did not create ${name}`);
}

export const stateV2Migration: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: STATE_V2_MIGRATION_NAME,
  targetDb: "state",
  apply(conn) {
    conn.exec(stateV2Sql());
  },
  check(conn) {
    for (const type of SEEDED_EDGE_TYPES) {
      const row = conn.prepare("SELECT invalidates FROM edge_types WHERE type = ?").get(type);
      const expected = type === "waits_on" ? 0 : 1;
      if (flag(row?.invalidates) !== expected) {
        throw new SchemaInvariantError(`edge type ${type} was not seeded`);
      }
    }
    for (const table of STATE_V2_TABLES) assertTable(conn, table);
    const undone = conn.prepare("SELECT terminal FROM feature_states WHERE state = 'UNDONE'").get();
    if (flag(undone?.terminal) !== 1) throw new SchemaInvariantError("feature state UNDONE was not seeded");
  },
};

export const codeIndexV2Migration: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: CODE_INDEX_V2_MIGRATION_NAME,
  targetDb: "code-index",
  apply(conn) {
    conn.exec(SCHEMA_MIGRATIONS_DDL);
    conn.exec(CODE_INDEX_MODULE_CARDS_DDL);
  },
  check(conn) {
    assertTable(conn, "schema_migrations");
    assertTable(conn, "module_cards");
  },
};
