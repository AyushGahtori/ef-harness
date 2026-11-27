# EF Harness Integration Audit — Complete Methodology, Runbook & Handoff Guide (`AUDITOR_CONTINUATION_GUIDE.md`)

**Purpose:** If the current auditor session hits a token, context, or quota limit at any point, **any human engineer or AI agent can resume seamlessly in under 2 minutes** using only the persistent files on disk in `c:/Users/Ayush/Desktop/ef harness/` — without needing prior conversation history and without re-auditing completed units.

---

## 1. Non-Negotiable Ground Rules (Read First!)

1. **Read-Only Auditor Mandate:**
   - **NEVER** implement, merge, rebase, `git checkout`, commit, stage, or edit any product code, Git branch, or worktree in `c:/Users/Ayush/Desktop/ef harness` or `C:/Users/Ayush/Desktop/ef-wt/*`.
   - You may ONLY write persistent audit files in `c:/Users/Ayush/Desktop/ef harness/`:
     - `audit_findings.md` (Master Bug Discovery Ledger — `F-001`, `F-002`, …)
     - `audit_progress.md` (Live Checkpoint & Recovery State)
     - `audit_reports/pass-NN/chunk-NNN.md` (Per-Chunk Detailed Audit Reports)
     - `audit_reports/AUDITOR_CONTINUATION_GUIDE.md` (This Runbook)
     - `combination_task.md` (Final Deliverable — written **ONLY AFTER** all 200 units are audited!)
2. **Do NOT Use Subagents:**
   - Standing user rule: **`DONT USE SUBAGENTS`**. Work sequentially in bounded chunks in the main agent loop so zero context or quota is lost to subagent failures.
3. **Never Rely on Conversation Memory Alone:**
   - Every chunk MUST follow the strict 6-step loop before moving to the next chunk:
     `CHUNK → INSPECT → ANALYZE → DOCUMENT (chunk-NNN.md) → UPDATE LEDGER (audit_findings.md) → CHECKPOINT (audit_progress.md)`

---

## 2. Repository & Worktree Topology (What Exists on Disk)

| Item | Path / Value | Notes |
|---|---|---|
| `REPO_ROOT` | `c:/Users/Ayush/Desktop/ef harness` | Checked out on `main` (`649773097c387ae534b686ea5825f449f843aa7c`). Contains all architecture `.md`/`.mmd`/`schema/*.sql`/`research/*.md` + `IMPLEMENTATION_TASKS.md` (12,797 lines, `Task 001`–`Task 200`). |
| `WORKTREE_ROOT` | `C:/Users/Ayush/Desktop/ef-wt` | Contains **202 worktree directories**: `integration` + 201 `task-NNN-*` directories corresponding to 201 `task/*` branches. |
| `INTEGRATION_BASE` | `harness/integration` (`30f2e9cb41169e3cea11f1a9946db74a5b32cfde`) | Located at `C:/Users/Ayush/Desktop/ef-wt/integration`. Previously merged `Tasks 002–089` mechanically without cross-package wiring and **missed 16 uncommitted worktree bugfix diffs** (`008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079`). `Tasks 090–200` are completely unmerged on `harness/integration`. |
| Duplicate / Superseded Branches | `task/162-office-pixijs-floorplan-sprites` (`6497730`), `task/164-office-animation-director-astar` (`6497730`) | Both sit at `main` (`6497730`) with `0` committed product/test files (only untracked `.agent-handoffs/task-162.md` / `task-164.md`), superseded by committed branches `task/162-office-pixijs-floor-sprites` (`73d1bd4`) and `task/164-office-animation-director-v2` (`0272a00`). Document both in `combination_task.md` `Exclusions`. |
| Verify Commands | `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:schema`, `pnpm verify:diagrams`, `pnpm verify:env`, `pnpm verify:harmony` | Run read-only checks from `REPO_ROOT` (`node schema/schema-test.js`, `node scripts/verify-diagrams.mjs`) or `C:/Users/Ayush/Desktop/ef-wt/integration`. |

---

## 3. Authority Hierarchy (How to Decide Which Contract Wins)

Whenever two isolated task branches or documents disagree, **neither worker branch wins by default** — resolve strictly in this order:

