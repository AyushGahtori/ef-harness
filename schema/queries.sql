-- EF Harness · canonical statements for state.db (and global.db where noted)
-- Each block starts with "-- name:". Writes run inside BEGIN IMMEDIATE on the single writer;
-- the kernel checks changes() / returned rows exactly as noted. Parameters use :name.

-- name: claim_task
-- One row returned = claimed. Zero rows = not ready, held, dependency open, brief changed or lost the race.
-- The holder foreign key is deferred until create_attempt inserts the attempt in the same transaction.
UPDATE task_runtime
   SET state = 'LEASED', holder_attempt = :attempt, epoch = epoch + 1,
       lease_expires_at = :expires_at, updated_rev = :rev
 WHERE task = :task
   AND state IN (SELECT state FROM task_states WHERE claimable = 1)
   AND (SELECT version FROM nodes WHERE id = :task) = :expected_brief
   AND NOT EXISTS (SELECT 1 FROM task_holds h WHERE h.task = :task)
   AND NOT EXISTS (SELECT 1
                     FROM edges d
                     JOIN task_runtime dep ON dep.task = d.dst
                     JOIN task_states s ON s.state = dep.state
                    WHERE d.src = :task AND d.type = 'depends_on' AND d.valid_to_rev IS NULL
                      AND s.done = 0)
   AND NOT EXISTS (SELECT 1                       -- no sweep (intent or granted) overlaps the write scope
                     FROM task_scopes ts
                     JOIN path_lease_prefixes p
                       ON substr(ts.path_prefix, 1, length(p.path_prefix)) = p.path_prefix
                       OR substr(p.path_prefix, 1, length(ts.path_prefix)) = ts.path_prefix
                     JOIN path_leases l ON l.id = p.lease AND l.holder <> :task
                    WHERE ts.task = :task)
RETURNING epoch;

