# Planning and crew: from settled decisions to a running team

This is the middle stage between discovery and coding. The planners turn settled decisions into an architecture, shared foundations, feature specs and a task graph. The kernel then proposes a crew: how many workers, at which levels, on which models. The developer sees the plan, its cost and its timeline, and presses **Start build**. Research: [planning and crew scheduling](research/planning-and-crew-scheduling.md).

## Decisions in plain words

1. **The number of workers is computed, never fixed.** It comes from how many tasks can actually run at the same time, what the machine can host, what each connection allows, and the budget. One project may run 2 workers, another 9.
2. **Models are chosen per task by difficulty.** Four levels: *Junior*, *Mid*, *Senior*, *Manager*. Each level maps to a model and reasoning effort on the connections the developer has. The developer is the CEO.
3. **Phase 0 pours the foundation first.** Scaffold, packages, database base schema, shared types, auth skeleton, test harness and design tokens are built before any feature worker starts. The thinking for Phase 0 happens during architecture synthesis, so the tasks themselves are precise instructions that a Junior on low effort can carry out.
4. **The first build waits for Go.** Planning starts automatically at readiness. Coding starts when the developer presses **Start build** on the plan preview. Later small revisions can auto-start under a threshold the developer sets.
5. **Shared things have one owner.** Workers import shared contracts; they never redefine them. Changes to shared files arrive as requests to the integrator.

## The planning pipeline

The complete assembly line, including the spec expansion and research stages before this pipeline, just-in-time documents one wave ahead, state machines, Git merge protocol and paperwork budget, is in [build pipeline](build-pipeline.md). This section summarizes the planning stages.

| Stage | Who | Output | Checked by code |
|---|---|---|---|
| 0 · Spec expansion and research | Code generators, `spec-expander@1` (Mid), `feature-researcher@1` (Mid) | Complete spec items; cited research facts ([spec expansion](spec-expansion.md)) | Every required cell filled; quotes match sources; no open contradictions |
| 1 · System architecture | `system-architect@1` (Manager) | Components, skeleton data model, inter-feature contracts, cross-cutting rules with scopes, name prefixes, conventions, pinned stack versions, environment manifest | Consistency gate: every requirement maps to a node; every contract has a producer and a consumer; names unique |
| 2 · Master plan and foundation | `master-planner@1` (Manager) | Phase 0 recipes (everything two or more features consume), wave order, estimates, paperwork budget | Every shared artifact has exactly one Phase 0 owner |
| 3 · Feature architecture and planning (just in time, per wave) | `feature-architect@1` and `feature-planner@1` (Senior), in parallel per feature | Feature flows and screen specs; task files, visible examples, check slots, wiring brief | Each task has a write scope, entry point and examples |
| 3b · Hidden checks | `oracle-author@1` (Senior, different model family where available) | Held-back cases and rubrics for the check slots, sealed | A held-back or generated case for every rule-bearing requirement |
| 4 · Graph compile | Kernel | One task DAG across Phase 0 and features | No cycles; no two tasks own the same path; tasks within size limits; every requirement has a task and a check ([completeness gate](completeness-gate.md)) |
| 5 · Estimates | Kernel | Tokens, dollars or allowance, and time per task, with ranges | Uses calibrated history when available |
| 6 · Crew proposal | Kernel | Three presets: Fastest, Balanced, Cheapest | Fits budget, connection caps and machine capacity |
| 7 · Plan preview | Developer | Start, adjust or ask for changes | — |

A gap found at any stage reopens its criterion through the normal question queue; the stage waits only for what depends on it.

### What the developer sees while planning runs

Planning usually takes from under a minute to a few minutes. Before it starts, the estimate is shown: “Planning will use about 150k tokens (≈$0.45 or ≈3% of your weekly ChatGPT share).” While it runs, results stream into the canvas as they validate:

```
Planning kitchen-app
  ✓ Architecture        6 components · 5 tables · 4 contracts          (Manager · 41 s)
  ✓ Foundation          7 Phase 0 tasks
  ◐ Features            F12 print ✓ · F13 ordering ✓ · F14 menu …        (3 Seniors)
  ○ Task graph · Estimates · Crew
  [Cancel planning]
```

Each finished stage is clickable. The Architecture tab fills in live, so the developer can start reading before the plan is complete.

## Shared foundations (Phase 0)

Phase 0 is the “task 0” every other task depends on. It is planned in detail by the Manager during synthesis, so each Phase 0 task is a precise recipe.