1. **`schema/*.sql` (`state.sql`, `global.sql`, `telemetry.sql`, `code-index.sql`, `queries.sql`) + `schema/schema-test.js` + `architecture-deep-review.md` (18 Nov 2026)** — Highest authority for SQL tables, columns, `CHECK` constraints, triggers, FTS5 (`ef_search_text`), and deep-review overrides.
2. **`database-design.md`, `kernel-schema-and-protocol.md`, `open-design-questions.md` (16–18 Nov 2026)** — Canonical SQLite single-writer rules, 5-byte IPC framing, RPC envelopes, and owner UX/product decisions (e.g., Office default Build view, `AgentID · short title`, never-auto-send dictation).
3. **`architecture-audit-response.md`, `architecture-review-decisions.md`** — Locked architectural resolutions.
4. **Domain `.md` & `.mmd` files** (`architecture.md`, `build-pipeline.md`, `security-and-governance.md`, `verification-and-runtime.md`, `app-shell-and-governor.md`, `build-cockpit.md`, `office-view.md`, `ui-design-system.md`, `brownfield-and-ship.md`, `investigations-and-sweeps.md`, `portability-and-scale.md`, `meta-harness-and-evals.md`, `prompt-contracts.md`, etc.).
5. **`research/*.md`, `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`, `stack-manifest.json`**.
6. **`IMPLEMENTATION_TASKS.md`** — Authoritative ONLY for what each isolated worker was assigned to build and export.
7. **`.agent-handoffs/task-NNN.md`** — Treated strictly as **untrusted worker claims** (frequently contradicted by actual code!).
8. **Actual code in `C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`** — Ground truth of what exists today, **never** permission to keep a contract that violates #1–#5.

> **BLOCKER Rule:** Only emit a `BLOCKER` in `combination_task.md` if two #1–#5 source-of-truth files genuinely contradict each other and `AUTHORITY_ORDER` (later date beats earlier date) cannot settle it. Quote both files and paths verbatim.

---

## 4. Step-by-Step Recovery Procedure (How to Resume After Any Interruption)

### Step 1: Read Current State on Disk (Takes 30 Seconds)
1. Read `c:/Users/Ayush/Desktop/ef harness/audit_progress.md` (lines 1–65) — tells you:
   - Exact `Current pass` and `Current chunk`
   - Completed chunks (`audit_reports/pass-NN/chunk-NNN.md`)
   - Remaining chunks and units
   - Highest confirmed finding ID (`F-xxx`)
2. Read the last 70 lines of `c:/Users/Ayush/Desktop/ef harness/audit_findings.md` (`## Investigation Checkpoint` + latest `F-xxx` entry) to verify the exact last finding number and ensure no partial write occurred.
3. Verify `git -C "c:/Users/Ayush/Desktop/ef harness" status --short` shows ONLY untracked `audit_findings.md`, `audit_progress.md`, `audit_reports/` (and `combination_task.md` once generated).

### Step 2: Recreate / Use Fast Read-Only Helper Scripts (If Starting in a New Session)
If your new session does not have the previous session's `scratch/` folder, you can inspect any unit `NNN` directly with standard Git commands against `REPO_ROOT` (`c:/Users/Ayush/Desktop/ef harness`) or its worktree (`C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`):

```powershell
# 1. List all branches matching task numbers (e.g., 166..175) with SHA and worktree status:
git -C "c:/Users/Ayush/Desktop/ef harness" for-each-ref --format="%(refname:short) | %(objectname:short)" "refs/heads/task/16[6-9]*" "refs/heads/task/17[05]*"

# 2. List exact changed files on a task branch vs main (excluding .agent-handoffs):
git -C "c:/Users/Ayush/Desktop/ef harness" diff --name-status main..task/166-brownfield-l0-scanner

# 3. Check for uncommitted/dirty edits inside a task's worktree (CRITICAL — 16 earlier worktrees had uncommitted bugfixes!):
git -C "C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-scanner" status --short

# 4. Find exact line numbers in IMPLEMENTATION_TASKS.md for a range of tasks:
Select-String -Path "c:/Users/Ayush/Desktop/ef harness/IMPLEMENTATION_TASKS.md" -Pattern "^### Task (166|167|168|169|170|175)\b"
```

---

## 5. Exact Per-Chunk Audit Execution Protocol (`CHUNK → INSPECT → ANALYZE → DOCUMENT → LEDGER → CHECKPOINT`)

