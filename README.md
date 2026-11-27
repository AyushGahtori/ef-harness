# EF Harness — Audit, Progress Ledger & Dirty Worktree Handoff (`harness/audit-and-handoff`)

This orphan branch stores all non-product audit deliverables, progress trackers, subagent logs, and the 16 dirty sibling worktree bugfix patches so cloud agents have 100% of the local state without polluting `main`, `harness/integration`, or any `task/*` branch.

## Repository Branch Layout (`https://github.com/AyushGahtori/ef-harness`)
- **`main`** (`6497730`) — Untouched frozen Task 001 baseline (DO NOT merge until Phase 9 after `C79` certification).
- **`harness/integration`** (`c07aa07`) — Active sequential integration branch (`C01`–`C04` committed + Wave 0 Proof Gate PASSED). All `C05`–`C79` + Phase 9 integration commits go here.
- **`harness/c05-wip`** (`df255ed`) — Uncommitted `C05` work-in-progress snapshot (1 commit ahead of `c07aa07`, 27 files in `packages/db`, `pnpm --filter @ef-harness/db build` exits `0`). Cherry-pick or fast-forward onto `harness/integration`, run `C05` tests/lint/schema checks, commit cleanly, and continue with `C06`.
- **`harness/audit-and-handoff`** (this orphan branch) — Contains:
  - `ALL_FINDINGS.md` — 100% consolidated audit ledger (`F-001`–`F-086` + all 31 chunk reports + continuation runbook).
  - `combination_task.md` — Sequential 79-task integration & repair plan (`C01`–`C79`).
  - `audit_findings.md`, `audit_progress.md`, `audit_reports/**`, `combination-audit-prompt.md`.
  - `fixing_run.md` — Append-only work log written by every subagent after completing its task or wave gate.
  - `integration_progress.md` — Master `C01`–`C79` + Phase 9 progress ledger table.
  - `dirty_worktree_patches/task-*.patch` — Exact `git diff HEAD --binary` exports of all 16 dirty sibling worktrees (`008`, `009`, `011` already harvested in Wave 0; `022`, `048`, `053`, `056`, `057`, `058`, `059`, `061`, `062`, `063`, `064`, `066`, `079` pending harvest in `C08`, `C18`, `C21`, `C22`, `C23`, `C24`, `C25`, `C31`).
- **`task/002-*` .. `task/200-*`** (`201` branches) — All isolated task branches, unmerged on `main` (`002`–`089` are already ancestors of `harness/integration`; `090`–`200` are unmerged, excluding the 2 empty superseded Office stub branches `task/162-office-pixijs-floorplan-sprites` and `task/164-office-animation-director-astar`).
- **Tags:** `foundation/task-001-complete`.

## Recommended Cloud Checkout Pattern
```bash
git fetch --all --tags
git checkout -B harness/integration origin/harness/integration
git worktree add ../ef-audit-handoff origin/harness/audit-and-handoff
```
Read `../ef-audit-handoff/ALL_FINDINGS.md`, `../ef-audit-handoff/combination_task.md`, and `../ef-audit-handoff/dirty_worktree_patches/task-NNN.patch` (applying with `git apply`), and update `../ef-audit-handoff/fixing_run.md` + `../ef-audit-handoff/integration_progress.md` and push back to `origin/harness/audit-and-handoff` + `origin/harness/integration`.
