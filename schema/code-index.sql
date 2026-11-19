-- EF Harness · per-project code index (code-index.db)
-- Tree-sitter symbols, references and ranking for the repository. Fully rebuildable from Git,
-- so it is excluded from backups and from the harness-state export.
-- Keyed by file content hash, so unchanged files are shared across commits.

CREATE TABLE indexed_commits (
  commit_sha TEXT PRIMARY KEY,
  built_at   INTEGER NOT NULL,
  files      INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE commit_files (
  commit_sha TEXT NOT NULL REFERENCES indexed_commits(commit_sha),
  path       TEXT NOT NULL,
  file_hash  TEXT NOT NULL,
  PRIMARY KEY (commit_sha, path)
) STRICT, WITHOUT ROWID;
CREATE INDEX commit_files_hash ON commit_files(file_hash);

CREATE TABLE symbols (
  file_hash TEXT NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,                  -- function | class | type | const | component | route
  line      INTEGER NOT NULL,
  signature TEXT,
  exported  INTEGER NOT NULL CHECK (exported IN (0,1)),
  PRIMARY KEY (file_hash, name, line)
) STRICT, WITHOUT ROWID;
CREATE INDEX symbols_name ON symbols(name);

CREATE TABLE refs (                       -- file references a symbol name (resolved per commit)
  file_hash TEXT NOT NULL,
  name      TEXT NOT NULL,
  line      INTEGER NOT NULL,
  PRIMARY KEY (file_hash, name, line)
) STRICT, WITHOUT ROWID;
CREATE INDEX refs_name ON refs(name);

CREATE TABLE file_rank (                  -- reference-graph ranking (PageRank-style) per commit
  commit_sha TEXT NOT NULL,
  path       TEXT NOT NULL,
  score      REAL NOT NULL,                 -- a ranking score, not money: floating point is fine here
  PRIMARY KEY (commit_sha, path)
) STRICT, WITHOUT ROWID;
