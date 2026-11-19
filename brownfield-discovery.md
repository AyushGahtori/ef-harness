# Brownfield discovery: opening an existing codebase

A developer opens a real 30,000-line repo and types “Add team invites and fix the slow dashboard query.” Asking “What are you building? Who needs it?” would feel broken. This document defines how the opening adapts, how the harness learns the repo without burning tokens, and how it treats missing tests, failing tests and stale docs. Research: [repo understanding](research/brownfield-repo-understanding.md).

## Decisions in plain words

1. **Read cheaply first, ask the model last.** Four layers: free deterministic scan → free local code map → bounded, cached model summaries of the areas this request touches → on-demand deep reads by workers.
2. **“Here's what your repo does today” is a confirmation card, not a lecture.** Each claim has a source link and a confidence label. The developer ticks, corrects or ignores.
3. **Today and next stay separate.** Repo observations describe the baseline. The developer's words describe the change. A mismatch is a planned change until proven to be a contradiction.
4. **The baseline is measured, not assumed.** With permission, the harness builds and runs the existing tests once in an isolated worktree. Workers are judged on what they change, not on failures that were already there.

## Opening screen for an existing repo

```
Existing project · kitchen-app
TypeScript · Next.js 14 · Postgres via Prisma · Vitest · 2,341 files · 31,204 lines
Scanned locally · 0 tokens spent

What would you like to change?
[ Add team invites and fix the slow dashboard query                       ] [Send]

  ▸ What I found (12 items to confirm)      ▸ Test health: not measured yet [Run]
```

After the first message, the five greenfield prompts become five **change prompts**, each prefilled from the scan and the message:

| # | Change prompt | Prefilled from |
|---|---|---|
| 1 | What do you want to change or add? | The message, split into work items |
| 2 | Which part of the app does it touch, and who uses that part? | Code map: routes, modules, roles found in auth code |
| 3 | What should be true when it's done? (one example) | Nothing; this is the acceptance anchor |
| 4 | What must not change? (APIs, schema, styling, deployment) | Public routes, exported packages, migrations, CI |
| 5 | How do you check this works today? | Test scripts, CI, README instructions |

**Mixed requests are split.** “Add team invites” becomes a new-feature work item. “Fix the slow dashboard query” becomes a performance-fix work item with its own small interview. Each gets its own readiness count; they share project facts. Each is a `work_items` row with its own discovery scope revisions; project-level decisions are listed in every item's scope that needs them ([database design](database-design.md#discovery-records)).

### Performance fixes need a number

“Slow” is not testable. The fix interview asks: which page or endpoint, how slow today (the harness offers to measure), and what's acceptable. The recommended default is “p95 under 300 ms with a realistic dataset”. The harness locates the query by tracing the route to its data call, proposes how to reproduce (seeded synthetic data at a stated scale, or a sanitized dump the developer supplies) and records the baseline with `EXPLAIN ANALYZE` or a timing harness. Acceptance is a benchmark check in a Tier 3 environment ([verification](verification-and-isolation.md)) plus the existing tests for that page.

## Four reading layers