Keep every chunk bounded to **4–6 closely related units (`~8–15` key source files read directly)** so context stays razor-sharp and never compacts mid-chunk.

### Step A — Scope the Chunk (`1 turn`)
1. Read the `IMPLEMENTATION_TASKS.md` spec blocks for the 4–6 tasks in the chunk (`Depends On`, `Owned Write Scope`, `Mandatory Reference Files`, `Shared Contracts Consumed / Produced`, `Invariants`).
2. List all files changed vs `main` for each task branch AND check `git status --short` in each worktree (`C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`) to catch any uncommitted worktree diffs or duplicate/abandoned branches.

### Step B — Read Actual Source Code Directly (`1–2 turns`, Never Rely on Handoffs!)
Read the real TypeScript/SQL/JSON files inside `C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`:
- Always read `package.json`, `src/index.ts` (barrel exports!), `ports.ts` / `types.ts` / `contracts.ts`, the main engine/controller implementation files, and any factory (`create-*.ts` / `sqlite-*.ts` / `local-*.ts`).
- **High-Yield Defect Checklist (What We Repeatedly Catch Across EF Harness Workers):**
  1. **Empty Package Barrels (`src/index.ts`):** Because every branch forked from `main` (`6497730`), almost every task left `packages/<pkg>/src/index.ts` as `export function packageIdentity()` instead of exporting its modules!
  2. **Missing `package.json` Dependencies & Uncopied Non-TS Assets:** Check if code imports undeclared npm packages (`react`, `pixi.js`, `web-tree-sitter`, `electron-updater`, `@parcel/watcher`) or reads `.wasm`, `.tmj`, `.png`, `.tiktoken`, `.sql` via `fs.readFileSync(new URL(..., import.meta.url))` when `tsc` does NOT copy non-`.ts` assets to `dist/`!
  3. **Forbidden Node Built-Ins in `apps/renderer`:** Sandboxed Electron renderer (`sandbox: true, nodeIntegration: false`) CANNOT import `node:fs`, `node:path`, `node:sqlite`, `node:crypto`, or `node:child_process` (`F-058`, `F-067`, `F-070`).
  4. **Local Mock/In-Memory Stand-Ins Masquerading as Production Wiring:** Workers frequently wrote `Local*` or `InMemory*` stand-in adapters (`LocalWorktreeSlotPool`, `LocalWindowsJobSupervisor` with fake `killOnJobClose = true`, `MemoryGlobalDbVocabularyDriver`, synthetic E2E gates) instead of wiring `@ef-harness/db`, `@ef-harness/sandbox`, `@ef-harness/git-engine`, etc.
  5. **Rogue `new DatabaseSync(...)` Writers & Private DDL:** Any module opening `state.db` or `global.db` directly with `node:sqlite` `DatabaseSync` and running custom `CREATE TABLE IF NOT EXISTS` violates `database-design.md` single-writer `SqliteConnection` + `CoordinatorWriteQueue` (`015`–`016`) and often clashes with `schema/*.sql` column names, `NOT NULL` constraints, `CHECK` enums, or `ef_search_text` FTS5 triggers (`F-010`, `F-012`, `F-057`, `F-061`).
  6. **Cross-Unit Enum, Casing & Signature Mismatches:**
     - Governor pressure level casing: `118` emits `"GREEN" | "YELLOW" | "ORANGE" | "RED"` while downstream consumers (`119`, `122`, `157`, check `165`!) check `"Green"` or `"green"` (`F-055`).
     - Digest format: `"sha256:<64-hex>"` (`shared-contracts`) vs bare `<64-hex>` (`cas-blobs` `028`) (`F-007`, `F-011`).
     - Sync vs Async port methods (`CasBlobStore`, `ReaderPool`, `GitRunner`, `SecretsVault`, `RuntimeAdapter`).
     - `zod` vs `zod/v4` (`F-005`) and `layers.mjs` intra-tier workspace import ban (`F-001`).
  7. **Fake Exit Gates (`105`, `134`, `152`, check `175`, `194`, `195`, `200`!):** E2E gate tests often import relative `.ts` files or test self-contained dummy state machines inside `tests/e2e/**` without ever invoking real workspace packages!

