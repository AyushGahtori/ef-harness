-- EF Harness · per-project telemetry database (telemetry.db)
-- High-rate, lossy-tolerant data: worker progress, token counts, heartbeats, health metrics.
-- Not part of any transaction with state.db, not backed up, not exported. Losing it loses only detail.
-- Settings: journal_mode = WAL, synchronous = NORMAL. Retention: 14 days.

CREATE TABLE telemetry (
  id      INTEGER PRIMARY KEY,
  attempt TEXT,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,                    -- progress | tokens | heartbeat | tool | metric
  data    TEXT NOT NULL
) STRICT;
CREATE INDEX telemetry_attempt ON telemetry(attempt, ts);
CREATE INDEX telemetry_ts ON telemetry(ts);
