# Deep architecture review: 20 problems found and fixed (18 November 2026)

Four parallel reviews read every design document and the SQL schema, looking for contradictions, gaps, stale text and designs that couldn't work as written. Thirty-eight raw findings were checked against the files, merged where they described the same root cause, and reduced to the 20 below. Each was fixed in the documents, and every storage-related fix was added to the executable schema with a test: `node schema/schema-test.js` now runs **67 scenarios, all passing** (SQLite 3.53).

## Storage and state

| # | Problem | Type | Decision | Fixed in |
|---|---|---|---|---|
| 1 | **Outbox events could be pruned unseen.** `prune_outbox` deleted any old event with no *pending* delivery rows, so an event with no delivery rows at all qualified | Bug | Delivery rows are registered for every intended consumer in the event's transaction; pruning requires rows and all acknowledged; a check reports events without rows | [queries.sql](schema/queries.sql), [database design](database-design.md#additions-from-the-18-november-architecture-review) |
| 2 | **Feature and project lifecycles had nowhere to live.** The build pipeline defined feature and project states, but the schema only had task state; “feature done” was also spelled two ways, and wiring could start before leaves were merged | Gap + bug | `feature_runtime` and `project_runtime` with lookup states; `LEAVES_ACCEPTED` became `LEAVES_MERGED`, reached only when every leaf is squashed onto the feature branch; one name, `DONE` | [state.sql](schema/state.sql), [build pipeline](build-pipeline.md#feature) |
| 3 | **Sweep leases weren't enforceable.** Sweeps “own their paths”, but the claim statement didn't look at paths at all | Gap | `task_scopes`, `path_leases`; claims refuse overlapping write scopes while a sweep is in intent or granted mode; the lease is granted only after overlapping work stops | [queries.sql](schema/queries.sql), [investigations and sweeps](investigations-and-sweeps.md#ownership-and-timing) |
| 4 | **Acceptance ignored negative reads.** A new consumer edge left node versions unchanged, so stale work could be accepted | Gap | `edge_read_sets` checked at acceptance; recorded searches re-run | [database design](database-design.md#five-more-traps) |
| 5 | **Submit and dependency holes.** `submission_pending` was never set, so a slow verification could lose its lease; planner dependencies could stay in task JSON instead of edges | Bug + gap | `accept_submission` and `finish_submission`; relations always become edges at publish, and a check flags relations left inside fields | [queries.sql](schema/queries.sql) |
| 6 | **The hint ladder had no memory.** Steps, fingerprints and disclosed examples weren't stored, so a restart or a new attempt reset the ladder | Gap | `verification_state` per task; resets on a new brief | [verification for real apps](verification-for-real-apps.md#when-a-worker-fails-a-hidden-check) |
| 7 | **Resume and takeover data missing.** Session references, contract versions and pending effects had no table; the multi-device lease file had no format | Gap | `attempt_checkpoints`; `lease.yaml` beside `manifest.yaml`, compared with `writer_epoch` | [stops, undo and re-entry](stops-undo-and-reentry.md), [portability](projects-portability-and-sync.md#single-writer-across-devices) |
| 8 | **Shipping had no state.** PR numbers, CI runs, repair generations and deployments couldn't be stored, so the bounded CI repair loop couldn't survive a restart | Gap | `ship_runs` linked to effects | [ship and deploy](ship-and-deploy.md#push-and-pull-request-loop) |
| 9 | **Requirement status had no recompute.** The drift check existed only for tasks | Gap | `requirement_status_recompute` (latest result per check at its current version) used by the drift job | [queries.sql](schema/queries.sql) |
| 10 | **Discovery had no data model.** Readiness counts, scope revisions, batches and brownfield work items weren't stored | Gap | Decision nodes per criterion; `work_items`, `discovery_scopes`, `scope_criteria`, `discovery_batches`; `readiness` statement | [database design](database-design.md#discovery-records) |

## Discovery and knowledge

| # | Problem | Type | Decision | Fixed in |
|---|---|---|---|---|
| 11 | **Four vocabularies for “where a value came from”** (creditBasis, infer-or-ask statuses, spec bases, “chosen under delegation”) | Contradiction | One basis set (`explicit`, `derived`, `delegated`, `defaulted`, `proposed`, `observed`), enforced by the database; statuses are separate | [database design](database-design.md#basis-and-status-vocabulary) |
| 12 | **Three models for spec defaults:** option elaborations, “stage default policies”, and the expander's input | Contradiction | Fixed order: decisions and rules, then option elaborations and universal policies, then `spec-expander@1` only for what's left | [spec expansion](spec-expansion.md#filling-cells) |
| 13 | **Opening prompts were disconnected:** rubric IDs never mapped to catalog criteria, the three prompts had no output schemas, and “publication starts automatically” read like auto-coding | Gap + stale | `opening-rubric-map@1`; schemas for all three; publication shows the plan preview, coding waits for Start build | [opening prompts](opening-prompts.md#opening-rubrics-map-to-catalog-criteria), [prompt contracts](prompt-contracts.md#discovery-prompt-schemas) |
| 14 | **Two languages for rule scopes** (a predicate form in knowledge slicing, flat tags in the corpus) | Unworkable | Tags only: `any: [...]` and `all: [...]` over the closed touches list | [knowledge slicing](knowledge-slicing.md#cross-cutting-rules-reach-every-task-they-apply-to) |
| 15 | **Canvas box actions had no router intents** (correct a mishearing vs change a decision) | Gap | `router@1` intents extended to match the canvas | [prompt contracts](prompt-contracts.md#router1) |

## Planning and building

| # | Problem | Type | Decision | Fixed in |
|---|---|---|---|---|
| 16 | **Two authors of held-back tests** (`oracle-author@1` vs the feature planner) and no step for them before graph compile | Contradiction | `oracle-author@1` is the only author; a sealing step (3b) runs before compile; four documents corrected | [build pipeline](build-pipeline.md#stage-c--planning), [planning and crew](planning-and-crew.md) |
| 17 | **Two owners of feature integration, two wiring mechanisms** | Contradiction | The feature plan's author holds the integrator role (transferable) and acts through `feature-integrator@1`; workers' wiring needs collect into one wiring task applied once | [parallel integration](parallel-feature-integration.md), [build pipeline](build-pipeline.md#leaf--feature) |

## Runtimes, machine and environments

| # | Problem | Type | Decision | Fixed in |
|---|---|---|---|---|
| 18 | **Scheduling classes were wrong or missing:** Copilot and Cursor were wrapped in one doc but “light” in another, Codex as an agent had no class, Tier C-only machines had no rule for foreign agents, and plan pacing sat inside projects although plans are shared | Contradiction + gap | Copilot and Cursor are session-process when wrapped; Codex classed by mode; foreign agents on Tier C only stripped and only for Tier C tasks; pacing lives in the global broker | [execution capacity](execution-capacity.md#runtimes-by-cost-while-thinking), [sandbox](sandbox-and-security.md), [provider connections](provider-connections.md) |
| 19 | **The App preview had no checkout, and environments were inconsistent:** ports in two databases, Redis both shared and per environment, and `harness.start_service` used but never defined | Gap + contradiction | A persistent integration worktree fast-forwarded by the merge queue; ports leased only in `global.db`; one Redis server per project with database indexes; `harness.start_service` added to the tools | [workspace and Git](workspace-and-git.md#worktrees), [test environments](test-environments.md#starting-servers-from-a-task) |
| 20 | **Stale leftovers:** the planning table still showed the older single-Manager pipeline, `HELD` still appeared as a state, the roadmap still listed an “event log”, and three places still offered a Claude plan login | Stale | All corrected to the current decisions | [planning and crew](planning-and-crew.md), [build pipeline](build-pipeline.md#task), [roadmap](roadmap.md), [architecture](architecture.md), [provider connections](provider-connections.md) |

## Not changed, on purpose

- Squash for task → feature and a merge commit for feature → integration is intentional (per-task revert and per-feature revert), not a contradiction.
- Provisional execution-pool widths stay provisional until the capacity benchmark.
- Items explicitly marked “to measure” in [open design questions](open-design-questions.md) were not treated as defects.

[Database design](database-design.md) · [Open design questions](open-design-questions.md) · [Roadmap](roadmap.md)