### Step C — Write `audit_reports/pass-NN/chunk-NNN.md` (`Mandatory 12 Sections`)
Every chunk report in `c:/Users/Ayush/Desktop/ef harness/audit_reports/pass-NN/chunk-NNN.md` MUST contain these exact 12 numbered sections:
1. `## 1. Chunk Identification and Scope` (Pass, Chunk, Units with branch + short SHA + worktree path + merge/dirty status, Governing Architecture Documents)
2. `## 2. Files Directly Inspected`
3. `## 3. Verified Local Strengths` (What each unit genuinely implemented well — needed so `combination_task.md` preserves working logic!)
4. `## 4. Local Implementation Defects Discovered` (Bugs inside a single unit even before integration, with `file:line` + `F-xxx` ID)
5. `## 5. Cross-Unit Contract & Seam Mismatches` (Producer↔consumer disagreements across units, with exact signatures on both sides + `F-xxx` ID)
6. `## 6. Shared-File & Ownership Conflicts` (`package.json`, `src/index.ts`, SQL tables, config files touched by multiple branches)
7. `## 7. Runtime Wiring Gaps` (What must be connected in `apps/daemon`, `apps/desktop`, `apps/renderer`, or orchestrators)
8. `## 8. Architecture & Security Violations`
9. `## 9. Test Coverage & Verification Gaps`
10. `## 10. Findings Added / Updated in audit_findings.md`
11. `## 11. Chunk Completion Gate Verification`
12. `## 12. Explicit Files and Relationships Still Requiring Inspection`

### Step D — Immediately Append `F-xxx` Entries to `audit_findings.md` & Update Checkpoint
In `c:/Users/Ayush/Desktop/ef harness/audit_findings.md`, insert new `### F-071 — Title` entries right above `## Investigation Checkpoint` AND update `## Investigation Checkpoint` at the bottom in the same turn. Every `F-xxx` entry MUST include all **13 mandatory fields**:
- `**Status:** CONFIRMED`
- `**Severity:** CRITICAL | HIGH | MEDIUM | LOW`
- `**Category:** seam-mismatch | local-defect | missing-wiring | shared-file-conflict | schema-conflict | security-violation | build-packaging | test-gap`
- `**Affected units:**`
- `**Files and symbols:**` (with exact `path:line-range`)
- `**Actual implementation:**`
- `**Required architecture:**` (citing exact `.md` / `.sql` authority)
- `**Evidence:**`
- `**Why this is a defect:**`
- `**Required correction:**` (exact contract/wiring fix for `combination_task.md`)
- `**Dependencies:**` (`F-xxx` IDs)
- `**Verification:**` (exact `pnpm` / `node` command)
- `**Integration priority:**`

### Step E — Update `audit_progress.md` & Post a Findings Report in Chat
Update `Current chunk`, `Completed chunks`, `Remaining chunks`, `Completed units`, `Findings discovered`, and `Exact next action` in `audit_progress.md`, and share a concise structured findings summary in chat with clickable `[filename](file:///c:/Users/Ayush/...)` links.

---

## 6. Exact Roadmap of Remaining Audit Chunks (`35 / 200` Units Left as of `pass-05/chunk-004`)

1. **`pass-05/chunk-005` (`Tasks 162–165` + 2 Duplicate Branches):**
   - Active branches: `task/162-office-pixijs-floor-sprites` (`73d1bd4`), `task/163-office-seated-cast-tags-flows` (`e70dc27`), `task/164-office-animation-director-v2` (`0272a00`), `task/165-office-accessibility-auto-fallback` (`c3401c3`).
   - Excluded empty branches at `6497730`: `task/162-office-pixijs-floorplan-sprites`, `task/164-office-animation-director-astar`.
   - Check: `pixi.js` in `apps/renderer/package.json`, `.tmj`/sprite asset paths in `dist/` vs `assets/`, Node imports in `apps/renderer`, `162↔163↔164↔165` port types, Governor `"ORANGE"` vs `"Orange"` casing in `165`, `122/123/124/125/126/127` cockpit hooks.
2. **`pass-05/chunk-006` (`Tasks 166–170, 175` — Finishes Pass 05!):**
   - `packages/brownfield` (`166` L0 scanner, `167` L1 `web-tree-sitter` + PageRank `code-index.db`, `168` L2 lazy summaries, `169` brownfield opening flow `Today`/`Change`, `170` baseline test health & quarantine) + `Task 175` (M5 `resume-changer@497831ec` Exit Gate).
   - Check: `code-index.sql` schema vs `014` `CodeIndexDb`, WASM grammar loading in `167`, `088` `ContextSlicerEngine` seam, `175` real vs synthetic E2E gate.