| Phase 0 task | Typical content | Default level |
|---|---|---|
| P0.1 Scaffold | Framework init, folder layout from the conventions, TypeScript and lint/format config, scripts | Junior · low |
| P0.2 Packages | Install every package the planned features need, pinned, in one lockfile change | Junior · low |
| P0.3 Data base | **Skeleton schema**: every entity known upfront with its key, ownership, relations and the fields other features or Phase 0 depend on; migration 0001; seed recipe for the [test-data generator](test-environments.md#synthetic-data). Feature-internal columns arrive later as additive migrations ([what is locked upfront](build-pipeline.md#what-must-be-locked-upfront)) | Mid · medium (Junior if no relations or constraints) |
| P0.4 Shared contracts | Types and validators generated from the contract specs (e.g. Zod or OpenAPI), exported from one package | Junior · low |
| P0.5 Auth skeleton | Session middleware, role check helper, test identities — only if two or more features need auth | Mid · medium |
| P0.6 Test harness | Unit and browser test config, fixtures, test database namespace, a passing smoke test | Junior · low |
| P0.7 Design foundation | Tokens, UI primitives, app shell, style guide page ([UI design system](ui-design-system.md#phase-0-design-foundation)) | Mid · medium |
| P0.8 Environment | `.env.example`, environment manifest, CI workflow if requested | Junior · low |

**Order.** P0.1 runs alone. P0.2–P0.8 then run in parallel where their write scopes don't overlap. Feature waves start only when Phase 0 lands on `harness/integration` and the **foundation gate** passes: build, lint, the smoke test, migration apply on an empty database and the style guide page rendering.

**How conflicting conventions are prevented after Phase 0.**

- A generated `conventions` node (folder for routes, naming, error shape, test style) is quoted line by line into each brief that needs it.
- Lint and import-boundary rules make the conventions executable: no new packages outside dependency intents, no redefining a type exported by the shared package, no raw colors outside tokens.
- Shared files (lockfile, schema, route registry, shared package exports) are owned by the integrator. A worker that needs a change sends an intent ([parallel integration](parallel-feature-integration.md)).

**Existing repos.** Phase 0 shrinks to what this change needs: the safety-net tests and baseline from [brownfield discovery](brownfield-discovery.md), any migration or shared type that two work items share, and the conventions extracted from the repo.

## Crew composition

### Levels and the roster

| Level | Typical roles | What it's good for |
|---|---|---|
| Manager | Project planner, integrator, architecture synthesis, hard escalations | Judgment across the whole project |
| Senior | Feature planners, tricky tasks (rules, auth, concurrency, data migrations) | Getting subtle logic right first time |
| Mid | Standard tasks (CRUD endpoint, component from a clear brief) | Most of the work |
| Junior | Mechanical tasks (scaffold, config, generated types, renames) | Cheap, fast instructions-following |

The **roster** maps each level to a connection, model and effort. It's a versioned config, because model names change every few months. An illustrative roster using the owner's example names:

| Level | OpenAI plan | Google API | Mixed setup |
|---|---|---|---|
| Manager | Sol 6.1 · high | Hydrogen · high | ChatGPT plan · Sol 6.1 · high |
| Senior | Luna · high | Hydrogen · medium | Copilot plan · strongest available |
| Mid | Luna · medium | Flash-class · high | ChatGPT plan · Luna · medium |
| Junior | Luna · low | Flash-class · low | Local model (Ollama) |

### Choosing a level per task

1. **Difficulty class** from the planner, checked against code signals: number of rules, contracts consumed, size of the write scope, held-back cases, whether similar tasks exist, risk tier. Classes: *mechanical → Junior*, *standard → Mid*, *tricky → Senior*, *integration/architecture → Manager*.
2. **Bump one level** for a critical-risk decision, a very large context, or a past failure on a similar task in this project.
3. **Compare expected cost, not sticker price.** Expected cost = cost per attempt ÷ probability of passing. A Junior at $0.05 with a 40% pass rate (≈$0.125 expected plus delay) can lose to a Mid at $0.10 with 90% (≈$0.11). Pass rates start from defaults per class and level and are calibrated from this developer's history.

### Choosing how many workers

```
parallel workers in a wave = min(
  tasks that are ready at the same time (width of the task graph),
  machine slots (measured: memory and CPU per worktree, with dev servers and browsers),
  connection slots (each connection's current concurrency limit, see provider pacing),
  the developer's maximum,
  what the budget pace allows
)
```

The kernel then simulates the build with **critical-path list scheduling**: always start the ready task with the longest chain of work behind it, on the best-fitting free slot. The simulation produces a timeline, cost and allowance use. Running it with different settings gives three presets:

| Preset | How it differs | Kitchen example (illustrative) |
|---|---|---|
| **Fastest** | Max width; raise the level of tasks on the critical path to avoid retries | 7 workers peak · ~38 min · ~$6.10 |
| **Balanced** (default) | Cheapest level that meets the pass-rate target; width limited by pacing | 5 workers peak · ~55 min · ~$3.80 |
| **Cheapest** | Lowest viable levels; narrower to stay inside plan windows | 3 workers peak · ~1 h 40 min · ~$2.20 |

Peak counts differ per wave: the kitchen plan might run 1 worker for P0.1, 4 for the rest of Phase 0, 6 for the feature wave and 2 for integration.

### During the build

- **Escalation ladder.** A failed attempt follows the [hint ladder](verification-for-real-apps.md#when-a-worker-fails-a-hidden-check); after it, the task moves up one level or goes back to its author.
- **Rebalancing.** When tasks finish early or late, the scheduler re-runs on the remaining graph. A free worker takes the next ready task; no worker idles while work is ready.
- **Calibration.** Each finished attempt records class, level, model, tokens, time and pass/fail. Estimates and pass rates improve per developer and per project.

## Plan preview

```
Plan for kitchen-app · revision 4                                    [Start build ▸]
Phase 0  ███ 8 tasks       Feature waves  F13 ordering (5) · F12 print (4) · F14 menu (3)
Crew     Balanced ▾   5 workers peak · Manager 1 · Senior 2 · Mid 4 · Junior 5 (over time)
Estimate Planned: Phase 0 + wave 1 · ~25 min · $1.40 (tasks known)
         Projected: waves 2–3 · ~30 min (20–50) · $2.40 ($1.60–3.60) (from feature size; refined before each wave)
         Paperwork reserved: $0.70 (18%) · ChatGPT share ~9% of weekly
Watch    ⚑ 3 tasks rely only on choices made for you (SQLite, manager-only edits) [review]
```

The estimate is honest about what is known. Phase 0 and the first wave are planned task by task. Later waves are **projected** from their feature size (spec items, screens, endpoints) times this project's measured cost per item, shown as a range and refined each time a wave is planned just in time ([build pipeline](build-pipeline.md#upfront-versus-just-in-time)).

The developer can:

- Switch preset or set a maximum number of workers.
- Change the level of any task or feature (“use Senior for all auth tasks”).
- Merge, split or reorder tasks: these go to the owning planner as a request; the preview updates when the planner republishes.
- Defer a feature to later.
- Ask in chat: “Why is T07 Senior?” or “Can this be cheaper?”.
- Press **Start build**.

**Auto-start settings** (Settings → Building): *First build of a project* always waits for Start. *Revisions* auto-start when they add at most N tasks and fit within $X or Y% of a plan window; otherwise they show a preview. Defaults (decided 17 November 2026): **5 tasks, $1, 2%**, and additionally only when the revision has no must-ask decision, no breaking contract change, no destructive migration, no new dependency and no external effect. Auto-started revisions together are capped at $5 or 10% of a plan window per day, so many small revisions can't add up unnoticed.

**Crew width counts thinking and executing separately.** Up to the thinking width, workers wait on models concurrently; commands run through a small execution pool sized by the machine ([execution capacity](execution-capacity.md)). Wrapped foreign agents have their own lower cap.

## Edge cases

| Situation | Behavior |
|---|---|
| Graph is a single chain (no parallel work) | Crew is one worker plus the Manager; the preview says why (“tasks depend on each other in sequence”). |
| Machine is small (8 GB RAM) | Machine slots limit stateful tasks to 1–2; stateless tasks can still run more widely. |
| Only one connection with a low concurrency cap | Width follows the cap; the preview shows the cap as the reason. |
| Developer changes the roster mid-build | Applies to new attempts only. |
| Planning itself would exceed the budget | Ask before planning; offer a cheaper planner level. |
| Phase 0 fails the foundation gate | Feature waves wait; the failing check goes to the Phase 0 owner; repeated failure escalates to Manager. |

[Diagram](planning-and-crew.svg) · [Editable Mermaid](planning-and-crew.mmd) · [Task and skill design](task-and-skill-architecture.md) · [Parallel integration](parallel-feature-integration.md) · [Provider pacing](provider-connections.md#budgeting-with-allowance-instead-of-dollars) · [Build cockpit](build-cockpit.md) · [Research](research/planning-and-crew-scheduling.md)
