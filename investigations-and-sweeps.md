# Investigations and sweeps: mystery bugs and repo-wide changes

Normal tasks have a known write scope before they start. Two kinds of work don't: a **mystery bug** (“Sometimes clicking Checkout logs the user out on Safari”), where nobody knows which files are at fault, and a **sweep** (“Upgrade Next.js 14 to 15”, “Rename `Order` to `LunchOrder` across 80 files”), which must touch many files at once. Both get their own task types with their own rules. Research: [debugging and codemods](research/debugging-and-codemods.md).

## Decisions in plain words

1. **An investigation can read everything but write almost nothing** until the cause is proven. It writes only a reproduction test and temporary instrumentation in a quarantined folder.
2. **No fix without a failing reproduction.** The pipeline is: reproduce → localize → prove the cause → minimal fix → keep the reproduction as a regression test.
3. **A sweep is the only owner of everything it touches.** Instead of breaking the “one owner per path” rule, the sweep takes an exclusive lease on its whole path set, usually between feature waves.
4. **Deterministic tools first, models for the leftovers.** Compiler-driven renames and official codemods do the bulk; the compiler's error list becomes the checklist; a model handles only what the tools couldn't.

## Investigations

### Pipeline

| Stage | Who | Writes | Done when |
|---|---|---|---|
| 1 · Intake | Router + Senior investigator | Symptom card: where, when, how often, environment (browser, OS, data), the developer's steps, attached screenshots or logs | The few missing facts are asked once (e.g. “Which Safari version? Logged in with email or Google?”) |
| 2 · Reproduce | Investigator | `tests/repro/<bug-id>.*` only | A test fails for the reported reason in a clean environment (e.g. Playwright **WebKit** for Safari), repeated runs to measure flakiness |
| 3 · Localize | Investigator | Temporary instrumentation in a quarantined branch (logging behind a flag) | A small set of files and a mechanism are identified |
| 4 · Prove the cause | Investigator, checked by a second model | A root-cause note | A minimal change flips the reproduction from red to green, and undoing it flips it back |
| 5 · Fix | Normal leaf task, scope = proven files | Product code | Reproduction passes; full regression suite passes |
| 6 · Keep | Kernel | Reproduction promoted to the permanent suite and linked to the bug node | — |

### Localization techniques (chosen by evidence)

| Evidence | Technique |
|---|---|
| “It used to work” and history has a good commit | `git bisect run` with the reproduction test (automatic, no model needed) |
| Works in Chromium, fails in WebKit | Differential run: same journey in both engines, compare network, cookies and console |
| Intermittent | Repeat the test many times with timing jitter; record traces (Playwright trace viewer) for passing and failing runs and compare |
| Server-side | Trace the request through logs with a correlation ID; add temporary spans |
| Data-dependent | Shrink the input: start from a failing dataset and remove rows until the minimum failing case remains |

**Hypothesis log.** Every hypothesis the investigator tries is recorded with the experiment and result. The kernel refuses to re-run an experiment with the same fingerprint, which stops loops, and the log becomes the root-cause note's evidence.

**Budget.** Each stage has a cap. If reproduction fails within its cap, the harness asks the developer for more evidence (a screen recording, HAR file or exact steps) or offers an **instrumentation release**: ship extra logging behind a flag to staging and wait for the bug to happen again.

### Example: the Safari logout

1. Reproduction in WebKit: after checkout redirect, the session cookie is missing → test fails.
2. Differential run: Chromium keeps the cookie; WebKit drops it on the cross-site redirect back from the payment page.
3. Cause: session cookie set with `SameSite=Strict`, so it isn't sent on the top-level navigation back from the payment provider.
4. Proof: changing to `SameSite=Lax` flips the test; reverting flips it back.
5. Fix task scope: `src/auth/session.ts`. Security reviewer confirms `Lax` meets the auth rules in the architecture.

## Sweeps

### When work is a sweep

The planner classifies work as a sweep when it changes a symbol, dependency or pattern used across more than one feature's paths, or more than a threshold of files (default 15). Examples: framework upgrades, renames, replacing a library, enabling a strict compiler option, changing the error format everywhere.

### Ownership and timing

- The sweep takes an **exclusive lease** on the union of affected paths, computed from the compiler and a code search before it starts. In the database this is a `path_leases` row with its path prefixes: it starts in *intent* mode (the claim statement already refuses any task whose write-scope prefixes overlap) and becomes *granted* only when no overlapping task is still leased, coding or verifying (`grant_sweep_lease` in [queries.sql](schema/queries.sql), tested).
- It runs in a **maintenance window**: when no task holds a lease on any of those paths. The scheduler drains affected work (finishes in-flight steps, starts no new ones there) and keeps unaffected work running.
- Sweep branch: `harness/s/<sweep-id>` from `harness/integration`, landed through the project merge queue like a feature.
- Afterwards, queued tasks whose briefs mention renamed symbols get their briefs updated automatically from the sweep's **symbol map** (old name → new name) and are re-checked.

### Pipeline

