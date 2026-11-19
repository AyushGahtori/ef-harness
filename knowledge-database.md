# Knowledge database: Markdown edits, write ownership and versioning

**Status: decided (design).** This document resolves three open questions about the central SQLite knowledge database: what happens when someone edits the generated Markdown files directly, who may write to the database when many agents run in parallel, and how versions and change impact are tracked. Each section ends with an answer to every numbered question that was raised. Research: [knowledge database consistency](research/knowledge-db-consistency.md).

## The three rules everything else follows

1. **SQLite is the single source of truth; Markdown and Mermaid files are generated views.** A view can be edited, but the edit is a *proposal* that enters the database through the same change path as any other change. It is never written directly and never silently overwritten.
2. **Only the coordinator writes.** Agents, planners, researchers and the UI send typed, idempotent write requests. The coordinator validates and commits them in short transactions. Coding, research and testing stay fully parallel; only the tiny act of recording results is serialized.
3. **Every record has its own version, every committed change set gets a global revision number, and every attempt records exactly which versions it read.** Freshness is decided per dependency, not by the global number.

---

## 1. Direct edits to the generated Markdown

### Where the files are and what they look like

Generated views live in `<project>/.harness/views/`, excluded from Git through the repository's local exclude file (`.git/info/exclude`), so they never appear in the developer's commits unless the team opts in ([portability](projects-portability-and-sync.md)). The same views are also written to the `harness-state` branch.

Every file and every section carries invisible markers that tie text to database records:

~~~markdown
---
ef_file: arch/features/F01/architecture
ef_revision: 214
ef_manifest: sha256:9b1c…
---
# Authentication

<!-- ef:node A-021 v=3 h=4f2a91 -->
## Sign-in methods
Users can sign in using email and password.

```ef-fields
id: A-021
kind: architecture_rule
consumes: [C-014@1]
implements: [SI-031, SI-032]
```
<!-- ef:end A-021 -->
~~~

- `v` is the record version the text was generated from; `h` is the hash of the normalized text as exported.
- Structured fields (IDs, relations, values) sit in a small `ef-fields` block so they can be parsed back exactly; prose stays prose.
- Relations also appear as normal links (`[C-014](../contracts/C-014.md)`), so editing a link is a detectable relation change.

### Detecting edits

| Mechanism | Catches |
|---|---|
| File watcher on `.harness/views/` (debounced; understands editors that save by writing a temp file and renaming it) | Edits while the app runs |
| Full scan against the export manifest (file hashes) at daemon start, on project open and every 10 minutes | Edits while the app was closed; missed watcher events (Windows can drop change notifications when its buffer overflows) |
| Diff of `views/` between two `harness-state` commits | Edits made by a teammate on another machine |

A file whose hash matches the manifest is unchanged and is skipped. Detection costs nothing for unchanged files.

### Mapping a changed file to records

1. Parse the file into sections by markers.
2. For each section, normalize the text and compare its hash with `h` in the marker. Equal means untouched.
3. For a changed section: diff the `ef-fields` block field by field (exact); diff the prose (text); compare links and listed IDs with the record's current edges (relation changes).
4. Text outside any marker is **new content**. A small import prompt (`doc-import@1`) proposes what it is (a new edge case, a new rule, a note), which record it belongs to and the edges; it is shown as a proposal.
5. Damaged or deleted markers: match sections by heading and text similarity; below a confidence threshold, ask which record the text belongs to.

### What the developer sees

Edits are always reviewed, in the same style as the rest of the app: nothing is applied without Enter, and the recommended choice is preselected.

```
You edited 2 items in arch/features/F01/architecture.md
  A-021  Sign-in methods     “email and password” → “email and password or Google”
         Impact: contract C-014, 2 tasks to update, 1 new task likely, 1 check to change   [View impact]
  EC-044 New edge case       “Google account without verified email”  → add to F01      [Edit]
                                                        [Apply both ⏎]   [Discard edits]
```

Applying creates one change set with origin `markdown_edit` (file, file hash, section). From there it follows exactly the same impact and versioning rules as a change made in chat (section 3).

### Conflicts

The marker gives a three-way merge for free: **base** = the version in the marker, **yours** = the edited file, **current** = the record's version in the database now.

| Situation | Result |
|---|---|
| Database still at the base version | Clean apply |
| Database moved, but you edited different fields | Field-level merge, shown in the review |
| Same field changed in both | Conflict card with both values and their sources; you choose |
| Prose changed in both | Conflict card with both texts; no automatic text merge for requirements |

While edits in a file are pending or in conflict, the exporter **does not overwrite that file**. The cockpit shows “Export paused for 1 file · pending edits”.

