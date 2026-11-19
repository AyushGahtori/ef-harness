-- EF Harness · project database (state.db) · schema version 1
-- Design and rationale: ../database-design.md
--
-- Connection settings (applied by the coordinator, not stored in the file):
--   PRAGMA journal_mode = WAL;  PRAGMA synchronous = FULL;  PRAGMA foreign_keys = ON;
--   PRAGMA busy_timeout = 5000;  PRAGMA secure_delete = ON;  PRAGMA journal_size_limit = 67108864;
--   PRAGMA temp_store = MEMORY;
-- Application functions registered on the writer connection before use:
--   ef_search_text(text) -> text   splits camelCase, snake_case, kebab-case and IDs into searchable words
--
-- Conventions
--   * Times are INTEGER milliseconds since the Unix epoch (UTC).
--   * Money and allowance are INTEGER units; the scale lives in `currencies` (no floating point).
--   * Extensible vocabularies are lookup tables with foreign keys, not CHECK lists,
--     so adding a node kind or task state is an INSERT, not a table rebuild.
--   * Knowledge meaning lives in `nodes` (versioned). Runtime state lives in runtime tables
--     keyed by the node ID. No fact is stored in both.

------------------------------------------------------------------------------------------------
-- 0. Metadata and vocabularies
------------------------------------------------------------------------------------------------

CREATE TABLE meta (                       -- project_id, stream_epoch, last_rev, owner lock row, ...
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE node_kinds (
  kind           TEXT PRIMARY KEY,
  is_requirement INTEGER NOT NULL DEFAULT 0 CHECK (is_requirement IN (0,1))
) STRICT, WITHOUT ROWID;

CREATE TABLE edge_types (
  type        TEXT PRIMARY KEY,
  invalidates INTEGER NOT NULL CHECK (invalidates IN (0,1))   -- 1: a change can make dependents stale
) STRICT, WITHOUT ROWID;

CREATE TABLE task_states (
  state     TEXT PRIMARY KEY,
  claimable INTEGER NOT NULL DEFAULT 0 CHECK (claimable IN (0,1)),
  done      INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),       -- satisfies a dependency
  terminal  INTEGER NOT NULL DEFAULT 0 CHECK (terminal IN (0,1))
) STRICT, WITHOUT ROWID;

CREATE TABLE currencies (                 -- 'usd', 'allowance:chatgpt-personal', 'slots:local'
  code  TEXT PRIMARY KEY,
  unit  TEXT NOT NULL,                    -- 'micro-USD', 'ppm of window share', 'slot'
  scale INTEGER NOT NULL CHECK (scale >= 1)   -- units per display unit (1000000 for micro-USD)
) STRICT, WITHOUT ROWID;

INSERT INTO node_kinds VALUES
  ('decision',0),('spec_item',1),('edge_case',1),('rule',1),('journey',1),
  ('contract',0),('arch_node',0),('research_fact',0),('plan',0),('feature',0),
  ('task',0),('check',0),('waiver',0),('ccr',0),('source',0),('asset',0),('comment',0);

INSERT INTO edge_types VALUES
  ('implements',1),('verifies',1),('consumes_contract',1),('produces_contract',1),
  ('obeys',1),('handles_edge_case',1),('derived_from',1),('depends_on',1),('waives',1),
  ('belongs_to',0),('documents',0),('cites',0),('comments_on',0),('supersedes',0);

INSERT INTO task_states VALUES
  ('DRAFTED',0,0,0),('READY',1,0,0),('LEASED',0,0,0),('CODING',0,0,0),
  ('STATIC_AUDIT',0,0,0),('CLEAN_VERIFY',0,0,0),('ACCEPTED',0,1,0),('MERGED_TO_FEATURE',0,1,1),
  ('WAITING_INPUT',0,0,0),('PARKED',0,0,0),('ESCALATED',0,0,0),('EXHAUSTED',0,0,0),
  ('HUMAN_OWNED',0,0,0),('SUPERSEDED',0,0,1),('CANCELLED',0,0,1);

INSERT INTO currencies VALUES ('usd','micro-USD',1000000);

------------------------------------------------------------------------------------------------
-- 1. Knowledge graph: change sets, nodes (current + history), edges (temporal)
------------------------------------------------------------------------------------------------

CREATE TABLE change_sets (
  id         TEXT PRIMARY KEY,
  rev        INTEGER UNIQUE,                -- assigned at commit; NULL while staged
  origin     TEXT NOT NULL CHECK (origin IN ('chat','markdown_edit','research','planner','sweep','undo','intake','kernel','import')),
  origin_ref TEXT,                          -- message ID, file+hash, source locator
  author     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summary    TEXT
) STRICT;