-- name: create_attempt
INSERT INTO attempts (id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
VALUES (:attempt, :task,
        (SELECT coalesce(max(n), 0) + 1 FROM attempts WHERE task = :task),
        :epoch, :expected_brief, :runtime, :model, :connection, :base_commit, 'running', :now);

-- name: sweep_expired_leases
-- A lease whose submission arrived in time (submission_pending = 1) is never expired.
UPDATE task_runtime
   SET state = 'READY', holder_attempt = NULL, epoch = epoch + 1, lease_expires_at = NULL, updated_rev = :rev
 WHERE holder_attempt IS NOT NULL
   AND lease_expires_at < :now
   AND submission_pending = 0
   AND state IN ('LEASED','CODING')
RETURNING task, epoch;

-- name: fence_attempts
UPDATE attempts SET state = 'fenced', ended_at = :now
 WHERE state = 'running'
   AND NOT EXISTS (SELECT 1 FROM task_runtime t WHERE t.holder_attempt = attempts.id);

-- name: submit_candidate
-- Inserted only if the attempt still holds the task with the same epoch. Zero changes = stale.
INSERT INTO candidates (id, task, attempt, epoch, commit_sha, payload, received_at)
SELECT :candidate, :task, :attempt, :epoch, :commit_sha, :payload, :now
 WHERE EXISTS (SELECT 1 FROM task_runtime
                WHERE task = :task AND holder_attempt = :attempt AND epoch = :epoch);

-- name: reserve
-- reservation_scopes rows for :reservation are inserted first (task, feature, project, grant).
-- Success only if changes() equals the number of scope rows; otherwise ROLLBACK TO the savepoint.
UPDATE budgets
   SET reserved_units = reserved_units + :amount
 WHERE (scope_kind, scope_id, currency) IN
       (SELECT scope_kind, scope_id, currency FROM reservation_scopes WHERE reservation = :reservation)
   AND closed = 0
   AND reserved_units + spent_units + :amount <= limit_units;

-- name: settle
-- Always succeeds: money already spent is recorded even if it exceeds a limit (overrun).
-- An overrun makes every further reserve() under that scope fail until a person raises the limit.
UPDATE budgets
   SET reserved_units = reserved_units - (SELECT amount_units FROM reservations WHERE id = :reservation),
       spent_units    = spent_units + :actual
 WHERE (scope_kind, scope_id, currency) IN
       (SELECT scope_kind, scope_id, currency FROM reservation_scopes WHERE reservation = :reservation)
   AND EXISTS (SELECT 1 FROM reservations WHERE id = :reservation AND state IN ('held','unknown'));

-- name: settle_mark
UPDATE reservations
   SET state = 'settled', actual_units = :actual,
       overrun_units = max(0, :actual - amount_units), settled_at = :now
 WHERE id = :reservation AND state IN ('held','unknown');

-- name: release
UPDATE budgets
   SET reserved_units = reserved_units - (SELECT amount_units FROM reservations WHERE id = :reservation)
 WHERE (scope_kind, scope_id, currency) IN
       (SELECT scope_kind, scope_id, currency FROM reservation_scopes WHERE reservation = :reservation)
   AND EXISTS (SELECT 1 FROM reservations WHERE id = :reservation AND state = 'held');

-- name: budget_remaining
SELECT scope_kind, scope_id, currency, limit_units, reserved_units, spent_units,
       max(0, limit_units - reserved_units - spent_units) AS remaining_units,
       spent_units > limit_units AS overrun
  FROM budgets WHERE scope_kind = :scope_kind AND scope_id = :scope_id;

-- name: validate_change_set_reads
-- :reads is JSON [{"id":"R17","v":3}, {"id":"C-014","dir":"in","type":"consumes_contract","v":5}, ...]
-- Returns the stale entries; any row means the change set must be recomputed.
SELECT r.value ->> '$.id' AS target, r.value ->> '$.dir' AS dir, r.value ->> '$.type' AS edge_type,
       r.value ->> '$.v' AS read_version,
       CASE WHEN r.value ->> '$.dir' IS NULL THEN n.version ELSE coalesce(e.version, 0) END AS current_version
  FROM json_each(:reads) AS r
  LEFT JOIN nodes n ON r.value ->> '$.dir' IS NULL AND n.id = r.value ->> '$.id'
  LEFT JOIN edge_set_versions e ON r.value ->> '$.dir' IS NOT NULL
        AND e.node = r.value ->> '$.id' AND e.dir = r.value ->> '$.dir' AND e.type = r.value ->> '$.type'
 WHERE (CASE WHEN r.value ->> '$.dir' IS NULL THEN n.version ELSE coalesce(e.version, 0) END)
       IS NOT (r.value ->> '$.v');

-- name: stale_reads_for_acceptance
-- Any row: the attempt read a node that has since had a breaking change; re-verify before accepting.
SELECT rs.node, rs.version AS read_version, n.version AS current_version
  FROM read_sets rs
  JOIN nodes n ON n.id = rs.node
 WHERE rs.attempt = :attempt
   AND n.version > rs.version
   AND EXISTS (SELECT 1 FROM node_changes c
                WHERE c.id = rs.node AND c.new_version > rs.version AND c.class IN ('breaking','retired'));

-- name: impact_walk
-- Reverse walk over invalidating edges, capped by depth and row count. 5001 rows = partial: report frontier.
WITH RECURSIVE impact(id, depth) AS (
  SELECT :start, 0
  UNION
  SELECT e.src, i.depth + 1
    FROM impact i
    JOIN edges e ON e.dst = i.id AND e.valid_to_rev IS NULL
    JOIN edge_types t ON t.type = e.type AND t.invalidates = 1
   WHERE i.depth < :max_depth
  LIMIT 5001
)
SELECT id, min(depth) AS depth FROM impact GROUP BY id;

-- name: asof_nodes
SELECT id, version, kind, title, status
  FROM node_versions
 WHERE valid_from_rev <= :rev AND (valid_to_rev IS NULL OR valid_to_rev > :rev);

-- name: asof_edges
SELECT src, type, dst
  FROM edges
 WHERE valid_from_rev <= :rev AND (valid_to_rev IS NULL OR valid_to_rev > :rev);

-- name: export_dirty_nodes
-- Nodes whose files must be rewritten in the harness-state export since the last exported revision.
SELECT c.id FROM node_changes c JOIN change_sets s ON s.id = c.change_set WHERE s.rev > :last_rev
UNION
SELECT src FROM edges WHERE valid_from_rev > :last_rev OR valid_to_rev > :last_rev;

-- name: requirements_without_task
SELECT r.id FROM requirements r
 WHERE NOT EXISTS (SELECT 1 FROM task_requirements tr WHERE tr.requirement_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM waivers w WHERE w.requirement_id = r.id);

-- name: requirements_without_check
SELECT r.id FROM requirements r
 WHERE NOT EXISTS (SELECT 1 FROM check_requirements cr WHERE cr.requirement_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM waivers w WHERE w.requirement_id = r.id);

-- name: tasks_without_requirement
SELECT t.task FROM task_runtime t
 WHERE NOT EXISTS (SELECT 1 FROM task_requirements tr WHERE tr.task_id = t.task);

-- name: rollup_drift
-- Periodic self-check: any row means a trigger bug; the rollup is rebuilt from source rows.
SELECT coalesce(a.feature, b.feature) AS feature, coalesce(a.state, b.state) AS state, a.n AS rollup_n, b.n AS actual_n
  FROM rollup_feature_tasks a
  FULL OUTER JOIN (SELECT feature, state, count(*) AS n FROM task_runtime GROUP BY feature, state) b
    ON a.feature = b.feature AND a.state = b.state
 WHERE coalesce(a.n, 0) <> coalesce(b.n, 0);

-- name: op_lookup
-- Row with same_request = 0 means the op_id was reused for a different request: reject with op_id_reused.
SELECT result, request_hash = :request_hash AS same_request FROM operations WHERE op_id = :op_id;

-- name: prune_operations
DELETE FROM operations WHERE created_at < :cutoff;

-- name: register_delivery
-- Run once per intended consumer in the same transaction that inserts the outbox event.
INSERT INTO outbox_deliveries(event_id, consumer) VALUES (:event_id, :consumer);

-- name: prune_outbox
-- Deletes only events that have delivery rows and all of them acknowledged.
-- An event with no delivery rows is a bug, never prunable.
DELETE FROM outbox
 WHERE created_at < :cutoff
   AND EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = outbox.id)
   AND NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = outbox.id AND d.delivered_at IS NULL);

