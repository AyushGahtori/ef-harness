export const HANDOFF_DDL = `
CREATE TABLE IF NOT EXISTS id_sequences (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS cas_blobs (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  content BLOB NOT NULL,
  created_at INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS graph_edges (
  kind TEXT NOT NULL CHECK (kind IN ('depends_on', 'waits_on')),
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, from_node, to_node)
) STRICT;

CREATE TABLE IF NOT EXISTS contract_owners (
  contract_id TEXT PRIMARY KEY,
  owner_role TEXT NOT NULL,
  owner_task_id TEXT NOT NULL,
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
`;
