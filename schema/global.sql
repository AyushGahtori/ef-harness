-- EF Harness · per-user global database (global.db) · schema version 1
-- Single writer: the resource broker inside harnessd (owner row in `meta` + OS file lock).
-- Never ATTACHed to a project database for writing: cross-file transactions are not atomic in WAL mode.
-- Same connection settings and conventions as state.sql (integer units, integer milliseconds).

CREATE TABLE meta (
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

CREATE TABLE projects (
  id             TEXT PRIMARY KEY,
  path           TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ok','needs_migration','needs_repair','offline','removed')),
  last_opened_at INTEGER,
  last_seen_at   INTEGER                    -- last time its state.db was reachable
) STRICT;

CREATE TABLE connections (
  id         TEXT PRIMARY KEY,              -- 'chatgpt-personal', 'openrouter-key-1'
  provider   TEXT NOT NULL,
  route      TEXT NOT NULL,                 -- api_key | siwc | codex_app_server | copilot_sdk | cursor_sdk | claude_cli | gemini_cli | local
  plan       TEXT,
  vault_ref  TEXT,                          -- name in Windows Credential Manager, never the secret
  currency   TEXT NOT NULL,                 -- 'usd' or 'allowance:<id>'
  scale      INTEGER NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE connection_windows (         -- observed and estimated usage per limit window
  connection      TEXT NOT NULL REFERENCES connections(id),
  window_kind     TEXT NOT NULL,            -- '5h' | 'weekly' | 'monthly' | 'rpm'
  window_start    INTEGER NOT NULL,
  window_end      INTEGER NOT NULL,
  limit_units     INTEGER,
  observed_units  INTEGER,                  -- from the provider when it reports usage
  estimated_units INTEGER NOT NULL DEFAULT 0,
  source          TEXT,
  observed_at     INTEGER,
  PRIMARY KEY (connection, window_kind, window_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE grants (                     -- capacity handed to a project; the project spends it locally
  id             TEXT PRIMARY KEY,
  project        TEXT NOT NULL REFERENCES projects(id),
  connection     TEXT NOT NULL REFERENCES connections(id),
  currency       TEXT NOT NULL,
  units          INTEGER NOT NULL CHECK (units > 0),
  concurrency    INTEGER NOT NULL DEFAULT 1 CHECK (concurrency >= 1),
  priority_class TEXT NOT NULL CHECK (priority_class IN ('interactive','foreground','background','batch')),
  issued_at      INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('issued','deposited','closed','expired')),
  used_units     INTEGER,                   -- reported by the project at closure
  unknown_units  INTEGER,                   -- paid calls with unknown outcome at closure
  closed_at      INTEGER
) STRICT;
CREATE INDEX grants_open ON grants(connection, state) WHERE state IN ('issued','deposited');
CREATE INDEX grants_by_project ON grants(project, state);

CREATE TABLE port_leases (                -- ports are machine-wide, so they are leased here
  port        INTEGER PRIMARY KEY CHECK (port BETWEEN 41000 AND 48999),
  project     TEXT NOT NULL REFERENCES projects(id),
  environment TEXT NOT NULL,
  leased_at   INTEGER NOT NULL,
  expires_at  INTEGER
) STRICT;

CREATE TABLE machine_profile (
  key         TEXT PRIMARY KEY,             -- ram_total_mb, cores, gpu, dev_drive, calibration_run
  value       TEXT NOT NULL,
  measured_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE footprints (                 -- learned memory footprints per consumer type
  consumer   TEXT NOT NULL,                 -- worker_cli | dev_server | build | browser | postgres | whisper_base | ...
  project    TEXT NOT NULL DEFAULT '',      -- '' = machine-wide default
  p50_mb     INTEGER NOT NULL,
  p95_mb     INTEGER NOT NULL,
  samples    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (consumer, project)
) STRICT, WITHOUT ROWID;

CREATE TABLE research_cache (
  package       TEXT NOT NULL,
  version_range TEXT NOT NULL,              -- major.minor, e.g. '15.4'
  doc_url       TEXT NOT NULL,
  page_version  TEXT,
  artifact_hash TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  PRIMARY KEY (package, version_range, doc_url)
) STRICT, WITHOUT ROWID;

CREATE TABLE cas_blobs (
  hash             TEXT PRIMARY KEY,        -- SHA-256 of uncompressed content
  bytes            INTEGER NOT NULL,
  stored_bytes     INTEGER NOT NULL,
  format           TEXT NOT NULL CHECK (format IN ('zstd','zstd-seekable','raw')),
  state            TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','quarantined')),
  created_at       INTEGER NOT NULL,
  last_verified_at INTEGER
) STRICT, WITHOUT ROWID;

CREATE TABLE cas_pins (                   -- a blob is deleted only when no pin remains
  hash        TEXT NOT NULL,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('project','backup','research','export','pending')),
  holder_id   TEXT NOT NULL,
  pinned_at   INTEGER NOT NULL,
  PRIMARY KEY (hash, holder_kind, holder_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX cas_pins_holder ON cas_pins(holder_kind, holder_id);

CREATE TABLE vocabulary (                 -- dictation terms; project '' = the developer's global list
  term       TEXT NOT NULL,
  project    TEXT NOT NULL DEFAULT '',
  weight     INTEGER NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('correction','glossary','dependency','pattern','global')),
  heard_as   TEXT,                          -- for correction rules
  hits       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (term, project)
) STRICT, WITHOUT ROWID;

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT, WITHOUT ROWID;