-- name: outbox_without_deliveries
SELECT o.id FROM outbox o WHERE NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id);

-- name: accept_submission
-- Runs in the same transaction as submit_candidate: stops lease expiry while verification runs.
UPDATE task_runtime
   SET state = 'STATIC_AUDIT', submission_pending = 1, updated_rev = :rev
 WHERE task = :task AND holder_attempt = :attempt AND epoch = :epoch AND state IN ('LEASED','CODING');

-- name: finish_submission
-- Verification outcome: ACCEPTED, back to CODING (hint ladder), ESCALATED or EXHAUSTED.
UPDATE task_runtime
   SET state = :next_state, submission_pending = 0, updated_rev = :rev,
       holder_attempt = CASE WHEN :next_state IN ('ESCALATED','EXHAUSTED') THEN NULL ELSE holder_attempt END
 WHERE task = :task AND epoch = :epoch AND submission_pending = 1;

-- name: relations_in_fields
-- One home per fact: relations live in edges. A task node must not carry depends_on (or similar) in fields.
SELECT id FROM nodes
 WHERE status = 'active'
   AND (fields ->> '$.depends_on' IS NOT NULL OR fields ->> '$.implements' IS NOT NULL
        OR fields ->> '$.verifies' IS NOT NULL OR fields ->> '$.consumes' IS NOT NULL);

-- name: advance_feature_leaves_merged
-- A feature leaves IN_WAVE only when every leaf task is squashed onto the feature branch.
UPDATE feature_runtime
   SET state = 'LEAVES_MERGED', updated_rev = :rev
 WHERE feature = :feature AND state = 'IN_WAVE'
   AND EXISTS (SELECT 1 FROM task_runtime t WHERE t.feature = :feature)
   AND NOT EXISTS (SELECT 1 FROM task_runtime t JOIN nodes n ON n.id = t.task
                    WHERE t.feature = :feature
                      AND coalesce(n.fields ->> '$.task_type', 'leaf') = 'leaf'
                      AND t.state NOT IN ('MERGED_TO_FEATURE','CANCELLED','SUPERSEDED'));

-- name: open_sweep_intent
INSERT INTO path_leases(id, holder, mode, created_at) VALUES (:lease, :sweep_task, 'intent', :now);