| Step | Tooling | Model use |
|---|---|---|
| 1 · Research | Official migration guide for the version jump, changelogs, known codemods | Researcher (read-only) writes the upgrade notes |
| 2 · Mechanical pass | Official codemods (e.g. `@next/codemod`), TypeScript language-service rename, ts-morph, ast-grep or jscodeshift scripts | None, or a model writes a codemod script that is reviewed and run |
| 3 · Checklist | Type checker errors, test failures, lint errors, plus a search for string occurrences (routes, SQL, config keys, docs, translation keys) | None |
| 4 · Residual fixes | Worker fixes checklist items in ordered batches (by package, in dependency order); one commit per batch | Mid or Senior |
| 5 · Verify | Type check clean, full test suite, feature journeys, and a **leftover scan** (old name or API must not appear except in an allowlist such as changelogs and migrations) | — |
| 6 · Review | Diff summary grouped by kind of change | Senior review of non-mechanical changes |

**Zero missed files** is enforced by the checklist: the sweep can't submit while any compiler error, failing test or unallowlisted leftover remains.

**Parallel sweeps** are allowed only when partitions are disjoint and each compiles on its own (e.g. independent packages in a monorepo). Otherwise batches run in order.

### Renames that touch data or APIs

“Rename `Order` to `LunchOrder`” can mean the code name only, or also the database table and public API. The sweep's intake asks once:

| Option | Effect |
|---|---|
| Code only (recommended) | Types, files and functions renamed; table and routes unchanged |
| Code and database | Plus an expand-then-contract migration ([ship and deploy](ship-and-deploy.md#live-database-migrations)) |
| Code, database and public API | Plus old routes kept as aliases for a deprecation period |

## Risks and safeguards

Isolated branches and worktrees separate tracked files, but not shared databases, untracked artifacts, running processes or the meaning of the code. These are the ways investigations and sweeps fail, and what prevents each.

### 1 · Patching the symptom instead of the cause

A guard clause, a swallowed error or a happy-path check can turn the reproduction green while the defect stays.

- **The fix must change the proven mechanism.** The kernel checks that the fix diff touches the locations named in the root-cause note. A fix made only of new guard clauses, null checks or `try/catch` at the symptom site is flagged.
- **Two regression tests:** the reproduction (the symptom) and a **mechanism test** that asserts the cause is gone (e.g. the session cookie is set with `SameSite=Lax`; the state machine rejects the illegal transition). Reverting the fix must fail both.
- `reviewer@1` answers one question on every bug fix: does this remove the cause or hide the symptom? The static audit still rejects swallowed errors ([completeness gate](completeness-gate.md#static-audit)).

### 2 · Bisecting to the wrong commit

Flaky tests, old build breaks and environment drift make `git bisect` blame innocent commits.

| Safeguard | Detail |
|---|---|
| Stable reproduction first | The reproduction must fail on every run (e.g. 5 of 5) at the bad commit and pass on every run at the good one. A flaky reproduction uses repeated runs per step with a threshold, or bisection isn't used. |
| Only the bug counts as “bad” | The bisect script matches the reproduction's own failure fingerprint (assertion and message). A build failure or unrelated error exits with code 125, which tells Git to **skip** the commit instead of marking it bad. |
| Each step in its own environment | Fresh sandbox, dependencies installed from that commit's lockfile, toolchain version from that commit's settings |
| The result is a hypothesis | Confirmed only by reverting the suspect commit on top of the current code in a scratch worktree and seeing the reproduction pass. Skipped ranges are reported as “one of these 3 commits”. |

### 3 · Missing references in a repo-wide change

The compiler doesn't see dynamic imports, string lookups, configuration, SQL or persisted data.

- **Name variants** are generated: case styles (`Order`, `order`, `ORDER`), plural, snake, kebab and camel forms, and compounds (`orderId`, `order_id`, `ORDER_STATUS`).
- **Places searched**, not only code: dynamic imports and computed property lookups, config files, environment variables, routes, raw SQL, migrations and ORM models, OpenAPI and API clients, translation files, CI and infrastructure files, docs and tests.
- **Persisted names** (JSON keys stored in database columns, browser storage keys, cache keys, event and queue names, webhook payloads) are never renamed without a data-migration decision. They are listed separately in the checklist as *keep* or *migrate*.
- Every hit is classified (rename, keep, persisted) and recorded; the sweep can't submit with unclassified hits.
- **Runtime confirmation:** app boot, a crawl that loads every route, feature journeys and the full suite, with the logs scanned for runtime reference errors.

### 4 · Deadlocks and scope collisions

The coordinator is the single lock manager, so lease rules can be designed to rule out deadlock:

- **All-or-nothing grants.** A sweep requests its entire path set at once; it never holds part of it while waiting for the rest.
- **Intent mode.** Once a sweep is queued, no new leases are granted on its paths, so it can't be starved. Running tasks finish their current step or park at a checkpoint after a timeout.
- **Tasks never wait while holding.** A task gets its write scope at claim time or not at all, so the only component that can hold and wait is a sweep growing its path set. Overlapping sweeps are serialized, so no waiting cycle can form.
- Non-overlapping sweeps may run in parallel.

### 5 · Context overflow and truncated files

- Packets are sized to the model ([knowledge slicing](knowledge-slicing.md)). Investigators get stack traces with repeated frames collapsed and log excerpts with repeated lines counted, never raw multi-megabyte logs. Large files come as an outline plus the requested line ranges.
- Edits are applied as search-and-replace hunks, not whole-file rewrites. The edit tool refuses content containing elision placeholders such as `// ... existing code ...` or “rest of file unchanged”.
- The static audit flags placeholder lines and large deletions the plan didn't call for.
- Invented APIs fail the type check; `kb.code` returns real signatures to look up instead of guessing.
- Sweep batches are sized to fit the worker's context.

### 6 · Silent behavior changes

A refactor that compiles and passes unit tests can still change timing, serialization or null handling.

- A sweep or refactor declared **behavior-preserving** first records **characterization tests**: responses of public endpoints on recorded inputs, serialized shapes, CLI outputs, accessibility snapshots of key screens. After the change, any difference must match the sweep's list of intended changes.
- AST rules flag risky transformations for review: added or removed `await`, sync ↔ async, changed defaults, `??` versus `||`, changed equality, sequential ↔ parallel loops, changed timeouts.
- Contract diff: exported signatures, OpenAPI and database schema must be unchanged unless intended.
- When the change touches I/O or the spec has performance items: a timing check on key journeys and a small concurrent-load smoke test, compared with a baseline.
- **Limit:** effects that only appear under production load can't be fully caught on a laptop. Staged deployment with an error watch is the last line ([ship and deploy](ship-and-deploy.md#post-deploy-checks-and-rollback)).

### 7 · Drifting away from the integration branch

- Sweeps start from the latest `harness/integration` and are kept short. Long changes are split into stages that land separately: introduce the new name alongside the old, move users in batches, then remove the old name.
- While a sweep runs, features that touch its paths are drained and don't merge; unaffected features can.
- Before landing, the sweep merges the latest integration (`merge-tree` first), **recomputes its reference inventory and checklist on the merged result** and reruns verification.
- Schema changes have one owner, the project integrator's schema lease. A sweep that renames tables takes that lease, so no parallel schema change can happen.

### 8 · Half-finished state outside Git

- **The knowledge database is never touched by workers or by the product's code**; only the coordinator writes it ([knowledge database](knowledge-database.md#2-concurrent-writers-and-write-ownership)). Product databases are separate.
- Every attempt has its own test database (created from a template), ports, temp folders and caches. Migrations run only against attempt-local databases. No test database is shared between attempts.
- Migrations run inside a transaction where the database supports transactional schema changes (PostgreSQL, SQLite); otherwise a snapshot is taken first and restored on failure.
- A retry starts from a fresh worktree at the checkpoint ref and a fresh database. Untracked build output never carries over. Only the kernel's installer changes lockfiles.
- Sweeps commit per batch. A crash resumes from the last batch commit and discards uncommitted edits.
- Staging and production migrations happen only as approved effects with backups ([ship and deploy](ship-and-deploy.md#live-database-migrations)).

### 9 · Several projects at once

Each project has its own database, worktrees and branches. Shared limits (plan windows, API concurrency, memory) are allocated by one global broker with fair shares and a reserved lane for interactive work ([projects, portability and sync](projects-portability-and-sync.md#running-several-projects-at-once)).

### 10 · SQLite is embedded, not installed

The harness ships SQLite inside the app (Node's built-in `node:sqlite`, [desktop app](desktop-app.md#technology-stack)). Users and contributors install nothing. The `sqlite3` command-line tool is optional for inspecting a database, and should be used read-only. The daemon notices commits by other connections (SQLite's `data_version` counter changes) and responds with an integrity check and safe mode.

SQLite provides atomic transactions, not freedom from races. Lost updates and double claims are prevented by the single-writer and conditional-update rules in the [knowledge database](knowledge-database.md) design.

## Edge cases

| Situation | Behavior |
|---|---|
| Can't reproduce after the cap | Ask for evidence or instrumentation; the bug stays open with its hypothesis log. |
| Root cause is in a dependency | Fix by upgrade, patch (pnpm patch) or workaround; recorded with a link to the upstream issue. |
| Bug report is actually a missing feature | Routed as a new feature through discovery. |
| Upgrade breaks a library with no compatible version | Sweep stops at the checklist; options presented (pin, replace, wait). |
| Developer edits files during a sweep | Treated per [editor coexistence](editor-coexistence.md); the sweep's checklist is recomputed after merging. |

[Diagram](investigations-and-sweeps.svg) · [Editable Mermaid](investigations-and-sweeps.mmd) · [Task and skill architecture](task-and-skill-architecture.md) · [Build pipeline](build-pipeline.md) · [Verification for real apps](verification-for-real-apps.md) · [Research](research/debugging-and-codemods.md)