### Deletes and moves

| Action | Behavior |
|---|---|
| A whole file is deleted | No record is deleted. Prompt: **Restore the file** (default) or **Retire these 7 items** (with impact preview). |
| A section is deleted | Proposal to retire that record, shown with its impact; never automatic |
| A file is renamed or moved | Recognized by `ef_file` in its front matter; content edits are still imported; the view is regenerated at its standard path afterwards |
| A Mermaid view is edited | Node IDs are matched; added or removed arrows between known nodes become relation proposals; layout-only changes are ignored |

### Agents working while you edit

An applied edit is a normal change set, so section 3 decides: tasks whose read set contains the changed record are held, refreshed, re-verified or reworked as appropriate; unrelated tasks continue. Pending (unapplied) edits affect nothing.

### Answers to the questions

| # | Question | Answer |
|---|---|---|
| 1.1 | Detect created, modified, renamed, deleted files | Watcher plus manifest scans plus state-branch diffs; renames recognized by `ef_file` |
| 1.2 | Which records correspond to changed sections | Section markers with record ID, version and hash; structured field blocks; similarity fallback with confirmation |
| 1.3 | Automatic or review | Always a review card with impact; one Enter applies |
| 1.4 | Both sides changed | Three-way merge using the marker's base version; same-field conflicts go to the developer |
| 1.5 | Relationship changes | Links and `ef-fields` relations compared with stored edges; Mermaid arrows compared by node IDs |
| 1.6 | An agent is using the edited knowledge | Only after applying, the change set's impact rules hold or refresh exactly the affected attempts |
| 1.7 | Deleted or moved files | Never delete records from a file deletion; retiring requires explicit confirmation with impact |

---

## 2. Concurrent writers and write ownership

### Decision: one logical writer (Option B), with batching

| Component | Database access |
|---|---|
| Coordinator (inside the daemon) | The only writer. One connection for writes; WAL mode for concurrent readers |
| Workers (any vendor) | **None.** They call MCP tools (`submit_candidate`, `ask_owner`, `kb.*`); the harness MCP server turns these into typed write requests |
| Planners, researchers, architects | None. They return typed proposals; the coordinator commits them |
| UI and exporters | Read-only connections, reading a committed revision |
| A second process or app instance | Read-only (see below) |

Option A (every worker writes) and Option C (hybrid) were rejected: workers run foreign code and foreign agents, so direct database access would put enforcement of ownership, leases and state transitions in the least trusted place. Option B keeps every rule in one process.

### Is one writer fast enough with 20+ workers?

Yes, because only small bookkeeping goes through it:

- A write transaction records a state change, a receipt or a proposal: typically well under a millisecond to a few milliseconds. Model calls, verification, Git operations and exports run **outside** transactions.
- **Group commit.** When several requests are queued, the coordinator commits them in one transaction every few milliseconds, each inside its own savepoint, so one invalid request is rejected without affecting the others.
- **Not everything is written.** Heartbeats live in memory and are flushed periodically; token-streaming progress is never stored per token.
- **Backpressure.** Request queues are bounded per class (interactive, task transitions, telemetry). Telemetry is dropped or sampled before task transitions ever wait.
- Measured target before M3 ([roadmap](roadmap.md)): 50 simulated workers with p99 write latency under 50 ms.

### Records and their owners