3. **`pass-06/chunk-001` (`Tasks 176–181` — `packages/ship-deploy`):**
   - `176` external `effects` ledger (`029` `EffectsRepo` & `schema/state.sql` `effects`/`ship_runs`), `177` GitHub rate-aware queue & pre-push guard, `178` PR/CI repair loop, `179` Vercel & Docker-SSH deploy adapters (`120` DPAPI vault & `127` `ApprovalCard`), `180` 6-phase expand-contract prod migrations, `181` post-deploy smoke & rollback.
4. **`pass-06/chunk-002` (`Tasks 182–185` — `packages/investigations`):**
   - `182` 6-stage mystery-bug pipeline (`100` HAR scrubber & `055` verifier), `183` `git bisect` + `ddmin` fault localizer (`036`/`038`/`047`), `184` repo-wide sweep ownership (`020` `leases`/`lease_paths`), `185` `@ast-grep` codemod & sweep safety guards.
5. **`pass-06/chunk-003` (`Tasks 186–188` — `packages/portability`):**
   - `186` `harness-state` orphan Git branch exporter + `age-encryption` (`036`/`091`/`011`), `187` portable `.zip` bundle & rehydrator (`015`/`028`/`120`), `188` global WFQ multi-project resource broker (`014` `GlobalBrokerDb`, `024`, `118`/`119`, `140`).
6. **`pass-06/chunk-004` (`Tasks 189–194` — `packages/meta-lab` & Architecture Review Trials):**
   - `189` frozen benchmark registry, `190` simulated dev personas, `191` McNemar + paired bootstrap eval & promotion gate, `192` chaos fault-injection runner (`034`), `193` red-team suite (`045`/`097`/`100`/`120`/`149`), `194` architecture review trials.
7. **`pass-06/chunk-005` (`Tasks 195–200` — Release, Installer & v1.0 Certification):**
   - `195` cross-milestone E2E suite, `196` Windows NSIS installer + EV Authenticode signing (`117`/`131`/`132`), `197` docs/diagram/code consistency verifier, `198` 16 GB laptop perf certification, `199` security & privacy audit, `200` v1.0 Release Certification Gate.
   - Also run read-only `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint` and `node scripts/verify-diagrams.mjs`.

---

## 7. Exact Blueprint for Generating & Validating `combination_task.md` (Final Phase)

**ONLY begin generating `c:/Users/Ayush/Desktop/ef harness/combination_task.md` when:**
- All **31 chunk reports** (`pass-01..06`) exist on disk,
- All **200 tasks (`201` `task/*` branches)** are accounted for, and
- `audit_findings.md` has **`0` `UNVERIFIED`** findings.