CREATE TABLE change_set_reads (            -- optimistic read set of a change set (audit copy)
  change_set TEXT NOT NULL REFERENCES change_sets(id),
  target     TEXT NOT NULL,                 -- node ID
  dir        TEXT NOT NULL DEFAULT '' CHECK (dir IN ('','in','out')),   -- '' = node version
  edge_type  TEXT NOT NULL DEFAULT '',
  version    INTEGER NOT NULL,
  PRIMARY KEY (change_set, target, dir, edge_type)
) STRICT, WITHOUT ROWID;

CREATE TABLE nodes (                      -- current state of every versioned knowledge record
  nid          INTEGER PRIMARY KEY,         -- stable rowid: FTS and joins (VACUUM keeps it)
  id           TEXT NOT NULL UNIQUE,        -- 'R17', 'T07', 'SI-212'
  kind         TEXT NOT NULL REFERENCES node_kinds(kind),
  version      INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL,
  title        TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  fields       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields)),
  feature      TEXT GENERATED ALWAYS AS (fields ->> '$.feature') VIRTUAL,
  basis        TEXT GENERATED ALWAYS AS (fields ->> '$.basis') VIRTUAL
               CHECK (basis IS NULL OR basis IN ('explicit','derived','delegated','defaulted','proposed','observed')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired','superseded')),
  owner_role   TEXT,
  change_set   TEXT NOT NULL REFERENCES change_sets(id),
  created_rev  INTEGER NOT NULL,
  updated_rev  INTEGER NOT NULL
) STRICT;
CREATE INDEX nodes_kind_feature ON nodes(kind, feature) WHERE status = 'active';

CREATE TABLE node_versions (              -- immutable history, written only by triggers
  id             TEXT NOT NULL,
  version        INTEGER NOT NULL,
  kind           TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  title          TEXT NOT NULL,
  text           TEXT NOT NULL,
  fields         TEXT NOT NULL,
  status         TEXT NOT NULL,
  change_set     TEXT NOT NULL REFERENCES change_sets(id),
  valid_from_rev INTEGER NOT NULL,
  valid_to_rev   INTEGER,                   -- NULL = current version
  PRIMARY KEY (id, version)
) STRICT, WITHOUT ROWID;
CREATE INDEX node_versions_from ON node_versions(valid_from_rev);
CREATE INDEX node_versions_to   ON node_versions(valid_to_rev);

CREATE TABLE node_changes (               -- per change set: what changed and how much it matters
  change_set  TEXT NOT NULL REFERENCES change_sets(id),
  id          TEXT NOT NULL,
  old_version INTEGER,
  new_version INTEGER,
  class       TEXT NOT NULL CHECK (class IN ('cosmetic','clarifying','compatible','breaking','created','retired')),
  PRIMARY KEY (change_set, id)
) STRICT, WITHOUT ROWID;
CREATE INDEX node_changes_by_node ON node_changes(id);

CREATE TABLE edges (                      -- temporal edges: one row per validity interval
  src             TEXT NOT NULL REFERENCES nodes(id),
  type            TEXT NOT NULL REFERENCES edge_types(type),
  dst             TEXT NOT NULL REFERENCES nodes(id),
  dst_version_pin INTEGER,                -- e.g. consumes C-014@2
  change_set      TEXT NOT NULL REFERENCES change_sets(id),
  valid_from_rev  INTEGER NOT NULL,
  valid_to_rev    INTEGER,                -- NULL = current
  PRIMARY KEY (src, type, dst, valid_from_rev),
  CHECK (valid_to_rev IS NULL OR valid_to_rev > valid_from_rev)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX edges_current         ON edges(src, type, dst) WHERE valid_to_rev IS NULL;
CREATE INDEX        edges_reverse_current ON edges(dst, type, src) WHERE valid_to_rev IS NULL;
CREATE INDEX        edges_from            ON edges(valid_from_rev);
CREATE INDEX        edges_to              ON edges(valid_to_rev);

CREATE TABLE edge_set_versions (          -- one counter per node, direction and edge type
  node    TEXT NOT NULL REFERENCES nodes(id),
  dir     TEXT NOT NULL CHECK (dir IN ('in','out')),
  type    TEXT NOT NULL REFERENCES edge_types(type),
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node, dir, type)
) STRICT, WITHOUT ROWID;

