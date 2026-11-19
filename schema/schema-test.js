// Schema scenario tests. Run from the repository root: node schema/schema-test.js
// Requires Node 22.13+ (built-in node:sqlite).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dir = process.argv[2] || path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(dir, 'schema', f), 'utf8');

const queries = {};
for (const block of read('queries.sql').split(/^-- name: /m).slice(1)) {
  const [name, ...rest] = block.split('\n');
  queries[name.trim()] = rest.filter(l => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
}

const results = [];
const check = (label, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', label, detail]); };

function splitWords(s) {
  if (!s) return '';
  const extra = String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-./:]+/g, ' ');
  return `${s} ${extra}`;
}

// ---------- state.db ----------
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.function('ef_search_text', { deterministic: true }, splitWords);
db.exec(read('state.sql'));
check('state.sql loads', true);

const g = new DatabaseSync(':memory:');
g.exec(read('global.sql'));
check('global.sql loads', true);
new DatabaseSync(':memory:').exec(read('telemetry.sql'));
new DatabaseSync(':memory:').exec(read('code-index.sql'));
check('telemetry.sql and code-index.sql load', true);

const q = (name) => db.prepare(queries[name]);
let rev = 0;
function changeSet(id) {
  rev += 1;
  db.prepare("INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'planner', 'test', 0)").run(id, rev);
  return rev;
}
function addNode(cs, r, id, kind, title, fields = {}, text = '') {
  db.prepare(`INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
              VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, 'h-' + id + '-1', title, text, JSON.stringify(fields), cs, r, r);
}
function addEdge(cs, r, src, type, dst) {
  db.prepare('INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)').run(src, type, dst, cs, r);
}

// Build a small project
db.exec('BEGIN IMMEDIATE');
let r1 = changeSet('CS-1');
addNode('CS-1', r1, 'F12', 'feature', 'Kitchen print', { feature: 'F12' });
addNode('CS-1', r1, 'R17', 'rule', 'Cutoff rule', { feature: 'F12' }, 'Orders close at 10:45 Europe/Berlin');
addNode('CS-1', r1, 'C-014', 'contract', 'kitchen-totals', { feature: 'F12' });
addNode('CS-1', r1, 'SI-212', 'spec_item', 'Locked totals after cutoff', { feature: 'F12' });
addNode('CS-1', r1, 'T03', 'task', 'Map totals with toPrintRows', { feature: 'F12', names: [{ kind: 'http_route', value: '/api/kitchen/totals' }] });
addNode('CS-1', r1, 'T07', 'task', 'Kitchen print page', { feature: 'F12', names: [{ kind: 'page_route', value: '/kitchen' }] });
addNode('CS-1', r1, 'AC-31', 'check', 'Totals grouped by dish', { feature: 'F12' });
addEdge('CS-1', r1, 'T07', 'depends_on', 'T03');
addEdge('CS-1', r1, 'T07', 'implements', 'SI-212');
addEdge('CS-1', r1, 'T07', 'obeys', 'R17');
addEdge('CS-1', r1, 'T07', 'consumes_contract', 'C-014');
addEdge('CS-1', r1, 'AC-31', 'verifies', 'SI-212');
addEdge('CS-1', r1, 'SI-212', 'derived_from', 'R17');
for (const t of ['T03', 'T07']) {
  db.prepare("INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, 'F12', 'READY', 'Mid', ?)").run(t, r1);
}
db.exec('COMMIT');
check('triggers wrote node_versions', db.prepare('SELECT count(*) c FROM node_versions').get().c === 7);
check('names registry filled from fields', db.prepare('SELECT count(*) c FROM names').get().c === 2);

// --- Bug C: claim respects dependencies, holds, brief version, and races
const claimArgs = (task, attempt, brief = 1) => ({ task, attempt, expires_at: 1000, rev: rev, expected_brief: brief });
db.exec('BEGIN IMMEDIATE');
let rows = q('claim_task').all(claimArgs('T07', 'A-T07-1'));
db.exec('ROLLBACK');
check('claim refused while dependency T03 is not done', rows.length === 0);

db.exec('BEGIN IMMEDIATE');
rows = q('claim_task').all(claimArgs('T03', 'A-T03-1'));
q('create_attempt').run({ attempt: 'A-T03-1', task: 'T03', epoch: rows[0].epoch, expected_brief: 1, runtime: 'own', model: 'm', connection: 'c', base_commit: 'abc', now: 1 });
db.exec('COMMIT');
check('claim succeeds and attempt row satisfies deferred FK', rows.length === 1 && rows[0].epoch === 1);

db.exec('BEGIN IMMEDIATE');
rows = q('claim_task').all(claimArgs('T03', 'A-T03-X'));
db.exec('ROLLBACK');
check('second claim on the same task loses', rows.length === 0);

let fkFailed = false;
try {
  db.exec('BEGIN IMMEDIATE');
  db.prepare("UPDATE task_runtime SET holder_attempt = 'NOPE' WHERE task = 'T07'").run();
  db.exec('COMMIT');
} catch (e) { fkFailed = true; db.exec('ROLLBACK'); }
check('holder_attempt pointing at a missing attempt is rejected at commit', fkFailed);

db.exec("UPDATE task_runtime SET state='ACCEPTED' WHERE task='T03'");
db.exec("INSERT INTO task_holds(task, reason, source, created_at) VALUES ('T07','user_pause','msg-1',0)");
db.exec('BEGIN IMMEDIATE');
rows = q('claim_task').all(claimArgs('T07', 'A-T07-1'));
db.exec('ROLLBACK');
check('claim refused while a hold exists', rows.length === 0);
db.exec("DELETE FROM task_holds WHERE task='T07'");
db.exec('BEGIN IMMEDIATE');
rows = q('claim_task').all(claimArgs('T07', 'A-T07-1', 99));
db.exec('ROLLBACK');
check('claim refused when the brief version changed', rows.length === 0);

// lease expiry and stale submission
db.exec('BEGIN IMMEDIATE');
rows = q('claim_task').all(claimArgs('T07', 'A-T07-1'));
q('create_attempt').run({ attempt: 'A-T07-1', task: 'T07', epoch: rows[0].epoch, expected_brief: 1, runtime: 'own', model: 'm', connection: 'c', base_commit: 'abc', now: 1 });
db.exec('COMMIT');
const epochT07 = rows[0].epoch;
db.exec('BEGIN IMMEDIATE');
const expired = q('sweep_expired_leases').all({ now: 5000, rev });
q('fence_attempts').run({ now: 5000 });
db.exec('COMMIT');
check('expired lease returns task to READY with a new epoch', expired.length === 1 && expired[0].epoch === epochT07 + 1);
const sub = q('submit_candidate').run({ candidate: 'CAND-1', task: 'T07', attempt: 'A-T07-1', epoch: epochT07, commit_sha: 'def', payload: '{}', now: 6000 });
check('submission from the fenced attempt is ignored', sub.changes === 0);

// --- Bug B: integer budgets, reserve, overrun settlement
db.exec("INSERT INTO currencies VALUES ('allowance:chatgpt','ppm',1000000)");
db.exec("INSERT INTO budgets(scope_kind, scope_id, currency, limit_units) VALUES ('project','P','usd',1000000), ('task','T07','usd',300000), ('grant','G1','usd',800000)");
function reserve(id, amount, scopes) {
  db.prepare("INSERT INTO reservations(id, purpose, currency, amount_units, state, created_at) VALUES (?, 'model_call', 'usd', ?, 'held', 0)").run(id, amount);
  for (const [k, s] of scopes) db.prepare("INSERT INTO reservation_scopes VALUES (?, ?, ?, 'usd')").run(id, k, s);
  return q('reserve').run({ reservation: id, amount }).changes === scopes.length;
}
const chain = [['task', 'T07'], ['project', 'P'], ['grant', 'G1']];
db.exec('BEGIN IMMEDIATE'); db.exec('SAVEPOINT r1');
const ok1 = reserve('RES-1', 100000, chain);
db.exec('RELEASE r1'); db.exec('COMMIT');
check('0.10 USD reserved on all three scopes', ok1);
db.exec('BEGIN IMMEDIATE'); db.exec('SAVEPOINT r2');
const ok2 = reserve('RES-2', 250000, chain);
if (!ok2) db.exec('ROLLBACK TO r2');
db.exec('RELEASE r2'); db.exec('COMMIT');
check('reservation over the task limit is refused and rolled back', !ok2 && db.prepare("SELECT reserved_units r FROM budgets WHERE scope_id='P'").get().r === 100000);
db.exec('BEGIN IMMEDIATE');
q('settle').run({ reservation: 'RES-1', actual: 340000 });
q('settle_mark').run({ reservation: 'RES-1', actual: 340000, now: 1 });
db.exec('COMMIT');
const t07 = db.prepare("SELECT * FROM budgets WHERE scope_id='T07'").get();
const res1 = db.prepare("SELECT * FROM reservations WHERE id='RES-1'").get();
check('overrun settlement records actual spend above the limit', t07.spent_units === 340000 && t07.reserved_units === 0 && res1.overrun_units === 240000);
db.exec('BEGIN IMMEDIATE'); db.exec('SAVEPOINT r3');
const ok3 = reserve('RES-3', 1, chain);
if (!ok3) db.exec('ROLLBACK TO r3');
db.exec('RELEASE r3'); db.exec('COMMIT');
check('after an overrun no further reservation fits that scope', !ok3);
check('sum of three 0.1 USD amounts is exact in integer units', 100000 + 100000 + 100000 === 300000);

// --- #4: edge-type noise and read-set validation
const before = db.prepare("SELECT version FROM edge_set_versions WHERE node='C-014' AND dir='in' AND type='consumes_contract'").get().version;
db.exec('BEGIN IMMEDIATE');
let r2 = changeSet('CS-2');
addNode('CS-2', r2, 'NOTE-1', 'comment', 'Reviewer note');
addEdge('CS-2', r2, 'NOTE-1', 'comments_on', 'C-014');
db.exec('COMMIT');
const after = db.prepare("SELECT version FROM edge_set_versions WHERE node='C-014' AND dir='in' AND type='consumes_contract'").get().version;
check('a comment edge does not bump the consumer edge-set version', before === after);
const reads = JSON.stringify([{ id: 'R17', v: 1 }, { id: 'C-014', dir: 'in', type: 'consumes_contract', v: before }]);
check('read set still valid after unrelated edge', q('validate_change_set_reads').all({ reads }).length === 0);
db.exec('BEGIN IMMEDIATE');
let r3 = changeSet('CS-3');
db.prepare(`UPDATE nodes SET version = 2, content_hash = 'h-R17-2', text = 'Orders close at 10:30', change_set = 'CS-3', updated_rev = ? WHERE id = 'R17'`).run(r3);
db.prepare("INSERT INTO node_changes VALUES ('CS-3','R17',1,2,'breaking')").run();
db.exec('COMMIT');
const stale = q('validate_change_set_reads').all({ reads });
check('read set detects the changed rule', stale.length === 1 && stale[0].target === 'R17');
let guard = false;
try { db.exec("UPDATE nodes SET text = 'sneaky' WHERE id = 'R17'"); } catch (e) { guard = /version/.test(e.message); }
check('changing a node without a version step is rejected', guard);
let del = false;
try { db.exec("DELETE FROM nodes WHERE id = 'NOTE-1'"); } catch (e) { del = true; }
check('nodes cannot be deleted', del);

// stale reads for acceptance
db.exec("INSERT INTO read_sets VALUES ('A-T07-1','R17',1,'h-R17-1','pushed')");
check('acceptance sees a breaking change since the read', q('stale_reads_for_acceptance').all({ attempt: 'A-T07-1' }).length === 1);

// as-of history
const asof1 = q('asof_nodes').all({ rev: r1 }).find(n => n.id === 'R17');
const asof3 = q('asof_nodes').all({ rev: r3 }).find(n => n.id === 'R17');
check('as-of revision returns the version valid then', asof1.version === 1 && asof3.version === 2);
check('as-of edges at r1 exclude the later comment edge', !q('asof_edges').all({ rev: r1 }).some(e => e.src === 'NOTE-1'));

// impact walk ignores non-invalidating edges
const impact = q('impact_walk').all({ start: 'R17', max_depth: 6 }).map(r => r.id);
check('impact walk reaches T07 and SI-212 via invalidating edges', impact.includes('T07') && impact.includes('SI-212'));
const impactC = q('impact_walk').all({ start: 'C-014', max_depth: 6 }).map(r => r.id);
check('impact walk ignores comment edges', !impactC.includes('NOTE-1'));

// --- Bug A: search
const words = db.prepare("SELECT n.id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'print AND rows'").all().map(r => r.id);
check('camelCase toPrintRows is found by "print rows"', words.includes('T03'));
const ident = db.prepare("SELECT id FROM kb_ident WHERE id LIKE '%C-01%'").all().map(r => r.id);
check('substring ID search through trigram index', ident.includes('C-014'));
const r17hits = db.prepare("SELECT n.id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'close AND 10'").all().map(r => r.id);
check('word index follows node updates', r17hits.includes('R17'));

// names: duplicate aborts publish
let dup = false;
try {
  db.exec('BEGIN IMMEDIATE');
  let r4 = changeSet('CS-4');
  addNode('CS-4', r4, 'T99', 'task', 'Another export', { feature: 'F14', names: [{ kind: 'page_route', value: '/kitchen' }] });
  db.exec('COMMIT');
} catch (e) { dup = true; db.exec('ROLLBACK'); rev -= 1; }
check('duplicate logical name aborts the publishing change set', dup);

// coverage invariants
check('coverage: every requirement has a task (obeys counts)', q('requirements_without_task').all().length === 0);
const noCheck = q('requirements_without_check').all().map(r => r.id);
check('coverage: rule R17 without a check is flagged, SI-212 is not', noCheck.length === 1 && noCheck[0] === 'R17');
check('coverage: tasks without requirement found (T03)', q('tasks_without_requirement').all().some(r => r.task === 'T03'));

// rollups
check('rollup matches recount', q('rollup_drift').all().length === 0);
db.exec("UPDATE task_runtime SET state='CODING' WHERE task='T07'");
check('rollup still matches after a transition', q('rollup_drift').all().length === 0);

// --- #5 idempotency
db.exec("INSERT INTO operations VALUES ('op-1','submit','hash-A','{\"receipt\":\"R1\"}',1,0)");
check('op_id reuse with a different request is detected', q('op_lookup').get({ op_id: 'op-1', request_hash: 'hash-B' }).same_request === 0);

// --- #6 outbox pruning guard and seq monotonic
db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-1','TaskAccepted','{}',0),('EV-2','FeatureCompleted','{}',0)");
db.exec("INSERT INTO outbox_deliveries VALUES ('EV-1','scheduler',5),('EV-2','scheduler',NULL)");
q('prune_outbox').run({ cutoff: 10 });
const left = db.prepare('SELECT id FROM outbox').all().map(r => r.id);
check('pruning keeps the unacknowledged event', left.length === 1 && left[0] === 'EV-2');
db.exec("DELETE FROM outbox WHERE id='EV-2'");
db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-3','X','{}',0)");
check('outbox seq never reuses a pruned number', db.prepare("SELECT seq FROM outbox WHERE id='EV-3'").get().seq === 3);

// --- #3 grants
db.exec('BEGIN IMMEDIATE');
q('deposit_grant').run({ grant_id: 'G2', connection: 'chatgpt', currency: 'usd', units: 500000, concurrency: 2, expires_at: 99, rev });
q('deposit_grant_budget').run({ grant_id: 'G2', currency: 'usd', units: 500000 });
q('deposit_grant').run({ grant_id: 'G2', connection: 'chatgpt', currency: 'usd', units: 500000, concurrency: 2, expires_at: 99, rev });
db.exec('COMMIT');
check('grant deposit is idempotent', db.prepare("SELECT count(*) c FROM grant_receipts WHERE grant_id='G2'").get().c === 1);
db.exec('BEGIN IMMEDIATE'); q('close_grant').run({ grant_id: 'G2' }); q('close_grant_receipt').run({ grant_id: 'G2', now: 5 }); db.exec('COMMIT');
check('closed grant reports used units', db.prepare("SELECT used_units u FROM grant_receipts WHERE grant_id='G2'").get().u === 0);

// global: GC respects pins, grant expiry is conservative
g.exec("INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, created_at) VALUES ('h1',1,1,'zstd',0),('h2',1,1,'zstd',0)");
g.exec("INSERT INTO cas_pins VALUES ('h1','backup','P-backup-3',0)");
const gc = g.prepare(queries.global_cas_gc_candidates).all({ grace_cutoff: 10 }).map(r => r.hash);
check('GC never selects a blob pinned by a backup', gc.length === 1 && gc[0] === 'h2');
g.exec("INSERT INTO projects VALUES ('P','C:/p','p',1,'ok',0,0)");
g.exec("INSERT INTO connections VALUES ('chatgpt','openai','siwc','plus',NULL,'allowance:chatgpt',1000000,1,0)");
g.exec("INSERT INTO grants(id, project, connection, currency, units, priority_class, issued_at, expires_at, state) VALUES ('G9','P','chatgpt','allowance:chatgpt',30000,'foreground',0,100,'issued')");
const exp = g.prepare(queries.global_expire_grants).all({ now: 1000, grace_ms: 60 });
check('a grant never reported back expires as fully used', exp.length === 1 && g.prepare("SELECT used_units u FROM grants WHERE id='G9'").get().u === 30000);

// secret scan
db.exec("INSERT INTO turns VALUES ('turn-1','developer',NULL,'my key is sk_live_abc123',NULL,0,0)");
check('secret occurrences are located across tables', q('secret_occurrences').all({ secret: 'sk_live_abc123' }).length === 1);

// IDs never reused
const a1 = q('allocate_id').get({ prefix: 'T' }).n, a2 = q('allocate_id').get({ prefix: 'T' }).n;
check('ID allocation is sequential and atomic', a1 === 1 && a2 === 2);

// turn_log archival only for closed attempts
db.exec("INSERT INTO turn_log(attempt, step, tool_call, tokens_in, tokens_out) VALUES ('A-T03-1',1,'read',10,5),('A-T03-1',2,'edit',20,7)");
db.exec("INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at) VALUES ('ART-1','h','items',10,'evidence',0)");
q('archive_turn_log').run({ attempt: 'A-T03-1', artifact: 'ART-1', now: 1 });
const kept = q('purge_archived_turn_log').run({ attempt: 'A-T03-1' }).changes;
check('turn_log of a running attempt is not purged', kept === 0);
db.exec("UPDATE attempts SET state='accepted' WHERE id='A-T03-1'");
const purged = q('purge_archived_turn_log').run({ attempt: 'A-T03-1' }).changes;
check('turn_log of a closed, archived attempt is purged with totals kept', purged === 2 && db.prepare("SELECT tokens_in t FROM turn_log_archives WHERE attempt='A-T03-1'").get().t === 30);

// ===== 18 November review additions =====
// R1 outbox: an event without delivery rows is never pruned
db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-4','TaskAccepted','{}',0)");
q('prune_outbox').run({ cutoff: 10 });
check('R1 event without delivery rows survives pruning', db.prepare("SELECT count(*) c FROM outbox WHERE id='EV-4'").get().c === 1);
check('R1 events without delivery rows are reported', q('outbox_without_deliveries').all().some(r => r.id === 'EV-4'));

// R11 basis vocabulary is enforced by the database
let badBasis = false;
try {
  db.exec('BEGIN IMMEDIATE'); const rb = changeSet('CS-B');
  addNode('CS-B', rb, 'D-BAD', 'decision', 'Bad basis', { basis: 'chosen under delegation' });
  db.exec('COMMIT');
} catch (e) { badBasis = true; db.exec('ROLLBACK'); rev -= 1; }
check('R11 unknown basis value is rejected', badBasis);

// R10 discovery readiness from scope criteria
db.exec('BEGIN IMMEDIATE'); const rd = changeSet('CS-D');
addNode('CS-D', rd, 'D-1', 'decision', 'Storage engine', { status: 'settled', basis: 'explicit' });
addNode('CS-D', rd, 'D-2', 'decision', 'Login method', { status: 'open' });
addNode('CS-D', rd, 'D-3', 'decision', 'Analytics', { status: 'open' });
db.exec("INSERT INTO work_items VALUES ('W1','project','Kitchen','discovering',0)");
db.prepare("INSERT INTO discovery_scopes VALUES ('W1',1,?, 'opening')").run(rd);
db.exec("INSERT INTO scope_criteria VALUES ('W1',1,'D-1',1,0),('W1',1,'D-2',1,1),('W1',1,'D-3',0,0)");
db.exec('COMMIT');
const rdy = q('readiness').get({ work_item: 'W1' });
check('R10 readiness counts planning, overall and critical-open', rdy.planning_total === 2 && rdy.planning_settled === 1 && rdy.overall_total === 3 && rdy.critical_open === 1);

// R5 relations live in edges, not in fields
db.exec('BEGIN IMMEDIATE'); const rr = changeSet('CS-R');
addNode('CS-R', rr, 'T80', 'task', 'Stray dependency', { feature: 'F12', depends_on: ['T03'] });
db.exec('COMMIT');
check('R5 a dependency stored in fields is flagged', q('relations_in_fields').all().some(r => r.id === 'T80'));

// R5 accept_submission stops lease expiry during verification
db.exec('BEGIN IMMEDIATE'); const rs = changeSet('CS-S');
addNode('CS-S', rs, 'T60', 'task', 'Print button', { feature: 'F12' });
addNode('CS-S', rs, 'T61', 'task', 'Docs page', { feature: 'F13' });
db.prepare("INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES ('T60','F12','READY','Mid',?), ('T61','F13','READY','Mid',?)").run(rs, rs);
db.exec("INSERT INTO task_scopes VALUES ('T60','src/app/kitchen/print/'), ('T61','docs/'), ('T07','src/app/kitchen/')");
db.exec('COMMIT');
db.exec('BEGIN IMMEDIATE');
let cl = q('claim_task').all({ task: 'T61', attempt: 'A-T61-1', expires_at: 100, rev, expected_brief: 1 });
q('create_attempt').run({ attempt: 'A-T61-1', task: 'T61', epoch: cl[0].epoch, expected_brief: 1, runtime: 'own', model: 'm', connection: 'c', base_commit: 'abc', now: 1 });
db.exec('COMMIT');
q('accept_submission').run({ task: 'T61', attempt: 'A-T61-1', epoch: cl[0].epoch, rev });
const notExpired = q('sweep_expired_leases').all({ now: 99999, rev }).every(r => r.task !== 'T61');
check('R5 a submitted task is not expired while verification runs', notExpired);
q('finish_submission').run({ task: 'T61', epoch: cl[0].epoch, next_state: 'ACCEPTED', rev });
check('R5 finishing verification clears the submission flag', db.prepare("SELECT submission_pending p, state s FROM task_runtime WHERE task='T61'").get().p === 0);

// R3 sweep leases block overlapping claims, not disjoint ones
db.exec("INSERT INTO path_leases(id, holder, mode, created_at) VALUES ('L-1','S-1','intent',0)");
db.exec("INSERT INTO path_lease_prefixes VALUES ('L-1','src/app/')");
db.exec('BEGIN IMMEDIATE');
cl = q('claim_task').all({ task: 'T60', attempt: 'A-T60-1', expires_at: 100, rev, expected_brief: 1 });
db.exec('ROLLBACK');
check('R3 sweep intent blocks a claim inside its paths', cl.length === 0);
check('R3 sweep is not granted while an overlapping task is coding', q('grant_sweep_lease').run({ lease: 'L-1' }).changes === 0);
db.exec("UPDATE task_runtime SET state='PARKED' WHERE task='T07'");
check('R3 sweep is granted once overlapping work is parked', q('grant_sweep_lease').run({ lease: 'L-1' }).changes === 1);

// R4 negative reads: a new consumer edge makes the attempt stale
const cv = db.prepare("SELECT version FROM edge_set_versions WHERE node='C-014' AND dir='in' AND type='consumes_contract'").get().version;
db.prepare("INSERT INTO edge_read_sets VALUES ('A-T07-1','C-014','in','consumes_contract',?)").run(cv);
check('R4 unchanged edge set is not stale', q('stale_edge_reads_for_acceptance').all({ attempt: 'A-T07-1' }).length === 0);
db.exec('BEGIN IMMEDIATE'); const re = changeSet('CS-E');
addEdge('CS-E', re, 'T60', 'consumes_contract', 'C-014');
db.exec('COMMIT');
check('R4 a new consumer makes the edge read stale', q('stale_edge_reads_for_acceptance').all({ attempt: 'A-T07-1' }).length === 1);

// R6 hint ladder
const step = (fp, bv = 1) => q('record_hidden_failure').get({ task: 'T07', brief_version: bv, fingerprint: fp, now: 1 }).ladder_step;
const s1 = step('fp-a'), s2 = step('fp-b'), s3 = step('fp-b');
check('R6 ladder goes 1, 2, then 3 on a repeated fingerprint', s1 === 1 && s2 === 2 && s3 === 3);
check('R6 a new brief version resets the ladder', step('fp-b', 2) === 1);

// R9 requirement status from latest results at current check versions
const st0 = Object.fromEntries(q('requirement_status_recompute').all().map(r => [r.requirement, r.status]));
check('R9 SI-212 pending before results, R17 uncovered', st0['SI-212'] === 'pending' && st0['R17'] === 'uncovered');
db.exec("INSERT INTO check_results VALUES ('AC-31','A-T03-1',1,'d1','pass',NULL,10)");
const st1 = Object.fromEntries(q('requirement_status_recompute').all().map(r => [r.requirement, r.status]));
check('R9 SI-212 passing after a pass at the current version', st1['SI-212'] === 'passing');

// R2 feature lifecycle gate: LEAVES_MERGED only when every leaf is merged
db.exec("INSERT INTO feature_runtime(feature, state, updated_rev) VALUES ('F12','IN_WAVE',1)");
check('R2 feature stays IN_WAVE while leaves are unmerged', q('advance_feature_leaves_merged').run({ feature: 'F12', rev }).changes === 0);
db.exec("UPDATE task_runtime SET state='MERGED_TO_FEATURE' WHERE feature='F12'");
check('R2 feature moves to LEAVES_MERGED when all leaves are merged', q('advance_feature_leaves_merged').run({ feature: 'F12', rev }).changes === 1);

// export dirty set
check('export dirty set since rev 1 contains R17 and NOTE-1', (() => { const ids = q('export_dirty_nodes').all({ last_rev: r1 }).map(r => r.id ?? r.src); return ids.includes('R17') && ids.includes('NOTE-1'); })());

const fails = results.filter(r => r[0] === 'FAIL');
for (const [s, l, d] of results) console.log(`${s}  ${l}${d ? ' — ' + d : ''}`);
console.log(`\n${results.length - fails.length}/${results.length} passed · SQLite ${db.prepare('select sqlite_version() v').get().v}`);
process.exit(fails.length ? 1 : 0);