| Record | Who may request changes | Rule |
|---|---|---|
| Task state, leases, epochs | Coordinator only (on worker or planner requests) | State machine in [build pipeline](build-pipeline.md#state-machines); conditional updates |
| Candidates, verification results, receipts | Worker submits; verifier results recorded by the coordinator | Keyed by task, attempt and commit; immutable once written |
| Feature progress | Nobody writes it directly | **Derived** from task and check rows; cached in rollup tables that database triggers update in the same transaction, with a periodic recount that rebuilds them on any drift ([database design §6](database-design.md#6--outbox-telemetry-and-fast-read-models)) |
| Knowledge records (decisions, spec items, architecture, contracts, plans, checks) | The owning planner role, the developer, or a Markdown import | Change sets with expected versions (section 3) |
| Budget ledger | Coordinator | Reservations in the same transaction as dispatch |
| Artifacts | Coordinator | Content-addressed; written once |

### How each danger is prevented

| Danger | Prevention |
|---|---|
| `SQLITE_BUSY` / locked | One writer means writers never compete; write transactions start with `BEGIN IMMEDIATE`; a busy timeout covers WAL checkpoints; a failed transaction is retried whole (it is idempotent, below) |
| Lost update (4 → 5 instead of 6) | No read-modify-write in application code. Counters are derived by queries; the few stored aggregates are updated in SQL (`x = x + 1`) inside the transaction that caused them |
| Two owners of one task | Claiming is one conditional statement on `task_runtime` that also requires the current brief version, no holds and all dependencies done, and returns the new epoch; the attempt row is inserted in the same transaction ([`claim_task`](schema/queries.sql), tested in [schema-test.js](schema/schema-test.js)) |
| Submit races with lease expiry | Both are coordinator transactions, so one commits first. A submission is valid only if its epoch equals the task's current epoch at commit. The expiry sweeper skips a lease whose submission arrived before the expiry time, so a worker that finished in time isn't punished for queueing delay |
| Worker thinks it succeeded but nothing was recorded | A worker's submission is done only when it receives a **receipt ID**, returned after commit. No receipt means not recorded |
| Retry after an uncertain result creates duplicates | Every write request carries an **operation ID** created and persisted by the requester before sending. The coordinator stores operation ID and result in the same transaction; a repeat returns the stored result. Candidates are additionally unique by (task, attempt, commit hash) |
| Write fails (disk full, I/O error) | The transaction rolls back; the coordinator enters **safe mode**: stops dispatching, keeps every worktree and checkpoint, shows the problem. Nothing is reported as accepted that wasn't committed |
| Two processes open the same project | The daemon is single-instance per Windows user. The project database also holds an owner row (process, start time, epoch) taken with `BEGIN IMMEDIATE` plus an OS file lock. A second process opens read-only. If anything else commits to the file anyway (e.g. someone writes with the `sqlite3` tool), SQLite's `data_version` counter changes; the coordinator runs an integrity check and enters safe mode. Across devices, see [portability](projects-portability-and-sync.md#single-writer-across-devices) |

### Answers to the questions

| # | Question | Answer |
|---|---|---|
| 2.1 | Coordinator as the only writer? | Yes |
| 2.2 | Structured write requests instead of direct access? | Yes, through MCP tools and typed proposals |
| 2.3 | Growing write queue at 20+ workers | Small transactions, group commit, in-memory heartbeats, bounded queues with priority classes; load-tested target |
| 2.4 | Records needing strict ownership | Table above |
| 2.5 | Failed, timed-out or retried writes | Whole-transaction retry with idempotency; safe mode on persistent failure |
| 2.6 | Duplicate submissions on retry | Operation IDs plus unique (task, attempt, commit) |
| 2.7 | Atomic claiming and transitions | Single conditional statements checked by changed-row count, inside coordinator transactions, plus epochs |
| 2.8 | Several processes or coordinators | Single-instance daemon, owner row plus file lock, read-only for others, fenced takeover across devices |

---

## 3. Versions, revisions and change impact

### Decision: hybrid (Option C), made concrete

| Mechanism | Purpose |
|---|---|
| **Record versions** | Every record (node or edge) has `id`, `version`, `content_hash`. Versions are immutable rows in a history table; the current pointer moves. |
| **Edge-set versions** | One version per record, direction and edge type, so “a new consumer of C-014 was added” is detectable while a new comment or documentation link changes nothing that matters |
| **Global revision** | Each committed change set gets the next revision number. Used to label snapshots and exports, order events and reconstruct “the database as of revision 214”. **Never used to decide freshness.** |
| **Change sets** | Every change is a change set: origin (chat steer, Markdown edit, research agent, planner, sweep, undo), author, the records and versions it read, the records it wrote with old and new versions, and a change class per record |
| **Read sets** | Every attempt records each record it read: ID, version, hash, and whether it was pushed in the packet or pulled with a tool ([knowledge slicing](knowledge-slicing.md#the-read-set)) |
| **Dependency edges** | Typed edges (`implements`, `consumes_contract`, `verifies`, `derived_from`, `documents`, …) drive impact analysis |

An unrelated change (research finding R-031 moves to v5) creates revision 215 but touches no read set of the authentication task, so nothing happens to that task.

### Classifying a change

| Class | Example | Determined by |
|---|---|---|
| **Cosmetic** | Rationale reworded; typo | Only prose fields marked non-normative changed (code) |
| **Clarifying** | Adds detail that is consistent with the old meaning | Owner planner's judgement, checked by the consistency gate |
| **Compatible** | New optional field; additional allowed value | Structured diff of contracts and schemas (code) |
| **Breaking** | Value changed (cutoff 11:00 → 10:45), field removed, behavior replaced | Structured diff (code); free-text normative changes are treated as breaking unless the owner classifies them otherwise |

### Propagation: content versioning versus dependency freshness

When a change set commits, the coordinator walks reverse dependency edges from every changed record (breadth-first, visited set, bounded) and decides an action for each dependent:

| Dependent | Cosmetic | Clarifying or compatible | Breaking |
|---|---|---|---|
| Derived document (brief, check, view) | Regenerate view only | Regenerate | Regenerate |
| Task not started | Nothing | Refresh brief | Refresh brief; planner reviews scope |
| Task running | Nothing | Deliver as a steer at the next tool boundary | Hold at the next boundary; refresh brief; resume or fresh session |
| Candidate submitted, not yet accepted | Nothing | Verify against current checks | Verify against **new** checks once the planner has updated them |
| Accepted or merged work | Nothing | **Re-verify** with current checks | Re-verify; if it fails, a **rework** task with the diff between old and new requirements |

**Early cutoff.** If a regenerated brief or check is identical (same hash) to the previous one, propagation stops there. This is the main protection against unnecessary invalidation: a change ripples only as far as it actually changes something.

**Re-verification before rework.** Running checks is cheap and deterministic, so the coordinator always tries to prove old work still valid first. Rework happens only when a check fails or the change adds behavior that no existing task covers (then the planner adds tasks, like T-018 for Google sign-in).

**Old versions never get accepted silently.** Acceptance compares the candidate's read set with current versions; any breaking difference blocks acceptance until re-verification against current checks passes.

### The authentication example, end to end

1. You edit A-021 (Markdown or chat): email/password → email/password or Google. Change set CS-88, origin recorded, revision 215.
2. Class: breaking (new behavior). Impact walk finds C-014 (contract), T-014 (login task), AC-014 (check), F01 plan.
3. The owning planner updates C-014 to v2 (compatible: new provider value), adds T-018 (Google sign-in) with its checks, and updates AC-014 only if its expectations changed. Revision 216.
4. T-014 is accepted already: re-verified against current checks. Email login still passes, so it stays accepted with a new verification receipt stamped against C-014@2.
5. Worker B, running on C-014@1: the contract change is compatible, so it gets a steer and continues; its candidate is verified against @2.
6. New workers receive v2 packets. Unrelated tasks (resume editor, PDF export) never notice.

### Several changes at once

- Change sets are validated optimistically: each states the versions it read; if another change set committed to those records first, it is recomputed, not blindly applied.
- Disjoint change sets both commit.
- Competing values for the same record go to its owner, or to the developer if both are explicit decisions.
- Propagation work is debounced per record, so a burst of five edits to one contract causes one impact run, not five.

### History

All versions and change sets are kept for the life of the project. Large artifacts (logs, traces) follow a retention setting, but records, read sets and receipts don't. “What did attempt T-014/3 see?” is answered by joining its read set with the version history.

### Answers to the questions

| # | Question | Answer |
|---|---|---|
| 3.1 | Per-record versions? | Yes, for nodes and edges, with edge-set versions |
| 3.2 | Global revision? | Yes, for snapshots, ordering and reconstruction, never for freshness |
| 3.3 | Store exact IDs, versions, hashes per attempt? | Yes, the read set, including how each item was obtained |
| 3.4 | Determine affected records | Reverse traversal of typed edges from changed records, with early cutoff |
| 3.5 | Automatic invalidation or check first? | Classify first; regenerate, then re-verify before any rework |
| 3.6 | Candidate built on an older version | Verified against current checks; accepted only if they pass |
| 3.7 | Preserve history? | Yes, immutable versions and change sets |
| 3.8 | Rework versus re-verification | Re-verification first; rework only on failure or new uncovered behavior |
| 3.9 | Markdown-origin versus database-origin changes | Identical: both become change sets through the coordinator |
| 3.10 | Simultaneous changes | Optimistic validation, disjoint commits, owner resolution for conflicts, debounced propagation |

## Tests that prove it

- 50 simulated workers claiming, submitting and expiring at random: no task with two holders, no lost receipts, no accepted stale epoch.
- Crash the coordinator between request and receipt for every write type; retry yields exactly one record.
- Edit a view while the app is closed, then change the same record in chat; reopen: the conflict card appears and nothing is overwritten.
- Delete a views folder: no record changes; files regenerate.
- Change an unrelated research fact: zero tasks held. Change C-014 compatibly: only its consumers get steers. Break it: only its consumers hold.

[Diagram](knowledge-database.svg) · [Editable Mermaid](knowledge-database.mmd) · [Linked graphs](linked-graphs-design.md) · [Revisions and recovery](linked-architecture-revisions.md) · [Coordinator and recovery](coordinator-and-recovery.md) · [Knowledge slicing](knowledge-slicing.md) · [Research](research/knowledge-db-consistency.md)