-- Search: words (camelCase split by ef_search_text) and substrings/IDs (trigram)
CREATE VIRTUAL TABLE kb_words USING fts5(
  title, body, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE kb_ident USING fts5(
  id, title, content = 'nodes', content_rowid = 'nid', tokenize = 'trigram'
);

-- Guard: any change of meaning or status requires exactly one version step
CREATE TRIGGER nodes_version_guard BEFORE UPDATE ON nodes
WHEN (new.content_hash IS NOT old.content_hash OR new.status IS NOT old.status
      OR new.title IS NOT old.title OR new.text IS NOT old.text OR new.fields IS NOT old.fields)
     AND new.version <> old.version + 1
BEGIN
  SELECT RAISE(ABORT, 'node change requires version + 1');
END;

CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO node_versions(id, version, kind, content_hash, title, text, fields, status, change_set, valid_from_rev)
  VALUES (new.id, new.version, new.kind, new.content_hash, new.title, new.text, new.fields, new.status, new.change_set, new.updated_rev);
  INSERT INTO kb_words(rowid, title, body)
  VALUES (new.nid, ef_search_text(new.title), ef_search_text(new.text || ' ' || new.fields));
  INSERT INTO kb_ident(rowid, id, title) VALUES (new.nid, new.id, new.title);
  INSERT INTO names(kind, value, owner_node, feature)
    SELECT j.value ->> '$.kind', j.value ->> '$.value', new.id, new.feature
      FROM json_each(new.fields, '$.names') AS j;
END;

CREATE TRIGGER nodes_au AFTER UPDATE ON nodes WHEN new.version <> old.version BEGIN
  UPDATE node_versions SET valid_to_rev = new.updated_rev WHERE id = old.id AND version = old.version;
  INSERT INTO node_versions(id, version, kind, content_hash, title, text, fields, status, change_set, valid_from_rev)
  VALUES (new.id, new.version, new.kind, new.content_hash, new.title, new.text, new.fields, new.status, new.change_set, new.updated_rev);
  DELETE FROM kb_words WHERE rowid = old.nid;
  INSERT INTO kb_words(rowid, title, body)
  VALUES (new.nid, ef_search_text(new.title), ef_search_text(new.text || ' ' || new.fields));
  INSERT INTO kb_ident(kb_ident, rowid, id, title) VALUES ('delete', old.nid, old.id, old.title);
  INSERT INTO kb_ident(rowid, id, title) VALUES (new.nid, new.id, new.title);
  DELETE FROM names WHERE owner_node = old.id;
  INSERT INTO names(kind, value, owner_node, feature)
    SELECT j.value ->> '$.kind', j.value ->> '$.value', new.id, new.feature
      FROM json_each(new.fields, '$.names') AS j
     WHERE new.status = 'active';
END;

CREATE TRIGGER nodes_no_delete BEFORE DELETE ON nodes BEGIN
  SELECT RAISE(ABORT, 'nodes are retired, never deleted');
END;

-- Edge-set counters follow edges automatically
CREATE TRIGGER edges_ai AFTER INSERT ON edges BEGIN
  INSERT OR IGNORE INTO edge_set_versions(node, dir, type) VALUES (new.dst, 'in', new.type), (new.src, 'out', new.type);
  UPDATE edge_set_versions SET version = version + 1
   WHERE (node = new.dst AND dir = 'in' AND type = new.type) OR (node = new.src AND dir = 'out' AND type = new.type);
END;

CREATE TRIGGER edges_retire AFTER UPDATE OF valid_to_rev ON edges
WHEN old.valid_to_rev IS NULL AND new.valid_to_rev IS NOT NULL BEGIN
  UPDATE edge_set_versions SET version = version + 1
   WHERE (node = new.dst AND dir = 'in' AND type = new.type) OR (node = new.src AND dir = 'out' AND type = new.type);
END;

------------------------------------------------------------------------------------------------
-- 2. Views over the graph (no duplicate storage)
------------------------------------------------------------------------------------------------

CREATE VIEW requirements AS
  SELECT n.id, n.kind, n.feature, n.fields ->> '$.risk' AS risk, n.version
    FROM nodes n JOIN node_kinds k ON k.kind = n.kind
   WHERE k.is_requirement = 1 AND n.status = 'active';

CREATE VIEW task_requirements AS          -- a task covers what it implements, obeys or handles
  SELECT e.src AS task_id, e.dst AS requirement_id
    FROM edges e JOIN nodes t ON t.id = e.src AND t.kind = 'task'
   WHERE e.type IN ('implements','obeys','handles_edge_case') AND e.valid_to_rev IS NULL;

CREATE VIEW check_requirements AS
  SELECT e.src AS check_id, e.dst AS requirement_id
    FROM edges e
   WHERE e.type = 'verifies' AND e.valid_to_rev IS NULL;

CREATE VIEW waivers AS
  SELECT w.id, e.dst AS requirement_id, w.fields ->> '$.reason' AS reason,
         w.fields ->> '$.approved_by' AS approved_by, w.fields ->> '$.risk_max' AS risk_max
    FROM nodes w JOIN edges e ON e.src = w.id AND e.type = 'waives' AND e.valid_to_rev IS NULL
   WHERE w.kind = 'waiver' AND w.status = 'active';

------------------------------------------------------------------------------------------------
-- 3. Name registry (maintained by the node triggers from fields.names)
------------------------------------------------------------------------------------------------

CREATE TABLE names (
  kind       TEXT NOT NULL,               -- http_route | page_route | db_table | db_column | db_index | env_var | storage_key | event | permission | ...
  value      TEXT NOT NULL,
  owner_node TEXT NOT NULL REFERENCES nodes(id),
  feature    TEXT,
  PRIMARY KEY (kind, value)                -- a duplicate name aborts the publishing change set
) STRICT, WITHOUT ROWID;
CREATE INDEX names_owner ON names(owner_node);

CREATE TABLE name_prefixes (              -- allocated by system architecture
  kind    TEXT NOT NULL,
  prefix  TEXT NOT NULL,
  feature TEXT NOT NULL,
  PRIMARY KEY (kind, prefix)
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 4. Conversation, sources and evidence
------------------------------------------------------------------------------------------------

CREATE TABLE turns (
  id             TEXT PRIMARY KEY,
  author         TEXT NOT NULL CHECK (author IN ('developer','harness')),
  target         TEXT,                    -- focused question or node at send time
  text           TEXT NOT NULL,
  audio_artifact TEXT,
  redacted       INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0,1)),
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE evidence (
  id           INTEGER PRIMARY KEY,
  node         TEXT NOT NULL REFERENCES nodes(id),
  node_version INTEGER NOT NULL,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('turn','source','repo','research')),
  source_ref   TEXT NOT NULL,             -- turn ID, source node ID, path@commit, research record
  source_hash  TEXT,
  locator      TEXT NOT NULL CHECK (json_valid(locator)),
  quote        TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1))
) STRICT;
CREATE INDEX evidence_by_node   ON evidence(node, node_version);
CREATE INDEX evidence_by_source ON evidence(source_kind, source_ref);