### Required Section Order in `combination_task.md`
1. `# Goal` — What is true on `harness/integration` after the final `Cxx` task finishes.
2. `## Sources read` — Discovered `PROJECT:` block (`REPO_ROOT`, `SOURCE_OF_TRUTH`, `AUTHORITY_ORDER`, `IMPLEMENTATION_TASK_FILE`, `ISOLATION`, `WORKTREE_ROOT`, `BRANCH_PATTERN`, `INTEGRATION_BASE`, `OUTPUT_PATH`, `VERIFY_COMMANDS`, `ENTRY_JOURNEY`) + complete list of architecture/SQL/research files read.
3. `## Inventory` — Complete table of all **201 `task/*` branches** (`Task ID`, `Branch`, `Commit SHA`, `Worktree`, `Merged in harness/integration?`, `Uncommitted Worktree Diff?`, `Assigned Cxx Task or Excluded`) + `### Exclusions` subsection with exact technical reasons (`task/001-*` already in `main`; `task/162-office-pixijs-floorplan-sprites` & `task/164-office-animation-director-astar` at `6497730` superseded by `73d1bd4` & `0272a00`). Every branch MUST map to **exactly one** `Cxx` task or `Exclusions`. Remember to instruct landing tasks for `008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079` to apply their uncommitted worktree bugfix diffs!
4. `## Contract atlas` — Frozen canonical TypeScript interfaces, Zod schemas, SQL tables/UDFs (`ef_search_text`), IPC envelopes, digest formats (`sha256:<64-hex>`), Governor enums (`"GREEN" | "YELLOW" | "ORANGE" | "RED"`), and runtime adapter contracts with exact source-of-truth citations.
5. `## Seam register` — Complete table mapping **every confirmed finding (`F-001`..`F-N`)** to its producer/consumer units, contract conflict, and the **earliest `Cxx` task** where those units meet and resolve it.
6. `## Wave plan` — Dependency-ordered waves (`Wave 0` workspace/lint/build plumbing → `Wave 1` contracts/observability/SQLite/IPC → `Wave 2` git/sandbox/MCP/test-env/worker/verifier/daemon/desktop M1 → `Wave 3` discovery/corpus/spec-expansion/research/planner/intake M2 → `Wave 4` integrator/steering/governor/providers/runtime-adapters M3–M4 → `Wave 5` cockpit/canvas/dictation/preview/office/brownfield M5 → `Wave 6` ship-deploy/investigations/portability/meta-lab/installer/v1.0 release M6), grouping **2–3 closely related units per `Cxx` task** (~75–90 sequential tasks total).
7. `## Blockers` — Include **ONLY** if an unresolvable contradiction exists between authoritative architecture docs (omit section if 0 blockers).
8. `## The tasks` — Sequential tasks `### C01 — ...` through `### Cnn — ...`.

### Strict Per-Task Format & Hard Line-Count Invariant (`35 <= nonBlankLines <= 55`, Target `40–50`)
Every `### Cxx` block MUST contain **40–50 non-blank lines** (hard programmatic check: `35..55` non-blank lines) and these exact subheadings in order:
- `### Cxx — <one sentence: what is true on the integration line when this task ends>`
- `Architecture.` (Exact `.md`/`.mmd`/`schema/*.sql` files & sections governing this task)
- `Land.` (Exact branches/commits — and worktree paths if harvesting uncommitted fixes — to bring onto `harness/integration`)
- `Freeze.` (Exact exported symbols, signatures, types, SQL columns, or IPC payloads locked by this task)
- `Seams.` (Exact `F-xxx` mismatches resolved in this task, naming both sides and the exact target signature/schema)
- `Local defects.` (Exact `F-xxx` single-unit bugs fixed in this task with `file:line` precision)
- `Shared files.` (Exact resolution rules for `package.json`, `src/index.ts`, `layers.mjs`, `tsconfig.json`, etc.)
- `Do not.` (Explicit guardrails so the executor model does not invent stand-ins, touch downstream packages prematurely, or weaken sandboxes/schemas)
- `Done when.` (**Self-contained!** Repeat exact `pnpm ...` verify commands, exact observable test/build output, AND the full signatures/contracts next tasks rely on — **NEVER** write `"as defined above"` or `"see the atlas"`!)
- `Stop.` (Leave `harness/integration` clean, green, and committed before `C(xx+1)` starts)

### Forbidden Vague Phrases (Zero Tolerance!)
Never write any of these in `combination_task.md`:
- `"merge and fix conflicts"`
- `"align the APIs"`
- `"match task NN's expectations"`
- `"clean up as needed"`
- `"investigate"`
- `"use your judgment"`
- `"as defined above"` / `"see the atlas"` (inside `Done when.`)

### Mandatory Programmatic Verification Script Before Declaring Completion
Before finishing, run a Node verification script asserting:
1. All **201** `refs/heads/task/*` branches appear in `## Inventory` and map `1-to-1` to either exactly one `### Cxx` `Land.` block or `### Exclusions`.
2. Every `F-001`..`F-N` in `audit_findings.md` appears in `## Seam register` AND inside at least one `### Cxx` (`Seams.` or `Local defects.`).
3. Every `### Cxx` block has `35 <= nonBlankLines <= 55` and contains all 9 subheadings (`Architecture.`, `Land.`, `Freeze.`, `Seams.`, `Local defects.`, `Shared files.`, `Do not.`, `Done when.`, `Stop.`).
4. Zero matches for forbidden vague phrases across `combination_task.md`.
5. `git status` on `c:/Users/Ayush/Desktop/ef harness` and `C:/Users/Ayush/Desktop/ef-wt/integration` shows zero modified tracked files.