-- name: grant_sweep_lease
-- Granted only when no other task actively holds an overlapping write scope.
UPDATE path_leases SET mode = 'granted'
 WHERE id = :lease AND mode = 'intent'
   AND NOT EXISTS (SELECT 1
                     FROM path_lease_prefixes p
                     JOIN task_scopes ts
                       ON substr(ts.path_prefix, 1, length(p.path_prefix)) = p.path_prefix
                       OR substr(p.path_prefix, 1, length(ts.path_prefix)) = ts.path_prefix
                     JOIN task_runtime t ON t.task = ts.task
                    WHERE p.lease = :lease AND t.task <> path_leases.holder
                      AND t.state IN ('LEASED','CODING','STATIC_AUDIT','CLEAN_VERIFY'));

-- name: stale_edge_reads_for_acceptance
-- Any row: an edge set the attempt relied on (including an empty one) has changed.
SELECT r.node, r.dir, r.type, r.version AS read_version, e.version AS current_version
  FROM edge_read_sets r
  JOIN edge_set_versions e ON e.node = r.node AND e.dir = r.dir AND e.type = r.type
 WHERE r.attempt = :attempt AND e.version > r.version;

-- name: record_hidden_failure
-- Step 1: rule and failure type. Step 2: fresh disclosed example. Step 3: escalate.
-- The same fingerprint twice in a row jumps to step 3.
INSERT INTO verification_state(task, brief_version, ladder_step, last_fingerprint, same_fingerprint, updated_at)
VALUES (:task, :brief_version, 1, :fingerprint, 1, :now)
ON CONFLICT(task) DO UPDATE SET
  ladder_step = CASE
      WHEN verification_state.brief_version <> excluded.brief_version THEN 1
      WHEN verification_state.last_fingerprint = excluded.last_fingerprint THEN 3
      ELSE min(3, verification_state.ladder_step + 1) END,
  same_fingerprint = CASE
      WHEN verification_state.brief_version = excluded.brief_version
       AND verification_state.last_fingerprint = excluded.last_fingerprint
      THEN verification_state.same_fingerprint + 1 ELSE 1 END,
  brief_version = excluded.brief_version,
  last_fingerprint = excluded.last_fingerprint,
  updated_at = excluded.updated_at
RETURNING ladder_step;

-- name: requirement_status_recompute
-- Source of truth for requirement_status: latest result per check at the check's current version.
WITH ranked AS (
  SELECT cr.check_id, cr.status,
         row_number() OVER (PARTITION BY cr.check_id ORDER BY cr.recorded_at DESC) AS rn
    FROM check_results cr JOIN nodes c ON c.id = cr.check_id AND cr.check_version = c.version
), latest AS (SELECT check_id, status FROM ranked WHERE rn = 1)
SELECT r.id AS requirement, r.feature,
  CASE
    WHEN EXISTS (SELECT 1 FROM waivers w WHERE w.requirement_id = r.id) THEN 'waived'
    WHEN NOT EXISTS (SELECT 1 FROM check_requirements q WHERE q.requirement_id = r.id) THEN 'uncovered'
    WHEN EXISTS (SELECT 1 FROM check_requirements q JOIN latest l ON l.check_id = q.check_id
                  WHERE q.requirement_id = r.id AND l.status <> 'pass') THEN 'failing'
    WHEN EXISTS (SELECT 1 FROM check_requirements q LEFT JOIN latest l ON l.check_id = q.check_id
                  WHERE q.requirement_id = r.id AND l.check_id IS NULL) THEN 'pending'
    ELSE 'passing' END AS status
  FROM requirements r;

-- name: readiness
-- Discovery progress for the latest scope revision of a work item ("Needed before building 18 of 18").
SELECT coalesce(sum(sc.needed_for_planning), 0) AS planning_total,
       coalesce(sum(CASE WHEN sc.needed_for_planning = 1 AND n.fields ->> '$.status' = 'settled' THEN 1 ELSE 0 END), 0) AS planning_settled,
       count(*) AS overall_total,
       coalesce(sum(CASE WHEN n.fields ->> '$.status' = 'settled' THEN 1 ELSE 0 END), 0) AS overall_settled,
       coalesce(sum(CASE WHEN sc.critical = 1 AND n.fields ->> '$.status' <> 'settled' THEN 1 ELSE 0 END), 0) AS critical_open
  FROM scope_criteria sc JOIN nodes n ON n.id = sc.decision
 WHERE sc.work_item = :work_item
   AND sc.scope_rev = (SELECT max(scope_rev) FROM discovery_scopes WHERE work_item = :work_item);