------------------------------------------------------------------------------------------------
-- 5. Runtime: tasks, holds, attempts, steps, read sets, candidates, results
------------------------------------------------------------------------------------------------

CREATE TABLE task_runtime (               -- mutable state of a task node; meaning stays in nodes
  task               TEXT PRIMARY KEY REFERENCES nodes(id),
  feature            TEXT NOT NULL,
  state              TEXT NOT NULL REFERENCES task_states(state),
  level              TEXT NOT NULL,
  epoch              INTEGER NOT NULL DEFAULT 0,
  holder_attempt     TEXT REFERENCES attempts(id) DEFERRABLE INITIALLY DEFERRED,
  lease_expires_at   INTEGER,
  submission_pending INTEGER NOT NULL DEFAULT 0 CHECK (submission_pending IN (0,1)),
  updated_rev        INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX task_runtime_state   ON task_runtime(state, level);
CREATE INDEX task_runtime_feature ON task_runtime(feature, state);
CREATE INDEX task_runtime_lease   ON task_runtime(lease_expires_at) WHERE holder_attempt IS NOT NULL;

CREATE TABLE task_holds (                 -- held = at least one row; reasons never overwrite each other
  task       TEXT NOT NULL REFERENCES task_runtime(task),
  reason     TEXT NOT NULL,               -- user_pause | requirement_change | budget | ccr | governor
  source     TEXT NOT NULL,               -- message, change set or rule that placed it
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT, WITHOUT ROWID;

CREATE TABLE attempts (
  id            TEXT PRIMARY KEY,
  task          TEXT NOT NULL REFERENCES task_runtime(task),
  n             INTEGER NOT NULL,
  epoch         INTEGER NOT NULL,
  brief_version INTEGER NOT NULL,         -- version of the task node this attempt works from
  runtime       TEXT NOT NULL,
  model         TEXT NOT NULL,
  connection    TEXT NOT NULL,
  worktree_slot TEXT,
  base_commit   TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('running','submitted','accepted','rejected','parked','fenced','crashed')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  outcome       TEXT,
  UNIQUE (task, n)
) STRICT;

CREATE TABLE turn_log (                   -- own worker loop steps
  attempt           TEXT NOT NULL REFERENCES attempts(id),
  step              INTEGER NOT NULL,
  request_digest    TEXT,
  items_artifact    TEXT,
  tool_call         TEXT,
  result_summary    TEXT,
  result_artifact   TEXT,
  checkpoint_commit TEXT,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  PRIMARY KEY (attempt, step)
) STRICT, WITHOUT ROWID;

CREATE TABLE read_sets (
  attempt TEXT NOT NULL REFERENCES attempts(id),
  node    TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash    TEXT NOT NULL,
  how     TEXT NOT NULL CHECK (how IN ('pushed','pulled')),
  PRIMARY KEY (attempt, node, version)
) STRICT, WITHOUT ROWID;
CREATE INDEX read_sets_by_node ON read_sets(node, version);

CREATE TABLE candidates (
  id          TEXT PRIMARY KEY,
  task        TEXT NOT NULL REFERENCES task_runtime(task),
  attempt     TEXT NOT NULL REFERENCES attempts(id),
  epoch       INTEGER NOT NULL,
  commit_sha  TEXT NOT NULL,
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  received_at INTEGER NOT NULL,
  UNIQUE (task, attempt, commit_sha)
) STRICT;

CREATE TABLE check_results (
  check_id        TEXT NOT NULL REFERENCES nodes(id),
  attempt         TEXT NOT NULL REFERENCES attempts(id),
  check_version   INTEGER NOT NULL,
  artifact_digest TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pass','fail','skip','missing','error')),
  receipt         TEXT,
  recorded_at     INTEGER NOT NULL,
  PRIMARY KEY (check_id, attempt, check_version)
) STRICT, WITHOUT ROWID;

CREATE TABLE requirement_status (         -- maintained by the kernel in the same transaction as results
  requirement TEXT PRIMARY KEY REFERENCES nodes(id),
  feature     TEXT,
  status      TEXT NOT NULL CHECK (status IN ('uncovered','pending','passing','failing','waived')),
  updated_rev INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 6. Read models (trigger-maintained caches; rows above stay the source of truth)
------------------------------------------------------------------------------------------------

CREATE TABLE rollup_feature_tasks (
  feature TEXT NOT NULL, state TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (feature, state)
) STRICT, WITHOUT ROWID;

CREATE TABLE rollup_feature_requirements (
  feature TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (feature, status)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER task_runtime_ai AFTER INSERT ON task_runtime BEGIN
  INSERT OR IGNORE INTO rollup_feature_tasks(feature, state) VALUES (new.feature, new.state);
  UPDATE rollup_feature_tasks SET n = n + 1 WHERE feature = new.feature AND state = new.state;
END;

CREATE TRIGGER task_runtime_au AFTER UPDATE OF state, feature ON task_runtime
WHEN old.state IS NOT new.state OR old.feature IS NOT new.feature BEGIN
  UPDATE rollup_feature_tasks SET n = n - 1 WHERE feature = old.feature AND state = old.state;
  INSERT OR IGNORE INTO rollup_feature_tasks(feature, state) VALUES (new.feature, new.state);
  UPDATE rollup_feature_tasks SET n = n + 1 WHERE feature = new.feature AND state = new.state;
END;

CREATE TRIGGER requirement_status_ai AFTER INSERT ON requirement_status BEGIN
  INSERT OR IGNORE INTO rollup_feature_requirements(feature, status) VALUES (coalesce(new.feature,''), new.status);
  UPDATE rollup_feature_requirements SET n = n + 1 WHERE feature = coalesce(new.feature,'') AND status = new.status;
END;

CREATE TRIGGER requirement_status_au AFTER UPDATE OF status ON requirement_status
WHEN old.status IS NOT new.status BEGIN
  UPDATE rollup_feature_requirements SET n = n - 1 WHERE feature = coalesce(old.feature,'') AND status = old.status;
  INSERT OR IGNORE INTO rollup_feature_requirements(feature, status) VALUES (coalesce(new.feature,''), new.status);
  UPDATE rollup_feature_requirements SET n = n + 1 WHERE feature = coalesce(new.feature,'') AND status = new.status;
END;

------------------------------------------------------------------------------------------------
-- 7. Budgets, reservations and grants (integer units)
------------------------------------------------------------------------------------------------

CREATE TABLE budgets (
  scope_kind     TEXT NOT NULL CHECK (scope_kind IN ('project','feature','task','wave_paperwork','grant')),
  scope_id       TEXT NOT NULL,
  currency       TEXT NOT NULL REFERENCES currencies(code),
  limit_units    INTEGER NOT NULL CHECK (limit_units >= 0),
  reserved_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  spent_units    INTEGER NOT NULL DEFAULT 0 CHECK (spent_units >= 0),   -- may exceed limit after an overrun
  closed         INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1)),
  parent_kind    TEXT,
  parent_id      TEXT,
  PRIMARY KEY (scope_kind, scope_id, currency)
) STRICT, WITHOUT ROWID;

CREATE TABLE reservations (
  id            TEXT PRIMARY KEY,
  attempt       TEXT REFERENCES attempts(id),
  purpose       TEXT NOT NULL,             -- model_call | paperwork | effect
  currency      TEXT NOT NULL REFERENCES currencies(code),
  amount_units  INTEGER NOT NULL CHECK (amount_units > 0),
  state         TEXT NOT NULL CHECK (state IN ('held','settled','released','unknown')),
  actual_units  INTEGER CHECK (actual_units IS NULL OR actual_units >= 0),
  overrun_units INTEGER NOT NULL DEFAULT 0 CHECK (overrun_units >= 0),
  created_at    INTEGER NOT NULL,
  settled_at    INTEGER
) STRICT;
CREATE INDEX reservations_open ON reservations(state) WHERE state IN ('held','unknown');

CREATE TABLE reservation_scopes (
  reservation TEXT NOT NULL REFERENCES reservations(id),
  scope_kind  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  currency    TEXT NOT NULL,
  PRIMARY KEY (reservation, scope_kind, scope_id, currency),
  FOREIGN KEY (scope_kind, scope_id, currency) REFERENCES budgets(scope_kind, scope_id, currency)
) STRICT, WITHOUT ROWID;

CREATE TABLE grant_receipts (             -- grants deposited by the global broker (see global.sql)
  grant_id            TEXT PRIMARY KEY,
  connection          TEXT NOT NULL,
  currency            TEXT NOT NULL REFERENCES currencies(code),
  units               INTEGER NOT NULL CHECK (units > 0),
  concurrency         INTEGER NOT NULL DEFAULT 1,
  expires_at          INTEGER NOT NULL,
  deposited_rev       INTEGER NOT NULL,
  closed_at           INTEGER,
  used_units          INTEGER,
  unknown_units       INTEGER,
  closure_reported_at INTEGER
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 8. Idempotency, outbox, inbox, effects, Git and environment leases
------------------------------------------------------------------------------------------------

CREATE TABLE operations (
  op_id         TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  request_hash  TEXT NOT NULL,             -- same op_id with a different request is an error
  result        TEXT NOT NULL,
  committed_rev INTEGER,
  created_at    INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX operations_age ON operations(created_at);

CREATE TABLE outbox (                     -- durable domain events only; telemetry lives in telemetry.db
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- never reused, even after pruning
  id         TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  subject    TEXT,
  rev        INTEGER,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE outbox_deliveries (
  event_id     TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  consumer     TEXT NOT NULL,               -- scheduler | exporter | broker | ui_projection | ...
  delivered_at INTEGER,
  PRIMARY KEY (event_id, consumer)
) STRICT, WITHOUT ROWID;
CREATE INDEX outbox_pending ON outbox_deliveries(consumer) WHERE delivered_at IS NULL;

CREATE TABLE inbox_items (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                -- question | secret | human_step | approval | conflict | fyi
  subject     TEXT,
  owner_role  TEXT,
  priority    INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open','answered','superseded','dismissed')),
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  needed_by   INTEGER,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;
CREATE INDEX inbox_open ON inbox_items(priority DESC, created_at) WHERE status = 'open';

CREATE TABLE inbox_subscribers (
  item TEXT NOT NULL REFERENCES inbox_items(id),
  task TEXT NOT NULL REFERENCES task_runtime(task),
  PRIMARY KEY (item, task)
) STRICT, WITHOUT ROWID;

CREATE TABLE effects (                    -- push, PR, deploy, migration, env sync, DNS, webhook, send
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  target          TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  approval        TEXT,
  lease_epoch     INTEGER,
  state           TEXT NOT NULL CHECK (state IN ('intended','approved','sent','confirmed','failed','unknown')),
  receipt         TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX effects_open ON effects(state) WHERE state IN ('intended','approved','sent','unknown');

CREATE TABLE ref_leases (                 -- harness/integration, harness/f/*, harness/s/*
  ref          TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  expected_sha TEXT,
  expires_at   INTEGER
) STRICT, WITHOUT ROWID;

CREATE TABLE env_processes (              -- test environment process registry (ports live in global.db)
  pid         INTEGER NOT NULL,
  start_time  INTEGER NOT NULL,
  environment TEXT NOT NULL,
  role        TEXT NOT NULL,
  port        INTEGER,
  job_name    TEXT,
  PRIMARY KEY (pid, start_time)
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 9. Artifacts, module cards, export state, redactions
------------------------------------------------------------------------------------------------

CREATE TABLE artifacts (
  id         TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,                -- SHA-256 of the uncompressed content
  kind       TEXT NOT NULL,                -- log | trace | screenshot | diff | page | audio | source | asset | items
  bytes      INTEGER NOT NULL,
  mime       TEXT,
  retention  TEXT NOT NULL CHECK (retention IN ('evidence','diagnostic','ephemeral','asset')),
  line_index TEXT,                         -- artifact ID of the sidecar line index for large text
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX artifacts_hash ON artifacts(hash);

CREATE TABLE artifact_refs (
  artifact   TEXT NOT NULL REFERENCES artifacts(id),
  owner_kind TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  PRIMARY KEY (artifact, owner_kind, owner_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE module_cards (               -- brownfield L2 summaries (cost tokens, so kept)
  path       TEXT NOT NULL,
  file_hash  TEXT NOT NULL,
  artifact   TEXT NOT NULL REFERENCES artifacts(id),
  model      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (path, file_hash)
) STRICT, WITHOUT ROWID;

CREATE TABLE export_state (               -- incremental export to the harness-state branch
  target      TEXT PRIMARY KEY,            -- 'harness-state'
  last_rev    INTEGER NOT NULL DEFAULT 0,
  commit_sha  TEXT,
  history_seg INTEGER NOT NULL DEFAULT 0,  -- last appended history segment number
  updated_at  INTEGER
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 10. ID allocation, negative reads, step archives
------------------------------------------------------------------------------------------------

CREATE TABLE id_counters (                -- human-readable IDs (T07, R17, A0014) are never reused
  prefix TEXT PRIMARY KEY,                 -- 'T', 'R', 'SI-', 'A'
  next   INTEGER NOT NULL CHECK (next >= 1)
) STRICT, WITHOUT ROWID;

CREATE TABLE search_reads (               -- what an attempt saw from a search, including "nothing found"
  attempt     TEXT NOT NULL REFERENCES attempts(id),
  query_hash  TEXT NOT NULL,               -- hash of canonical {query, filters}
  query       TEXT NOT NULL CHECK (json_valid(query)),
  result_hash TEXT NOT NULL,               -- hash of the sorted result IDs and versions ('' set allowed)
  rev         INTEGER NOT NULL,
  PRIMARY KEY (attempt, query_hash)
) STRICT, WITHOUT ROWID;

CREATE TABLE turn_log_archives (          -- full step rows moved to a blob once the attempt is closed
  attempt     TEXT PRIMARY KEY REFERENCES attempts(id),
  artifact    TEXT NOT NULL REFERENCES artifacts(id),
  steps       INTEGER NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  archived_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

------------------------------------------------------------------------------------------------
-- 11. Lifecycles, path leases, verification state, checkpoints, shipping, discovery
--     (added by the 18 November architecture review; see ../architecture-deep-review.md)
------------------------------------------------------------------------------------------------

CREATE TABLE feature_states (
  state    TEXT PRIMARY KEY,
  terminal INTEGER NOT NULL DEFAULT 0 CHECK (terminal IN (0,1))
) STRICT, WITHOUT ROWID;
INSERT INTO feature_states VALUES
  ('PLANNED',0),('JIT_READY',0),('IN_WAVE',0),('LEAVES_MERGED',0),('WIRED',0),('JOURNEY_PASSED',0),
  ('QUEUED_FOR_MERGE',0),('MERGED',0),('DONE',1),('BLOCKED',0),('REOPENED',0),('DEFERRED',0),('ABANDONED',1);

CREATE TABLE feature_runtime (            -- mutable lifecycle of a feature node
  feature            TEXT PRIMARY KEY REFERENCES nodes(id),
  state              TEXT NOT NULL REFERENCES feature_states(state),
  wave               INTEGER,
  integration_holder TEXT,                 -- role holding the feature integration lease (the plan author by default)
  epoch              INTEGER NOT NULL DEFAULT 0,
  branch             TEXT,                 -- harness/f/<feature>
  updated_rev        INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX feature_runtime_state ON feature_runtime(state);

CREATE TABLE project_states (state TEXT PRIMARY KEY) STRICT, WITHOUT ROWID;
INSERT INTO project_states VALUES ('DISCOVERY'),('SPEC_COMPLETE'),('UPFRONT_DOCS'),('PREVIEW'),('PHASE0'),
  ('WAVES'),('COMPLETION'),('READY_TO_LAND'),('LANDED'),('SHIPPING');

CREATE TABLE project_runtime (            -- exactly one row
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  state        TEXT NOT NULL REFERENCES project_states(state),
  current_wave INTEGER,
  paused       INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  updated_rev  INTEGER NOT NULL
) STRICT;

CREATE TABLE task_scopes (                -- literal path prefixes of a task's write scope (from its globs)
  task        TEXT NOT NULL REFERENCES task_runtime(task),
  path_prefix TEXT NOT NULL,               -- 'src/app/kitchen/' for 'src/app/kitchen/**'
  PRIMARY KEY (task, path_prefix)
) STRICT, WITHOUT ROWID;

CREATE TABLE path_leases (                -- sweeps (and other exclusive work) over many paths
  id         TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,                -- sweep task ID
  mode       TEXT NOT NULL CHECK (mode IN ('intent','granted')),   -- intent already blocks new claims
  epoch      INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE path_lease_prefixes (
  lease       TEXT NOT NULL REFERENCES path_leases(id) ON DELETE CASCADE,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (lease, path_prefix)
) STRICT, WITHOUT ROWID;

CREATE TABLE edge_read_sets (             -- edge sets an attempt relied on, including "no consumer exists"
  attempt TEXT NOT NULL REFERENCES attempts(id),
  node    TEXT NOT NULL,
  dir     TEXT NOT NULL CHECK (dir IN ('in','out')),
  type    TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (attempt, node, dir, type)
) STRICT, WITHOUT ROWID;

CREATE TABLE verification_state (         -- hint ladder per task; survives attempts, resets on a new brief
  task             TEXT PRIMARY KEY REFERENCES task_runtime(task),
  brief_version    INTEGER NOT NULL,
  ladder_step      INTEGER NOT NULL DEFAULT 0 CHECK (ladder_step BETWEEN 0 AND 3),
  last_fingerprint TEXT,
  same_fingerprint INTEGER NOT NULL DEFAULT 0,
  disclosed_checks TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(disclosed_checks)),
  static_failures  INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE attempt_checkpoints (        -- everything needed to resume an attempt after a stop or crash
  attempt           TEXT PRIMARY KEY REFERENCES attempts(id),
  step              INTEGER NOT NULL,
  wip_ref           TEXT,                  -- refs/harness/checkpoints/<attempt>/<step>
  session_ref       TEXT,                  -- foreign runtime session or thread ID
  contract_versions TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(contract_versions)),
  pending_effects   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pending_effects)),
  handoff_artifact  TEXT,                  -- handoff note shown on welcome-back
  updated_at        INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE ship_runs (                  -- pull requests, CI runs, deployments and live migrations
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('pr','ci','deploy','migration')),
  feature             TEXT,
  effect              TEXT REFERENCES effects(id),
  repo                TEXT,
  pr_number           INTEGER,
  head_sha            TEXT,
  run_id              TEXT,
  environment         TEXT,                -- preview | staging | production
  status              TEXT NOT NULL CHECK (status IN ('pending','running','passed','failed','cancelled','rolled_back')),
  failure_fingerprint TEXT,
  repair_generation   INTEGER NOT NULL DEFAULT 0,
  url                 TEXT,
  updated_at          INTEGER NOT NULL
) STRICT;
CREATE INDEX ship_runs_open ON ship_runs(kind, status) WHERE status IN ('pending','running','failed');

CREATE TABLE work_items (                 -- one per project, plus one per brownfield change request
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('project','change','fix','feature_request')),
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('discovering','ready','planned','done','abandoned')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE discovery_scopes (           -- a scope revision freezes the applicable decision set
  work_item   TEXT NOT NULL REFERENCES work_items(id),
  scope_rev   INTEGER NOT NULL,
  created_rev INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (work_item, scope_rev)
) STRICT, WITHOUT ROWID;

CREATE TABLE scope_criteria (             -- which decision nodes count, and which are needed before building
  work_item           TEXT NOT NULL,
  scope_rev           INTEGER NOT NULL,
  decision            TEXT NOT NULL REFERENCES nodes(id),
  needed_for_planning INTEGER NOT NULL CHECK (needed_for_planning IN (0,1)),
  critical            INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0,1)),
  PRIMARY KEY (work_item, scope_rev, decision),
  FOREIGN KEY (work_item, scope_rev) REFERENCES discovery_scopes(work_item, scope_rev)
) STRICT, WITHOUT ROWID;

CREATE TABLE discovery_batches (
  id         TEXT PRIMARY KEY,
  work_item  TEXT NOT NULL REFERENCES work_items(id),
  scope_rev  INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('open','answered','superseded')),
  questions  TEXT NOT NULL CHECK (json_valid(questions)),    -- ordered decision IDs
  cursor     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX discovery_batches_open ON discovery_batches(work_item) WHERE status = 'open';

CREATE TABLE redactions (                 -- the only sanctioned rewrite of history
  id                 TEXT PRIMARY KEY,
  secret_fingerprint TEXT NOT NULL,        -- HMAC of the value with a local key, never the value
  label              TEXT NOT NULL,        -- '[REDACTED:STRIPE_SECRET_KEY]'
  counts             TEXT NOT NULL CHECK (json_valid(counts)),
  hash_map_artifact  TEXT,                 -- old content hash -> new content hash
  created_at         INTEGER NOT NULL
) STRICT;