| Layer | Cost | What it produces |
|---|---|---|
| **L0 · Deterministic scan** | Free, seconds | File tree honoring `.gitignore`; languages; manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`); frameworks from dependencies; scripts (`dev`, `build`, `test`, `lint`); test framework and test-file count; CI config; docs (README, `docs/`, ADRs); schema and migrations (`prisma/schema.prisma`, `migrations/`); `.env.example` names; Git stats (commit count, recent activity, churn hotspots). |
| **L1 · Code map** | Free, local | Tree-sitter symbols: exports, routes, components, DB models, and a reference graph ranked by importance (Aider-style repo map). Entry points: framework route folders, `main`/`bin` fields, server bootstraps. Stored in a separate, rebuildable `code-index.db` keyed by file hash and commit ([schema](schema/code-index.sql)). |
| **L2 · Targeted summaries** | Bounded tokens, cached by file hash | A small model writes one short *module card* per area the request touches: purpose, key exports, data it reads and writes, tests covering it. The estimate appears before spending: “Reading 9 modules: about 80k tokens (≈$0.10 or ≈1% of weekly share).” Cards are reused on re-open and refreshed only for changed files. |
| **L3 · Deep reads** | Per task | Workers and planners request exact files or spans through scoped lookup at the pinned commit. |

**Request-driven focus.** The message decides which modules get L2 cards: for team invites, the auth, user, team and email modules; for the dashboard, the dashboard route, its data layer and the relevant tables. Everything else stays at L0/L1 until a later request needs it.

**Privacy.** L0 and L1 never leave the machine. Before L2 sends excerpts to a remote model, the secret scanner skips `.env` files and masks credentials. A local-only project uses a local model for L2 or skips it.

## “Here's what your repo does today”

| Claim | Source | Confidence | Developer |
|---|---|---|---|
| Users sign in with email magic links (NextAuth) | `src/auth/options.ts:12-40 @a1b2c3` | High (code) | ✓ / ✗ / edit |
| A user belongs to exactly one team | `prisma/schema.prisma:44 @a1b2c3` | High (schema) | ✓ / ✗ / edit |
| Dashboard loads all orders, then filters in JavaScript | `src/app/dashboard/data.ts:18 @a1b2c3` | Medium (summary) | ✓ / ✗ / edit |
| README says “run `npm start`” but no `start` script exists | `README.md:9` vs `package.json` | Stale doc | Noted |

Confirmed claims become **observed facts** with provenance. A correction becomes a user fact that overrides the observation and is linked to it. Unreviewed claims stay *observed, unconfirmed*: planners may use high-confidence ones, and a task that relies on a medium-confidence claim lists it in its assumptions.

## Test health and what it changes

With permission (“This installs dependencies and runs scripts from your repo in an isolated copy”), the harness creates a baseline worktree, installs from the lockfile, builds and runs the test command with a time limit. It records a **baseline receipt** at that commit: build pass/fail, tests passed/failed/skipped, flaky (re-run failures up to three times), duration and lint warning count.

| Repo state | Harness behavior |
|---|---|
| Healthy suite | Acceptance requires targeted checks to pass and no new failures anywhere. |
| Some tests failing | Record them as **known failing at baseline** with their names. Acceptance requires no *new* failures. Offer an optional “Fix the 3 failing tests first” task. A worker never gets blamed for, or asked to fix, unrelated baseline failures. |
| Flaky tests | Mark unstable; exclude from pass/fail decisions until their owner stabilizes them. |
| Zero tests | Add a **safety-net phase** before changes: install a test runner if missing (approved by the developer because it adds dependencies), then write characterization tests for the modules this request touches. These are preservation checks: they capture current behavior and must pass before and after. |
| Build fails at baseline | Stop and report. Offer a “Make the build pass” task; feature work waits because nothing can be verified. |
| Developer skips the run | Mark test health “not measured”. Every acceptance runs a pre-change baseline for the touched checks first, so pre-existing failures are still separated. |

## Stale docs

Deterministic checks compare docs against code: commands mentioned but missing from scripts, packages or databases mentioned but absent from dependencies, file paths that don't exist, environment variables not read anywhere, and docs untouched for a long time while the code they describe changed heavily. Code wins for “today” facts. Each mismatch appears on the confirmation card. The harness never rewrites the developer's README unless a task explicitly includes it.

## Conventions extraction

From lint and formatter configs, folder layout, naming patterns, the existing component library and error-handling style, the harness writes a **project conventions** node: where new routes go, how components are named, which UI primitives to reuse, how errors are returned, which test style is used. Planners include the relevant lines in each brief; [planning](planning-and-crew.md#shared-foundations-phase-0) and [UI consistency](ui-design-system.md) rely on it.

## Brownfield graph

The architecture canvas ([interactive architecture](interactive-architecture.md)) shows two layers: **Today** (observed modules, routes, entities and tests, grey) and **Change** (planned features, rules and tasks, colored). Edges from change nodes to today nodes show what will be touched.

## Edge cases

| Situation | Behavior |
|---|---|
| Monorepo with many packages | Ask which package(s) the request concerns, prefilled from the message; scan only those deeply. |
| Generated code or vendored folders | Detected by header comments and paths; excluded from maps and write scopes. |
| Repo in an unsupported language | L0 still works. L1 falls back to text search. L2 runs on the files the request mentions. |
| Developer's request contradicts code (“users have many teams” vs schema) | Recorded as a planned change, not a contradiction. The interview asks for the migration expectation for existing users. |
| New commits arrive while discovery runs | Pin to the commit at start. Refresh changed module cards before planning. |

[Diagram](workspace-git-and-brownfield.svg) · [Editable Mermaid](workspace-git-and-brownfield.mmd) · [Workspace and Git](workspace-and-git.md) · [Interactive architecture](interactive-architecture.md) · [Planning and crew](planning-and-crew.md) · [Research](research/brownfield-repo-understanding.md)