-- name: deposit_grant
INSERT OR IGNORE INTO grant_receipts (grant_id, connection, currency, units, concurrency, expires_at, deposited_rev)
VALUES (:grant_id, :connection, :currency, :units, :concurrency, :expires_at, :rev);

-- name: deposit_grant_budget
INSERT OR IGNORE INTO budgets (scope_kind, scope_id, currency, limit_units, parent_kind, parent_id)
VALUES ('grant', :grant_id, :currency, :units, NULL, NULL);

-- name: close_grant
-- Freeze the grant: no new reservations; report used and unknown units to the broker afterwards.
UPDATE budgets SET closed = 1, limit_units = spent_units + reserved_units
 WHERE scope_kind = 'grant' AND scope_id = :grant_id AND closed = 0;

-- name: close_grant_receipt
UPDATE grant_receipts
   SET closed_at = :now,
       used_units = (SELECT spent_units FROM budgets WHERE scope_kind = 'grant' AND scope_id = :grant_id),
       unknown_units = (SELECT coalesce(sum(r.amount_units), 0)
                          FROM reservations r JOIN reservation_scopes s ON s.reservation = r.id
                         WHERE s.scope_kind = 'grant' AND s.scope_id = :grant_id AND r.state = 'unknown')
 WHERE grant_id = :grant_id AND closed_at IS NULL;

-- name: secret_occurrences
-- Locate a pasted secret before redaction (value bound as :secret, never logged).
SELECT 'node_versions' AS tbl, id || '@' || version AS ref FROM node_versions
 WHERE instr(text, :secret) > 0 OR instr(fields, :secret) > 0
UNION ALL SELECT 'turns', id FROM turns WHERE instr(text, :secret) > 0
UNION ALL SELECT 'evidence', CAST(id AS TEXT) FROM evidence WHERE instr(quote, :secret) > 0
UNION ALL SELECT 'outbox', id FROM outbox WHERE instr(payload, :secret) > 0
UNION ALL SELECT 'change_sets', id FROM change_sets WHERE instr(coalesce(summary,'') || coalesce(origin_ref,''), :secret) > 0;

-- name: allocate_id
-- Atomic, never reused (also after retirement). Counters travel in the export manifest.
INSERT INTO id_counters(prefix, next) VALUES (:prefix, 1)
ON CONFLICT(prefix) DO UPDATE SET next = next + 1
RETURNING next AS n;

-- name: archive_turn_log
-- After the attempt is closed and its archive artifact is written to the blob store.
INSERT INTO turn_log_archives(attempt, artifact, steps, tokens_in, tokens_out, archived_at)
SELECT :attempt, :artifact, count(*), coalesce(sum(tokens_in), 0), coalesce(sum(tokens_out), 0), :now
  FROM turn_log WHERE attempt = :attempt
HAVING count(*) > 0;

-- name: purge_archived_turn_log
DELETE FROM turn_log
 WHERE attempt = :attempt
   AND EXISTS (SELECT 1 FROM turn_log_archives a WHERE a.attempt = :attempt)
   AND EXISTS (SELECT 1 FROM attempts t WHERE t.id = :attempt AND t.state NOT IN ('running','submitted','parked'));

-- name: global_cas_gc_candidates
-- (global.db) Blobs with no pin, past the grace period.
SELECT b.hash FROM cas_blobs b
 WHERE b.created_at < :grace_cutoff
   AND NOT EXISTS (SELECT 1 FROM cas_pins p WHERE p.hash = b.hash)
 LIMIT 1000;

-- name: global_expire_grants
-- (global.db) A project that never reported back: count the whole grant as used (conservative).
UPDATE grants SET state = 'expired', used_units = units, closed_at = :now
 WHERE state IN ('issued','deposited') AND expires_at + :grace_ms < :now
RETURNING id, project, connection, units;
