# EF Harness — Sequential Integration & Repair Plan (`combination_task.md`)

## Goal

Land every remaining isolated task branch (`task/090` through `task/200`), harvest all `16` uncommitted working-tree bugfix deltas (`008`–`079`), exclude only the `2` empty superseded Office stub branches (`162-office-pixijs-floorplan-sprites` and `164-office-animation-director-astar`), eliminate every shadow port, missing barrel export, missing package dependency, rogue raw `DatabaseSync` writer, illegal renderer Node built-in, and mock-only milestone gate, and resolve every intra-unit defect and cross-unit contract mismatch (`F-001` through `F-086`) on `C:/Users/Ayush/Desktop/ef-wt/integration` (`harness/integration`, starting from `30f2e9cb41169e3cea11f1a9946db74a5b32cfde`) in strict dependency order (`C01` through `C79`) so the final running 28-package + 3-app system behaves identically to the authoritative EF Harness architecture specifications.

## Sources read

- **PROJECT:**
  - `REPO_ROOT`: `c:/Users/Ayush/Desktop/ef harness` (`main` @ `649773097c387ae534b686ea5825f449f843aa7c`)
  - `INTEGRATION_BASE`: `harness/integration` @ `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` in `C:/Users/Ayush/Desktop/ef-wt/integration`
  - `ISOLATION`: `mixed` (`WORKTREE_ROOT = C:/Users/Ayush/Desktop/ef-wt`, `202` dirs; `BRANCH_PATTERN = task/*`, `201` branches)
  - `IMPLEMENTATION_TASK_FILE`: `IMPLEMENTATION_TASKS.md` (`Task 001`–`Task 200`)
  - `OUTPUT_PATH`: `c:/Users/Ayush/Desktop/ef harness/combination_task.md`
  - `VERIFY_COMMANDS`: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `node schema/schema-test.js`, `pnpm verify:diagrams`, `node scripts/verify-docs-diagrams.mjs`, `pnpm verify:env`, `pnpm verify:harmony`
- **AUTHORITY_ORDER:** (1) `schema/*.sql` + `schema/schema-test.js` + `architecture-deep-review.md` -> (2) `database-design.md`, `kernel-schema-and-protocol.md`, `open-design-questions.md` -> (3) `architecture-audit-response.md`, `architecture-review-decisions.md` -> (4) `architecture.md`, `build-pipeline.md`, `roadmap.md`, and topic `.md`/`.mmd` files (later revisions beat earlier ones) -> (5) `research/*.md`, `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json` -> (6) `IMPLEMENTATION_TASKS.md` -> (7) `.agent-handoffs/task-NNN.md` -> (8) task branch code. (`0` unresolvable contradictions exist after applying `AUTHORITY_ORDER`, so `Blockers` is omitted.)
- **Root Architecture & Decision Docs (54):** `CONTRIBUTING_AGENTS.md`, `IMPLEMENTATION_TASKS.md`, `README.md`, `agent-graph-routing.md`, `agent-handoffs.md`, `agent-runtime-adapters.md`, `app-shell-and-governor.md`, `architecture-audit-response.md`, `architecture-deep-review.md`, `architecture-ideas.md`, `architecture-review-decisions.md`, `architecture.md`, `brownfield-discovery.md`, `build-cockpit.md`, `build-pipeline.md`, `completeness-gate.md`, `coordinator-and-recovery.md`, `database-design.md`, `desktop-app.md`, `discovery-depth-and-catalog.md`, `editor-coexistence.md`, `execution-capacity.md`, `external-intake.md`, `interactive-architecture.md`, `investigations-and-sweeps.md`, `kernel-schema-and-protocol.md`, `knowledge-database.md`, `knowledge-slicing.md`, `linked-architecture-revisions.md`, `linked-graphs-design.md`, `meta-lab.md`, `office-view.md`, `open-design-questions.md`, `opening-prompts.md`, `parallel-feature-integration.md`, `planning-and-crew.md`, `project-discovery.md`, `projects-portability-and-sync.md`, `prompt-contracts.md`, `provider-connections.md`, `roadmap.md`, `routing-design.md`, `sandbox-and-security.md`, `ship-and-deploy.md`, `spec-expansion.md`, `stops-undo-and-reentry.md`, `task-and-skill-architecture.md`, `test-environments.md`, `ui-design-system.md`, `v1-knowledge-corpus.md`, `verification-and-isolation.md`, `verification-for-real-apps.md`, `worker-loop.md`, `workspace-and-git.md`.
- **Editable Mermaid Diagrams (32):** `adaptive-question-selection.mmd`, `agent-graph-routing.mmd`, `agent-handoffs.mmd`, `build-pipeline.mmd`, `cockpit-and-office.mmd`, `completeness-gate.mmd`, `database-design.mmd`, `desktop-app.mmd`, `dictation-and-canvas.mmd`, `discovery-depth-and-catalog.mmd`, `editor-coexistence.mmd`, `ef-harness-complete.mmd`, `harness-architecture.mmd`, `investigations-and-sweeps.mmd`, `knowledge-database.mmd`, `knowledge-slicing.mmd`, `linked-architecture-revisions.mmd`, `meta-lab.mmd`, `mid-build-messages.mmd`, `onboarding-providers-and-runtimes.mmd`, `parallel-feature-integration.mmd`, `planning-and-crew.mmd`, `projects-portability-and-sync.mmd`, `requirements-and-agent-routing.mmd`, `sandbox-and-security.mmd`, `ship-and-deploy.mmd`, `spec-expansion.mmd`, `stops-undo-and-reentry.mmd`, `task-and-skill-architecture.mmd`, `ui-design-system.mmd`, `verification-for-real-apps.mmd`, `workspace-git-and-brownfield.mmd`.
- **Executable SQL Schemas (6):** `schema/code-index.sql`, `schema/global.sql`, `schema/queries.sql`, `schema/schema-test.js`, `schema/state.sql`, `schema/telemetry.sql`.
- **Research Evidence (30):** `research/README.md`, `research/agent-control-protocols.md`, `research/assembly-line-pipeline.md`, `research/brownfield-repo-understanding.md`, `research/ci-and-deployment.md`, `research/coexistence-undo-and-reentry.md`, `research/context-slicing.md`, `research/debugging-and-codemods.md`, `research/desktop-app-shell.md`, `research/dictation-and-interactive-canvas.md`, `research/evaluating-prompts-and-skills.md`, `research/git-worktrees-and-workspaces.md`, `research/intake-and-assets.md`, `research/kernel-storage-and-ipc.md`, `research/knowledge-db-consistency.md`, `research/office-view-prior-art.md`, `research/planning-and-crew-scheduling.md`, `research/portability-and-sync.md`, `research/provider-subscriptions.md`, `research/question-catalog-and-depth.md`, `research/sandbox-capacity-on-windows.md`, `research/shell-and-hardware.md`, `research/spec-expansion.md`, `research/sqlite-database-engineering.md`, `research/static-completeness-checks.md`, `research/test-environments-on-windows.md`, `research/testing-real-apps.md`, `research/ui-consistency-and-preview.md`, `research/windows-sandboxing.md`, `research/worker-loop-and-edits.md`.
- **Skills, Benchmarks & Workspace Configs:** `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`, `stack-manifest.json`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `scripts/layers.mjs`, `scripts/harmony-lib.mjs`, `IMPLEMENTATION_TASKS.md`.

## Inventory

- **Baseline & Already-Landed Range:** `Task 001` is frozen on `main` (`6497730`) underneath `harness/integration` (`30f2e9c`). Tasks `002` through `089` are mechanically merged on `harness/integration` via `integrate: Task NNN <slug>` commits, PLUS `16` dirty worktrees (`008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079`) holding critical uncommitted bugfix diffs that MUST be applied (`C03`–`C30`). Tasks `090` through `200` (`112` branches including `162` & `164` pairs) are unmerged.

### Complete Branch & Worktree Allocation (`201 / 201` `task/*` Branches + `Task 001` Baseline)

| Task | Branch | Tip SHA | Worktree | Status on `harness/integration` | Uncommitted Delta | Assigned Combination Task |
| --- | --- | --- | --- | --- | --- | --- |
| `001` | `main` | `6497730` | `c:/Users/Ayush/Desktop/ef harness` | Ancestor (Baseline) | Clean (audit docs untracked only) | `C01` (DAG verification) |
| `002` | `task/002-spike-node-sqlite-electron` | `c117ff2` | `C:/Users/Ayush/Desktop/ef-wt/task-002-spike-node-sqlite-electron` | Merged ancestor | Clean | `C01` |
| `003` | `task/003-spike-windows-sandbox` | `2938e90` | `C:/Users/Ayush/Desktop/ef-wt/task-003-spike-windows-sandbox` | Merged ancestor | Clean | `C01` |
| `004` | `task/004-spike-execution-capacity` | `a1d3a28` | `C:/Users/Ayush/Desktop/ef-wt/task-004-spike-execution-capacity` | Merged ancestor | Clean | `C01` |
| `005` | `task/005-spike-test-services-windows` | `7c3a952` | `C:/Users/Ayush/Desktop/ef-wt/task-005-spike-test-services-windows` | Merged ancestor | Clean | `C02` |
| `006` | `task/006-spike-foreign-runtimes` | `ed8b0b2` | `C:/Users/Ayush/Desktop/ef-wt/task-006-spike-foreign-runtimes` | Merged ancestor | Clean | `C02` |
| `007` | `task/007-canonical-hashing-ids` | `baed849` | `C:/Users/Ayush/Desktop/ef-wt/task-007-canonical-hashing-ids` | Merged ancestor | Clean | `C02` |
| `008` | `task/008-core-packet-schemas` | `9853d46` | `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas` | Merged ancestor | 2 files (`packages/shared-contracts/src/packets/receipt.ts`, `packages/shared-contracts/tests/packets/checkpoint.test.ts`) | `C03` |
| `009` | `task/009-prompt-contract-schemas` | `3d7784d` | `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas` | Merged ancestor | 3 files (`packages/shared-contracts/src/prompts/common.ts`, `packages/shared-contracts/src/prompts/schemas/execution.ts`, ...) | `C03` |
| `010` | `task/010-closed-vocabularies` | `d45eb68` | `C:/Users/Ayush/Desktop/ef-wt/task-010-closed-vocabularies` | Merged ancestor | Clean | `C04` |
| `011` | `task/011-logger-tracer-redactor` | `f754213` | `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor` | Merged ancestor | 5 files (`.agent-handoffs/task-011.md`, `packages/shared-contracts/src/telemetry/redactor.ts`, ...) | `C04` |
| `012` | `task/012-sqlite-driver-wrapper` | `51c90de` | `C:/Users/Ayush/Desktop/ef-wt/task-012-sqlite-driver-wrapper` | Merged ancestor | Clean | `C05` |
| `013` | `task/013-state-db-bootstrap-safemode` | `7baa1b6` | `C:/Users/Ayush/Desktop/ef-wt/task-013-state-db-bootstrap-safemode` | Merged ancestor | Clean | `C05` |
| `014` | `task/014-global-telemetry-codeindex-dbs` | `e4c80c0` | `C:/Users/Ayush/Desktop/ef-wt/task-014-global-telemetry-codeindex-dbs` | Merged ancestor | Clean | `C05` |
| `015` | `task/015-db-migration-engine` | `0ddc371` | `C:/Users/Ayush/Desktop/ef-wt/task-015-db-migration-engine` | Merged ancestor | Clean | `C06` |
| `016` | `task/016-backups-corruption-recovery` | `b674e4a` | `C:/Users/Ayush/Desktop/ef-wt/task-016-backups-corruption-recovery` | Merged ancestor | Clean | `C06` |
| `017` | `task/017-knowledge-graph-repo` | `a6ef07d` | `C:/Users/Ayush/Desktop/ef-wt/task-017-knowledge-graph-repo` | Merged ancestor | Clean | `C07` |
| `018` | `task/018-fts5-knowledge-search` | `baee148` | `C:/Users/Ayush/Desktop/ef-wt/task-018-fts5-knowledge-search` | Merged ancestor | Clean | `C07` |
| `019` | `task/019-name-registry-hygiene` | `cea291d` | `C:/Users/Ayush/Desktop/ef-wt/task-019-name-registry-hygiene` | Merged ancestor | Clean | `C07` |
| `020` | `task/020-task-claiming-leases-sleep-guard` | `336e7e5` | `C:/Users/Ayush/Desktop/ef-wt/task-020-task-claiming-leases-sleep-guard` | Merged ancestor | Clean | `C08` |
| `021` | `task/021-holds-submissions-fencing` | `4f5c3f6` | `C:/Users/Ayush/Desktop/ef-wt/task-021-holds-submissions-fencing` | Merged ancestor | Clean | `C08` |
| `022` | `task/022-feature-project-lifecycles` | `a3c8977` | `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles` | Merged ancestor | 2 files (`packages/db/src/lifecycles/done.ts`, `packages/db/src/lifecycles/repo.ts`) | `C08` |
| `023` | `task/023-budget-reservation-ledger` | `96649df` | `C:/Users/Ayush/Desktop/ef-wt/task-023-budget-reservation-ledger` | Merged ancestor | Clean | `C09` |
| `024` | `task/024-cross-db-grant-protocol` | `e16d754` | `C:/Users/Ayush/Desktop/ef-wt/task-024-cross-db-grant-protocol` | Merged ancestor | Clean | `C09` |
| `025` | `task/025-idempotency-group-commit` | `b0a731a` | `C:/Users/Ayush/Desktop/ef-wt/task-025-idempotency-group-commit` | Merged ancestor | Clean | `C09` |
| `026` | `task/026-transactional-outbox` | `ce1ab76` | `C:/Users/Ayush/Desktop/ef-wt/task-026-transactional-outbox` | Merged ancestor | Clean | `C10` |
| `027` | `task/027-read-models-rollups-drift` | `a95c149` | `C:/Users/Ayush/Desktop/ef-wt/task-027-read-models-rollups-drift` | Merged ancestor | Clean | `C10` |
| `028` | `task/028-cas-artifact-store-gc` | `49ff155` | `C:/Users/Ayush/Desktop/ef-wt/task-028-cas-artifact-store-gc` | Merged ancestor | Clean | `C11` |
| `029` | `task/029-seekable-logs-retention-archive` | `e289bb9` | `C:/Users/Ayush/Desktop/ef-wt/task-029-seekable-logs-retention-archive` | Merged ancestor | Clean | `C11` |
| `030` | `task/030-secret-purge-engine` | `71bacaa` | `C:/Users/Ayush/Desktop/ef-wt/task-030-secret-purge-engine` | Merged ancestor | Clean | `C11` |
| `031` | `task/031-named-pipe-ipc-transport` | `e23f4fe` | `C:/Users/Ayush/Desktop/ef-wt/task-031-named-pipe-ipc-transport` | Merged ancestor | Clean | `C12` |
| `032` | `task/032-ipc-event-stream-resync` | `2117d11` | `C:/Users/Ayush/Desktop/ef-wt/task-032-ipc-event-stream-resync` | Merged ancestor | Clean | `C12` |
| `033` | `task/033-binary-artifact-streaming` | `6dfa32b` | `C:/Users/Ayush/Desktop/ef-wt/task-033-binary-artifact-streaming` | Merged ancestor | Clean | `C13` |
| `034` | `task/034-m0-deterministic-sim-exit-gate` | `15c4663` | `C:/Users/Ayush/Desktop/ef-wt/task-034-m0-deterministic-sim-exit-gate` | Merged ancestor | Clean | `C13` |
| `035` | `task/035-mingit-wrapper-folder-states` | `33895fd` | `C:/Users/Ayush/Desktop/ef-wt/task-035-mingit-wrapper-folder-states` | Merged ancestor | Clean | `C14` |
| `036` | `task/036-git-safety-scanner` | `5872b0a` | `C:/Users/Ayush/Desktop/ef-wt/task-036-git-safety-scanner` | Merged ancestor | Clean | `C14` |
| `037` | `task/037-temp-index-snapshots` | `fe092d2` | `C:/Users/Ayush/Desktop/ef-wt/task-037-temp-index-snapshots` | Merged ancestor | Clean | `C14` |
| `038` | `task/038-worktree-slot-manager` | `04aa278` | `C:/Users/Ayush/Desktop/ef-wt/task-038-worktree-slot-manager` | Merged ancestor | Clean | `C15` |
| `039` | `task/039-branch-ref-leases-cas` | `68c4d3f` | `C:/Users/Ayush/Desktop/ef-wt/task-039-branch-ref-leases-cas` | Merged ancestor | Clean | `C15` |
| `040` | `task/040-windows-job-objects` | `ddcffc7` | `C:/Users/Ayush/Desktop/ef-wt/task-040-windows-job-objects` | Merged ancestor | Clean | `C16` |
| `041` | `task/041-sandbox-tier-a-mxc` | `bca08dd` | `C:/Users/Ayush/Desktop/ef-wt/task-041-sandbox-tier-a-mxc` | Merged ancestor | Clean | `C16` |
| `042` | `task/042-sandbox-tier-b-users` | `1b8a413` | `C:/Users/Ayush/Desktop/ef-wt/task-042-sandbox-tier-b-users` | Merged ancestor | Clean | `C16` |
| `043` | `task/043-sandbox-tier-c-d-selector` | `4337b83` | `C:/Users/Ayush/Desktop/ef-wt/task-043-sandbox-tier-c-d-selector` | Merged ancestor | Clean | `C17` |
| `044` | `task/044-loopback-allowlist-proxy` | `d534d12` | `C:/Users/Ayush/Desktop/ef-wt/task-044-loopback-allowlist-proxy` | Merged ancestor | Clean | `C17` |
| `045` | `task/045-secure-doc-fetcher` | `d26eee9` | `C:/Users/Ayush/Desktop/ef-wt/task-045-secure-doc-fetcher` | Merged ancestor | Clean | `C17` |
| `046` | `task/046-supply-chain-installer` | `b27a210` | `C:/Users/Ayush/Desktop/ef-wt/task-046-supply-chain-installer` | Merged ancestor | Clean | `C18` |
| `047` | `task/047-harness-run-engine` | `c559222` | `C:/Users/Ayush/Desktop/ef-wt/task-047-harness-run-engine` | Merged ancestor | Clean | `C18` |
| `048` | `task/048-attempt-mcp-server` | `954622c` | `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server` | Merged ancestor | 3 files (`packages/mcp-server/src/scope.ts`, `packages/mcp-server/src/server.ts`, ...) | `C18` |
| `049` | `task/049-test-env-orchestrator-core` | `cc26926` | `C:/Users/Ayush/Desktop/ef-wt/task-049-test-env-orchestrator-core` | Merged ancestor | Clean | `C19` |
| `050` | `task/050-native-backing-services` | `57eca20` | `C:/Users/Ayush/Desktop/ef-wt/task-050-native-backing-services` | Merged ancestor | Clean | `C19` |
| `051` | `task/051-oauth-stripe-mocks-port-fallback` | `9c562b8` | `C:/Users/Ayush/Desktop/ef-wt/task-051-oauth-stripe-mocks-port-fallback` | Merged ancestor | Clean | `C20` |
| `052` | `task/052-template-db-synthetic-data` | `1c3bb83` | `C:/Users/Ayush/Desktop/ef-wt/task-052-template-db-synthetic-data` | Merged ancestor | Clean | `C20` |
| `053` | `task/053-worker-loop-provider-protocols` | `445b340` | `C:/Users/Ayush/Desktop/ef-wt/task-053-worker-loop-provider-protocols` | Merged ancestor | 8 files (`packages/worker-loop/src/protocols/errors.ts`, `packages/worker-loop/src/protocols/openai-compatible-chat.ts`, ...) | `C21` |
| `054` | `task/054-worker-loop-context-compaction` | `f62475b` | `C:/Users/Ayush/Desktop/ef-wt/task-054-worker-loop-context-compaction` | Merged ancestor | Clean | `C21` |
| `055` | `task/055-worker-loop-tool-shrinker` | `460527d` | `C:/Users/Ayush/Desktop/ef-wt/task-055-worker-loop-tool-shrinker` | Merged ancestor | Clean | `C21` |
| `056` | `task/056-worker-loop-edit-applier` | `42aafc7` | `C:/Users/Ayush/Desktop/ef-wt/task-056-worker-loop-edit-applier` | Merged ancestor | 5 files (`packages/worker-loop/src/edits/dispatcher.ts`, `packages/worker-loop/src/edits/parse-apply-patch.ts`, ...) | `C22` |
| `057` | `task/057-worker-loop-executor-checkpoints` | `a3e3d60` | `C:/Users/Ayush/Desktop/ef-wt/task-057-worker-loop-executor-checkpoints` | Merged ancestor | 7 files (`packages/worker-loop/src/executor/guards.ts`, `packages/worker-loop/src/executor/index.ts`, ...) | `C22` |
| `058` | `task/058-static-audit-scanners-p1` | `71ea882` | `C:/Users/Ayush/Desktop/ef-wt/task-058-static-audit-scanners-p1` | Merged ancestor | 3 files (`packages/completeness-gate/src/ast-scanners/dead-controls.ts`, `packages/completeness-gate/src/ast-scanners/stubs.ts`, ...) | `C23` |
| `059` | `task/059-static-audit-scanners-p2` | `b6e79b2` | `C:/Users/Ayush/Desktop/ef-wt/task-059-static-audit-scanners-p2` | Merged ancestor | 4 files (`packages/completeness-gate/src/gate/check-reachability.ts`, `packages/completeness-gate/src/gate/check-scope.ts`, ...) | `C23` |
| `060` | `task/060-clean-verifier-harness` | `a06d371` | `C:/Users/Ayush/Desktop/ef-wt/task-060-clean-verifier-harness` | Merged ancestor | Clean | `C23` |
| `061` | `task/061-red-before-green-blind-binder` | `cc176e3` | `C:/Users/Ayush/Desktop/ef-wt/task-061-red-before-green-blind-binder` | Merged ancestor | 3 files (`packages/verifier/src/binder/adapter-audit.ts`, `packages/verifier/src/binder/containment.ts`, ...) | `C24` |
| `062` | `task/062-ui-interaction-contract-verifier` | `fe62a40` | `C:/Users/Ayush/Desktop/ef-wt/task-062-ui-interaction-contract-verifier` | Merged ancestor | 3 files (`packages/verifier/src/ui-contract/verifier.ts`, `packages/verifier/tests/ui-contract/fixture-server.ts`, ...) | `C24` |
| `063` | `task/063-multi-surface-verifiers` | `9b455fd` | `C:/Users/Ayush/Desktop/ef-wt/task-063-multi-surface-verifiers` | Merged ancestor | 3 files (`packages/verifier/src/surfaces/migration-preservation-verifier.ts`, `packages/verifier/src/surfaces/schemas.ts`, ...) | `C24` |
| `064` | `task/064-ai-eval-property-mutation-probes` | `3a84cad` | `C:/Users/Ayush/Desktop/ef-wt/task-064-ai-eval-property-mutation-probes` | Merged ancestor | 2 files (`packages/verifier/src/advanced/boundary-mutation-prober.ts`, `packages/verifier/tests/advanced/boundary-mutation-prober.test.ts`) | `C25` |
| `065` | `task/065-hint-ladder-dispute-routing` | `9f0c374` | `C:/Users/Ayush/Desktop/ef-wt/task-065-hint-ladder-dispute-routing` | Merged ancestor | Clean | `C25` |
| `066` | `task/066-candidate-acceptance-tx` | `f68afb3` | `C:/Users/Ayush/Desktop/ef-wt/task-066-candidate-acceptance-tx` | Merged ancestor | 3 files (`packages/verifier/src/acceptance/coordinator.ts`, `packages/verifier/src/acceptance/rule-scope.ts`, ...) | `C25` |
| `067` | `task/067-m1-daemon-minimal-viewer` | `d1109c7` | `C:/Users/Ayush/Desktop/ef-wt/task-067-m1-daemon-minimal-viewer` | Merged ancestor | Clean | `C26` |
| `068` | `task/068-m1-kitchen-exit-gate` | `76f8a9c` | `C:/Users/Ayush/Desktop/ef-wt/task-068-m1-kitchen-exit-gate` | Merged ancestor | Clean | `C26` |
| `069` | `task/069-discovery-core-opening-rubrics` | `0df0a18` | `C:/Users/Ayush/Desktop/ef-wt/task-069-discovery-core-opening-rubrics` | Merged ancestor | Clean | `C27` |
| `070` | `task/070-discovery-prompts-quote-verifier` | `326728d` | `C:/Users/Ayush/Desktop/ef-wt/task-070-discovery-prompts-quote-verifier` | Merged ancestor | Clean | `C27` |
| `071` | `task/071-entailment-derivations-reopening` | `2c91b46` | `C:/Users/Ayush/Desktop/ef-wt/task-071-entailment-derivations-reopening` | Merged ancestor | Clean | `C27` |
| `072` | `task/072-adaptive-question-selector` | `7f8f233` | `C:/Users/Ayush/Desktop/ef-wt/task-072-adaptive-question-selector` | Merged ancestor | Clean | `C28` |
| `073` | `task/073-discovery-depth-controls` | `47801e2` | `C:/Users/Ayush/Desktop/ef-wt/task-073-discovery-depth-controls` | Merged ancestor | Clean | `C28` |
| `074` | `task/074-honest-readiness-calculator` | `27758b5` | `C:/Users/Ayush/Desktop/ef-wt/task-074-honest-readiness-calculator` | Merged ancestor | Clean | `C28` |
| `075` | `task/075-corpus-loader-core-data-auth` | `db21117` | `C:/Users/Ayush/Desktop/ef-wt/task-075-corpus-loader-core-data-auth` | Merged ancestor | Clean | `C29` |
| `076` | `task/076-corpus-web-api-cli-elaborations` | `8764a25` | `C:/Users/Ayush/Desktop/ef-wt/task-076-corpus-web-api-cli-elaborations` | Merged ancestor | Clean | `C29` |
| `077` | `task/077-cross-cutting-rules-seams-tags` | `b73f44c` | `C:/Users/Ayush/Desktop/ef-wt/task-077-cross-cutting-rules-seams-tags` | Merged ancestor | Clean | `C29` |
| `078` | `task/078-skill-vetting-quarantine-catalog` | `404d945` | `C:/Users/Ayush/Desktop/ef-wt/task-078-skill-vetting-quarantine-catalog` | Merged ancestor | Clean | `C30` |
| `079` | `task/079-spec-matrix-generators` | `f19582e` | `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators` | Merged ancestor | 4 files (`packages/spec-expansion/src/generators/collapse.ts`, `packages/spec-expansion/src/generators/enumerate.ts`, ...) | `C31` |
| `080` | `task/080-spec-cell-filler-proposed-review` | `0f5e3d9` | `C:/Users/Ayush/Desktop/ef-wt/task-080-spec-cell-filler-proposed-review` | Merged ancestor | Clean | `C31` |
| `081` | `task/081-five-layer-contradiction-checker` | `24fe966` | `C:/Users/Ayush/Desktop/ef-wt/task-081-five-layer-contradiction-checker` | Merged ancestor | Clean | `C31` |
| `082` | `task/082-research-engine-api-verifier` | `a6d8908` | `C:/Users/Ayush/Desktop/ef-wt/task-082-research-engine-api-verifier` | Merged ancestor | Clean | `C32` |
| `083` | `task/083-system-architecture-synthesizer` | `e753d6f` | `C:/Users/Ayush/Desktop/ef-wt/task-083-system-architecture-synthesizer` | Merged ancestor | Clean | `C32` |
| `084` | `task/084-feature-architecture-wireframes` | `8ce7ede` | `C:/Users/Ayush/Desktop/ef-wt/task-084-feature-architecture-wireframes` | Merged ancestor | Clean | `C32` |
| `085` | `task/085-knowledge-views-exporter` | `b104c7b` | `C:/Users/Ayush/Desktop/ef-wt/task-085-knowledge-views-exporter` | Merged ancestor | Clean | `C33` |
| `086` | `task/086-markdown-direct-edit-importer` | `8adf0a5` | `C:/Users/Ayush/Desktop/ef-wt/task-086-markdown-direct-edit-importer` | Merged ancestor | Clean | `C33` |
| `087` | `task/087-hybrid-revision-impact-engine` | `a1e4945` | `C:/Users/Ayush/Desktop/ef-wt/task-087-hybrid-revision-impact-engine` | Merged ancestor | Clean | `C33` |
| `088` | `task/088-knowledge-packet-slicer` | `c8cf1f8` | `C:/Users/Ayush/Desktop/ef-wt/task-088-knowledge-packet-slicer` | Merged ancestor | Clean | `C34` |
| `089` | `task/089-rule-matching-pull-to-push` | `cde3a46` | `C:/Users/Ayush/Desktop/ef-wt/task-089-rule-matching-pull-to-push` | Merged ancestor | Clean | `C34` |
| `090` | `task/090-master-planner-wave-budgets` | `b6b1e95` | `C:/Users/Ayush/Desktop/ef-wt/task-090-master-planner-wave-budgets` | Unmerged | Clean | `C37` |
| `091` | `task/091-feature-planner-sealed-oracles` | `c779647` | `C:/Users/Ayush/Desktop/ef-wt/task-091-feature-planner-sealed-oracles` | Unmerged | Clean | `C37` |
| `092` | `task/092-deterministic-graph-compiler` | `95d6eb5` | `C:/Users/Ayush/Desktop/ef-wt/task-092-deterministic-graph-compiler` | Unmerged | Clean | `C37` |
| `093` | `task/093-phase0-controller-gate0` | `1d460bd` | `C:/Users/Ayush/Desktop/ef-wt/task-093-phase0-controller-gate0` | Unmerged | Clean | `C38` |
| `094` | `task/094-ui-design-system-pipeline` | `0e553ab` | `C:/Users/Ayush/Desktop/ef-wt/task-094-ui-design-system-pipeline` | Unmerged | Clean | `C38` |
| `095` | `task/095-sequential-task-dispatcher` | `769e91a` | `C:/Users/Ayush/Desktop/ef-wt/task-095-sequential-task-dispatcher` | Unmerged | Clean | `C38` |
| `096` | `task/096-feature-integrator-engine` | `f69c07d` | `C:/Users/Ayush/Desktop/ef-wt/task-096-feature-integrator-engine` | Unmerged | Clean | `C39` |
| `097` | `task/097-external-intake-converters` | `f41cfd0` | `C:/Users/Ayush/Desktop/ef-wt/task-097-external-intake-converters` | Unmerged | Clean | `C35` |
| `098` | `task/098-intake-chunker-openapi-importer` | `f266844` | `C:/Users/Ayush/Desktop/ef-wt/task-098-intake-chunker-openapi-importer` | Unmerged | Clean | `C35` |
| `099` | `task/099-brand-asset-sanitizer-registry` | `8c8e2f7` | `C:/Users/Ayush/Desktop/ef-wt/task-099-brand-asset-sanitizer-registry` | Unmerged | Clean | `C36` |
| `100` | `task/100-bug-har-scrubber-triage` | `74e4e4a` | `C:/Users/Ayush/Desktop/ef-wt/task-100-bug-har-scrubber-triage` | Unmerged | Clean | `C36` |
| `101` | `task/101-completion-wave-final-audit` | `8660af4` | `C:/Users/Ayush/Desktop/ef-wt/task-101-completion-wave-final-audit` | Unmerged | Clean | `C39` |
| `102` | `task/102-specialist-review-qa-prompts` | `61496c7` | `C:/Users/Ayush/Desktop/ef-wt/task-102-specialist-review-qa-prompts` | Unmerged | Clean | `C39` |
| `103` | `task/103-corpus-wave1-expanded-packs` | `1637274` | `C:/Users/Ayush/Desktop/ef-wt/task-103-corpus-wave1-expanded-packs` | Unmerged | Clean | `C30` |
| `104` | `task/104-corpus-wave2-packs-14-skills` | `c02800d` | `C:/Users/Ayush/Desktop/ef-wt/task-104-corpus-wave2-packs-14-skills` | Unmerged | Clean | `C30` |
| `105` | `task/105-m2-kitchen-exit-gate` | `f8e06c0` | `C:/Users/Ayush/Desktop/ef-wt/task-105-m2-kitchen-exit-gate` | Unmerged | Clean | `C41` |
| `106` | `task/106-crew-levels-expected-cost` | `279569d` | `C:/Users/Ayush/Desktop/ef-wt/task-106-crew-levels-expected-cost` | Unmerged | Clean | `C40` |
| `107` | `task/107-heft-scheduler-crew-presets` | `3f1744a` | `C:/Users/Ayush/Desktop/ef-wt/task-107-heft-scheduler-crew-presets` | Unmerged | Clean | `C40` |
| `108` | `task/108-plan-preview-autostart-gate` | `95c9260` | `C:/Users/Ayush/Desktop/ef-wt/task-108-plan-preview-autostart-gate` | Unmerged | Clean | `C41` |
| `109` | `task/109-artifact-handoff-mailbox-engine` | `989041d` | `C:/Users/Ayush/Desktop/ef-wt/task-109-artifact-handoff-mailbox-engine` | Unmerged | Clean | `C42` |
| `110` | `task/110-parallel-feature-branches-migrations` | `08a8f36` | `C:/Users/Ayush/Desktop/ef-wt/task-110-parallel-feature-branches-migrations` | Unmerged | Clean | `C42` |
| `111` | `task/111-project-merge-queue-integrator` | `72b37e6` | `C:/Users/Ayush/Desktop/ef-wt/task-111-project-merge-queue-integrator` | Unmerged | Clean | `C43` |
| `112` | `task/112-contract-change-request-pipeline` | `5ed8f81` | `C:/Users/Ayush/Desktop/ef-wt/task-112-contract-change-request-pipeline` | Unmerged | Clean | `C43` |
| `113` | `task/113-message-sequencing-intent-router` | `4c86c46` | `C:/Users/Ayush/Desktop/ef-wt/task-113-message-sequencing-intent-router` | Unmerged | Clean | `C44` |
| `114` | `task/114-four-route-steering-dispatcher` | `05609eb` | `C:/Users/Ayush/Desktop/ef-wt/task-114-four-route-steering-dispatcher` | Unmerged | Clean | `C44` |
| `115` | `task/115-multi-interpretation-hold-engine` | `2c95cd8` | `C:/Users/Ayush/Desktop/ef-wt/task-115-multi-interpretation-hold-engine` | Unmerged | Clean | `C45` |
| `116` | `task/116-shared-question-queue-arbiter` | `2370d7a` | `C:/Users/Ayush/Desktop/ef-wt/task-116-shared-question-queue-arbiter` | Unmerged | Clean | `C45` |
| `117` | `task/117-governor-windows-telemetry` | `dcee682` | `C:/Users/Ayush/Desktop/ef-wt/task-117-governor-windows-telemetry` | Unmerged | Clean | `C46` |
| `118` | `task/118-governor-hysteresis-footprints` | `865cae2` | `C:/Users/Ayush/Desktop/ef-wt/task-118-governor-hysteresis-footprints` | Unmerged | Clean | `C46` |
| `119` | `task/119-three-pool-capacity-scheduler` | `b9a1b25` | `C:/Users/Ayush/Desktop/ef-wt/task-119-three-pool-capacity-scheduler` | Unmerged | Clean | `C46` |
| `120` | `task/120-dpapi-secrets-vault-env-injection` | `f1fad0a` | `C:/Users/Ayush/Desktop/ef-wt/task-120-dpapi-secrets-vault-env-injection` | Unmerged | Clean | `C47` |
| `121` | `task/121-human-step-probing-verification` | `f8fb5d0` | `C:/Users/Ayush/Desktop/ef-wt/task-121-human-step-probing-verification` | Unmerged | Clean | `C47` |
| `122` | `task/122-single-app-shell-framework` | `2c6aeff` | `C:/Users/Ayush/Desktop/ef-wt/task-122-single-app-shell-framework` | Unmerged | Clean | `C48` |
| `123` | `task/123-phase-presets-popout-windows` | `7a522a6` | `C:/Users/Ayush/Desktop/ef-wt/task-123-phase-presets-popout-windows` | Unmerged | Clean | `C48` |
| `124` | `task/124-board-cockpit-seven-lanes` | `3bb233b` | `C:/Users/Ayush/Desktop/ef-wt/task-124-board-cockpit-seven-lanes` | Unmerged | Clean | `C49` |
| `125` | `task/125-board-health-signals-explainer` | `20d6ff1` | `C:/Users/Ayush/Desktop/ef-wt/task-125-board-health-signals-explainer` | Unmerged | Clean | `C49` |
| `126` | `task/126-worker-inspector-panel` | `3dce5cd` | `C:/Users/Ayush/Desktop/ef-wt/task-126-worker-inspector-panel` | Unmerged | Clean | `C50` |
| `127` | `task/127-calm-notification-inbox-ui` | `5b91291` | `C:/Users/Ayush/Desktop/ef-wt/task-127-calm-notification-inbox-ui` | Unmerged | Clean | `C50` |
| `128` | `task/128-budget-winddown-stop-card-wip` | `a8ca2fd` | `C:/Users/Ayush/Desktop/ef-wt/task-128-budget-winddown-stop-card-wip` | Unmerged | Clean | `C50` |
| `129` | `task/129-planned-feature-undo-engine` | `94ca48c` | `C:/Users/Ayush/Desktop/ef-wt/task-129-planned-feature-undo-engine` | Unmerged | Clean | `C43` |
| `130` | `task/130-reentry-reconciliation-welcome-back` | `a92052c` | `C:/Users/Ayush/Desktop/ef-wt/task-130-reentry-reconciliation-welcome-back` | Unmerged | Clean | `C45` |
| `131` | `task/131-electron-desktop-lifecycle` | `304c4e7` | `C:/Users/Ayush/Desktop/ef-wt/task-131-electron-desktop-lifecycle` | Unmerged | Clean | `C51` |
| `132` | `task/132-component-downloader-park-updater` | `f89dbc1` | `C:/Users/Ayush/Desktop/ef-wt/task-132-component-downloader-park-updater` | Unmerged | Clean | `C51` |
| `133` | `task/133-diagnostics-health-bundle-exporter` | `ab4387b` | `C:/Users/Ayush/Desktop/ef-wt/task-133-diagnostics-health-bundle-exporter` | Unmerged | Clean | `C51` |
| `134` | `task/134-m3-parallel-exit-gate` | `7f37eee` | `C:/Users/Ayush/Desktop/ef-wt/task-134-m3-parallel-exit-gate` | Unmerged | Clean | `C52` |
| `135` | `task/135-signed-provider-policy-engine` | `e6934db` | `C:/Users/Ayush/Desktop/ef-wt/task-135-signed-provider-policy-engine` | Unmerged | Clean | `C53` |
| `136` | `task/136-api-key-onboarding-pricing` | `80e6ae8` | `C:/Users/Ayush/Desktop/ef-wt/task-136-api-key-onboarding-pricing` | Unmerged | Clean | `C53` |
| `137` | `task/137-sign-in-with-chatgpt-oauth` | `8ffeebd` | `C:/Users/Ayush/Desktop/ef-wt/task-137-sign-in-with-chatgpt-oauth` | Unmerged | Clean | `C53` |
| `138` | `task/138-openrouter-oauth-local-models` | `01daab9` | `C:/Users/Ayush/Desktop/ef-wt/task-138-openrouter-oauth-local-models` | Unmerged | Clean | `C54` |
| `139` | `task/139-copilot-cursor-subscription-auth` | `7475bf8` | `C:/Users/Ayush/Desktop/ef-wt/task-139-copilot-cursor-subscription-auth` | Unmerged | Clean | `C54` |
| `140` | `task/140-broker-allowance-pacing-aimd` | `ab3b334` | `C:/Users/Ayush/Desktop/ef-wt/task-140-broker-allowance-pacing-aimd` | Unmerged | Clean | `C54` |
| `141` | `task/141-no-silent-fallback-connections-ui` | `7067800` | `C:/Users/Ayush/Desktop/ef-wt/task-141-no-silent-fallback-connections-ui` | Unmerged | Clean | `C55` |
| `142` | `task/142-runtime-adapter-core-supervision` | `e50d00a` | `C:/Users/Ayush/Desktop/ef-wt/task-142-runtime-adapter-core-supervision` | Unmerged | Clean | `C55` |
| `143` | `task/143-generic-acp-adapter` | `4ff2425` | `C:/Users/Ayush/Desktop/ef-wt/task-143-generic-acp-adapter` | Unmerged | Clean | `C56` |
| `144` | `task/144-codex-runtime-adapter` | `2a84057` | `C:/Users/Ayush/Desktop/ef-wt/task-144-codex-runtime-adapter` | Unmerged | Clean | `C56` |
| `145` | `task/145-copilot-runtime-adapter` | `5f2d8c7` | `C:/Users/Ayush/Desktop/ef-wt/task-145-copilot-runtime-adapter` | Unmerged | Clean | `C56` |
| `146` | `task/146-cursor-runtime-adapter` | `b6c107e` | `C:/Users/Ayush/Desktop/ef-wt/task-146-cursor-runtime-adapter` | Unmerged | Clean | `C57` |
| `147` | `task/147-claude-code-headless-adapter` | `de69e3e` | `C:/Users/Ayush/Desktop/ef-wt/task-147-claude-code-headless-adapter` | Unmerged | Clean | `C57` |
| `148` | `task/148-gemini-cli-optional-adapter` | `d200038` | `C:/Users/Ayush/Desktop/ef-wt/task-148-gemini-cli-optional-adapter` | Unmerged | Clean | `C57` |
| `149` | `task/149-opencode-acp-runtime-adapter` | `90dcdea` | `C:/Users/Ayush/Desktop/ef-wt/task-149-opencode-acp-runtime-adapter` | Unmerged | Clean | `C58` |
| `150` | `task/150-foreign-runtime-checkpoint-resume` | `2cc3418` | `C:/Users/Ayush/Desktop/ef-wt/task-150-foreign-runtime-checkpoint-resume` | Unmerged | Clean | `C58` |
| `151` | `task/151-automated-adapter-conformance-suite` | `f8b7b3f` | `C:/Users/Ayush/Desktop/ef-wt/task-151-automated-adapter-conformance-suite` | Unmerged | Clean | `C59` |
| `152` | `task/152-m4-plans-conformance-exit-gate` | `6a166dd` | `C:/Users/Ayush/Desktop/ef-wt/task-152-m4-plans-conformance-exit-gate` | Unmerged | Clean | `C59` |
| `153` | `task/153-interactive-architecture-canvas` | `f38da6d` | `C:/Users/Ayush/Desktop/ef-wt/task-153-interactive-architecture-canvas` | Unmerged | Clean | `C64` |
| `154` | `task/154-canvas-popovers-multiselection` | `cb0b77d` | `C:/Users/Ayush/Desktop/ef-wt/task-154-canvas-popovers-multiselection` | Unmerged | Clean | `C64` |
| `155` | `task/155-single-composer-state-machine` | `8405651` | `C:/Users/Ayush/Desktop/ef-wt/task-155-single-composer-state-machine` | Unmerged | Clean | `C64` |
| `156` | `task/156-canvas-box-chat-intents` | `2c03735` | `C:/Users/Ayush/Desktop/ef-wt/task-156-canvas-box-chat-intents` | Unmerged | Clean | `C65` |
| `157` | `task/157-local-whisper-dictation-engine` | `6ebcdcd` | `C:/Users/Ayush/Desktop/ef-wt/task-157-local-whisper-dictation-engine` | Unmerged | Clean | `C63` |
| `158` | `task/158-dictation-vocabulary-normalizer` | `1dd0dda` | `C:/Users/Ayush/Desktop/ef-wt/task-158-dictation-vocabulary-normalizer` | Unmerged | Clean | `C63` |
| `159` | `task/159-spec-browser-plan-tree-tabs` | `cd7bfd6` | `C:/Users/Ayush/Desktop/ef-wt/task-159-spec-browser-plan-tree-tabs` | Unmerged | Clean | `C65` |
| `160` | `task/160-live-app-preview-runner` | `82213b1` | `C:/Users/Ayush/Desktop/ef-wt/task-160-live-app-preview-runner` | Unmerged | Clean | `C66` |
| `161` | `task/161-jsx-source-plugin-point-to-fix` | `58a5508` | `C:/Users/Ayush/Desktop/ef-wt/task-161-jsx-source-plugin-point-to-fix` | Unmerged | Clean | `C66` |
| `162` | `task/162-office-pixijs-floor-sprites` | `73d1bd4` | `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floor-sprites` | Unmerged | Clean | `C67` |
| `162` | `task/162-office-pixijs-floorplan-sprites` | `6497730` | `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floorplan-sprites` | Excluded (empty at `6497730`) | `.agent-handoffs/task-162.md` only | `Excluded` |
| `163` | `task/163-office-seated-cast-tags-flows` | `e70dc27` | `C:/Users/Ayush/Desktop/ef-wt/task-163-office-seated-cast-tags-flows` | Unmerged | Clean | `C67` |
| `164` | `task/164-office-animation-director-astar` | `6497730` | `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-astar` | Excluded (empty at `6497730`) | `.agent-handoffs/task-164.md` only | `Excluded` |
| `164` | `task/164-office-animation-director-v2` | `0272a00` | `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-v2` | Unmerged | Clean | `C68` |
| `165` | `task/165-office-accessibility-auto-fallback` | `c3401c3` | `C:/Users/Ayush/Desktop/ef-wt/task-165-office-accessibility-auto-fallback` | Unmerged | Clean | `C68` |
| `166` | `task/166-brownfield-l0-repo-scanner` | `01c9d1f` | `C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-repo-scanner` | Unmerged | Clean | `C60` |
| `167` | `task/167-brownfield-l1-code-map` | `49b2404` | `C:/Users/Ayush/Desktop/ef-wt/task-167-brownfield-l1-code-map` | Unmerged | Clean | `C60` |
| `168` | `task/168-brownfield-l2-summaries` | `a9d88c3` | `C:/Users/Ayush/Desktop/ef-wt/task-168-brownfield-l2-summaries` | Unmerged | Clean | `C60` |
| `169` | `task/169-brownfield-opening-flow` | `596121a` | `C:/Users/Ayush/Desktop/ef-wt/task-169-brownfield-opening-flow` | Unmerged | Clean | `C61` |
| `170` | `task/170-brownfield-baseline-test-health` | `555e097` | `C:/Users/Ayush/Desktop/ef-wt/task-170-brownfield-baseline-test-health` | Unmerged | Clean | `C61` |
| `171` | `task/171-editor-coexistence-watcher` | `84fc19a` | `C:/Users/Ayush/Desktop/ef-wt/task-171-editor-coexistence-watcher` | Unmerged | Clean | `C62` |
| `172` | `task/172-safe-landing-engine` | `7d47942` | `C:/Users/Ayush/Desktop/ef-wt/task-172-safe-landing-engine` | Unmerged | Clean | `C62` |
| `173` | `task/173-human-fixed-it-myself` | `0583866` | `C:/Users/Ayush/Desktop/ef-wt/task-173-human-fixed-it-myself` | Unmerged | Clean | `C62` |
| `174` | `task/174-ui-consistency-pipeline` | `a885fb8` | `C:/Users/Ayush/Desktop/ef-wt/task-174-ui-consistency-pipeline` | Unmerged | Clean | `C69` |
| `175` | `task/175-m5-exit-gate` | `14d3964` | `C:/Users/Ayush/Desktop/ef-wt/task-175-m5-exit-gate` | Unmerged | Clean | `C69` |
| `176` | `task/176-external-effect-ledger` | `7b46817` | `C:/Users/Ayush/Desktop/ef-wt/task-176-external-effect-ledger` | Unmerged | Clean | `C70` |
| `177` | `task/177-github-connector-queue` | `b32f60e` | `C:/Users/Ayush/Desktop/ef-wt/task-177-github-connector-queue` | Unmerged | Clean | `C70` |
| `178` | `task/178-push-pr-ci-repair` | `3dcb870` | `C:/Users/Ayush/Desktop/ef-wt/task-178-push-pr-ci-repair` | Unmerged | Clean | `C70` |
| `179` | `task/179-deploy-adapter-vercel-docker` | `1ad270e` | `C:/Users/Ayush/Desktop/ef-wt/task-179-deploy-adapter-vercel-docker` | Unmerged | Clean | `C71` |
| `180` | `task/180-expand-contract-migrations` | `d6d7f53` | `C:/Users/Ayush/Desktop/ef-wt/task-180-expand-contract-migrations` | Unmerged | Clean | `C71` |
| `181` | `task/181-post-deploy-verify-rollback` | `53ef907` | `C:/Users/Ayush/Desktop/ef-wt/task-181-post-deploy-verify-rollback` | Unmerged | Clean | `C71` |
| `182` | `task/182-mystery-bug-investigation` | `e61ea0c` | `C:/Users/Ayush/Desktop/ef-wt/task-182-mystery-bug-investigation` | Unmerged | Clean | `C72` |
| `183` | `task/183-investigation-localization-toolkit` | `1a6730f` | `C:/Users/Ayush/Desktop/ef-wt/task-183-investigation-localization-toolkit` | Unmerged | Clean | `C72` |
| `184` | `task/184-sweep-ownership-engine` | `b2e1a1d` | `C:/Users/Ayush/Desktop/ef-wt/task-184-sweep-ownership-engine` | Unmerged | Clean | `C73` |
| `185` | `task/185-sweep-safety-guards` | `afa760f` | `C:/Users/Ayush/Desktop/ef-wt/task-185-sweep-safety-guards` | Unmerged | Clean | `C73` |
| `186` | `task/186-orphan-branch-portability` | `1a42698` | `C:/Users/Ayush/Desktop/ef-wt/task-186-orphan-branch-portability` | Unmerged | Clean | `C74` |
| `187` | `task/187-rehydrate-zip-lease` | `2e76f37` | `C:/Users/Ayush/Desktop/ef-wt/task-187-rehydrate-zip-lease` | Unmerged | Clean | `C74` |
| `188` | `task/188-global-resource-broker` | `82f90b9` | `C:/Users/Ayush/Desktop/ef-wt/task-188-global-resource-broker` | Unmerged | Clean | `C74` |
| `189` | `task/189-metalab-benchmark-registry` | `e5e794e` | `C:/Users/Ayush/Desktop/ef-wt/task-189-metalab-benchmark-registry` | Unmerged | Clean | `C75` |
| `190` | `task/190-metalab-simulated-developers` | `b950b62` | `C:/Users/Ayush/Desktop/ef-wt/task-190-metalab-simulated-developers` | Unmerged | Clean | `C75` |
| `191` | `task/191-metalab-eval-promotion` | `6bfc3f7` | `C:/Users/Ayush/Desktop/ef-wt/task-191-metalab-eval-promotion` | Unmerged | Clean | `C75` |
| `192` | `task/192-metalab-fault-injection` | `06f62c4` | `C:/Users/Ayush/Desktop/ef-wt/task-192-metalab-fault-injection` | Unmerged | Clean | `C76` |
| `193` | `task/193-metalab-red-team-suite` | `d76f749` | `C:/Users/Ayush/Desktop/ef-wt/task-193-metalab-red-team-suite` | Unmerged | Clean | `C76` |
| `194` | `task/194-architecture-review-trials` | `da32d6f` | `C:/Users/Ayush/Desktop/ef-wt/task-194-architecture-review-trials` | Unmerged | Clean | `C76` |
| `195` | `task/195-e2e-cross-milestone-suite` | `73526dc` | `C:/Users/Ayush/Desktop/ef-wt/task-195-e2e-cross-milestone-suite` | Unmerged | Clean | `C78` |
| `196` | `task/196-windows-packaging-nsis` | `d9af2d6` | `C:/Users/Ayush/Desktop/ef-wt/task-196-windows-packaging-nsis` | Unmerged | Clean | `C77` |
| `197` | `task/197-docs-diagram-consistency` | `5bf94b0` | `C:/Users/Ayush/Desktop/ef-wt/task-197-docs-diagram-consistency` | Unmerged | Clean | `C77` |
| `198` | `task/198-performance-scale-cert` | `dff302b` | `C:/Users/Ayush/Desktop/ef-wt/task-198-performance-scale-cert` | Unmerged | Clean | `C78` |
| `199` | `task/199-security-privacy-audit` | `f56f166` | `C:/Users/Ayush/Desktop/ef-wt/task-199-security-privacy-audit` | Unmerged | Clean | `C79` |
| `200` | `task/200-release-certification-gate` | `500e7bd` | `C:/Users/Ayush/Desktop/ef-wt/task-200-release-certification-gate` | Unmerged | Clean | `C79` |

### Exclusions

- **`task/162-office-pixijs-floorplan-sprites`:** Superseded empty branch at main `6497730` (`0` committed product files; only untracked `.agent-handoffs/task-162.md` with `in_progress` claim). Active implementation on `task/162-office-pixijs-floor-sprites` (`73d1bd4`), landed in `C67`.
- **`task/164-office-animation-director-astar`:** Superseded empty branch at main `6497730` (`0` committed product files; only untracked `.agent-handoffs/task-164.md` with `in_progress` claim). Active implementation on `task/164-office-animation-director-v2` (`0272a00`), landed in `C68`.

## Contract atlas

| Contract / Surface | Owner Task | Authoritative Source | Frozen Signature & Invariants |
| --- | --- | --- | --- |
| ESLint Workspace DAG (`scripts/layers.mjs`, `eslint.config.mjs`) | `C01` | `architecture.md`, `roadmap.md` | `PACKAGE_LAYOUT` keeps `[id, layer, dir]` (`layer 0..5`); `DAG_RANK` (`0..34`) enforces strict acyclic intra-tier imports (`shared-contracts:0 -> shared-observability:1 -> db:2 -> git-engine:3 -> ipc:4 -> ... -> meta-lab:28 -> apps/tests`). |
| Hashing & Typed IDs (`@ef-harness/shared-contracts`) | `C02` | `kernel-schema-and-protocol.md` | `canonicalJson(value): string`, `canonicalSha256(value): "sha256:<64-hex>"`, `toPrefixedSha256(digest)`, `toBareSha256Hex(digest)`, `Sha256PrefixedSchema`, `Sha256HexSchema`. |
| Core Packets, RPC & 32 `@1` Prompts (`@ef-harness/shared-contracts`) | `C03` | `kernel-schema-and-protocol.md`, `prompt-contracts.md` | `CheckOutcomeSchema` (rejects `status: "pass"` with `collected_count === 0`), `EvidenceLocatorSchema` (aliased as `LocatorSchema`), `RpcRequestSchema`/`RpcResponseSchema` (snake_case `project_id`, `question_id`, `batch_id`, `op_id` on mutating RPCs only, string `stream_epoch`), `StreamCreditGrantSchema` (`{ stream_id, bytes }`). |
| Closed Vocabularies & Telemetry (`@ef-harness/shared-contracts`, `@ef-harness/shared-observability`) | `C04` | `v1-knowledge-corpus.md`, `observability-and-testing.md`, `schema/state.sql` | `TOUCHES_TAGS` (28), `DecisionBasis`, `NodeStatus`, `HoldReason` (`'user_pause'|'requirement_change'|'budget'|'ccr'|'governor'|'editor_overlap'`), `GovernorPressure` (`'GREEN'|'YELLOW'|'ORANGE'|'RED'`), `ProjectKind` (`'web_saas'|'web_static'|'api_service'|'cli_tool'|'desktop_electron'|'mobile_web'`), `WorkerTier`, `CrewPreset`, `StreamingRedactor`, `PacketSecurityRedactor`, `LocalTracer`. |
| Single-Writer SQLite & Search (`@ef-harness/db`) | `C05`–`C11` | `database-design.md`, `schema/*.sql` | `ProjectStateDb`, `GlobalBrokerDb`, `TelemetryDb`, `CodeIndexDb`, `CoordinatorWriteQueue`, `MigrationRunner` (v2 migrations + `expands`/`contradicts`/`informs` edge types + `canvas_layout`, `investigations`, `sweep_symbol_maps`, `module_cards`, etc.), `splitSearchText`/`ef_search_text` UDF, `CasBlobStore` (`"sha256:<hex>"` API over bare 64-hex `cas_blobs`), `EffectsRepo`, `SecretPurgeEngine`, `KnowledgeGraphRepo`, `HoldsSubmissionsRepo`, `RuntimeLifecycleRepo`, `BudgetLedger`. |
| Named-Pipe IPC & Kernel Simulator (`@ef-harness/ipc`, `@ef-harness/sim`) | `C12`–`C14` | `kernel-schema-and-protocol.md`, `roadmap.md` | `FrameCodec` (`[channel:u8, length:u32be]`), `NamedPipeServer`, `Channel0Dispatcher` (JSON-RPC), `Channel1StreamCoordinator` + `StreamCreditGrantSchema`, wired directly to `@ef-harness/db` and exercised live by `@ef-harness/sim`. |
| Git Engine, Sandboxing, MCP & Test Environments (`@ef-harness/{git-engine,sandbox,mcp-server,test-env}`) | `C14`–`C18` | `workspace-and-git.md`, `sandbox-and-security.md`, `test-environments.md` | `resolveGitBinary` (`MinGit` + `PATH` opt-in), `WorktreeSlotPool`, `GitRefCasUpdater`, `WindowsJobObjectManager` (`KILL_ON_JOB_CLOSE`), `AllowlistProxyServer.fetch` + `proxyUrl`, `KernelPackageInstaller`, `HarnessRunEngine` (Tier C default, async `SandboxTierSelector`), `AttemptMcpServer` (`kb.*`, `harness.run`, `harness.read_result`), `TestEnvOrchestrator`, `TemplateDbManager`. |
| Worker Loop, Completeness Gate, Clean Verifier & Apps M1 (`@ef-harness/{worker-loop,completeness-gate,verifier}`, `apps/{daemon,desktop}`) | `C19`–`C26` | `worker-loop.md`, `completeness-gate.md`, `verification-and-isolation.md`, `desktop-app.md` | `ModelProtocolAdapter`, `PatchEditApplier`, `NativeWorkerLoop`, `CompletenessGateRunner`, `CleanVerifierRunner`, `BlindCheckBinder`, `UiPlaywrightContractVerifier`, `AcceptanceTransactionCoordinator`, `apps/daemon` (`@ef-harness/db`+`ipc`), `apps/desktop` multi-window `MessagePort` bridge, `M1KitchenExitGate` (`068`). |
| M2 Discovery, Corpus, Spec Expansion, Research, Planner, Intake & M2 Gate | `C27`–`C41` | `project-discovery.md`, `v1-knowledge-corpus.md`, `spec-expansion.md`, `planning-and-crew.md`, `external-intake.md`, `roadmap.md` | `DiscoverySessionCoordinator` (`preSettleObservedCriteria`), `CorpusPackLoader`, `SkillVettingPipeline`, `MatrixCellEnumerator` + `Z3SolverVerifier`, `ResearchFactCache` (`CasBlobStore`), `MarkdownExporter`/`Importer`, `SystemArchitectureSynthesizer` + `SkeletonLockEnforcer`, `HybridRevisionEngine`, `ContextSlicerEngine`, `MasterPlannerEngine`, `DeterministicGraphCompiler`, `Phase0ExecutionController` (`DevOnlyJsxSourceTagPlugin` `P0.8`), `SequentialBuildRunner`, `FeatureIntegratorEngine`, `CompletionWaveController`, `VersionedModelRoster`, `HeftCriticalPathScheduler`, `PlanPreviewAndAutoStartGate`, `M2KitchenE2eBenchmarkRunner` (`105`). |
| M3 Integrator, Steering, Governor, Shell/Cockpit & M3 Gate | `C42`–`C52` | `agent-handoffs.md`, `parallel-feature-integration.md`, `routing-design.md`, `stops-undo-and-reentry.md`, `execution-capacity.md`, `build-cockpit.md` | `ArtifactHandoffStore` (`harness.read_result`), `ProjectMergeQueue` + sandboxed `CombinedRegressionGate`, `ContractChangeRequestEngine` (`ccr@1`), `FeatureUndoEngine`, async `SteeringMessageRouter` (`router@1`), `FourRouteSteeringDispatcher` (`'user_pause'`), `MultiInterpretationHoldEngine`, `SharedQuestionArbiter`, `ColdOpenReconciler` (`'parked'`), `PressureHysteresisStateMachine` (`.pressure`, `.subscribe`), `ThreePoolCapacityScheduler`, `WindowsDpapiSecretsVault`, `SingleAppShell`, `BoardCockpitView`, `CreditLimitedStream`, `BudgetWindDownController`, `M3ParallelBenchmarkRunner` (`134`). |
| M4 Providers, Pacing, Connections UI & Runtime Adapters | `C53`–`C59` | `provider-connections.md`, `agent-runtime-adapters.md`, `open-design-questions.md` | `SignedProviderPolicyEngine`, `ApiConnectionManager`, `ChatGptSignInOAuth`, `AllowancePacingController` (DB-backed `k[model]`), strict Console `sk-ant-api` UI (`141`, zero `node:sqlite`), frozen 10-method `AgentRuntimeAdapter` (`readonly runtime`, `WindowsJobObjectManager`, `AllowlistProxyServer`) across all 7 adapters (`143–149`), `ForeignRuntimeResumeCoordinator` (`150`), `AdapterConformanceRunner` (`151`), `M4ExitGate` (`152`). |
| M5 Brownfield, Coexistence, Dictation, Canvas, Preview, Office & M5 Gate | `C60`–`C69` | `brownfield-discovery.md`, `editor-coexistence.md`, `interactive-architecture.md`, `ui-design-system.md`, `office-view.md` | `BrownfieldL0RepoScanner`, async WASM `WasmTreeSitterIndexer`, `SqliteModuleCardStore` (`code-index.db.module_cards`), `BrownfieldOpeningController`, `BaselineTestHealthRunner`, `@parcel/watcher` `EditorCoexistenceWatcher`, `ZeroStashLandingExecutor`, `HumanFixFlowEngine`, `@ef-harness/dictation` (`gpt2.tiktoken` copied to `dist/`), daemon-backed `Canvas`/`BoxChatIntents`/`Tabs` (zero `node:` built-ins in renderer), `LivePreviewDaemonRunner` + daemon `visual-steer@1`, `pixi.js` `OfficeView` (11 kebab-case `ROOM_IDS` + reduced motion on `ORANGE` override), active Playwright `UiConsistencyPipeline` (`174`), `M5ExitGate` (`175`). |
| M6 Ship, Investigations, Portability, Meta-Lab, Packaging & v1.0 Release | `C70`–`C79` | `ship-and-deploy.md`, `investigations-and-sweeps.md`, `projects-portability-and-sync.md`, `meta-lab.md`, `desktop-app.md`, `roadmap.md` | `ExternalEffectLedger` (fenced on `StopCoordinator` + `writer_epoch`), `GitHubRateAwareQueue`, nested-path `LinuxCaseSensitivityAutoRepair`, `DockerOverSshDeployAdapter` (RFC 8785 `{targetEnv, commitSha, envDiff}`), `MysteryBugPipeline` + neighbor-probing `125` `FlakeSafeGitBisector`, sandboxed codemods (`path_leases` `'exclusive'`), `PostSweepBriefSymbolUpdater` (`'READY'|'BLOCKED'`), `age-encryption` multi-check `OrphanBranchPortabilityExporter` + real `state.db` rehydration + `MachineWideSlotCoordinator`, wired `meta-lab` + `review-trials`, real NSIS `electron-builder` packaging (`corpus/**`), fail-closed `verify-docs-diagrams.mjs`, and `V1ReleaseCertificationRunner` (`productExecuted: true` across all 7 suites). |

## Seam register

| Finding ID | Seam / Defect Summary | Resolving Combination Task(s) |
| --- | --- | --- |
| `F-001` | Layer-boundary ESLint graph blocks required architectural imports within the same numeric layer | `C01` |
| `F-002` | Spike Vitest configuration omits M0 spike suites (`windows-sandbox` `.mjs` and sub-package tests) | `C01`, `C02` |
| `F-003` | `packages/shared-observability` remains the naive Task-001 stub while real logger/tracer/redactor live in `packages/shared-contracts/src/telemetry` with uncommitted streaming-leak bugfixes in `task-011` | `C04`, `C12` |
| `F-004` | `CheckOutcomeSchema` on `harness/integration` accepts `status: "pass"` with `collected_count: 0` (uncommitted `task-008` fix missing) | `C03` |
| `F-005` | Mixed `zod` vs `zod/v4` imports and divergent `EvidenceLocatorSchema` vs `LocatorSchema` / intent schemas across `shared-contracts` and `intake` | `C03`, `C35` |
| `F-006` | Canonical JSON-RPC schemas in `shared-contracts` vs `packages/ipc` disagree on `op_id` placement, parameter names (`project_id` vs `project`, `question_id` vs `questionId`, `batch_id` vs `batchId`), `artifact.open` mutability, `snapshot.get` pagination, and `stream_epoch` type | `C03`, `C10`, `C12` |
| `F-007` | Hash prefix seam: `"sha256:<64-hex>"` in `shared-contracts` & KB/search vs bare `<64-hex>` in `cas_blobs`, `artifacts`, `ipc` streams, and `portability` | `C02`, `C07`, `C11`, `C13` |
| `F-008` | Uncommitted `task-022` lifecycle & DONE-invariant bugfixes missing on `harness/integration` (`coversScope` inverted prefix bug, `contractsCurrent` brief-version pin, `BLOCKED` pre-block state & approved exit persistence) | `C08` |
| `F-009` | `ProjectStateDb` (`Task 013`) and `GlobalBrokerDb` (`Task 014`) bypass `MigrationRunner` (`Task 015`) and hard-fail on upgraded schemas (`user_version !== 1`) | `C06` |
| `F-010` | Divergent `ef_search_text` UDF implementations across `packages/db` omit acronym splitting (`XMLHttpRequest` -> `XML Http Request`), corrupting FTS5 `kb_words` parity | `C05`, `C06`, `C07`, `C11`, `C76` |
| `F-011` | Three incompatible `CasBlobStore` contracts inside `packages/db` (`cas/store.ts` vs `artifacts/cas-port.ts` vs `secret-purge/cas-store.ts`), breaking `zstd-seekable` >1 MB log storage | `C11`, `C13`, `C21`, `C35`, `C36` |
| `F-012` | Fragmented connection handles and 9 duplicate `queries.sql` parsers inside `packages/db` prevent repositories from sharing `ProjectStateDb` + `CoordinatorWriteQueue` | `C05`, `C07`, `C08`, `C09`, `C10`, `C11`, `C15`, `C19`, `C25`, `C36` |
| `F-013` | `packages/ipc` (`Tasks 032–033`) defines incompatible async port interfaces for `CoordinatorWriteQueue`, `OutboxRepo`, `ReadModelRepo`, and `ArtifactCatalog` instead of binding to `@ef-harness/db` | `C09`, `C10`, `C12`, `C13` |
| `F-014` | `FrameCodec.encode` static vs instance mismatch between `ipc/transport` (`Task 031`) and `ipc/streams` (`Task 033`) | `C12`, `C13` |
| `F-015` | `StreamCreditGrantSchema` (`shared-contracts`) vs `packages/ipc/src/streams` credit control message mismatch | `C03`, `C13` |
| `F-016` | `packages/sim` (`Task 034` M0 Kernel Simulator) simulates a private standalone SQL/CAS/pipe model instead of exercising `@ef-harness/db` and `@ef-harness/ipc` | `C13` |
| `F-017` | `packages/git-engine` `resolveGitBinary` refuses to fall back to `git` on `PATH` when bundled MinGit is absent, and submodules define 5 incompatible `GitRunner` / `RefLeaseStateDb` contracts | `C14`, `C15`, `C25` |
| `F-018` | CRITICAL SECURITY DEFECT: `HarnessRunEngine` (`Task 047`) executes commands unsandboxed under the developer's token via `NestedCommandJobManager` + `WarmExecutionPool` while falsely reporting `tier: "C"` | `C18` |
| `F-019` | `SecureDocFetcher` (`Task 045`) expects `AllowlistProxyServer.fetch(...)` which `AllowlistProxyServer` (`Task 044`) does not implement | `C17` |
| `F-020` | `KernelPackageInstaller` (`Task 046`) hand-splices invalid synthetic lockfile text before running `--frozen-lockfile`, breaking real `pnpm` / `npm` / `yarn` dependency additions | `C18` |
| `F-021` | Uncommitted `task-048` bugfixes missing on `harness/integration` (`globMatch` zero-segment `**/`, `core.quotepath=false`, pull-quota token over-accounting, `shutdownReason`) plus `mcp-server` disconnected from `db`/`sandbox`/`test-env` | `C18`, `C20`, `C22`, `C34` |
| `F-022` | `packages/test-env` (`Tasks 049–052`) duplicates `DatabaseSync` connections on `global.db`/`state.db` and incompatible `WindowsJobManager` / `ServiceProvider` contracts | `C16`, `C19`, `C20` |
| `F-023` | Uncommitted bugfixes in `packages/worker-loop` (`task-053`, `task-056`, `task-057`) missing on `harness/integration` (429 `insufficient_quota` misclassification, assistant-text `cost` regex injection, Responses reasoning/tool ordering, CRLF `rangeHash` mismatch, `.GIT` case bypass, `unknown_timeout` crash vs reconciliation, `replace_lines` gate, and `no_progress` spiral bypass) | `C21`, `C22` |
| `F-024` | Uncommitted bugfixes in `packages/completeness-gate` (`task-058`, `task-059`) missing on `harness/integration` (`return;` / `return false;` / `() => undefined` stubs, standalone dead `<button>`, ESM `.js`->`.ts` reachability, and integrator hunk-line bounds) plus internal `058`↔`059` AST port disconnect | `C23` |
| `F-025` | Uncommitted security & correctness bugfixes in `packages/verifier` (`task-061`, `062`, `063`, `064`, `066`) missing on `harness/integration` plus 3 incompatible `SurfaceVerifierAdapter` interfaces inside `packages/verifier` | `C24`, `C25` |
| `F-026` | `apps/daemon` (`Task 067`) bypasses `@ef-harness/db` and `@ef-harness/ipc`, violates SQLite outbox/schema invariants (`outbox_without_deliveries`, missing pragmas/`user_version`), and checks lock PIDs without Windows start-time verification | `C10`, `C26` |
| `F-027` | `apps/desktop` `pipe-client.ts` (`Task 067`) corrupts/duplicates framed bytes after `session.hello` and overwrites a single `renderer` `MessagePort`, breaking multi-window / pop-out bridges | `C26`, `C48` |
| `F-028` | `tests/e2e` M1 Exit Gate (`Task 068`) runs a self-contained mock script instead of exercising the real M1 packages (`db`, `git-engine`, `sandbox`, `test-env`, `mcp-server`, `worker-loop`, `completeness-gate`, `verifier`) | `C26` |
| `F-029` | `packages/discovery` (`Tasks 069–074`) splits into 6 disconnected intra-package silos with incompatible `decision` `fields` JSON schemas, sync-vs-async model/session contracts, and zero `@ef-harness/db` wiring | `C27`, `C28` |
| `F-030` | `packages/discovery` `valueSatisfiesLimits` (`Task 069`) hardcodes only `sqlite`, rejecting all other bounded-delegation selections | `C27` |
| `F-031` | `packages/discovery` `prompts/ports.ts` (`Task 070`) walks filesystem for `pnpm-workspace.yaml` (breaking packaged Electron builds), duplicates `Task 009` schemas, and adds 3 more divergent `ef_search_text` UDFs | `C27` |
| `F-032` | `CorpusPackLoader` (`Task 075`) crashes on `Task 076`, `Task 077`, and `Task 104` corpus YAML files due to incompatible schemas, rejected YAML anchors, sidecar manifests, and mismatched `core-data-auth` option IDs | `C29`, `C30` |
| `F-033` | `packages/meta-lab/src/skill-vetting` (`Task 078`) uses non-canonical `allowedTouches` tags outside `TOUCHES_TAGS` and cannot load `Task 104`'s 14 Wave 2 skills | `C30` |
| `F-034` | `Tasks 079, 081, 082` insert `edges` with `type IN ('expands', 'contradicts', 'informs')` that are not registered in `schema/state.sql` `edge_types`, causing `SQLITE_CONSTRAINT_FOREIGNKEY` on real `state.db` | `C06`, `C31`, `C32` |
| `F-035` | `packages/spec-expansion` (`Tasks 079–081`) lacks `task-079`'s uncommitted collapse/requirements-view fixes, calls nonexistent sibling methods (`listCells`, `listMaterializedRequirements`), reads nonexistent `selectedOptionId`/`groupId` decision fields, and leaves `z3-solver` WASM unwired | `C27`, `C31` |
| `F-036` | `packages/research-engine` `ResearchFactCache` (`Task 082`) stores fact payloads only in an in-memory `Map` (losing 100% of cached facts on restart), misses runtime `"typescript"` dependency, and mismatches `SecureDocFetcher` | `C17`, `C32` |
| `F-037` | `views-export` (`Task 085`) and `views-import` (`Task 086`) disagree on `.manifest.json` schema, `<!-- ef:node -->` `base_hash`/anchor/escape syntax, and `ExportPauseLock`, breaking `.harness/views/` round-trip editing | `C33` |
| `F-038` | `system-arch` (`Task 083`) and `feature-arch` (`Task 084`) define conflicting `SkeletonLockEnforcer` / `DeterministicArchConsistencyGate` contracts, omit `fields.names` SQL trigger format, and leave `feature-architect@1` synchronous & unpersisted | `C07`, `C32` |
| `F-039` | Three-way MCP `kb.*` tool-name, worker-level, band-casing, and `task_holds.reason` mismatch across `AttemptMcpServer` (`048`), `HybridRevisionEngine` (`087`), `KnowledgePacketSlicer` (`088`), `KbPullToolHandlers` (`089`), and `Scheduler` (`107`) | `C04`, `C08`, `C18`, `C33`, `C34`, `C40` |
| `F-040` | Unexported `packages/planner` Execution Submodules (`090–095`), Conflicting `ProjectKind` / `CrewLevel` Enums & Sync Model Ports | `C04`, `C37`, `C38`, `C40`, `C41` |
| `F-041` | Five Private SQLite Schemas in `packages/planner` (`090–093, 095`) Colliding with `schema/state.sql` & Missing `DeterministicGraphCompiler` Sibling Methods | `C37`, `C38` |
| `F-042` | Unsandboxed `Phase0ExecutionController` (`093`), Non-Installing `LocalKernelPackageInstaller`, and Regex/Solid-PNG `StyleguideRouteVerifier` (`094`) | `C38`, `C66` |
| `F-043` | `SequentialBuildRunner` (`095`) Toy Regex Default Ports, Broken `LocalFeatureIntegrator` (`journeys === 0`), Non-Executing `PostMergeSmokeChecker`, and Divergent `StateDb` Helpers | `C38` |
| `F-044` | `packages/planner/src/specialists` (`102`) Sync Model Port, Nonexistent Verifier/Audit/Hint Methods, Hardcoded `1..400` Line Grounding & Discarded `ask-owner-responder@1` Output | `C39` |
| `F-045` | Three-Way `crew-levels` (`106`) ↔ `scheduler` (`107`) ↔ `plan-preview` (`108`) Contract Mismatches, Tier-Name-As-Model Dispatch Bug & Volatile RAM 24h Auto-Start Cap | `C04`, `C40`, `C41`, `C46` |
| `F-046` | `packages/intake` (`097–100`) `NormalizedDocument` Seam Mismatch (`097` vs `098`), Stub Package Barrel, Sync CAS/Model Ports & Rogue `SqliteBrandAssetState` | `C35`, `C36` |
| `F-047` | `FeatureIntegratorEngine` (`096`) & `CompletionWaveController` (`101`) Stub Barrel, In-Memory Sync Verifier/Binder Stand-Ins, Private `FinalAuditStore` & Missing `BudgetLedger` Methods | `C09`, `C39` |
| `F-048` | `Task 105` M2 Kitchen Exit Gate Copies Pre-Baked Static HTML/JS Fixtures (Zero M2 Package Execution), Uses Untypechecked `.ts` Import Extensions & Lacks Root Replay Scripts | `C41` |
| `F-049` | Five Isolated SQLite Schemas (`36` Custom Tables) Across M3 `packages/integrator` (`109–112, 129`), Unwired `harness.read_result` MCP Tool & 12 `Local*` CCR Mock Ports | `C18`, `C42`, `C43` |
| `F-050` | `CombinedRegressionGate` (`111`), `ProjectIntegratorEngine` (`111`), and `FeatureUndoEngine` (`129`) Hardcode Toy `build.mjs` / `features/*/manifest.json` Conventions & Spawn Unsandboxed Host Commands | `C42`, `C43` |
| `F-051` | `EditorCoexistenceWatcher` (`171`), `ZeroStashLandingExecutor` (`172`), and `HumanFixFlowEngine` (`173`) Hold/Dependency Mismatches, Unsafe Branch Cleanup, RAM-Only Landing Receipts & 7th Private SQLite DB | `C62` |
| `F-052` | `UiConsistencyPipeline` (`174`) 5th Conflicting `ProjectKind` (`"ui"`), Passive Pre-Computed Audit Inputs (No Playwright Execution), 1×1 Pixel `InMemoryCasStore` & Toy Default Ports | `C69` |
| `F-053` | `packages/steering` (`113–116, 130`) Stub Barrel, Three Conflicting SQLite Schemas (`task_runtime` DDL Crash & `qa_*` Shadow Tables), and RAM-Only `SteeringRuntime` / `InMemoryReentryStore` | `C44`, `C45` |
| `F-054` | `SteeringMessageRouter` (`113`) Discards `router@1` LLM Output, `FourRouteSteeringDispatcher` (`114`) Rejects `AskOwnerResponderEngine` (`102`) & Emits Invalid `"user_paused"` Hold Reason | `C39`, `C44`, `C45` |
| `F-055` | `packages/governor` (`117–121`) Stub Barrel, `"GREEN"` vs `"Green"` Pressure Crash (`118`→`119`), Dual-DB `SqliteVaultMetadataStore` (`120`), and Invalid `"waiting_on_human_step"` Hold Reason (`121`) | `C04`, `C46`, `C47` |
| `F-056` | `Task 134` M3 Parallel Exit Gate Re-Implements Local Fake `HeftCriticalPathScheduler` / `ProjectMergeQueue` / `WindowsDpapiSecretsVault` Classes (Zero M3 Package Execution) & Uses `.ts` Imports | `C52` |
| `F-057` | `packages/providers` (`135`–`140`) Empty Barrel, Six Divergent `global.db` Schemas (Including Destructive `route = 'api_key'` `CHECK` in `136`), Six Incompatible `WindowsDpapiSecretsVault` (`120`) Ports, Unpersisted `k[model]` Weights & Unwired Policy/Roster Methods | `C53`, `C54` |
| `F-058` | `Task 141` `apps/renderer/src/connections` Compliance Bypass Accepting `sk-ant-oat*` Subscription OAuth Tokens as `"Anthropic Console"`, Illegal Renderer `node:sqlite` Import & Internal `FallbackGuardPort` Mismatch | `C55`, `C76` |
| `F-059` | `packages/runtime-adapters` (`142`–`146`) Empty Barrel, Missing `runtime` Property Failing `assertAgentRuntimeAdapter`, Five Divergent 10-Method `AgentRuntimeAdapter` Signatures & Disconnected `core`/`acp` Silos | `C55`, `C56`, `C57` |
| `F-060` | `packages/runtime-adapters` (`142`–`146`) Broken PowerShell Job Object Helper (Missing `KILL_ON_JOB_CLOSE` + 20s Main-Thread `Atomics.wait` Freeze), Non-Job `taskkill`/`InMemoryJobSupervisor` Fallbacks & Dead `127.0.0.1:9` Proxy Default | `C16`, `C17`, `C55`, `C56`, `C57`, `C76` |
| `F-061` | `packages/runtime-adapters` (`147`–`151`) Adapter Contract Mismatches (`147`–`149`), Duplicated ACP/Job Silos, `SqliteAttemptCheckpointStore` (`150`) `attempts` DDL Crash & Non-Adapter-Driving `AdapterConformanceRunner` (`151`) | `C57`, `C58`, `C59` |
| `F-062` | `Task 152` M4 Exit Gate (`tests/e2e/m4-exit-gate`) Self-Contained Fake Stand-In Classes, Static Hidden-Suite Scoring & Untypechecked `.ts` Import Specifiers | `C59` |
| `F-063` | `SingleAppShell` (`122`) & `PopOutWindowCoordinator` (`123`) Undeclared `react`/`react-dom` Dependencies, Incompatible `BridgePayload` vs `009`/`032`/`067` IPC Protocol, Governor Casing Drop & `SharedHarnessdStream` Epoch-Reset Crash | `C48` |
| `F-064` | `BoardCockpitView` (`124`) & `BoardHealthSignalEngine` (`125`) Disconnected `DaemonStore` Snapshot Shapes, Missing `StateDbBoardRow` Daemon Projection & Duplicate `CockpitExplainerV1Schema` | `C10`, `C49` |
| `F-065` | `WorkerInspectorPanel` (`126`), `CalmInboxPanel` (`127`) & `BudgetWindDownController` (`128`) Credit-Exhaustion Throw Bug, Rogue `stop_events` SQLite Writer, Volatile `AtomicBudgetReservationLedger` & Upstream RPC/Method Mismatches | `C09`, `C50`, `C54` |
| `F-066` | Desktop Lifecycle (`131`), Component Downloader & Auto-Updater (`132`) & Diagnostics (`133`) Unwired from `apps/daemon`/`apps/desktop`, Missing `electron-updater`, Nonexistent `reconcileAfterWake` & Live `telemetry.db` WAL Unlink Race | `C51`, `C58` |
| `F-067` | `apps/renderer/src/canvas/{intents,tabs}` (`156`, `159`) Illegal Renderer `node:sqlite`/`node:fs`/`node:crypto` Imports, Fabricated 20-Column `nodes` Schema, 8th `ef_search_text` UDF & Undeclared `@xyflow/react`/`elkjs` Dependencies (`153`) | `C64`, `C65` |
| `F-068` | Canvas & Composer Silos (`153`–`156`, `159`) Missing `canvas_layout` SQLite Table, Missing `ShellLayoutContext.readCanvas`/`writeCanvas`, Duplicate Composer State in `156` & Nine `Local*` Stand-Ins Disconnected from `harnessd` | `C06`, `C64`, `C65` |
| `F-069` | `packages/dictation` (`157`–`158`) Empty Barrel, Uncopied `gpt2.tiktoken` Build Asset Crash (`ENOENT` in `dist/`), Disconnected `stt`↔`vocabulary` Pipeline & Upstream `118`/`132`/`040` Signature Mismatches | `C63` |
| `F-070` | Live App Preview (`160`) & Point-to-Fix (`161`) All-Mock `createLivePreviewDaemonRunner` (In-Memory `commits` Map & Fake `killOnJobClose`), Renderer `node:path` Import, Regex-Only `VisualSteerRouter` & Unwired `P0.8`/`174` Baselines | `C16`, `C66` |
| `F-071` | Office 2D Renderer (`Task 162`) Undeclared `"pixi.js"` Dependency, Forbidden Renderer `node:fs`/`node:path`/`node:url` Imports, Hardcoded `800×600` Viewport Size, Unmounted `world` Scene Graph & Empty Duplicate Branch `task/162-office-pixijs-floorplan-sprites` | `C67` |
| `F-072` | Four-Way Office Submodule Isolation (`Tasks 162–165`): 3 Incompatible `OfficeRoomId` Vocabularies (`"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"`), `OfficeCastProjector`/`WalkableGridPort` Clashes, Uncapped `ORANGE` Override Motion, Missing `118`/`122–127` Wiring & Empty Branch `task/164-office-animation-director-astar` | `C67`, `C68` |
| `F-073` | Brownfield L1/L2 (`Tasks 167–168`) Undeclared & Uncalled `web-tree-sitter` WASM, Synchronous Event-Loop Blocking, Lowercase Governor `"orange"`/`"red"` Check, Fake Linear Edges in `renderPersonalizedMap` & Missing `code-index.db.module_cards` Persistence | `C06`, `C60` |
| `F-074` | `packages/brownfield` (`Tasks 166–170`) 5-Way Internal Silo Isolation, Empty Barrel, Ambient `PATH` `"git"`, Volatile In-Memory `work_items`/`quarantined_tests` & Upstream Port Mismatches (`017, 035, 038, 048, 069, 088, 153`) | `C28`, `C60`, `C61` |
| `F-075` | `Task 175` M5 Exit Gate Self-Contained Toy Re-Implementations (Zero Workspace Imports, Non-SQLite `CodeIndexDatabase` Stub, `.git/HEAD`-Only Live Mode) & `.ts` Extension Imports | `C69` |
| `F-076` | `ship-deploy` (`Tasks 176, 178, 180`) Disconnected `project_runtime` Fencing Table, Rogue `MigrationStateStore` `DatabaseSync` Overwriting `effects.payload_hash`, and Nested-Path Stripping in `LinuxCaseSensitivityAutoRepair` | `C70`, `C71` |
| `F-077` | `packages/ship-deploy` (`Tasks 176–181`) 6-Way Internal Silo Isolation, Empty Barrel, Volatile In-Memory `ship_runs`/Rate-Queue/CAS Stores, Unbound `commitSha` Approval Hash & Unwired Upstream Ports | `C70`, `C71` |
| `F-078` | `investigations` (`Tasks 182–184`) Broken `FlakeSafeGitBisector` `125` Skip (`low = mid + 1` Discards Earlier Culprits) & Missing `finally` Reset, Unsandboxed Codemods Missing `ts-morph`/`@ast-grep` Deps, `jscodeshift` Dry-Run Disk Mutation & Unmigrated `investigations` Table | `C06`, `C72`, `C73` |
| `F-079` | `packages/investigations` (`Tasks 182–185`) 4-Way Internal Silos, Empty Barrel, `"queued"`/`"paused"` vs `'READY'`/`'BLOCKED'` Mismatch in `PostSweepBriefSymbolUpdater` & `path_leases` (`'granted'` vs `'exclusive'`) Seam | `C06`, `C08`, `C36`, `C72`, `C73` |
| `F-080` | `portability` (`Tasks 186–188`) Undeclared `"age-encryption"` & Packaged-App `createRequire` Crash, Dropped 2nd+ Sealed Checks Per Feature, Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` & Permanent 1-Slot `setGovernorOrange(false)` Lock | `C37`, `C74` |
| `F-081` | `packages/portability` (`Tasks 186–188`) 3-Way Internal Silos, Empty Barrel, Duplicate `age`/YAML/Redactor Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` Bypassing `global.db` (`014` & `024`) | `C09`, `C74` |
| `F-082` | `packages/meta-lab` (`Tasks 189–193`) 5-Way Internal Silos, Empty Barrel, Hardcoded `ThreeLevelEvalRunner`, Toy `REAL`-Float `SimulatedDaemonStack` & Mock-Sink `RedTeamSecuritySuiteRunner` | `C75`, `C76` |
| `F-083` | `Task 194` `ArchitectureReviewTrialsSuite` Self-Contained Inline Toy Functions (Zero Workspace Imports Across Areas A–J & Trials 1–6) Masking Real Production Regressions | `C76` |
| `F-084` | `Task 196` Windows NSIS Packaging Pipeline Ships Stub `MZEFHARNESS` Executables, Empty `module.exports = {}` `app.asar`, Fixture Placeholders & Undeclared `electron` / `electron-builder` | `C77` |
| `F-085` | `Task 197` `scripts/verify-docs-diagrams.mjs` Checks Nonexistent `packages/kernel`, `packages/contracts` & `corpus/skills/m2` Paths (Vacuous Pass) and Mutates `ef-harness-complete.mmd` In Place | `C77` |
| `F-086` | `Tasks 195, 198, 199, 200` Final E2E, Perf, Security & v1.0 Release Certification Suites Use Self-Contained Local Port Stubs (`productExecuted: false`), Non-SQLite `"state.db"` Text Files & `.ts` Extension Imports | `C78`, `C79` |

## Wave plan

| Wave | Tasks | Unit Scope | Proof Gate | Rationale |
| --- | --- | --- | --- | --- |
| `Wave 0` | `C01`–`C04` | `Tasks 001–011` (`layers`, spikes, `shared-contracts`, `shared-observability`) | `pnpm --filter @ef-harness/spikes test && pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/shared-observability test` | Unblock intra-tier acyclic DAG imports and freeze schemas, hashing, vocabularies, and zero-leak redaction before DB/IPC. |
| `Wave 1` | `C05`–`C13` | `Tasks 012–034` (`db`, `ipc`, `sim`) | `node schema/schema-test.js && pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/ipc test && pnpm --filter @ef-harness/sim test` | Consolidate single-writer SQLite + additive v2 migrations + `ef_search_text` + `CasBlobStore` before pipe IPC and M0 Sim. |
| `Wave 2` | `C14`–`C26` | `Tasks 035–068` (`git-engine`, `sandbox`, `mcp-server`, `test-env`, `worker-loop`, `completeness-gate`, `verifier`, `daemon`, `desktop`, `M1` gate) | `pnpm --filter @ef-harness/e2e test -- m1` (`C26`) | Land Git/JobObject/Proxy containment, harvest `048..066` dirty bugfixes, bind real daemon/desktop pipes, and run real M1 gate. |
| `Wave 3` | `C27`–`C41` | `Tasks 069–108` (`discovery`, `corpus`, `spec-expansion`, `research-engine`, `intake`, `planner`, `096/101`, `M2` gate) | `pnpm --filter @ef-harness/e2e test -- m2` (`C41`) | Stabilize corpus/criteria/spec/research/views/slicing before planner compilation, `intake`, HEFT scheduling, and real M2 Kitchen gate. |
| `Wave 4` | `C42`–`C52` | `Tasks 109–134` (`integrator` M3, `steering`, `governor`, `shell`/`cockpit`/`lifecycle`, `M3` gate) | `pnpm --filter @ef-harness/e2e test -- m3-exit-gate` (`C52`) | Wire M3 parallel branches, merge queue, CCR, async steering, canonical pressure/vault, Board/Inspector/Inbox UI, and real M3 speed gate. |
| `Wave 5` | `C53`–`C59` | `Tasks 135–152` (`providers`, `connections` UI, `runtime-adapters`, `M4` gate) | `pnpm --filter @ef-harness/e2e test -- m4-exit-gate` (`C59`) | Lock provider compliance (`sk-ant-api` only), DB-backed AIMD pacing, unified 10-method `AgentRuntimeAdapter`, conformance, and real M4 gate. |
| `Wave 6` | `C60`–`C69` | `Tasks 153–175` (`brownfield`, `coexistence`/`landing`/`human-fix`, `dictation`, `canvas`, `preview`, `office`, `ui-checks`, `M5` gate) | `pnpm --filter @ef-harness/e2e test -- m5-exit-gate` (`C69`) | Land Layer 2/3 (`brownfield`, `dictation`, `coexistence`) before Layer 5 (`canvas`, `preview`, `office`), remove renderer `node:*` imports, and certify M5. |
| `Wave 7` | `C70`–`C79` | `Tasks 176–200` (`ship-deploy`, `investigations`, `portability`, `meta-lab`, `review-trials`, `packaging`, `docs-parity`, `full-lifecycle`, `perf-scale`, `security-audit`, `M6` release) | Full repo `pnpm build && pnpm typecheck && pnpm lint && pnpm test && node schema/schema-test.js && pnpm verify:diagrams && node scripts/verify-docs-diagrams.mjs && pnpm --filter @ef-harness/e2e test` (`C79`) | Land M6 subsystems in strict DAG order, wire real NSIS packaging & fail-closed diagram checks, and certify v1.0 release with `productExecuted: true`. |

## Tasks

### C01 — The workspace ESLint layer graph permits all architectural intra-tier DAG edges and M0 SQLite, sandbox, and capacity spikes run under Vitest.

Architecture.
- `architecture.md` (Workspace Package Topology & Layering), `roadmap.md` (Milestone M0 Validation Spikes), `sandbox-and-security.md` (Windows Sandbox Tiers A–D & Job Objects), `execution-capacity.md` (Warm Execution Pool).
- `IMPLEMENTATION_TASKS.md` (`Task 001`–`Task 004`), `scripts/layers.mjs`, `eslint.config.mjs` (`ef/layer-boundary`).
- Post-task invariant: The workspace ESLint layer graph permits all architectural intra-tier DAG edges and M0 SQLite, sandbox, and capacity spikes run under Vitest.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` (halt if `HEAD` differs).
- Unit `Task 002` (`task/002-spike-node-sqlite-electron` @ `c117ff2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-002-spike-node-sqlite-electron`, roots `spikes/node-sqlite-electron/REPORT.md, spikes/node-sqlite-electron/backup.ts, spikes/node-sqlite-electron/checks.ts, spikes/node-sqlite-electron/driver.ts, spikes/node-sqlite-electron/fallback-vendor.ts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 003` (`task/003-spike-windows-sandbox` @ `2938e90`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-003-spike-windows-sandbox`, roots `spikes/windows-sandbox/CODEX_EVAL.md, spikes/windows-sandbox/REPORT.md, spikes/windows-sandbox/child-action.mjs, spikes/windows-sandbox/helpers, spikes/windows-sandbox/redteam-probe.mjs`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 004` (`task/004-spike-execution-capacity` @ `a1d3a28`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-004-spike-execution-capacity`, roots `spikes/execution-capacity/REPORT.md, spikes/execution-capacity/bench.mjs, spikes/execution-capacity/calibrated-defaults.json, spikes/execution-capacity/lib, spikes/execution-capacity/template-app`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration` (`30f2e9c`): `task/002-spike-node-sqlite-electron` (`c117ff2`), `task/003-spike-windows-sandbox` (`2938e90`), and `task/004-spike-execution-capacity` (`a1d3a28`).
- Sequence note: Confirm zero uncommitted diffs in `C:/Users/Ayush/Desktop/ef-wt/task-002-*`, `task-003-*`, and `task-004-*`.

Freeze.
- `scripts/layers.mjs` preserves the existing `PACKAGE_LAYOUT` `[id, layer, dir]` tuple shape and `LIBRARY_PACKAGE_IDS` (`layer < 5`, all 28 library packages) for `scripts/harmony.test.mjs` compatibility, and exports `DAG_RANK` with topological ordering (`shared-contracts:0`, `shared-observability:1`, `db:2`, `git-engine:3`, `ipc:4`, `sandbox:5`, `test-env:6`, `mcp-server:7`, `sim:8`, `completeness-gate:9`, `worker-loop:10`, `verifier:11`, `corpus:12`, `discovery:13`, `spec-expansion:14`, `research-engine:15`, `intake:16`, `brownfield:17`, `dictation:18`, `planner:19`, `governor:20`, `providers:21`, `integrator:22`, `steering:23`, `runtime-adapters:24`, `ship-deploy:25`, `investigations:26`, `portability:27`, `meta-lab:28`, `daemon:29`, `desktop:30`, `renderer:31`, `spikes:32`, `benchmarks:33`, `e2e:34`).
- `eslint.config.mjs` `ef/layer-boundary` checks `DAG_RANK[to] >= DAG_RANK[from]` (enforcing strict acyclic imports across intra-tier edges) while `LAYERS` remains `0..5` for `packageIdentity().layer` and `harmony.test.mjs`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-001`: Replace coarse integer tier comparison (`to >= from` on `0..5`) in `scripts/layers.mjs:6-42` and `eslint.config.mjs:54-62` with strict acyclic `dagRank` comparison so required edges (`ipc -> db`, `mcp-server -> db/sandbox/test-env`, `verifier -> completeness-gate/db/sandbox/test-env`, `spec-expansion -> discovery`, `runtime-adapters -> providers/governor`) pass `pnpm lint`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-002`: Update `spikes/vitest.config.ts:6` `include` globs to execute `windows-sandbox/windows-sandbox.test.mjs`, `node-sqlite-electron/**/*.test.ts`, `execution-capacity/tests/**/*.test.ts`, `foreign-runtimes/tests/**/*.test.ts`, and `test-services-windows/tests/**/*.test.ts` while excluding `spikes/execution-capacity/template-app/**`.

Shared files.
- Integration-owned shared surfaces: `scripts/layers.mjs`, `eslint.config.mjs`, `spikes/vitest.config.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not disable `ef/layer-boundary` or allow cyclic imports between workspace packages.
- Do not include `spikes/execution-capacity/template-app/src/format.test.ts` in the outer workspace Vitest run.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/spikes test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Vitest output for `@ef-harness/spikes` explicitly executes `windows-sandbox.test.mjs`, `node-sqlite-electron`, and `execution-capacity` suites with `0` skipped files.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `scripts/layers.mjs` `PACKAGE_LAYOUT` (`dagRank` strictly increasing from producers to consumers) and `eslint.config.mjs` `ef/layer-boundary` allowing acyclic producer imports without lint errors.

Stop.
- Commit on `harness/integration` once build, typecheck, lint, and spike tests are green; do not touch `packages/shared-contracts` yet.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C02 — All five M0 spikes pass and `@ef-harness/shared-contracts` exports frozen RFC 8785 canonical JSON hashing, typed IDs, and lossless SHA-256 prefix helpers.

Architecture.
- `kernel-schema-and-protocol.md` (RFC 8785 JCS Canonical JSON, ULID/Typed IDs, SHA-256 Digest Conventions), `database-design.md` (`cas_blobs.hash` vs `nodes.content_hash`), `test-environments.md`, `agent-runtime-adapters.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 005`–`Task 007`).
- Post-task invariant: All five M0 spikes pass and `@ef-harness/shared-contracts` exports frozen RFC 8785 canonical JSON hashing, typed IDs, and lossless SHA-256 prefix helpers.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C01` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 005` (`task/005-spike-test-services-windows` @ `7c3a952`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-005-spike-test-services-windows`, roots `spikes/test-services-windows/.gitignore, spikes/test-services-windows/REDIS_DECISION.md, spikes/test-services-windows/REPORT.md, spikes/test-services-windows/report.json, spikes/test-services-windows/run-unit-tests.mjs`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 006` (`task/006-spike-foreign-runtimes` @ `ed8b0b2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-006-spike-foreign-runtimes`, roots `spikes/foreign-runtimes/REPORT.md, spikes/foreign-runtimes/acp-probe.mjs, spikes/foreign-runtimes/claude-probe.mjs, spikes/foreign-runtimes/codex-probe.mjs, spikes/foreign-runtimes/credentials.ts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 007` (`task/007-canonical-hashing-ids` @ `baed849`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-007-canonical-hashing-ids`, roots `packages/shared-contracts/src/canonical, packages/shared-contracts/tests/canonical`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/005-spike-test-services-windows` (`7c3a952`), `task/006-spike-foreign-runtimes` (`ed8b0b2`), and `task/007-canonical-hashing-ids` (`baed849`).

Freeze.
- `canonicalJson(value: unknown): string` (RFC 8785 JCS deterministic key/number serialization) and `canonicalSha256(value: unknown): Sha256Prefixed` returning `'sha256:<64-lowercase-hex>'`.
- `toPrefixedSha256(digest: string): Sha256Prefixed` and `toBareSha256Hex(digest: string): string` (validating 64 lowercase hex chars and converting losslessly between `'sha256:<hex>'` and bare `'<hex>'`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-007`: Export `toPrefixedSha256`, `toBareSha256Hex`, `Sha256PrefixedSchema` (`/^sha256:[0-9a-f]{64}$/`), and `Sha256HexSchema` (`/^[0-9a-f]{64}$/`) from `packages/shared-contracts/src/hashing/index.ts` and `packages/shared-contracts/src/index.ts` so `shared-contracts`, `db/cas`, `ipc/streams`, and `portability` share one canonical conversion boundary.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `spikes/test-services-windows` and `spikes/foreign-runtimes` clean up ephemeral child processes and temp dirs deterministically on Windows (`F-002` verification).
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/shared-contracts/src/hashing/**`, `packages/shared-contracts/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit uppercase hex digits or allow unvalidated non-64-hex strings in `toPrefixedSha256` or `toBareSha256Hex`.
- Do not import `zod/v4` subpath in `packages/shared-contracts/src/hashing/**`; import standard `"zod"`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/spikes test && pnpm --filter @ef-harness/shared-contracts test -- hashing` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: All 5 M0 spike suites pass in `@ef-harness/spikes`, and round-trip unit tests prove `toBareSha256Hex(toPrefixedSha256(h)) === h` and `toPrefixedSha256(h) === "sha256:" + h`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `canonicalJson(value): string`, `canonicalSha256(value): Sha256Prefixed` (`'sha256:<64-hex>'`), `toPrefixedSha256(digest): Sha256Prefixed`, and `toBareSha256Hex(digest): string` exported from `@ef-harness/shared-contracts`.

Stop.
- Commit on `harness/integration` once spikes and hashing tests pass; do not edit `packets` or `prompts` yet.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C03 — `@ef-harness/shared-contracts` enforces non-vacuous check receipts, unified `zod` imports, unified `EvidenceLocator`, and frozen JSON-RPC & 32 `@1` prompt schemas.

Architecture.
- `kernel-schema-and-protocol.md` (Core Packet Schemas, Channel-0 JSON-RPC Envelope, `op_id` Idempotency, `stream.credit`, `EvidenceLocator`), `prompt-contracts.md` (All 32 `@1` Prompt Schemas).
- `IMPLEMENTATION_TASKS.md` (`Task 008`–`Task 009`).
- Post-task invariant: `@ef-harness/shared-contracts` enforces non-vacuous check receipts, unified `zod` imports, unified `EvidenceLocator`, and frozen JSON-RPC & 32 `@1` prompt schemas.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C02` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 008` (`task/008-core-packet-schemas` @ `9853d46`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas`, roots `packages/shared-contracts/src/packets, packages/shared-contracts/tests/packets`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 008`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas` covering `packages/shared-contracts/src/packets/receipt.ts`, `packages/shared-contracts/tests/packets/checkpoint.test.ts`.
- Unit `Task 009` (`task/009-prompt-contract-schemas` @ `3d7784d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas`, roots `packages/shared-contracts/src/prompts, packages/shared-contracts/tests/prompts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 009`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas` covering `packages/shared-contracts/src/prompts/common.ts`, `packages/shared-contracts/src/prompts/schemas/execution.ts`, `packages/shared-contracts/tests/prompts/schemas.test.ts`.
- Sequence note: Verify `task/008-core-packet-schemas` (`9853d46`) and `task/009-prompt-contract-schemas` (`3d7784d`) on `harness/integration`, AND apply the uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas` (`receipt.ts`, `checkpoint.test.ts`) and `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas` (`common.ts`, `execution.ts`, `schemas.test.ts`).

Freeze.
- `CheckOutcomeSchema` rejects `status: "pass"` when `collected_count === 0`.
- `EvidenceLocatorSchema` (discriminated union over `user_turn | doc_span | code_span | url_fetch | probe_receipt`) is the single locator schema re-exported as `LocatorSchema`.
- Canonical RPC schemas in `packages/shared-contracts/src/packets/rpc.ts`: snake_case params (`project_id`, `question_id`, `batch_id`), `op_id` required strictly on mutating RPCs (`artifact.open` read-only without `op_id`), `snapshot.get` cursor pagination, `stream_epoch: z.string().min(1)`, and `StreamCreditGrantSchema` (`{ stream_id: string, bytes: number }` positive integer).
- All 32 `@1` prompt input/output Zod schemas (`batch-resolve@1` through `visual-steer@1`, `cockpit-explainer@1`, `module-card-writer@1`, `ci-triage@1`, `investigator@1`, `sweep-planner@1`, `sweep-worker@1`) exported from `@ef-harness/shared-contracts`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-005`: Standardize every file in `packages/shared-contracts/src/**` on `import { z } from "zod"` (removing `"zod/v4"` subpaths) and alias `prompts/common.ts` `LocatorSchema` to `packets/locator.ts` `EvidenceLocatorSchema`.
2. `F-006`, `F-015`: Freeze `packets/rpc.ts` and `StreamCreditGrantSchema` as the sole RPC/stream wire authority (`packages/ipc` will delete its conflicting `ipc/schemas.ts` in `C12`–`C13`).

Local defects.
- `F-004`: Apply `task-008`'s uncommitted `CheckOutcomeSchema` refinement rejecting vacuous `status: "pass"` with `collected_count: 0`, plus `task-009`'s `execution.ts` prompt schema refinements.

Shared files.
- Integration-owned shared surfaces: `packages/shared-contracts/src/packets/**`, `packages/shared-contracts/src/prompts/**`, `packages/shared-contracts/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.

Do not.
- Do not leave duplicate incompatible `LocatorSchema` or `CockpitExplainer` definitions inside `shared-contracts`.
- Do not require `op_id` on read-only RPC methods (`snapshot.get`, `artifact.open`, `events.subscribe`, `health.ping`).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/shared-contracts test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CheckOutcomeSchema.safeParse({ status: "pass", collected_count: 0 })` returns `success: false`, and all 32 `@1` prompt contracts validate positive and negative fixtures.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `CheckOutcomeSchema`, `EvidenceLocatorSchema`, `RpcRequestSchema`, `RpcResponseSchema`, `StreamCreditGrantSchema`, and all 32 `*V1Schema` prompt contracts from `@ef-harness/shared-contracts`.

Stop.
- Commit on `harness/integration` once `@ef-harness/shared-contracts` packet and prompt tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C04 — Closed vocabularies (`TOUCHES_TAGS`, `ProjectKind`, `CrewPreset`, `PressureLevel`) and zero-leak `StreamingRedactor` observability are frozen across `@ef-harness/shared-contracts` and `@ef-harness/shared-observability`.

Architecture.
- `v1-knowledge-corpus.md` (28 Closed `touches` Tags, 6 Decision Bases, 8 Node Statuses, `X-01..X-14`, `UP-01..UP-08`), `observability-and-testing.md`, `sandbox-and-security.md`, `app-shell-and-governor.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 010`–`Task 011`).
- Post-task invariant: Closed vocabularies (`TOUCHES_TAGS`, `ProjectKind`, `CrewPreset`, `PressureLevel`) and zero-leak `StreamingRedactor` observability are frozen across `@ef-harness/shared-contracts` and `@ef-harness/shared-observability`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C03` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 010` (`task/010-closed-vocabularies` @ `d45eb68`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-010-closed-vocabularies`, roots `packages/shared-contracts/src/vocabularies, packages/shared-contracts/tests/vocabularies`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 011` (`task/011-logger-tracer-redactor` @ `f754213`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor`, roots `packages/shared-contracts/src/telemetry, packages/shared-contracts/tests/telemetry`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 011`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor` covering `.agent-handoffs/task-011.md`, `packages/shared-contracts/src/telemetry/redactor.ts`, `packages/shared-contracts/src/telemetry/tracer.ts`, `packages/shared-contracts/tests/telemetry/local-tracer.test.ts`, `packages/shared-contracts/tests/telemetry/secret-redactor.test.ts`.
- Sequence note: Verify `task/010-closed-vocabularies` (`d45eb68`) and `task/011-logger-tracer-redactor` (`f754213`) on `harness/integration`, AND apply all uncommitted diffs from `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor` (`redactor.ts`, `tracer.ts`, `local-tracer.test.ts`, `secret-redactor.test.ts`).

Freeze.
- `TOUCHES_TAGS` (exact 28 snake_case tags), `DECISION_BASES` (`explicit | confirmed | inferred_highentropy | delegated | observed | proposed`), `ProjectKind` (`"web_fullstack" | "web_static" | "backend_api" | "cli_tool" | "library"`), `WorkerTier` (`"Junior" | "Mid" | "Senior" | "Principal"`), `CrewPreset` (`"budget" | "balanced" | "thorough"`), `PressureLevel` (`"GREEN" | "YELLOW" | "ORANGE" | "RED"`), and `TaskHoldReason` (`"user_pause" | "requirement_change" | "budget" | "ccr" | "governor"`).
- `SecretRedactor`, `StreamingRedactor` (`StringDecoder` + pre-redaction tail-overlap holdback), `StructuredLogger`, `LocalTracer`, and `getSharedSecretRedactor()` exported from BOTH `@ef-harness/shared-contracts` and `@ef-harness/shared-observability`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-003`: Add `"@ef-harness/shared-contracts": "workspace:*"` to `packages/shared-observability/package.json`, re-export `SecretRedactor`, `StreamingRedactor`, `StructuredLogger`, `LocalTracer`, `getSharedSecretRedactor`, and `scanForSecrets`, and rewrite `redactSecrets(text)` to delegate to `getSharedSecretRedactor().redact(text)`.
2. `F-039`, `F-040`, `F-045`, `F-055`: Export canonical `ProjectKind`, `WorkerTier`, `CrewPreset`, `PressureLevel`, and `TaskHoldReason` enums from `packages/shared-contracts/src/vocab/index.ts`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-003`: Apply `task-011` fixes so `SecretRedactor.register` ignores short strings without wiping existing labels, `StreamingRedactor.push` uses `StringDecoder` across multi-byte UTF-8 boundaries, and chunk overlap holdback runs BEFORE `redact()` so split `sk_live_*` keys never leak their tails.

Shared files.
- Integration-owned shared surfaces: `packages/shared-contracts/src/vocab/**`, `packages/shared-contracts/src/telemetry/**`, `packages/shared-observability/package.json`, `packages/shared-observability/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not retain the broken `split(prefix).join("[redacted]")` implementation in `packages/shared-observability/src/index.ts`.
- Do not introduce alternative pressure casings (`"Green"` or `"green"`) in shared vocabularies.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/shared-observability test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Chunk-boundary tests prove `StreamingRedactor` redacts `sk_live_1234567890abcdef` split at every byte offset with `0` leaked tail bytes and lossless multi-byte UTF-8.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `TOUCHES_TAGS`, `ProjectKind`, `WorkerTier`, `CrewPreset`, `PressureLevel`, `TaskHoldReason` from `@ef-harness/shared-contracts` and `SecretRedactor`/`StreamingRedactor`/`StructuredLogger`/`LocalTracer` from `@ef-harness/shared-observability`.

Stop.
- Commit on `harness/integration` once Wave 0 contracts and observability pass all checks.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C05 — `@ef-harness/db` opens `state.db`, `global.db`, `telemetry.db`, and `code-index.db` through one `SqliteConnection` + `ReaderPool` contract with one canonical `ef_search_text` UDF and shared `queries.sql` loader.

Architecture.
- `database-design.md` (Four-DB Split, Zero `ATTACH`, Single-Writer WAL + `ReaderPool`, `ef_search_text` FTS5 Tokenizer), `schema/state.sql`, `schema/global.sql`, `schema/telemetry.sql`, `schema/code-index.sql`, `schema/queries.sql`, `schema/schema-test.js`.
- `IMPLEMENTATION_TASKS.md` (`Task 012`–`Task 014`).
- Post-task invariant: `@ef-harness/db` opens `state.db`, `global.db`, `telemetry.db`, and `code-index.db` through one `SqliteConnection` + `ReaderPool` contract with one canonical `ef_search_text` UDF and shared `queries.sql` loader.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C04` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 012` (`task/012-sqlite-driver-wrapper` @ `51c90de`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-012-sqlite-driver-wrapper`, roots `packages/db/src/driver, packages/db/tests/driver`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 013` (`task/013-state-db-bootstrap-safemode` @ `7baa1b6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-013-state-db-bootstrap-safemode`, roots `packages/db/src/state-db, packages/db/tests/state-db`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 014` (`task/014-global-telemetry-codeindex-dbs` @ `e4c80c0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-014-global-telemetry-codeindex-dbs`, roots `packages/db/src/auxiliary-dbs, packages/db/tests/auxiliary-dbs`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/012-sqlite-driver-wrapper` (`51c90de`), `task/013-state-db-bootstrap-safemode` (`7baa1b6`), and `task/014-global-telemetry-codeindex-dbs` (`e4c80c0`).

Freeze.
- `splitSearchText(input: unknown): string` (`XMLHttpRequest -> "XML Http Request"`, `camelCase`, `snake_case`, `kebab-case`, paths) registered as deterministic SQLite UDF `ef_search_text` on EVERY `state.db` writer and reader connection via `registerEfSearchText(db)`.
- `SqliteConnection` (single writer with `BEGIN IMMEDIATE` + nested `savepoint()`, `ATTACH` ban, WAL + `synchronous=NORMAL` + `foreign_keys=ON` + `busy_timeout=5000`), `ReaderPool` (`query_only=ON`), and single `loadNamedQueries()` parser for `schema/queries.sql`.
- `ProjectStateDb`, `GlobalBrokerDb`, `TelemetryDb`, and `CodeIndexDb` expose `.writer: SqliteConnection` and `.readers: ReaderPool`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-010`: Delete divergent `ef_search_text` implementations inside `packages/db/src/**` and bind all `SqliteConnection`/`ReaderPool` instances to `splitSearchText` matching `schema/schema-test.js`.
2. `F-012`: Export one shared `DbHandle` (`{ readonly writer: SqliteConnection; readonly readers: ReaderPool; query(name: string): string }`) and package-bundled SQL asset loader so `ProjectStateDb`, `GlobalBrokerDb`, `TelemetryDb`, and `CodeIndexDb` work both in monorepo checkouts and packaged `dist/`.

Local defects.
- Ensure `packages/db` build copies `schema/{state,global,telemetry,code-index,queries}.sql` (or resolves bundled SQL cleanly) without fragile `../../../../schema` relative crashes in packaged builds.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/driver/**`, `packages/db/src/state-db/**`, `packages/db/src/auxiliary-dbs/**`, `packages/db/src/index.ts`, `packages/db/package.json`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `ATTACH DATABASE` on any `SqliteConnection` or `ReaderPool` handle.
- Do not hard-reject `user_version > 1` (`C06` wires `MigrationRunner` directly into bootstrap).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `node schema/schema-test.js && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- driver state-db auxiliary` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `SELECT ef_search_text('parseXMLHttpRequest_v2')` returns `'parse XML Http Request v2'` identically across `ProjectStateDb` writer and `ReaderPool` connections.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SqliteConnection`, `ReaderPool`, `ProjectStateDb`, `GlobalBrokerDb`, `TelemetryDb`, `CodeIndexDb`, `splitSearchText`, and `loadNamedQueries` from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once driver and 4-DB bootstrap tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C06 — `ProjectStateDb`, `GlobalBrokerDb`, and `CodeIndexDb` execute forward `user_version` migrations cleanly with seeded `edge_types`, `canvas_layout`, `module_cards`, and 4-step corruption recovery.

Architecture.
- `database-design.md` (`user_version` Forward Migrations, Online Pre-Upgrade Backup, 4-Step Corruption Recovery, 12-Step Rebuild), `schema/state.sql` (`edge_types`), `schema/code-index.sql`.
- `IMPLEMENTATION_TASKS.md` (`Task 015`–`Task 016`).
- Post-task invariant: `ProjectStateDb`, `GlobalBrokerDb`, and `CodeIndexDb` execute forward `user_version` migrations cleanly with seeded `edge_types`, `canvas_layout`, `module_cards`, and 4-step corruption recovery.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C05` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 015` (`task/015-db-migration-engine` @ `0ddc371`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-015-db-migration-engine`, roots `packages/db/src/migrations, packages/db/tests/migrations`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 016` (`task/016-backups-corruption-recovery` @ `b674e4a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-016-backups-corruption-recovery`, roots `packages/db/src/recovery, packages/db/tests/recovery`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/015-db-migration-engine` (`0ddc371`) and `task/016-backups-corruption-recovery` (`b674e4a`).

Freeze.
- `MigrationRunner.migrateToLatest(conn: SqliteConnection)` runs automatically inside `ProjectStateDb.open()`, `GlobalBrokerDb.open()`, and `CodeIndexDb.open()`, supporting `user_version >= 1` forward migrations with pre-upgrade online backup (`BackupAndRecoveryManager`).
- Additive `state.db` migration `v2` seeds `edge_types` with `'expands'`, `'contradicts'`, and `'informs'` (`F-034`) and creates `canvas_layout` (`F-068`), `investigations`, and `sweep_symbol_maps` (`F-078`, `F-079`).
- additive `code-index.db` migration `v2` creates `module_cards` (`F-073`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-009`: Remove the `user_version !== 1` hard-fail guard in `ProjectStateDb` (`packages/db/src/state-db/**`) and `GlobalBrokerDb` (`packages/db/src/auxiliary-dbs/**`), delegating schema version checks and upgrades to `MigrationRunner`.
2. `F-034`, `F-068`, `F-073`, `F-078`, `F-079`: Register canonical additive migrations in `packages/db/src/migrations/` so downstream packages never execute ad-hoc `CREATE TABLE` DDL on rogue `DatabaseSync` handles.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `BackupAndRecoveryManager` (`016`) registers `registerEfSearchText` before running FTS5 `kb_words` rebuild steps during 4-step corruption recovery (`F-010`).

Shared files.
- Integration-owned shared surfaces: `packages/db/src/migrations/**`, `packages/db/src/recovery/**`, `packages/db/src/state-db/**`, `packages/db/src/auxiliary-dbs/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not edit frozen baseline `schema/state.sql` in ways that break `node schema/schema-test.js`; apply `v2` additions via `MigrationRunner` (or keep `schema/schema-test.js` 67/67 green).
- Do not unlink active `-wal` or `-shm` files while a `DatabaseSync` handle is open (`WAL` corruption hazard).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `node schema/schema-test.js && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- migrations recovery state-db` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Opening a `user_version = 1` `state.db` migrates cleanly to `v2` with pre-upgrade backup, and inserting edges of type `'expands'`, `'contradicts'`, and `'informs'` succeeds under `PRAGMA foreign_keys = ON`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `MigrationRunner`, `BackupAndRecoveryManager`, seeded `edge_types` (`expands`, `contradicts`, `informs`), `state.db.canvas_layout`/`investigations`/`sweep_symbol_maps`, and `code-index.db.module_cards`.

Stop.
- Commit on `harness/integration` once migration and recovery suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C07 — `KnowledgeGraphRepo`, `Fts5SearchRepo`, and `NameRegistryRepo` operate over the shared `ProjectStateDb` handle with canonical `sha256:<64-hex>` content hashes and `fields.names` trigger parity.

Architecture.
- `database-design.md` (Append-Revision Knowledge Graph, Contentless `kb_words` FTS5 Search, `names` Uniqueness Registry), `schema/state.sql` (`nodes`, `node_history`, `edges`, `kb_words`, `names`), `schema/queries.sql`.
- `IMPLEMENTATION_TASKS.md` (`Task 017`–`Task 019`).
- Post-task invariant: `KnowledgeGraphRepo`, `Fts5SearchRepo`, and `NameRegistryRepo` operate over the shared `ProjectStateDb` handle with canonical `sha256:<64-hex>` content hashes and `fields.names` trigger parity.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C06` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 017` (`task/017-knowledge-graph-repo` @ `a6ef07d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-017-knowledge-graph-repo`, roots `packages/db/src/knowledge, packages/db/tests/knowledge`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 018` (`task/018-fts5-knowledge-search` @ `baee148`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-018-fts5-knowledge-search`, roots `packages/db/src/search, packages/db/tests/search`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 019` (`task/019-name-registry-hygiene` @ `cea291d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-019-name-registry-hygiene`, roots `packages/db/src/registry, packages/db/tests/registry`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/017-knowledge-graph-repo` (`a6ef07d`), `task/018-fts5-knowledge-search` (`baee148`), and `task/019-name-registry-hygiene` (`cea291d`).

Freeze.
- `KnowledgeGraphRepo` accepts `ProjectStateDb` (or `SqliteConnection` + `ReaderPool`), computes `content_hash` via `canonicalSha256` (`"sha256:<64-hex>"`), persists `fields.names` as `[{ name: string, kind: string, scope?: string }]` firing `schema/state.sql`'s `names` trigger, and exposes `upsertNode`, `getNode`, `listNodesByKind`, `insertEdge`, `listEdges`, and `impactWalk`.
- `Fts5SearchRepo` queries contentless `kb_words` using `splitSearchText` query tokenization.
- `NameRegistryRepo` queries/validates `state.db.names` (`kind, scope, name, node`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-007`, `F-010`, `F-012`: Refactor `017`, `018`, and `019` to accept `ProjectStateDb` instead of isolated `DatabaseSync` constructors, remove duplicate `queries.sql` loaders, and enforce `toPrefixedSha256` on `nodes.content_hash`.
2. `F-038`: Ensure `NameRegistryRepo` and `KnowledgeGraphRepo` read/write `fields.names` in the exact JSON array shape expected by `schema/state.sql`'s `nodes_ai_names`/`nodes_au_names` triggers.

Local defects.
- Ensure `Fts5SearchRepo` escapes FTS5 operator tokens (`-`, `:`, `"`, `*`, `NEAR`) in user/agent free-text queries so arbitrary symbol or path queries never throw SQLite FTS5 syntax errors.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/knowledge-graph/**`, `packages/db/src/search/**`, `packages/db/src/names/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not open private `new DatabaseSync(...)` connections inside `KnowledgeGraphRepo`, `Fts5SearchRepo`, or `NameRegistryRepo`.
- Do not create non-contentless shadow FTS tables.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- knowledge search names` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Creating/updating a node via `KnowledgeGraphRepo` on `ProjectStateDb` populates `kb_words` (searchable via `Fts5SearchRepo` including `XMLHttpRequest` acronym splits) and `names` (verified via `NameRegistryRepo`) in one atomic transaction.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `KnowledgeGraphRepo`, `Fts5SearchRepo`, and `NameRegistryRepo` bound to `ProjectStateDb` from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once knowledge graph, FTS5, and name registry tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C08 — Task claiming, `path_leases`, independent `task_holds`, fenced submissions, and `DONE` lifecycle invariants run atomically on `ProjectStateDb` with uncommitted `task-022` bugfixes applied.

Architecture.
- `coordinator-and-recovery.md` (Atomic Claiming, Sleep-Wake Lease Grace, Fencing Epochs, Independent Hold Stack), `database-design.md`, `schema/state.sql` (`tasks`, `attempts`, `leases`, `path_leases`, `task_holds`, `features`).
- `IMPLEMENTATION_TASKS.md` (`Task 020`–`Task 022`).
- Post-task invariant: Task claiming, `path_leases`, independent `task_holds`, fenced submissions, and `DONE` lifecycle invariants run atomically on `ProjectStateDb` with uncommitted `task-022` bugfixes applied.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C07` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 020` (`task/020-task-claiming-leases-sleep-guard` @ `336e7e5`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-020-task-claiming-leases-sleep-guard`, roots `packages/db/src/leases, packages/db/tests/leases`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 021` (`task/021-holds-submissions-fencing` @ `4f5c3f6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-021-holds-submissions-fencing`, roots `packages/db/src/holds, packages/db/tests/holds`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 022` (`task/022-feature-project-lifecycles` @ `a3c8977`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles`, roots `packages/db/src/lifecycles, packages/db/tests/lifecycles`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 022`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles` covering `packages/db/src/lifecycles/done.ts`, `packages/db/src/lifecycles/repo.ts`.
- Sequence note: Verify `task/020-task-claiming-leases-sleep-guard` (`336e7e5`), `task/021-holds-submissions-fencing` (`4f5c3f6`), and `task/022-feature-project-lifecycles` (`a3c8977`) on `harness/integration`, AND apply the uncommitted working-tree diff from `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles` (`packages/db/src/lifecycles/done.ts`, `repo.ts`).

Freeze.
- `TaskClaimLeasesRepo` (`claimNextReadyTask`, `renewLease`, `applySleepWakeGrace`, `acquirePathLease(mode: 'write' | 'intent' | 'exclusive')`, `promoteSweepIntentToExclusive`, `releasePathLease`) backed by `state.db.leases` and `state.db.path_leases`.
- `HoldsAndSubmissionsRepo` (`placeHold`, `releaseHold`, `listActiveHolds`, `fenceSubmission`) enforcing `TaskHoldReason` (`'user_pause' | 'requirement_change' | 'budget' | 'ccr' | 'governor'`).
- `LifecycleRepo` enforcing all `DONE` invariants (`coversScope`, `contractsCurrent`, `preBlockState` restoration on `BLOCKED` unblock, and approved exit persistence).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-039`, `F-079`: Bind `020`, `021`, and `022` to `ProjectStateDb` (`SqliteConnection` + `ReaderPool`), expose two-phase sweep `path_leases` (`'intent' -> 'exclusive'`) on `TaskClaimLeasesRepo` for `Task 184`, and enforce `schema/state.sql`'s 5 `task_holds.reason` values.

Local defects.
- `F-008`: Apply `task-022` uncommitted fixes correcting the inverted `coversScope` path-prefix check in `done.ts`, pinning `contractsCurrent` against compiled brief revision, preserving pre-block task state across `BLOCKED` transitions, and persisting approved project/feature exit gates.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/claiming/**`, `packages/db/src/holds/**`, `packages/db/src/lifecycles/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not insert non-schema hold reasons (`'user_paused'`, `'revision_in_flight'`, `'waiting_on_human_step'`) into `state.db.task_holds`.
- Do not insert `'granted'` into `state.db.path_leases.mode` (`CHECK` allows `'write' | 'intent' | 'exclusive'`).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- claiming holds lifecycles` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Unit tests verify `coversScope` rejects uncovered sibling paths, `path_leases` transitions `'intent' -> 'exclusive'` atomically blocking new overlapping task claims, and releasing one hold reason preserves remaining active holds.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `TaskClaimLeasesRepo`, `HoldsAndSubmissionsRepo`, and `LifecycleRepo` exported from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once claiming, holds, and lifecycle suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C09 — Integer `micro-USD`/`ppm` budget reservations, two-phase `global.db` ↔ `state.db` grants, and savepoint group-commit `CoordinatorWriteQueue` operate atomically without floats or `ATTACH`.

Architecture.
- `database-design.md` (Integer `micro-USD` & `ppm` Budgets, Two-Phase Cross-DB Grants Without `ATTACH`, `operations` Idempotency & Savepoint Group-Commit), `schema/state.sql` (`budgets`, `budget_ledger`, `operations`), `schema/global.sql` (`grants`).
- `IMPLEMENTATION_TASKS.md` (`Task 023`–`Task 025`).
- Post-task invariant: Integer `micro-USD`/`ppm` budget reservations, two-phase `global.db` ↔ `state.db` grants, and savepoint group-commit `CoordinatorWriteQueue` operate atomically without floats or `ATTACH`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C08` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 023` (`task/023-budget-reservation-ledger` @ `96649df`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-023-budget-reservation-ledger`, roots `packages/db/src/ledger, packages/db/tests/ledger`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 024` (`task/024-cross-db-grant-protocol` @ `e16d754`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-024-cross-db-grant-protocol`, roots `packages/db/src/grants, packages/db/tests/grants`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 025` (`task/025-idempotency-group-commit` @ `b0a731a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-025-idempotency-group-commit`, roots `packages/db/src/write-queue, packages/db/tests/write-queue`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/023-budget-reservation-ledger` (`96649df`), `task/024-cross-db-grant-protocol` (`e16d754`), and `task/025-idempotency-group-commit` (`b0a731a`).

Freeze.
- `BudgetReservationLedger` (`reserve`, `settle`, `release`, `getScopeSnapshot`, `setHardStop`) storing strictly integer `micro_usd` and `ppm` units in `state.db.budgets` + `budget_ledger`.
- `CrossDbGrantProtocol` / `BrokerGrantIssuer` (`issueGrant`, `depositGrant`, `closeGrant`, `reclaimExpiredGrants`) coordinating `global.db.grants` and `state.db` with zero `ATTACH DATABASE`.
- `CoordinatorWriteQueue` (`enqueueSync<T>(op)` + `enqueue<T>(op): Promise<T>`, `executeIdempotent(opId, kind, payloadHash, fn)`) batching concurrent writes via SQLite `SAVEPOINT` inside one `BEGIN IMMEDIATE` transaction.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-013`, `F-047`, `F-065`, `F-081`: Bind `023`, `024`, and `025` onto `ProjectStateDb` and `GlobalBrokerDb`, exposing both synchronous and Promise-wrapped `CoordinatorWriteQueue` entrypoints plus `getScopeSnapshot` so `ipc` (`032`), `integrator` (`101`), `cockpit` (`128`), and `portability` (`188`) share one ledger and write queue.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `IdempotencyOpsManager` (`025`) hashes operation payloads with `canonicalSha256` (`C02`) and rejects `op_id` replay when `payload_hash` differs.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/budget/**`, `packages/db/src/grants/**`, `packages/db/src/write-queue/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not store floating-point dollar or percentage values in `budgets`, `budget_ledger`, or `grants`.
- Do not roll back sibling savepoints in a group-commit batch when a single enqueued item throws a domain validation error.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- budget grants idempotency group-commit` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: 50 concurrent budget reservation calls against the last remaining `micro_usd` unit result in exactly `1` winner and `49` clean `InsufficientBudgetError` rejections with `0` `SQLITE_BUSY` errors.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BudgetReservationLedger`, `CrossDbGrantProtocol`, `BrokerGrantIssuer`, `IdempotencyOpsManager`, and `CoordinatorWriteQueue` from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once budget, grant, and group-commit suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C10 — `TransactionalOutboxRepo` pairs `outbox` and `outbox_deliveries` atomically and `ReadModelsAndRollupsRepo` serves cockpit/board/drift projections from `ProjectStateDb`.

Architecture.
- `database-design.md` (Transactional Outbox & Delivery Guard Trigger, Incremental Rollups & Drift Recompute), `kernel-schema-and-protocol.md` (`events.subscribe` Monotonic `seq`), `schema/state.sql` (`outbox`, `outbox_deliveries`, `rollups`).
- `IMPLEMENTATION_TASKS.md` (`Task 026`–`Task 027`).
- Post-task invariant: `TransactionalOutboxRepo` pairs `outbox` and `outbox_deliveries` atomically and `ReadModelsAndRollupsRepo` serves cockpit/board/drift projections from `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C09` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 026` (`task/026-transactional-outbox` @ `ce1ab76`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-026-transactional-outbox`, roots `packages/db/src/outbox, packages/db/tests/outbox`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 027` (`task/027-read-models-rollups-drift` @ `a95c149`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-027-read-models-rollups-drift`, roots `packages/db/src/read-models, packages/db/tests/read-models`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/026-transactional-outbox` (`ce1ab76`) and `task/027-read-models-rollups-drift` (`a95c149`).

Freeze.
- `TransactionalOutboxRepo` (`appendEvent`, `readSinceSeq`, `ackDelivery`, `currentStreamEpoch`) inserting `outbox` AND target consumer rows in `outbox_deliveries` inside the same savepoint so `schema/state.sql`'s `outbox_without_deliveries` trigger is satisfied.
- `ReadModelsAndRollupsRepo` (`getBoardSnapshot`, `getFeatureRollups`, `recomputeRollupsAndVerifyZeroDrift`) bound to `ProjectStateDb.readers` and `CoordinatorWriteQueue`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-013`, `F-026`, `F-064`: Bind `TransactionalOutboxRepo` and `ReadModelsAndRollupsRepo` to `ProjectStateDb` and expose the exact cursor-paginated `getBoardSnapshot(cursor?, limit?)` and `readSinceSeq(streamEpoch, afterSeq, limit)` methods consumed by `@ef-harness/ipc` (`032`), `apps/daemon` (`067`), and `BoardCockpitView` (`124`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `stream_epoch` in `state.db.meta` is read and returned as a non-empty `string` matching `shared-contracts` `RpcEventEnvelopeSchema` (`F-006`).
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/outbox/**`, `packages/db/src/read-models/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not insert into `state.db.outbox` without inserting at least one matching `outbox_deliveries` row in the same transaction.
- Do not run full-table `COUNT(*)` scans on the hot render path when `rollups` rows are current.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test -- outbox read-models rollups` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Appending events through `CoordinatorWriteQueue` + `TransactionalOutboxRepo` satisfies `schema/state.sql` triggers (`0` `outbox_without_deliveries` aborts) and `recomputeRollupsAndVerifyZeroDrift()` proves `0` drift.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `TransactionalOutboxRepo` and `ReadModelsAndRollupsRepo` exported from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once outbox and rollup suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C11 — `@ef-harness/db` exposes one unified `CasBlobStore` (`sha256` prefix/hex safe), `zstd` seekable log archiver, `EffectsRepo`, and raw-byte-verified 8-step `SecretPurgeEngine`.

Architecture.
- `database-design.md` (Content-Addressed Blob Store, Windows `EBUSY` Rename Retry, `zstd` Seekable Log Frames >1 MB, 8-Step Secret Purge with `VACUUM` + WAL Truncate), `schema/state.sql` (`cas_blobs`, `artifacts`, `effects`).
- `IMPLEMENTATION_TASKS.md` (`Task 028`–`Task 030`).
- Post-task invariant: `@ef-harness/db` exposes one unified `CasBlobStore` (`sha256` prefix/hex safe), `zstd` seekable log archiver, `EffectsRepo`, and raw-byte-verified 8-step `SecretPurgeEngine`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C10` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 028` (`task/028-cas-artifact-store-gc` @ `49ff155`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-028-cas-artifact-store-gc`, roots `packages/db/src/cas, packages/db/tests/cas`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 029` (`task/029-seekable-logs-retention-archive` @ `e289bb9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-029-seekable-logs-retention-archive`, roots `packages/db/src/artifacts, packages/db/tests/artifacts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 030` (`task/030-secret-purge-engine` @ `71bacaa`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-030-secret-purge-engine`, roots `packages/db/src/secret-purge, packages/db/tests/secret-purge`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/028-cas-artifact-store-gc` (`49ff155`), `task/029-seekable-logs-retention-archive` (`e289bb9`), and `task/030-secret-purge-engine` (`71bacaa`).

Freeze.
- Single unified `CasBlobStore` class & interface (`put(bytes, opts?): CasPutReceipt`, `getBytes(digest): Uint8Array | null`, `openReadStream(digest, range?): AsyncIterable<Uint8Array>`, `has(digest): boolean`, `deleteUnreferencedGc()`, `purgeDigestBytes(digest)`), accepting BOTH `"sha256:<64-hex>"` and bare `<64-hex>` via `toBareSha256Hex`/`toPrefixedSha256` (`C02`) while storing bare `<64-hex>` in `cas_blobs.hash`.
- `SeekableLogArchiver` (`029`), `EffectsRepo` (`029`/`176`), and `SecretPurgeEngine` (`030`, executing all 8 purge steps including FTS5 rebuild via `registerEfSearchText`, CAS blob overwrite/unlink, `PRAGMA wal_checkpoint(TRUNCATE)`, and `VACUUM`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-007`, `F-011`, `F-012`: Collapse the 3 conflicting CAS interfaces inside `packages/db` (`cas/store.ts`, `artifacts/cas-port.ts`, `secret-purge/cas-store.ts`) into the single `CasBlobStore` contract and wire `SeekableLogArchiver` and `SecretPurgeEngine` directly to `CasBlobStore` + `ProjectStateDb`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-010`: Replace `SecretPurgeEngine`'s local FTS tokenizer stub with `registerEfSearchText` (`C05`) so step-4 FTS5 rebuild preserves exact `kb_words` parity.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/db/src/cas/**`, `packages/db/src/artifacts/**`, `packages/db/src/logs/**`, `packages/db/src/secret-purge/**`, `packages/db/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not leave multiple incompatible `CasBlobStore` interfaces in `@ef-harness/db`.
- Do not skip `VACUUM` or `PRAGMA wal_checkpoint(TRUNCATE)` in `SecretPurgeEngine` (deleted SQLite pages would retain raw secret bytes).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `SeekableLogArchiver` archives a >1 MB log into `CasBlobStore` and reads arbitrary byte ranges back, and `SecretPurgeEngine` leaves `0` raw secret bytes across `state.db`, `state.db-wal`, `kb_words`, and CAS files.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on unified `CasBlobStore`, `ArtifactCatalogRepo`, `SeekableLogArchiver`, `EffectsRepo`, and `SecretPurgeEngine` from `@ef-harness/db`.

Stop.
- Commit on `harness/integration` once `@ef-harness/db` is 100% unified and green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C12 — `@ef-harness/ipc` runs 5-byte framed Windows named-pipe JSON-RPC and gap-free outbox event resync bound directly to `@ef-harness/shared-contracts` and `@ef-harness/db`.

Architecture.
- `kernel-schema-and-protocol.md` (`\\.\pipe\efharness-<user>` Named Pipe ACLs, 5-Byte `[channel:u8, length:u32be]` Framing, `session.hello`, Mutating `op_id`, `events.subscribe` Gap-Free Resync & `stream_epoch`).
- `IMPLEMENTATION_TASKS.md` (`Task 031`–`Task 032`).
- Post-task invariant: `@ef-harness/ipc` runs 5-byte framed Windows named-pipe JSON-RPC and gap-free outbox event resync bound directly to `@ef-harness/shared-contracts` and `@ef-harness/db`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C11` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 031` (`task/031-named-pipe-ipc-transport` @ `e23f4fe`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-031-named-pipe-ipc-transport`, roots `packages/ipc/src/transport, packages/ipc/tests/transport`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 032` (`task/032-ipc-event-stream-resync` @ `2117d11`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-032-ipc-event-stream-resync`, roots `packages/ipc/src/protocol, packages/ipc/tests/protocol`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/031-named-pipe-ipc-transport` (`e23f4fe`) and `task/032-ipc-event-stream-resync` (`2117d11`).

Freeze.
- `FrameCodec` exposes BOTH static `FrameCodec.encode(channel, payload)` / `FrameCodec.decode(...)` and instance methods (`new FrameCodec()`), enforcing `maxFrameBytes` caps.
- `NamedPipeRpcServer` & `NamedPipeRpcClient` validate every Channel-0 message against `@ef-harness/shared-contracts` `packets/rpc.ts` (`project_id`, `question_id`, `batch_id`, `stream_epoch: string`, `op_id` on mutating methods only) and bind directly to `@ef-harness/db` `CoordinatorWriteQueue`, `TransactionalOutboxRepo`, and `ReadModelsAndRollupsRepo`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-003`: Replace `packages/ipc/src/transport/redaction.ts` `LocalSecretRedactor` with `@ef-harness/shared-observability` `SecretRedactor`.
2. `F-006`, `F-013`, `F-014`: Delete conflicting RPC schema definitions in `packages/ipc/src/schemas.ts` in favor of `@ef-harness/shared-contracts` `packets/rpc.ts`, add `@ef-harness/db: workspace:*` to `packages/ipc/package.json`, bind `032` adapters to real `CoordinatorWriteQueue` + `TransactionalOutboxRepo` + `ReadModelsAndRollupsRepo`, and expose static+instance `FrameCodec.encode`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `events.subscribe` emits an explicit `epoch_reset` control notification with the new string `stream_epoch` + snapshot cursor whenever `client.stream_epoch !== db.stream_epoch` instead of throwing an unhandled error.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/ipc/package.json`, `packages/ipc/src/transport/**`, `packages/ipc/src/resync/**`, `packages/ipc/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not accept camelCase `projectId`/`questionId` wire aliases that diverge from `shared-contracts/src/packets/rpc.ts`.
- Do not emit raw unredacted payloads in IPC transport logs.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/ipc test -- transport resync` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Named-pipe loopback tests prove `session.hello`, mutating RPC `op_id` deduplication via `CoordinatorWriteQueue`, and gap-free `events.subscribe` replay + `stream_epoch` reset recovery over real `ProjectStateDb`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `FrameCodec`, `NamedPipeRpcServer`, `NamedPipeRpcClient`, and `OutboxEventStreamer` from `@ef-harness/ipc`.

Stop.
- Commit on `harness/integration` once IPC transport and resync tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C13 — Channel-1 64 KB credit-windowed binary streaming binds to `CasBlobStore` and `@ef-harness/sim` M0 Exit Gate certifies the real `@ef-harness/db` + `@ef-harness/ipc` kernel.

Architecture.
- `kernel-schema-and-protocol.md` (Channel-1 64 KB Chunked Binary Streaming & `stream.credit` Flow Control), `roadmap.md` (M0 Deterministic Kernel Simulation Exit Gate).
- `IMPLEMENTATION_TASKS.md` (`Task 033`–`Task 034`).
- Post-task invariant: Channel-1 64 KB credit-windowed binary streaming binds to `CasBlobStore` and `@ef-harness/sim` M0 Exit Gate certifies the real `@ef-harness/db` + `@ef-harness/ipc` kernel.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C12` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 033` (`task/033-binary-artifact-streaming` @ `6dfa32b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-033-binary-artifact-streaming`, roots `packages/ipc/src/streams, packages/ipc/tests/streams`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 034` (`task/034-m0-deterministic-sim-exit-gate` @ `15c4663`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-034-m0-deterministic-sim-exit-gate`, roots `packages/sim/src/m0, packages/sim/tests/m0`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/033-binary-artifact-streaming` (`6dfa32b`) and `task/034-m0-deterministic-sim-exit-gate` (`15c4663`).

Freeze.
- `BinaryArtifactStreamServer` & `CreditWindowedStreamReader` (`033`) use `@ef-harness/shared-contracts` `StreamCreditGrantSchema` (`{ stream_id, bytes }`), `FrameCodec` (`channel = 1`), and `@ef-harness/db` `CasBlobStore.openReadStream` (`toBareSha256Hex` / `toPrefixedSha256` safe).
- `M0DeterministicSimHarness` (`034` in `@ef-harness/sim`) drives real `ProjectStateDb`, `GlobalBrokerDb`, `CoordinatorWriteQueue`, `TransactionalOutboxRepo`, `CasBlobStore`, and `@ef-harness/ipc` under seeded virtual-clock fault injection.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-007`, `F-011`, `F-013`, `F-014`, `F-015`: Wire `packages/ipc/src/streams/**` to `FrameCodec`, `StreamCreditGrantSchema`, `artifact.open` (read-only RPC without `op_id`), and `CasBlobStore`.
2. `F-016`: Add `@ef-harness/db: workspace:*` and `@ef-harness/ipc: workspace:*` to `packages/sim/package.json` and replace `packages/sim`'s standalone mock SQL/CAS/pipe model with real `@ef-harness/db` + `@ef-harness/ipc` instances.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `BinaryArtifactStreamServer` pauses chunk emission cleanly when available credit reaches `0` bytes (never throwing or overflowing renderer memory) and resumes immediately on `stream.credit`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/ipc/src/streams/**`, `packages/ipc/src/index.ts`, `packages/sim/package.json`, `packages/sim/src/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not keep disconnected mock SQLite/IPC engines as the subject under test in `packages/sim`.
- Do not send binary chunks exceeding `65536` bytes or exceeding granted `stream.credit`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/ipc test && pnpm --filter @ef-harness/sim test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Streaming a 4 MB CAS log over Channel 1 with a 128 KB credit window pauses/resumes with exact SHA-256 parity, and `M0DeterministicSimHarness` passes 100% of seeded crash/reconnect runs against real `ProjectStateDb` + `NamedPipeRpcServer`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BinaryArtifactStreamServer`, `CreditWindowedStreamReader` (`@ef-harness/ipc`), and `M0DeterministicSimHarness` (`@ef-harness/sim`).

Stop.
- Commit on `harness/integration` once Wave 1 (`db`, `ipc`, `sim`) is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C14 — `@ef-harness/git-engine` provides one hermetic-first `GitRunner` (with dev `PATH` fallback), `SafetyScanner`, and `DirtySnapshotEngine`.

Architecture.
- `workspace-and-git.md` (Bundled Portable MinGit, Folder State Detection, `GIT_INDEX_FILE` Dirty Snapshots, Secret/Binary Pre-Commit Safety), `sandbox-and-security.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 035`–`Task 037`).
- Post-task invariant: `@ef-harness/git-engine` provides one hermetic-first `GitRunner` (with dev `PATH` fallback), `SafetyScanner`, and `DirtySnapshotEngine`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C13` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 035` (`task/035-mingit-wrapper-folder-states` @ `33895fd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-035-mingit-wrapper-folder-states`, roots `packages/git-engine/src/runner, packages/git-engine/tests/runner`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 036` (`task/036-git-safety-scanner` @ `5872b0a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-036-git-safety-scanner`, roots `packages/git-engine/src/safety-scan, packages/git-engine/tests/safety-scan`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 037` (`task/037-temp-index-snapshots` @ `fe092d2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-037-temp-index-snapshots`, roots `packages/git-engine/src/snapshots, packages/git-engine/tests/snapshots`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/035-mingit-wrapper-folder-states` (`33895fd`), `task/036-git-safety-scanner` (`5872b0a`), and `task/037-temp-index-snapshots` (`fe092d2`).

Freeze.
- `GitRunner` (`exec(args: readonly string[], opts?: GitExecOptions): Promise<GitExecResult>` and `execSync(args: readonly string[], opts?: GitExecOptions): GitExecResult`) with stripped `GIT_CONFIG_GLOBAL`/`GIT_TERMINAL_PROMPT=0` and `core.quotepath=false`.
- `resolveGitBinary(opts?)`: uses bundled portable MinGit (`EF_MINGIT_PATH` / packaged `resources/bin/mingit/cmd/git.exe`) unconditionally when `packaged === true`, and falls back cleanly to verified `git` on `PATH` only in unpackaged dev/test checkouts.
- `MinGitRepoInspector` (`035`), `SafetyScanner` (`036` `gitleaks` + regex fallback), and `DirtySnapshotEngine` (`037` isolated `GIT_INDEX_FILE` tree snapshots without touching `.git/index`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-017`: Consolidate the 5 competing `GitRunner` interfaces across `packages/git-engine/src/**` into the single frozen `GitRunner` exported from `@ef-harness/git-engine`, wiring `SafetyScanner` and `DirtySnapshotEngine` onto it.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-017`: Fix `resolveGitBinary` so unpackaged developer/CI runs without `resources/bin/mingit` resolve `git` cleanly instead of throwing `BundledMinGitNotFoundError`, while `EF_HARNESS_PACKAGED === '1'` still enforces bundled MinGit.

Shared files.
- Integration-owned shared surfaces: `packages/git-engine/src/mingit/**`, `packages/git-engine/src/safety/**`, `packages/git-engine/src/snapshots/**`, `packages/git-engine/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not run `git stash` or mutate the developer's `.git/index` inside `DirtySnapshotEngine`.
- Do not allow interactive credential prompts (`GIT_TERMINAL_PROMPT` must be `"0"`).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/git-engine test -- mingit safety snapshots` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `DirtySnapshotEngine` captures untracked and modified files via a temporary `GIT_INDEX_FILE` leaving `git status` byte-identical, and `SafetyScanner` blocks planted `sk_live_` / `AKIA` secrets.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `GitRunner`, `resolveGitBinary`, `MinGitRepoInspector`, `SafetyScanner`, and `DirtySnapshotEngine` from `@ef-harness/git-engine`.

Stop.
- Commit on `harness/integration` once `035–037` tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C15 — `WorktreeSlotPool` and `RefLeaseAndCasManager` manage isolated Git worktrees and compare-and-swap ref updates over `ProjectStateDb` `ref_leases`.

Architecture.
- `workspace-and-git.md` (Reusable Worktree Slot Pool `wt/<project>/slot-*`, Atomic CAS `git update-ref` & `state.db.ref_leases`), `schema/state.sql` (`ref_leases`).
- `IMPLEMENTATION_TASKS.md` (`Task 038`–`Task 039`).
- Post-task invariant: `WorktreeSlotPool` and `RefLeaseAndCasManager` manage isolated Git worktrees and compare-and-swap ref updates over `ProjectStateDb` `ref_leases`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C14` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 038` (`task/038-worktree-slot-manager` @ `04aa278`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-038-worktree-slot-manager`, roots `packages/git-engine/src/worktrees, packages/git-engine/tests/worktrees`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 039` (`task/039-branch-ref-leases-cas` @ `68c4d3f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-039-branch-ref-leases-cas`, roots `packages/git-engine/src/refs, packages/git-engine/tests/refs`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/038-worktree-slot-manager` (`04aa278`) and `task/039-branch-ref-leases-cas` (`68c4d3f`).

Freeze.
- `WorktreeSlotPool` (`acquire(opts: { slotKind, baseRef, clean?: boolean }): Promise<WorktreeSlot>`, `release(slotId): Promise<void>`, `pruneStaleSlots()`).
- `RefLeaseAndCasManager` (`acquireRefLease(ref, holder, expectedSha?, ttlMs?)`, `casUpdateRef(ref, newSha, expectedOldSha, leaseEpoch)`, `releaseRefLease(ref, holder)`) persisted strictly in `ProjectStateDb` `schema/state.sql` `ref_leases(ref, holder, epoch, expected_sha, expires_at)`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-017`: Add `@ef-harness/db: workspace:*` to `packages/git-engine/package.json`, delete `039`'s rogue private `ref_leases` DDL, and bind `WorktreeSlotPool` and `RefLeaseAndCasManager` to `GitRunner` (`C14`) and `ProjectStateDb` (`C05`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `WorktreeSlotPool.acquire` retries Windows `EBUSY`/`EPERM` unlink/reset transients with bounded backoff and verifies detached clean status before handing a slot to a worker or verifier.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/git-engine/package.json`, `packages/git-engine/src/worktrees/**`, `packages/git-engine/src/ref-leases/**`, `packages/git-engine/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not force-update `harness/integration` or `main` without passing `expectedOldSha` to `git update-ref`.
- Do not open a separate `DatabaseSync` connection on `state.db` inside `packages/git-engine`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/git-engine test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Concurrent `casUpdateRef` races on `harness/integration` over `ProjectStateDb` `ref_leases` let exactly 1 writer win while rejecting the stale expected-SHA caller cleanly.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `WorktreeSlotPool` and `RefLeaseAndCasManager` exported from `@ef-harness/git-engine`.

Stop.
- Commit on `harness/integration` once `@ef-harness/git-engine` is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C16 — `@ef-harness/sandbox` enforces real Windows Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) and Tier A/B OS process isolation.

Architecture.
- `sandbox-and-security.md` (Windows Job Objects `KILL_ON_JOB_CLOSE`, Tier A AppContainer/MXC, Tier B Restricted Worker Users & Explicit Per-Slot ACLs), `research/windows-sandboxing.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 040`–`Task 042`).
- Post-task invariant: `@ef-harness/sandbox` enforces real Windows Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) and Tier A/B OS process isolation.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C15` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 040` (`task/040-windows-job-objects` @ `ddcffc7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-040-windows-job-objects`, roots `packages/sandbox/src/job-objects, packages/sandbox/tests/job-objects`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 041` (`task/041-sandbox-tier-a-mxc` @ `bca08dd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-041-sandbox-tier-a-mxc`, roots `packages/sandbox/src/tier-a-mxc, packages/sandbox/tests/tier-a-mxc`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 042` (`task/042-sandbox-tier-b-users` @ `1b8a413`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-042-sandbox-tier-b-users`, roots `packages/sandbox/src/tier-b-users, packages/sandbox/tests/tier-b-users`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/040-windows-job-objects` (`ddcffc7`), `task/041-sandbox-tier-a-mxc` (`bca08dd`), and `task/042-sandbox-tier-b-users` (`1b8a413`).

Freeze.
- `WindowsJobObjectManager` (`createJob(limits): Promise<JobHandle>`, `assignProcess(job, pid)`, `terminateAndClose(job): Promise<void>`, guaranteeing `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `activeProcesses === 0` teardown without blocking the Node main thread).
- `SandboxTierARunner` (`041`) and `SandboxTierBRunner` (`042`) implementing `SandboxTierRunner { readonly tier: 'A' | 'B' | 'C' | 'D'; probe(): Promise<TierProbeResult>; spawnSandboxed(req: SandboxedSpawnRequest): Promise<SandboxedProcessReceipt> }`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-022`, `F-060`, `F-070`: Export `WindowsJobObjectManager` and `JobHandle` cleanly from `@ef-harness/sandbox` as the single Job Object supervisor consumed by `test-env` (`049`), `runtime-adapters` (`142`), `dictation` (`157`), and `daemon/preview` (`160`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Verify `SandboxTierBRunner` revokes per-slot ACL grants in `finally` on exit/timeout so recycled `WorktreeSlotPool` directories never retain stale ACL entries.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/sandbox/src/job-objects/**`, `packages/sandbox/src/tier-a/**`, `packages/sandbox/src/tier-b/**`, `packages/sandbox/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not use `Atomics.wait` on the main event loop thread or fake `killOnJobClose = true` with plain `child.kill()`.
- Do not grant worker processes read access to `%USERPROFILE%\.ssh`, `%APPDATA%`, or sealed-check directories.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/sandbox test -- job tier-a tier-b` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Spawning a `SIGINT`-ignoring parent+grandchild tree inside `WindowsJobObjectManager` and closing the job leaves `0` surviving PIDs on Windows.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `WindowsJobObjectManager`, `SandboxTierARunner`, `SandboxTierBRunner`, and `SandboxTierRunner` from `@ef-harness/sandbox`.

Stop.
- Commit on `harness/integration` once Job Object and Tier A/B tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C17 — `SandboxTierSelector` (Tiers A–D), `AllowlistProxyServer`, and `SecureDocFetcher` connect end-to-end with SSRF-safe allowlisted HTTP fetching.

Architecture.
- `sandbox-and-security.md` (Tier C Restricted Token + Job + Loopback Proxy, Tier D Container Fallback, `AllowlistProxyServer`, `SecureDocFetcher` HTML/Redirect/SSRF Hygiene).
- `IMPLEMENTATION_TASKS.md` (`Task 043`–`Task 045`).
- Post-task invariant: `SandboxTierSelector` (Tiers A–D), `AllowlistProxyServer`, and `SecureDocFetcher` connect end-to-end with SSRF-safe allowlisted HTTP fetching.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C16` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 043` (`task/043-sandbox-tier-c-d-selector` @ `4337b83`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-043-sandbox-tier-c-d-selector`, roots `packages/sandbox/src/tier-c-d-selector, packages/sandbox/tests/tier-c-d-selector`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 044` (`task/044-loopback-allowlist-proxy` @ `d534d12`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-044-loopback-allowlist-proxy`, roots `packages/sandbox/src/proxy, packages/sandbox/tests/proxy`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 045` (`task/045-secure-doc-fetcher` @ `d26eee9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-045-secure-doc-fetcher`, roots `packages/sandbox/src/doc-fetcher, packages/sandbox/tests/doc-fetcher`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/043-sandbox-tier-c-d-selector` (`4337b83`), `task/044-loopback-allowlist-proxy` (`d534d12`), and `task/045-secure-doc-fetcher` (`d26eee9`).

Freeze.
- `SandboxTierSelector` (`selectBestAvailableTier(req): Promise<SandboxTierRunner>`) probing Tiers `A -> B -> C -> D` and refusing unsandboxed host fallback unless an explicit test-only override is passed.
- `AllowlistProxyServer` (`start()`, `stop()`, `port`, `proxyUrl`, AND `fetch(url: string, init?: SecureProxyFetchInit): Promise<ProxyFetchResponse>`) blocking RFC 1918/link-local/loopback/metadata IPs (except registered `AttemptMcpServer` loopback route) and non-allowlisted domains.
- `SecureDocFetcher` (`fetchCleanDoc(url, opts): Promise<CleanDocResult>`) bound directly to `AllowlistProxyServer.fetch`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-019`: Implement `fetch(url, init)` directly on `AllowlistProxyServer` (`packages/sandbox/src/proxy/**`) matching `SecureDocFetcher`'s proxy port contract and wire `SecureDocFetcher` (`045`) to `AllowlistProxyServer` (`044`).
2. `F-036`, `F-060`: Export `AllowlistProxyServer` (`proxyUrl`) and `SecureDocFetcher` (`fetchCleanDoc`) from `@ef-harness/sandbox` for `research-engine` (`082`) and `runtime-adapters` (`144`).

Local defects.
- Ensure `SecureDocFetcher` strips `<script>`, `<style>`, HTML comments, `display:none`/`visibility:hidden` blocks, and Unicode tag-block prompt-injection characters before returning extracted text.

Shared files.
- Integration-owned shared surfaces: `packages/sandbox/src/tier-selector/**`, `packages/sandbox/src/proxy/**`, `packages/sandbox/src/doc-fetcher/**`, `packages/sandbox/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow DNS rebinding or HTTP `302` redirects from an allowlisted host to `127.0.0.1` / `169.254.169.254`.
- Do not default any proxy client to `127.0.0.1:9`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/sandbox test -- selector proxy doc-fetcher` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Integration test proves `SecureDocFetcher` routed through `AllowlistProxyServer` fetches an allowlisted local test doc cleanly, strips hidden CSS/comment injections, and hard-blocks a redirect to a loopback trap port.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SandboxTierSelector`, `AllowlistProxyServer` (`.proxyUrl`, `.fetch()`), and `SecureDocFetcher` from `@ef-harness/sandbox`.

Stop.
- Commit on `harness/integration` once tier selector, proxy, and doc-fetcher tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C18 — `KernelPackageInstaller` runs real `ignore-scripts` lockfile resolution, `HarnessRunEngine` enforces real OS sandboxing, and `AttemptMcpServer` lands its uncommitted bugfixes.

Architecture.
- `sandbox-and-security.md` (Kernel-Only `pnpm v10` `ignore-scripts`/`onlyBuiltDependencies` Installer, Sandboxed `harness.run` Execution), `knowledge-slicing.md` (`AttemptMcpServer` Read-Only `kb.*` + `harness.*` Tools).
- `IMPLEMENTATION_TASKS.md` (`Task 046`–`Task 048`).
- Post-task invariant: `KernelPackageInstaller` runs real `ignore-scripts` lockfile resolution, `HarnessRunEngine` enforces real OS sandboxing, and `AttemptMcpServer` lands its uncommitted bugfixes.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C17` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 046` (`task/046-supply-chain-installer` @ `b27a210`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-046-supply-chain-installer`, roots `packages/sandbox/src/installer, packages/sandbox/tests/installer`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 047` (`task/047-harness-run-engine` @ `c559222`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-047-harness-run-engine`, roots `packages/sandbox/src/harness-run, packages/sandbox/tests/harness-run`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 048` (`task/048-attempt-mcp-server` @ `954622c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server`, roots `packages/mcp-server/src/candidate.ts, packages/mcp-server/src/errors.ts, packages/mcp-server/src/http.ts, packages/mcp-server/src/index.ts, packages/mcp-server/src/names.ts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 048`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server` covering `packages/mcp-server/src/scope.ts`, `packages/mcp-server/src/server.ts`, `packages/mcp-server/src/tools.ts`.
- Sequence note: Verify `task/046-supply-chain-installer` (`b27a210`), `task/047-harness-run-engine` (`c559222`), and `task/048-attempt-mcp-server` (`954622c`) on `harness/integration`, AND apply the uncommitted working-tree diff from `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server` (`scope.ts`, `server.ts`, `tools.ts`).

Freeze.
- `KernelPackageInstaller.installPackages(req)` invokes real `pnpm`/`npm`/`yarn` lockfile resolution with `--ignore-scripts` and explicit `onlyBuiltDependencies` allowlist inside a controlled kernel job (never hand-splicing fake YAML into `pnpm-lock.yaml`), followed by `--frozen-lockfile` verification.
- `HarnessRunEngine.execute(req)` dispatches EVERY command through `SandboxTierSelector` + `WindowsJobObjectManager` + `WarmExecutionPool` (`finally` slot release) and reports the true executed `tier` (`'A' | 'B' | 'C' | 'D'`).
- `AttemptMcpServer` exposes canonical tools `kb.search`, `kb.get_node`, `kb.list_rules`, `kb.get_contract`, `harness.run`, and `harness.read_result`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-021`, `F-039`, `F-049`: Add `@ef-harness/db: workspace:*` and `@ef-harness/sandbox: workspace:*` to `packages/mcp-server/package.json`, wire `AttemptMcpServer` to `KnowledgeGraphRepo`/`Fts5SearchRepo` (`C07`) and `HarnessRunEngine` (`047`), and freeze canonical `kb.*` + `harness.read_result` tool names.

Local defects.
- `F-018` (CRITICAL): Remove unsandboxed `NestedCommandJobManager` default execution in `HarnessRunEngine` (`packages/sandbox/src/run-engine/**`) that ran under the developer token while reporting `tier: "C"`, and guarantee `WarmExecutionPool` slot release inside `finally`.
- `F-020`: Delete synthetic string lockfile splicing in `KernelPackageInstaller`.
- `F-021`: apply `task-048` uncommitted fixes for `**/` zero-segment globs, `core.quotepath=false`, pull-quota token accounting, and `shutdownReason`.

Shared files.
- Integration-owned shared surfaces: `packages/sandbox/src/installer/**`, `packages/sandbox/src/run-engine/**`, `packages/sandbox/src/index.ts`, `packages/mcp-server/package.json`, `packages/mcp-server/src/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not report `tier: "C"` unless Restricted Token + Job Object + Loopback Proxy isolation actually wrapped the spawned process.
- Do not allow `postinstall` scripts on unallowlisted npm packages during `KernelPackageInstaller.installPackages`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/sandbox test && pnpm --filter @ef-harness/mcp-server test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: A malicious fixture package with a `postinstall` canary reader executes `0` lifecycle scripts under `KernelPackageInstaller`, and `HarnessRunEngine` blocks out-of-worktree writes and releases slots on timeout.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `KernelPackageInstaller`, `HarnessRunEngine` (`@ef-harness/sandbox`), and `AttemptMcpServer` (`@ef-harness/mcp-server`).

Stop.
- Commit on `harness/integration` once `@ef-harness/sandbox` and `@ef-harness/mcp-server` pass all tests.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C19 — `TestEnvOrchestrator` and native backing services allocate ports via `GlobalBrokerDb.port_leases`, track PIDs in `ProjectStateDb.env_processes`, and supervise services via `WindowsJobObjectManager`.

Architecture.
- `test-environments.md` (Ephemeral Per-Slot Test Environments, Dynamic Port Range `41000–48999` in `global.db.port_leases`, `state.db.env_processes` `(pid, start_time)` Registry, Native Backing Services), `schema/global.sql`, `schema/state.sql`.
- `IMPLEMENTATION_TASKS.md` (`Task 049`–`Task 050`).
- Post-task invariant: `TestEnvOrchestrator` and native backing services allocate ports via `GlobalBrokerDb.port_leases`, track PIDs in `ProjectStateDb.env_processes`, and supervise services via `WindowsJobObjectManager`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C18` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 049` (`task/049-test-env-orchestrator-core` @ `cc26926`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-049-test-env-orchestrator-core`, roots `packages/test-env/src/orchestrator, packages/test-env/tests/orchestrator`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 050` (`task/050-native-backing-services` @ `57eca20`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-050-native-backing-services`, roots `packages/test-env/src/services, packages/test-env/tests/services`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/049-test-env-orchestrator-core` (`cc26926`) and `task/050-native-backing-services` (`57eca20`).

Freeze.
- `ServiceProvider` interface (`readonly kind: ServiceKind; start(ctx: ServiceStartContext): Promise<RunningService>; healthCheck(svc: RunningService): Promise<boolean>; stop(svc: RunningService): Promise<void>`).
- `TestEnvOrchestrator` (`provision(req): Promise<TestEnvHandle>`, `teardown(envId): Promise<void>`, `reconcileOrphanedProcesses()`) bound to `GlobalBrokerDb` (`port_leases`), `ProjectStateDb` (`env_processes`), and `WindowsJobObjectManager` (`C16`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-022`: Add `@ef-harness/db: workspace:*` and `@ef-harness/sandbox: workspace:*` to `packages/test-env/package.json`, delete private `new DatabaseSync(...)` handles on `global.db`/`state.db` in `049`–`050`, and unify `WindowsJobManager` + `ServiceProvider` contracts.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `reconcileOrphanedProcesses()` verifies `(pid, start_time)` before killing any process so recycled Windows PIDs are never killed (`test-environments.md` invariant).
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/test-env/package.json`, `packages/test-env/src/orchestrator/**`, `packages/test-env/src/services/**`, `packages/test-env/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allocate ports outside `41000–48999` or bypass `GlobalBrokerDb` `port_leases`.
- Do not allow `sk_live_` or production credentials into `TestEnvOrchestrator` environment maps.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/test-env test -- orchestrator services` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Provisioning two concurrent test environments allocates non-overlapping ports in `GlobalBrokerDb.port_leases`, records `(pid, start_time)` in `ProjectStateDb.env_processes`, and `teardown()` leaves `0` leased ports or child PIDs.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `TestEnvOrchestrator` and `ServiceProvider` exported from `@ef-harness/test-env`.

Stop.
- Commit on `harness/integration` once `049–050` tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C20 — Local OAuth/Stripe/webhook mocks and `TemplateDbManager` plug into `TestEnvOrchestrator` and wire into `AttemptMcpServer`.

Architecture.
- `test-environments.md` (Local OAuth/OIDC & Stripe/Webhook Signed Mocks, Port-Collision Fallback, Fast Template DB Cloning & Deterministic Synthetic Seeding).
- `IMPLEMENTATION_TASKS.md` (`Task 051`–`Task 052`).
- Post-task invariant: Local OAuth/Stripe/webhook mocks and `TemplateDbManager` plug into `TestEnvOrchestrator` and wire into `AttemptMcpServer`.
- Priority authority check: apply `AUTHORITY_ORDER` (`schema/*.sql` -> dated decision docs -> architecture specs -> `IMPLEMENTATION_TASKS.md`) if branch comments conflict.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C19` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 051` (`task/051-oauth-stripe-mocks-port-fallback` @ `9c562b8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-051-oauth-stripe-mocks-port-fallback`, roots `packages/test-env/src/auth-payment-mocks, packages/test-env/tests/auth-payment-mocks`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 052` (`task/052-template-db-synthetic-data` @ `1c3bb83`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-052-template-db-synthetic-data`, roots `packages/test-env/src/synthetic-data, packages/test-env/tests/synthetic-data`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/051-oauth-stripe-mocks-port-fallback` (`9c562b8`) and `task/052-template-db-synthetic-data` (`1c3bb83`).

Freeze.
- `LocalOAuthMockProvider` & `LocalWebhookMockProvider` (`051`) and `TemplateDbManager` (`052` `prepareTemplate(schemaHash, migrateFn)`, `cloneForAttempt(attemptId): Promise<ClonedDbHandle>`) implementing `ServiceProvider` (`C19`) and registered in `TestEnvOrchestrator`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-021`, `F-022`: Adapt `051` and `052` onto the frozen `ServiceProvider` interface (`C19`), export all 4 submodules from `packages/test-env/src/index.ts`, and wire `@ef-harness/test-env` into `AttemptMcpServer` (`packages/mcp-server`) so `harness.run` provisions per-attempt isolated DB clones and mock endpoints.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure port-collision `EADDRINUSE` fallback in `051` marks the collided port lease expired/replaced in `GlobalBrokerDb.port_leases` and retries within `41000–48999`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/test-env/src/mocks/**`, `packages/test-env/src/template-db/**`, `packages/test-env/src/index.ts`, `packages/mcp-server/package.json`, `packages/mcp-server/src/server.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not share mutable SQLite/Postgres database files across concurrent attempts; always clone per attempt via `TemplateDbManager.cloneForAttempt`.
- Do not hit external `stripe.com` or OAuth endpoints from local mock providers.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/test-env test && pnpm --filter @ef-harness/mcp-server test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `TemplateDbManager.cloneForAttempt` produces isolated writable DB clones in `< 50 ms`, signed Stripe webhook mocks verify HMAC signatures, and `AttemptMcpServer` runs `harness.run` with injected `TestEnvHandle` env vars.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `TestEnvOrchestrator`, `TemplateDbManager`, `LocalOAuthMockProvider`, and `LocalWebhookMockProvider` from `@ef-harness/test-env`.

Stop.
- Commit on `harness/integration` once `@ef-harness/test-env` and `@ef-harness/mcp-server` are green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C21 — `@ef-harness/worker-loop` wire protocols (with uncommitted `task-053` security/wire fixes), context compactor, and CAS-backed tool-output shrinker are unified.

Architecture.
- `provider-connections.md` (OpenAI Responses, ChatGPT Sign-In Wire Rules, Anthropic Messages, Gemini, OpenAI-Compatible Chat), `agent-runtime-adapters.md`, `verification-and-runtime.md` (Context Compaction & Tool Output Shrinking).
- `IMPLEMENTATION_TASKS.md` (`Task 053`–`Task 055`).
- Post-task invariant: `@ef-harness/worker-loop` wire protocols (with uncommitted `task-053` security/wire fixes), context compactor, and CAS-backed tool-output shrinker are unified.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C20` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 053` (`task/053-worker-loop-provider-protocols` @ `445b340`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-053-worker-loop-provider-protocols`, roots `packages/worker-loop/src/protocols, packages/worker-loop/tests/protocols`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 053`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-053-worker-loop-provider-protocols` covering `packages/worker-loop/src/protocols/errors.ts`, `packages/worker-loop/src/protocols/openai-compatible-chat.ts`, `packages/worker-loop/src/protocols/openai-responses.ts`, `packages/worker-loop/src/protocols/profiles.ts`, `packages/worker-loop/src/protocols/types.ts`, `packages/worker-loop/tests/protocols/errors-currency-profiles.test.ts` (+2 more).
- Unit `Task 054` (`task/054-worker-loop-context-compaction` @ `f62475b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-054-worker-loop-context-compaction`, roots `packages/worker-loop/src/context, packages/worker-loop/tests/context`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 055` (`task/055-worker-loop-tool-shrinker` @ `460527d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-055-worker-loop-tool-shrinker`, roots `packages/worker-loop/src/read-tools, packages/worker-loop/tests/read-tools`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify `task/053-worker-loop-provider-protocols` (`445b340`), `task/054-worker-loop-context-compaction` (`f62475b`), and `task/055-worker-loop-tool-shrinker` (`460527d`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-053-worker-loop-provider-protocols` (`errors.ts`, `openai-compatible-chat.ts`, `openai-responses.ts`, `profiles.ts`, `types.ts`, and `tests/protocols/**`).

Freeze.
- `ModelProtocolAdapter` (`streamTurn(req: ProtocolTurnRequest): Promise<ProtocolTurnResult>`) enforcing ChatGPT sign-in wire rules (`store: false`, `stream: true`, `max_output_tokens`/`temperature`/`previous_response_id` stripped) and exact provider error classification (`429 rate_limit` vs `insufficient_quota`).
- `ContextCompactor` (`054`) and `ToolOutputShrinker` (`055`, spilling oversized stdout/stderr into `@ef-harness/db` `CasBlobStore` and returning head/tail excerpts + CAS digest).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-011`, `F-023`: Add `@ef-harness/db: workspace:*` and `@ef-harness/shared-observability: workspace:*` to `packages/worker-loop/package.json` and bind `ToolOutputShrinker` (`055`) to unified `CasBlobStore` + `StreamingRedactor`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-023`: Apply `task-053` uncommitted fixes resolving HTTP `429` `insufficient_quota` misclassification, blocking assistant-text `cost` regex injection in `openai-compatible-chat.ts`, and preserving `reasoning` item ordering before `function_call` items in `openai-responses.ts`.

Shared files.
- Integration-owned shared surfaces: `packages/worker-loop/package.json`, `packages/worker-loop/src/protocols/**`, `packages/worker-loop/src/compaction/**`, `packages/worker-loop/src/shrinker/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not parse billing/cost amounts out of untrusted model assistant text.
- Do not send `max_output_tokens`, `temperature`, or `previous_response_id` on the ChatGPT Sign-In subscription route.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/worker-loop test -- protocols compaction shrinker` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Unit tests verify `429 insufficient_quota` maps to quota exhaustion (not transient retry), assistant text containing `"cost": 999` is ignored, and 500 KB tool outputs shrink into `CasBlobStore` cleanly.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `ModelProtocolAdapter`, `ContextCompactor`, and `ToolOutputShrinker` in `@ef-harness/worker-loop`.

Stop.
- Commit on `harness/integration` once `053–055` protocol, compaction, and shrinker tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C22 — `NativeWorkerLoop` and `EditApplier` land uncommitted `task-056`/`task-057` safety fixes and execute end-to-end over `ModelProtocolAdapter`, `AttemptMcpServer`, and `ProjectStateDb`.

Architecture.
- `verification-and-runtime.md` (Sandboxed Scoped Edit Applier, CRLF-Safe `rangeHash`, Spiral Guards, Durable Step Checkpoints & Crash Recovery), `schema/state.sql` (`attempts`, `turn_log`).
- `IMPLEMENTATION_TASKS.md` (`Task 056`–`Task 057`).
- Post-task invariant: `NativeWorkerLoop` and `EditApplier` land uncommitted `task-056`/`task-057` safety fixes and execute end-to-end over `ModelProtocolAdapter`, `AttemptMcpServer`, and `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C21` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 056` (`task/056-worker-loop-edit-applier` @ `42aafc7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-056-worker-loop-edit-applier`, roots `packages/worker-loop/src/edits, packages/worker-loop/tests/edits`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 056`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-056-worker-loop-edit-applier` covering `packages/worker-loop/src/edits/dispatcher.ts`, `packages/worker-loop/src/edits/parse-apply-patch.ts`, `packages/worker-loop/src/edits/paths.ts`, `packages/worker-loop/src/edits/text.ts`, `packages/worker-loop/tests/edits/dispatcher.test.ts`.
- Unit `Task 057` (`task/057-worker-loop-executor-checkpoints` @ `a3e3d60`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-057-worker-loop-executor-checkpoints`, roots `packages/worker-loop/src/executor, packages/worker-loop/tests/executor`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 057`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-057-worker-loop-executor-checkpoints` covering `packages/worker-loop/src/executor/guards.ts`, `packages/worker-loop/src/executor/index.ts`, `packages/worker-loop/src/executor/native-worker-loop.ts`, `packages/worker-loop/src/executor/types.ts`, `packages/worker-loop/tests/executor/crash-recovery.test.ts`, `packages/worker-loop/tests/executor/spiral-guards.test.ts` (+1 more).
- Sequence note: Verify `task/056-worker-loop-edit-applier` (`42aafc7`) and `task/057-worker-loop-executor-checkpoints` (`a3e3d60`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-056-worker-loop-edit-applier` (`dispatcher.ts`, `parse-apply-patch.ts`, `paths.ts`, `text.ts`, `dispatcher.test.ts`) and `C:/Users/Ayush/Desktop/ef-wt/task-057-worker-loop-executor-checkpoints` (`guards.ts`, `index.ts`, `native-worker-loop.ts`, `types.ts`, and `tests/executor/**`).

Freeze.
- `EditApplier` (`applyPatch`, `replaceLines`, enforcing case-insensitive `.git`/`.harness` path denylist on Windows NTFS, symlink escape checks, write-scope globs, and CRLF-normalized `rangeHash`).
- `NativeWorkerLoop` (`runAttempt(req: WorkerAttemptRequest): Promise<WorkerAttemptOutcome>`) integrating `ModelProtocolAdapter` (`053`), `ContextCompactor` (`054`), `ToolOutputShrinker` (`055`), `EditApplier` (`056`), `AttemptMcpServer` (`048`), and `ProjectStateDb` step checkpoints.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-021`, `F-023`: Connect `053–057` inside `packages/worker-loop` (replacing internal silo mock ports in `NativeWorkerLoop` with real `ModelProtocolAdapter`, `ContextCompactor`, `ToolOutputShrinker`, `EditApplier`, `AttemptMcpServer`, and `ProjectStateDb`) and export all 5 submodules from `packages/worker-loop/src/index.ts`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-023`: Apply `task-056` fixes (case-insensitive `.GIT` write block, CRLF `rangeHash` normalization) and `task-057` fixes (`unknown_timeout` reconciliation instead of crash, `replace_lines` read-before-edit gate, and `no_progress` spiral guard enforcement).

Shared files.
- Integration-owned shared surfaces: `packages/worker-loop/package.json`, `packages/worker-loop/src/edits/**`, `packages/worker-loop/src/executor/**`, `packages/worker-loop/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `EditApplier` to write into `.git/`, `.GIT/`, `.harness/`, or paths outside `task.write_scope`.
- Do not silently retry `unknown_timeout` tool calls without checking side-effect state.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/worker-loop test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Tests confirm `.GIT/config` writes are rejected on Windows, CRLF files match `rangeHash`, `no_progress` spiral guard halts 3 identical failing turns, and `NativeWorkerLoop` resumes cleanly from a `ProjectStateDb` checkpoint.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `NativeWorkerLoop` and `EditApplier` exported from `@ef-harness/worker-loop`.

Stop.
- Commit on `harness/integration` once `@ef-harness/worker-loop` is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C23 — `@ef-harness/completeness-gate` lands uncommitted `task-058`/`task-059` AST scanner fixes and wires directly into `CleanVerifierHarness` on clean detached checkouts.

Architecture.
- `verification-and-isolation.md` (`STATIC_AUDIT` Anti-Stub/Dead-Control/Reachability/Scope Gate & Clean-Copy Verifier Isolation), `verification-for-real-apps.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 058`–`Task 060`).
- Post-task invariant: `@ef-harness/completeness-gate` lands uncommitted `task-058`/`task-059` AST scanner fixes and wires directly into `CleanVerifierHarness` on clean detached checkouts.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C22` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 058` (`task/058-static-audit-scanners-p1` @ `71ea882`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-058-static-audit-scanners-p1`, roots `packages/completeness-gate/src/ast-scanners, packages/completeness-gate/tests/ast-scanners`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 058`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-058-static-audit-scanners-p1` covering `packages/completeness-gate/src/ast-scanners/dead-controls.ts`, `packages/completeness-gate/src/ast-scanners/stubs.ts`, `packages/completeness-gate/tests/ast-scanners/engine.test.ts`.
- Unit `Task 059` (`task/059-static-audit-scanners-p2` @ `b6e79b2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-059-static-audit-scanners-p2`, roots `packages/completeness-gate/src/gate, packages/completeness-gate/tests/gate`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 059`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-059-static-audit-scanners-p2` covering `packages/completeness-gate/src/gate/check-reachability.ts`, `packages/completeness-gate/src/gate/check-scope.ts`, `packages/completeness-gate/tests/gate/leaf-feature-audit.test.ts`, `packages/completeness-gate/tests/gate/overrides-and-scope.test.ts`.
- Unit `Task 060` (`task/060-clean-verifier-harness` @ `a06d371`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-060-clean-verifier-harness`, roots `packages/verifier/src/runner, packages/verifier/tests/runner`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify `task/058-static-audit-scanners-p1` (`71ea882`), `task/059-static-audit-scanners-p2` (`b6e79b2`), and `task/060-clean-verifier-harness` (`a06d371`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-058-static-audit-scanners-p1` (`dead-controls.ts`, `stubs.ts`, `engine.test.ts`) and `C:/Users/Ayush/Desktop/ef-wt/task-059-static-audit-scanners-p2` (`check-reachability.ts`, `check-scope.ts`, and `tests/gate/**`).

Freeze.
- `CompletenessGateRunner` (`runLeafAudit(req)`, `runFeatureAudit(req)`) executing real AST stub/TODO/dead-control/hardcoded-secret scanners (`058`) + ESM `.js -> .ts/.tsx` reachability & diff-hunk scope auditors (`059`).
- `CleanVerifierHarness` (`verifyCandidate(req: CandidateVerifyRequest): Promise<VerificationReceipt>`) checking out candidate SHA into a fresh clean `WorktreeSlotPool` slot (`038`), running `CompletenessGateRunner` (`STATIC_AUDIT`) first, and executing checks inside `HarnessRunEngine` (`047`) + `TestEnvOrchestrator` (`049`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-024`: Connect `packages/completeness-gate/src/gate/**` (`059`) directly to `src/ast-scanners/**` (`058`) instead of stub scanner callbacks, export `CompletenessGateRunner` from `@ef-harness/completeness-gate`, and wire it into `CleanVerifierHarness` (`packages/verifier/src/clean-harness/**`).

Local defects.
- `F-024`: Apply `task-058` fixes catching `return;`, `return false;`, `() => undefined` stubs and standalone dead `<button>` elements, and `task-059` fixes resolving TypeScript ESM `.js` specifiers to `.ts`/`.tsx` files and enforcing exact diff hunk line bounds.

Shared files.
- Integration-owned shared surfaces: `packages/completeness-gate/src/**`, `packages/verifier/package.json`, `packages/verifier/src/clean-harness/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not run `CleanVerifierHarness` inside the worker's dirty worktree slot (untracked worker files must never taint verification).
- Do not pass `CheckOutcomeSchema` when `collected_count === 0` (`C03`).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/completeness-gate test && pnpm --filter @ef-harness/verifier test -- clean-harness` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CompletenessGateRunner` flags dead `<button>` controls and `() => undefined` stubs while resolving `./foo.js -> ./foo.ts` imports cleanly, and `CleanVerifierHarness` ignores untracked helper files left in the worker slot.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `CompletenessGateRunner` (`@ef-harness/completeness-gate`) and `CleanVerifierHarness` (`@ef-harness/verifier`).

Stop.
- Commit on `harness/integration` once completeness-gate and clean-harness tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C24 — `@ef-harness/verifier` lands uncommitted `task-061`–`063` fixes and unifies `SurfaceVerifierAdapter` across blind red-before-green, Playwright UI, API, CLI, and migration verifiers.

Architecture.
- `verification-and-isolation.md` (Blind Sealed Checks & Red-Before-Green Proof), `verification-for-real-apps.md` (Playwright UI Interaction Contract, OpenAPI/HTTP, CLI `--json` Purity, Migration Data Preservation).
- `IMPLEMENTATION_TASKS.md` (`Task 061`–`Task 063`).
- Post-task invariant: `@ef-harness/verifier` lands uncommitted `task-061`–`063` fixes and unifies `SurfaceVerifierAdapter` across blind red-before-green, Playwright UI, API, CLI, and migration verifiers.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C23` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 061` (`task/061-red-before-green-blind-binder` @ `cc176e3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-061-red-before-green-blind-binder`, roots `packages/verifier/src/binder, packages/verifier/tests/binder`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 061`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-061-red-before-green-blind-binder` covering `packages/verifier/src/binder/adapter-audit.ts`, `packages/verifier/src/binder/containment.ts`, `packages/verifier/tests/binder/blindness-and-audit.test.ts`.
- Unit `Task 062` (`task/062-ui-interaction-contract-verifier` @ `fe62a40`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-062-ui-interaction-contract-verifier`, roots `packages/verifier/src/ui-contract, packages/verifier/tests/ui-contract`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 062`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-062-ui-interaction-contract-verifier` covering `packages/verifier/src/ui-contract/verifier.ts`, `packages/verifier/tests/ui-contract/fixture-server.ts`, `packages/verifier/tests/ui-contract/verifier.test.ts`.
- Unit `Task 063` (`task/063-multi-surface-verifiers` @ `9b455fd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-063-multi-surface-verifiers`, roots `packages/verifier/src/surfaces, packages/verifier/tests/surfaces`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 063`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-063-multi-surface-verifiers` covering `packages/verifier/src/surfaces/migration-preservation-verifier.ts`, `packages/verifier/src/surfaces/schemas.ts`, `packages/verifier/tests/surfaces/migration-preservation-verifier.test.ts`.
- Sequence note: Verify `task/061-red-before-green-blind-binder` (`cc176e3`), `task/062-ui-interaction-contract-verifier` (`fe62a40`), and `task/063-multi-surface-verifiers` (`9b455fd`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-061-*`, `task-062-*`, and `task-063-*`.

Freeze.
- Single `SurfaceVerifierAdapter` interface (`readonly surface: 'unit' | 'ui_playwright' | 'http_api' | 'cli' | 'migration' | 'property'; run(ctx: SurfaceVerifyContext): Promise<CheckOutcome>`).
- `RedBeforeGreenBlindBinder` (`061`), `UiPlaywrightContractVerifier` (`062`), and `ApiContractVerifier` / `CliContractVerifier` / `MigrationPreservationVerifier` (`063`) all implementing `SurfaceVerifierAdapter` and registered in `CleanVerifierHarness` (`C23`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-025`: Collapse the 3 incompatible `SurfaceVerifierAdapter` shapes across `clean-harness` (`060`), `ui-contract` (`062`), and `surfaces` (`063`) into the single frozen `SurfaceVerifierAdapter` contract returning `@ef-harness/shared-contracts` `CheckOutcome`.

Local defects.
- `F-025`: Apply uncommitted fixes in `061` (`adapter-audit.ts`, `containment.ts` sealed-dir escape prevention), `062` (`ui-contract/verifier.ts` console/pageerror/network failure capture), and `063` (`migration-preservation-verifier.ts` pre-migration seed row survival proof).

Shared files.
- Integration-owned shared surfaces: `packages/verifier/src/binder/**`, `packages/verifier/src/ui-contract/**`, `packages/verifier/src/surfaces/**`, `packages/verifier/src/clean-harness/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.

Do not.
- Do not expose sealed check source files or assertion failure stack traces inside worker-visible slots.
- Do not mark a UI check green if `pageerror` or uncaught HTTP `500` responses occurred during interaction.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/verifier test -- binder ui-contract surfaces` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `RedBeforeGreenBlindBinder` rejects vacuous tests that pass on pre-fix base SHA, `UiPlaywrightContractVerifier` catches silent console errors, and `MigrationPreservationVerifier` catches destructive row loss.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SurfaceVerifierAdapter`, `RedBeforeGreenBlindBinder`, `UiPlaywrightContractVerifier`, `ApiContractVerifier`, `CliContractVerifier`, and `MigrationPreservationVerifier` from `@ef-harness/verifier`.

Stop.
- Commit on `harness/integration` once `061–063` verifier suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C25 — `@ef-harness/verifier` completes boundary mutation probes, 3-step `HintLadder`, and atomic `CandidateAcceptanceCoordinator` over `CoordinatorWriteQueue` and `RefLeaseAndCasManager`.

Architecture.
- `verification-and-isolation.md` (AST Boundary Mutation Probes, Persistent 3-Step Hint Ladder Without Sealed Oracle Leakage, `DisputeTest` Escalation, Atomic Candidate Acceptance Transaction).
- `IMPLEMENTATION_TASKS.md` (`Task 064`–`Task 066`).
- Post-task invariant: `@ef-harness/verifier` completes boundary mutation probes, 3-step `HintLadder`, and atomic `CandidateAcceptanceCoordinator` over `CoordinatorWriteQueue` and `RefLeaseAndCasManager`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C24` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 064` (`task/064-ai-eval-property-mutation-probes` @ `3a84cad`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-064-ai-eval-property-mutation-probes`, roots `packages/verifier/src/advanced, packages/verifier/tests/advanced`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 064`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-064-ai-eval-property-mutation-probes` covering `packages/verifier/src/advanced/boundary-mutation-prober.ts`, `packages/verifier/tests/advanced/boundary-mutation-prober.test.ts`.
- Unit `Task 065` (`task/065-hint-ladder-dispute-routing` @ `9f0c374`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-065-hint-ladder-dispute-routing`, roots `packages/verifier/src/hint-ladder, packages/verifier/tests/hint-ladder`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 066` (`task/066-candidate-acceptance-tx` @ `f68afb3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-066-candidate-acceptance-tx`, roots `packages/verifier/src/acceptance, packages/verifier/tests/acceptance`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 066`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-066-candidate-acceptance-tx` covering `packages/verifier/src/acceptance/coordinator.ts`, `packages/verifier/src/acceptance/rule-scope.ts`, `packages/verifier/tests/acceptance/acceptance.test.ts`.
- Sequence note: Verify `task/064-ai-eval-property-mutation-probes` (`3a84cad`), `task/065-hint-ladder-dispute-routing` (`9f0c374`), and `task/066-candidate-acceptance-tx` (`f68afb3`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-064-ai-eval-property-mutation-probes` (`boundary-mutation-prober.ts`) and `C:/Users/Ayush/Desktop/ef-wt/task-066-candidate-acceptance-tx` (`coordinator.ts`, `rule-scope.ts`, `acceptance.test.ts`).

Freeze.
- `BoundaryMutationProber` (`064` implementing `SurfaceVerifierAdapter`), `PersistentHintLadder` & `DisputeTestRouter` (`065` persisted in `ProjectStateDb`, redacted via `SecretRedactor`), and `CandidateAcceptanceCoordinator` (`066` `acceptVerifiedCandidate(req): Promise<AcceptanceReceipt>`).
- `CandidateAcceptanceCoordinator` verifies `fencing_epoch` + active holds (`021`), updates `RefLeaseAndCasManager` (`039`), and commits `tasks(DONE)` + `checks` + `artifacts` + `rollups` + `outbox` inside `CoordinatorWriteQueue` (`025`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-012`, `F-017`, `F-025`: Wire `CandidateAcceptanceCoordinator` (`066`) and `PersistentHintLadder` (`065`) to real `@ef-harness/db` (`ProjectStateDb`, `CoordinatorWriteQueue`, `HoldsAndSubmissionsRepo`, `LifecycleRepo`, `TransactionalOutboxRepo`, `CasBlobStore`) and `@ef-harness/git-engine` (`RefLeaseAndCasManager`), and export all 7 submodules from `packages/verifier/src/index.ts`.

Local defects.
- `F-025`: Apply uncommitted fixes in `064` (`boundary-mutation-prober.ts` operator boundary restoration) and `066` (`coordinator.ts` & `rule-scope.ts` fencing-epoch and rule-scope enforcement).

Shared files.
- Integration-owned shared surfaces: `packages/verifier/package.json`, `packages/verifier/src/advanced/**`, `packages/verifier/src/hints/**`, `packages/verifier/src/acceptance/**`, `packages/verifier/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not include sealed test filenames, code snippets, or expected literal values in Level 1–3 `PersistentHintLadder` hints.
- Do not mark a task `DONE` in `state.db` if `RefLeaseAndCasManager.casUpdateRef` fails or if a `HARD` hold is active.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/verifier test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CandidateAcceptanceCoordinator` atomically advances the feature ref and commits `DONE` + `outbox` events, while quarantining late submissions when `fencing_epoch` mismatches.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BoundaryMutationProber`, `PersistentHintLadder`, `DisputeTestRouter`, and `CandidateAcceptanceCoordinator` from `@ef-harness/verifier`.

Stop.
- Commit on `harness/integration` once `@ef-harness/verifier` is 100% unified and green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C26 — `apps/daemon` and `apps/desktop` run over `@ef-harness/db` + `@ef-harness/ipc` with multi-window `MessagePort` framing fixed, and `Task 068` M1 Exit Gate certifies the real M1 stack.

Architecture.
- `desktop-app.md` (Detached `harnessd` Single-Instance `(pid, start_time)` Lock, Electron Utility-Process Named-Pipe Bridge & Per-Window `MessagePort` Multiplexing), `roadmap.md` (M1 Exit Gate).
- `IMPLEMENTATION_TASKS.md` (`Task 067`–`Task 068`).
- Post-task invariant: `apps/daemon` and `apps/desktop` run over `@ef-harness/db` + `@ef-harness/ipc` with multi-window `MessagePort` framing fixed, and `Task 068` M1 Exit Gate certifies the real M1 stack.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C25` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 067` (`task/067-m1-daemon-minimal-viewer` @ `d1109c7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-067-m1-daemon-minimal-viewer`, roots `apps/daemon/src/bootstrap, apps/daemon/tests/bootstrap, apps/desktop/src/bootstrap, apps/renderer/src/m1-viewer`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 068` (`task/068-m1-kitchen-exit-gate` @ `76f8a9c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-068-m1-kitchen-exit-gate`, roots `benchmarks/m1-kitchen-leaves/M1_EXIT_REPORT.md, benchmarks/m1-kitchen-leaves/briefs, benchmarks/m1-kitchen-leaves/hidden, benchmarks/m1-kitchen-leaves/manifest.json, benchmarks/m1-kitchen-leaves/seed`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/067-m1-daemon-minimal-viewer` (`d1109c7`) and `task/068-m1-kitchen-exit-gate` (`76f8a9c`).

Freeze.
- `HarnessDaemon` (`apps/daemon`) opens `ProjectStateDb` + `GlobalBrokerDb` + `TelemetryDb` (`C05`–`C11`), serves `NamedPipeRpcServer` + `OutboxEventStreamer` + `BinaryArtifactStreamServer` (`C12`–`C13`), and acquires `daemon.lock` verified by `(pid, processStartTime)`.
- `PipeClientBridge` (`apps/desktop/src/pipe-client.ts`) preserves leftover post-`session.hello` framed bytes in a single rolling `FrameCodec` buffer and routes frames across a `Map<windowId, MessagePortMain>` without clobbering existing windows.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-026`: Replace `apps/daemon`'s raw `DatabaseSync` + un-paired `outbox` inserts with `@ef-harness/db` (`ProjectStateDb`, `CoordinatorWriteQueue`, `TransactionalOutboxRepo`) and `@ef-harness/ipc` (`NamedPipeRpcServer`).
2. `F-028`: Rewrite `tests/e2e` M1 Exit Gate (`068`) to drive the real M1 packages (`db`, `ipc`, `git-engine`, `sandbox`, `test-env`, `mcp-server`, `worker-loop`, `completeness-gate`, `verifier`, `daemon`) instead of its self-contained mock script.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-027`: Fix `apps/desktop/src/pipe-client.ts` buffer handoff after `session.hello` (zero dropped/duplicated bytes when an event frame coalesces in the same socket read) and replace the single `this.rendererPort` field with a per-window `Map<string, MessagePortLike>`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `apps/daemon/package.json`, `apps/daemon/src/**`, `apps/desktop/package.json`, `apps/desktop/src/**`, `tests/e2e/package.json`, `tests/e2e/m1-exit-gate/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not enable `nodeIntegration` or disable `sandbox: true` / `contextIsolation: true` in `apps/desktop` `BrowserWindow` configs.
- Do not treat bare PID existence without `start_time` match as an active `harnessd` lock on Windows.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/desktop test && pnpm --filter @ef-harness/e2e test -- m1` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `PipeClientBridge` delivers coalesced `session.hello` + event frames losslessly to 2 simultaneous window `MessagePort`s, and the M1 Kitchen vertical slice builds, audits, verifies red-before-green, and accepts into `ProjectStateDb`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `HarnessDaemon` (`apps/daemon`) and multi-window `PipeClientBridge` (`apps/desktop`).

Stop.
- Commit on `harness/integration` once Wave 2 (entire M1 spine) is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C27 — `@ef-harness/discovery` unifies `DecisionFields`, async prompt runners, exact-quote grounding, bounded delegation (`valueSatisfiesLimits`), and acyclic entailment on `ProjectStateDb`.

Architecture.
- `project-discovery.md` (Opening Rubrics, Exact-Quote Grounding, Bounded Delegation, Acyclic `derived_from` Entailment & Selective Premise Reopening), `skills/infer-or-ask/SKILL.md`, `prompt-contracts.md` (`batch-resolve@1`, `entailment-checker@1`).
- `IMPLEMENTATION_TASKS.md` (`Task 069`–`Task 071`).
- Post-task invariant: `@ef-harness/discovery` unifies `DecisionFields`, async prompt runners, exact-quote grounding, bounded delegation (`valueSatisfiesLimits`), and acyclic entailment on `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C26` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 069` (`task/069-discovery-core-opening-rubrics` @ `0df0a18`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-069-discovery-core-opening-rubrics`, roots `packages/discovery/src/core, packages/discovery/tests/core`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 070` (`task/070-discovery-prompts-quote-verifier` @ `326728d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-070-discovery-prompts-quote-verifier`, roots `packages/discovery/src/prompts, packages/discovery/tests/prompts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 071` (`task/071-entailment-derivations-reopening` @ `2c91b46`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-071-entailment-derivations-reopening`, roots `packages/discovery/src/entailment, packages/discovery/tests/entailment`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/069-discovery-core-opening-rubrics` (`0df0a18`), `task/070-discovery-prompts-quote-verifier` (`326728d`), and `task/071-entailment-derivations-reopening` (`2c91b46`).

Freeze.
- Unified `DecisionNodeFields` (`{ criterionId: string, groupId?: string, value: unknown, selectedOptionId?: string, basis: DecisionBasis, evidence: EvidenceLocator[], limits?: DelegationLimits, derivedFromIds?: string[] }`) persisted via `KnowledgeGraphRepo` (`C07`).
- Async `DiscoveryModelPort` (`resolveBatch`, `checkEntailment`) validated by `@ef-harness/shared-contracts` `BatchResolveV1Schema` and `EntailmentCheckerV1Schema`, bundling `infer-or-ask/SKILL.md` without walking for `pnpm-workspace.yaml`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-029`, `F-031`, `F-035`: Unify `DecisionNodeFields` across `069–074` and `079–081` (preserving `selectedOptionId` and `groupId`), convert sync model/session ports in `069–071` to `Promise`-based async contracts, delete duplicate schemas + 3 local `ef_search_text` UDFs in `070`, and wire `KnowledgeGraphRepo` (`C07`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-030`: Fix `valueSatisfiesLimits` in `packages/discovery/src/core/**` (`069`) to evaluate all declared `VALUE_LIMIT_TAGS` (`local_only`, `zero_paid_saas`, `serverless_compatible`, `relational_acid`, etc.) instead of hardcoding only `"sqlite"`.
- `F-031`: Remove `pnpm-workspace.yaml` upward filesystem walk in `packages/discovery/src/prompts/ports.ts` so packaged Electron builds load prompt/skill assets cleanly.

Shared files.
- Integration-owned shared surfaces: `packages/discovery/package.json`, `packages/discovery/src/core/**`, `packages/discovery/src/prompts/**`, `packages/discovery/src/entailment/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not accept `basis = 'explicit'` without a verified verbatim substring match in `user_turn` `EvidenceLocator`.
- Do not allow `leaves_open` entailment outcomes (`"link on their phones"` -> offline/native) to settle a criterion.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/discovery test -- core prompts entailment` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `"Email the totals"` settles notification channel while leaving recipient unsettled, `"link on their phones"` rejects offline/native entailment, and `valueSatisfiesLimits` accepts valid non-SQLite bounded-delegation options.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `DecisionNodeFields`, `ExactQuoteVerifier`, `EntailmentEngine`, and `PremiseSupersessionReopener` in `@ef-harness/discovery`.

Stop.
- Commit on `harness/integration` once `069–071` discovery suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C28 — `DiscoverySessionCoordinator` integrates `AdaptiveQuestionSelector`, `DiscoveryDepthController`, observed brownfield pre-settlement, and `HonestReadinessCalculator` on `ProjectStateDb`.

Architecture.
- `project-discovery.md` (Adaptive VOI Question Selection, `Accept all recommended` / `Chosen for you`, Depth Controls, Honest Readiness Counts), `brownfield-discovery.md` (`basis = 'observed'` Stack Pre-Settlement).
- `IMPLEMENTATION_TASKS.md` (`Task 072`–`Task 074`).
- Post-task invariant: `DiscoverySessionCoordinator` integrates `AdaptiveQuestionSelector`, `DiscoveryDepthController`, observed brownfield pre-settlement, and `HonestReadinessCalculator` on `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C27` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 072` (`task/072-adaptive-question-selector` @ `7f8f233`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-072-adaptive-question-selector`, roots `packages/discovery/src/selector, packages/discovery/tests/selector`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 073` (`task/073-discovery-depth-controls` @ `47801e2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-073-discovery-depth-controls`, roots `packages/discovery/src/depth, packages/discovery/tests/depth`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 074` (`task/074-honest-readiness-calculator` @ `27758b5`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-074-honest-readiness-calculator`, roots `packages/discovery/src/readiness, packages/discovery/tests/readiness`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/072-adaptive-question-selector` (`7f8f233`), `task/073-discovery-depth-controls` (`47801e2`), and `task/074-honest-readiness-calculator` (`27758b5`).

Freeze.
- `DiscoverySessionCoordinator` (`startSession`, `ingestUserTurn`, `acceptRecommendedDefaults`, `preSettleObservedCriteria`, `getReadinessSnapshot`) orchestrating `069–074` over `ProjectStateDb` (`KnowledgeGraphRepo` + `CoordinatorWriteQueue`).
- `HonestReadinessCalculator` returning exact integer counts `{ explicitCount, confirmedCount, delegatedChosenForYouCount, observedCount, blockingUnsettledCount, deferredCount, readyToPlan: boolean }`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-029`, `F-074`: Connect all 6 submodules (`069–074`) inside `packages/discovery/src/index.ts` onto shared `DecisionNodeFields` (`C27`) and `ProjectStateDb`, and expose `preSettleObservedCriteria({ workItemId, settlements })` for `BrownfieldOpeningController` (`169`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `acceptRecommendedDefaults` stamps every auto-selected criterion strictly with `basis: "delegated"` (visible under `Chosen for you`), never `"explicit"` or `"confirmed"`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/discovery/src/selector/**`, `packages/discovery/src/depth/**`, `packages/discovery/src/readiness/**`, `packages/discovery/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit percentage readiness scores hiding unsettled blocking criteria; always report exact basis counts.
- Do not re-ask criteria already settled with `basis = 'observed'`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/discovery test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: An end-to-end discovery session over `ProjectStateDb` ingests an opening prompt, runs `acceptRecommendedDefaults`, pre-settles observed criteria without re-asking, and computes exact `HonestReadinessCalculator` counts.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `DiscoverySessionCoordinator`, `AdaptiveQuestionSelector`, `DiscoveryDepthController`, and `HonestReadinessCalculator` from `@ef-harness/discovery`.

Stop.
- Commit on `harness/integration` once `@ef-harness/discovery` is 100% unified and green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C29 — `CorpusPackLoader` loads `core-data-auth`, `web-api-cli` elaborations, `X-01..X-14`, `UP-01..UP-08`, and 10 seam templates cleanly with zero YAML anchor or option-ID crashes.

Architecture.
- `v1-knowledge-corpus.md` (44 M2 / 87 Total Questions, Triggered Elaborations, `X-01..X-14` Cross-Cutting Rules, `UP-01..UP-08` Universal Policies, 10 Seam Templates, 28 `touches` Tags).
- `IMPLEMENTATION_TASKS.md` (`Task 075`–`Task 077`).
- Post-task invariant: `CorpusPackLoader` loads `core-data-auth`, `web-api-cli` elaborations, `X-01..X-14`, `UP-01..UP-08`, and 10 seam templates cleanly with zero YAML anchor or option-ID crashes.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C28` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 075` (`task/075-corpus-loader-core-data-auth` @ `db21117`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-075-corpus-loader-core-data-auth`, roots `corpus/packs/core-data-auth, packages/discovery/src/corpus-loader, packages/discovery/tests/corpus-loader`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 076` (`task/076-corpus-web-api-cli-elaborations` @ `8764a25`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-076-corpus-web-api-cli-elaborations`, roots `corpus/elaborations/api.yaml, corpus/elaborations/cli.yaml, corpus/elaborations/core-data-auth.yaml, corpus/elaborations/web.yaml, corpus/packs/web-api-cli`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 077` (`task/077-cross-cutting-rules-seams-tags` @ `b73f44c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-077-cross-cutting-rules-seams-tags`, roots `corpus/rules-seams/cross-cutting-rules.yaml, corpus/rules-seams/seam-templates.yaml, packages/planner/src/tag-detector, packages/planner/tests/tag-detector`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/075-corpus-loader-core-data-auth` (`db21117`), `task/076-corpus-web-api-cli-elaborations` (`8764a25`), and `task/077-cross-cutting-rules-seams-tags` (`b73f44c`).

Freeze.
- `CorpusPackLoader` (`loadAllBundledPacks(): LoadedCorpusCatalog`) supporting standard YAML anchors/aliases (`yaml` `merge: true`), pack kinds (`questions`, `elaborations`, `cross_cutting_rules`, `universal_policies`, `seam_templates`), and SHA-256 manifest verification.
- Consistent option IDs across `core-data-auth.yaml` (`075`) and `web-api-cli` elaboration triggers (`076`) with `0` dangling `whenOptionId` / `dependsOn` references.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-032`: Reconcile `CorpusPackLoader` (`075`) Zod schemas with the actual YAML structures authored in `076` and `077`, enable safe YAML anchor resolution (bounding alias expansion count instead of rejecting all anchors), and align dangling option IDs between `core-data-auth.yaml` and `076` elaborations.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-032`: Ensure every `touches` tag referenced in `075–077` YAML packs validates strictly against `@ef-harness/shared-contracts` `TOUCHES_TAGS` (`C04`).
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/corpus/package.json`, `packages/corpus/src/**`, `packages/corpus/packs/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not weaken `TOUCHES_TAGS` validation to `z.string()`; fix any non-canonical tag name in YAML to the exact 28-tag vocabulary.
- Do not allow unbounded billion-laughs YAML alias expansion (`maxAliasCount: 100`).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/corpus test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `new CorpusPackLoader().loadAllBundledPacks()` loads 100% of `075`, `076`, and `077` YAML files from disk (`X-01..X-14`, `UP-01..UP-08`, 10 seam templates, 0 dangling option IDs).
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `CorpusPackLoader` and `LoadedCorpusCatalog` exported from `@ef-harness/corpus`.

Stop.
- Commit on `harness/integration` once `075–077` corpus packs load cleanly together.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C30 — All 87 v1 corpus questions and all 20 SHA-256-pinned vetted skills (`infer-or-ask` byte-identical) load through one unified `CorpusPackLoader` and `SkillVettingCatalog`.

Architecture.
- `v1-knowledge-corpus.md` (Complete 87-Question Catalog & 20 Vetted v1 Skills `<= 2,000` Tokens Each), `task-and-skill-architecture.md`, `skills/infer-or-ask/SKILL.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 078`, `Task 103`, `Task 104`).
- Post-task invariant: All 87 v1 corpus questions and all 20 SHA-256-pinned vetted skills (`infer-or-ask` byte-identical) load through one unified `CorpusPackLoader` and `SkillVettingCatalog`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C29` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 103` (`task/103-corpus-wave1-expanded-packs` @ `1637274`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-103-corpus-wave1-expanded-packs`, roots `corpus/elaborations/wave1, corpus/packs/wave1-expanded, packages/discovery/tests/corpus-wave1`): unmerged — run `git merge --no-ff task/103-corpus-wave1-expanded-packs -m "integrate: Task 103 corpus-wave1-expanded-packs"`.
- Unit `Task 104` (`task/104-corpus-wave2-packs-14-skills` @ `c02800d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-104-corpus-wave2-packs-14-skills`, roots `corpus/elaborations/wave2, corpus/packs/wave2-expanded, corpus/skills/wave2, packages/discovery/tests/corpus-wave2`): unmerged — run `git merge --no-ff task/104-corpus-wave2-packs-14-skills -m "integrate: Task 104 corpus-wave2-packs-14-skills"`.
- Unit `Task 078` (`task/078-skill-vetting-quarantine-catalog` @ `404d945`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-078-skill-vetting-quarantine-catalog`, roots `corpus/skills/m2, corpus/skills/manifest.json, packages/meta-lab/src/skill-vetting, packages/meta-lab/tests/skill-vetting`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Merge `task/103-corpus-wave1-expanded-packs` (`1637274`) and `task/104-corpus-wave2-packs-14-skills` (`c02800d`) (`git merge --no-ff`) onto `harness/integration`, and verify already-merged `task/078-skill-vetting-quarantine-catalog` (`404d945`).

Freeze.
- Complete 87-question `LoadedCorpusCatalog` (`075–077` + `103` + `104`) loaded with `0` schema or referential errors by `CorpusPackLoader` and wired into `AdaptiveQuestionSelector` (`C28`).
- Unified 20-skill manifest (`6` M2 skills from `078` + `14` Wave-2 skills from `104`) under `packages/corpus/packs/skills/`, validated against closed 28 `TOUCHES_TAGS`, `<= 2,000` tokens per skill, SHA-256 digests, canary quarantine receipts, and byte-for-byte parity between `packages/corpus/packs/skills/infer-or-ask/SKILL.md` and `skills/infer-or-ask/SKILL.md`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-032`, `F-033`: Reconcile `103` and `104` sidecar manifests and YAML pack schemas with `CorpusPackLoader` (`C29`), merge `078`'s 6-skill catalog and `104`'s 14-skill catalog into one 20-skill registry, and map all non-canonical `allowedTouches` strings in `078` onto `TOUCHES_TAGS` (`C04`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-033`: Copy canonical `skills/infer-or-ask/SKILL.md` into `packages/corpus/packs/skills/infer-or-ask/SKILL.md` and recompute its manifest SHA-256 so bundled and root copies are byte-identical.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/corpus/packs/**`, `packages/corpus/src/**`, `packages/discovery/src/selector/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow any bundled `SKILL.md` to exceed `2,000` tokens or contain hidden Unicode tag/bidi characters.
- Do not modify root `skills/infer-or-ask/SKILL.md`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/corpus test && pnpm --filter @ef-harness/discovery test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CorpusPackLoader` loads all 87 questions (`44` M2 + `43` Wave 1/2) and `SkillVettingCatalog` validates all `20/20` skills with valid `TOUCHES_TAGS` and byte-exact `infer-or-ask/SKILL.md`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on complete 87-question `CorpusPackLoader` and 20-skill `SkillVettingCatalog` from `@ef-harness/corpus`.

Stop.
- Commit on `harness/integration` once all 87 questions and 20 skills pass verification.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C31 — `@ef-harness/spec-expansion` lands uncommitted `task-079` fixes, wires `079–081` together over `ProjectStateDb`, and executes real Z3 WASM Layer-4 contradiction checks.

Architecture.
- `spec-expansion-and-contradictions.md` (12 Spec Matrices, `proposed` Cell Batch Review, 5-Layer Contradiction Checker Including Z3 SMT Layer 4), `schema/state.sql` (`edges` `expands`/`contradicts`).
- `IMPLEMENTATION_TASKS.md` (`Task 079`–`Task 081`).
- Post-task invariant: `@ef-harness/spec-expansion` lands uncommitted `task-079` fixes, wires `079–081` together over `ProjectStateDb`, and executes real Z3 WASM Layer-4 contradiction checks.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C30` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 079` (`task/079-spec-matrix-generators` @ `f19582e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators`, roots `packages/spec-expansion/src/generators, packages/spec-expansion/tests/generators`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Uncommitted worktree delta (`Task 079`): apply pending changes from `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators` covering `packages/spec-expansion/src/generators/collapse.ts`, `packages/spec-expansion/src/generators/enumerate.ts`, `packages/spec-expansion/src/generators/persistence.ts`, `packages/spec-expansion/src/generators/types.ts`.
- Unit `Task 080` (`task/080-spec-cell-filler-proposed-review` @ `0f5e3d9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-080-spec-cell-filler-proposed-review`, roots `packages/spec-expansion/src/filler, packages/spec-expansion/tests/filler`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 081` (`task/081-five-layer-contradiction-checker` @ `24fe966`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-081-five-layer-contradiction-checker`, roots `packages/spec-expansion/src/contradictions, packages/spec-expansion/tests/contradictions`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify `task/079-spec-matrix-generators` (`f19582e`), `task/080-spec-cell-filler-proposed-review` (`0f5e3d9`), and `task/081-five-layer-contradiction-checker` (`24fe966`) on `harness/integration`, AND apply all uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators` (`collapse.ts`, `enumerate.ts`, `persistence.ts`, `types.ts`).

Freeze.
- `SpecMatrixGenerator` (`079`, exposing `generateMatrices`, `listCells(workItemId)`, and `listMaterializedRequirements(workItemId)`), `SpecCellFiller` (`080`), and `FiveLayerContradictionChecker` (`081`) persisted in `ProjectStateDb` (`KnowledgeGraphRepo` with `'expands'` and `'contradicts'` edges seeded in `C06`).
- Layer-4 arithmetic/state/schedule constraint solver wired to `z3-solver` WASM (with deterministic fallback only if WASM init is explicitly disabled in unit stubs).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-034`, `F-035`: Implement `listCells` and `listMaterializedRequirements` on `SpecMatrixGenerator` (`079`) consumed by `080` and `081`, align decision reading to `DecisionNodeFields` (`selectedOptionId`, `groupId` frozen in `C27`), declare `z3-solver` in `packages/spec-expansion/package.json` and wire its WASM solver into Layer 4, and export `079–081` from `packages/spec-expansion/src/index.ts`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-035`: Apply `task-079` uncommitted collapse and requirements-materialization fixes so inapplicable matrix rows collapse cleanly without orphan cells.

Shared files.
- Integration-owned shared surfaces: `packages/spec-expansion/package.json`, `packages/spec-expansion/src/**`, `packages/spec-expansion/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not silently auto-promote `basis = 'proposed'` spec cells to `'confirmed'` without explicit batch review acceptance.
- Do not insert `edges` outside `ProjectStateDb` `KnowledgeGraphRepo`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/spec-expansion test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: End-to-end test over `ProjectStateDb` expands decisions from `DiscoverySessionCoordinator` into spec cells (`expands` edges), materializes requirements, and catches an arithmetic cutoff/window contradiction via Layer-4 Z3 (`contradicts` edge).
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SpecMatrixGenerator`, `SpecCellFiller`, and `FiveLayerContradictionChecker` from `@ef-harness/spec-expansion`.

Stop.
- Commit on `harness/integration` once `@ef-harness/spec-expansion` passes all tests.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C32 — `@ef-harness/research-engine` persists `.d.ts`-verified facts in `ProjectStateDb` + `CasBlobStore` and `system-arch`/`feature-arch` share one async `SkeletonLockEnforcer`.

Architecture.
- `architecture-and-planning.md` (Grounded `.d.ts` API Symbol Verifier, System Architecture Lock, Feature Architecture & Wireframes, `fields.names` Uniqueness), `prompt-contracts.md` (`feature-researcher@1`, `system-architect@1`, `feature-architect@1`).
- `IMPLEMENTATION_TASKS.md` (`Task 082`–`Task 084`).
- Post-task invariant: `@ef-harness/research-engine` persists `.d.ts`-verified facts in `ProjectStateDb` + `CasBlobStore` and `system-arch`/`feature-arch` share one async `SkeletonLockEnforcer`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C31` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 082` (`task/082-research-engine-api-verifier` @ `a6d8908`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-082-research-engine-api-verifier`, roots `packages/research-engine/src/allowlist.ts, packages/research-engine/src/doc-quarantine.ts, packages/research-engine/src/domain.ts, packages/research-engine/src/feature-research-orchestrator.ts, packages/research-engine/src/feature-researcher-v1.ts`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 083` (`task/083-system-architecture-synthesizer` @ `e753d6f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-083-system-architecture-synthesizer`, roots `packages/planner/src/system-arch, packages/planner/tests/system-arch`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 084` (`task/084-feature-architecture-wireframes` @ `8ce7ede`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-084-feature-architecture-wireframes`, roots `packages/planner/src/feature-arch, packages/planner/tests/feature-arch`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/082-research-engine-api-verifier` (`a6d8908`), `task/083-system-architecture-synthesizer` (`e753d6f`), and `task/084-feature-architecture-wireframes` (`8ce7ede`).

Freeze.
- `ResearchFactCache` & `FeatureResearchOrchestrator` (`082`) persist fact metadata + `'informs'` edges in `ProjectStateDb` (`KnowledgeGraphRepo`), persist full fact bodies in `CasBlobStore` (`C11`), declare `"typescript"` in runtime `dependencies` for `.d.ts` AST symbol verification, and call `SecureDocFetcher.fetchCleanDoc` (`C17`).
- Single `SkeletonLockEnforcer` & `DeterministicArchConsistencyGate` shared between `SystemArchitectureSynthesizer` (`083`) and async `FeatureArchitectureSynthesizer` (`084`), writing `fields.names` in `schema/state.sql` trigger format (`C07`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-034`, `F-036`: Move `typescript` from `devDependencies` to `dependencies` in `packages/research-engine/package.json`, replace `ResearchFactCache`'s volatile in-memory `bodies` `Map` with `CasBlobStore` + `KnowledgeGraphRepo`, and adapt `fetchDocs` to `SecureDocFetcher.fetchCleanDoc`.
2. `F-038`: Deduplicate `SkeletonLockEnforcer` between `packages/planner/src/system-arch/**` (`083`) and `src/feature-arch/**` (`084`), convert `FeatureArchitectureSynthesizer` to async `Promise` execution persisting into `KnowledgeGraphRepo`, and emit `fields.names` arrays for `NameRegistryRepo`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `.d.ts` verifier rejects hallucinated package exports absent from the installed package's TypeScript declaration AST.

Shared files.
- Integration-owned shared surfaces: `packages/research-engine/package.json`, `packages/research-engine/src/**`, `packages/planner/package.json`, `packages/planner/src/system-arch/**`, `packages/planner/src/feature-arch/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not cache research fact bodies only in RAM; reopening `ProjectStateDb` + `CasBlobStore` must recover 100% of cached facts.
- Do not allow `FeatureArchitectureSynthesizer` to mutate locked system-skeleton contracts without emitting a CCR.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/research-engine test && pnpm --filter @ef-harness/planner test -- system-arch feature-arch` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Restarting `ResearchFactCache` over the same `ProjectStateDb` + `CasBlobStore` hits cached facts with `0` network fetches, and `FeatureArchitectureSynthesizer` persists `fields.names` entries enforced by `state.db.names`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `FeatureResearchOrchestrator` (`@ef-harness/research-engine`), `SystemArchitectureSynthesizer`, `FeatureArchitectureSynthesizer`, and `SkeletonLockEnforcer` (`@ef-harness/planner`).

Stop.
- Commit on `harness/integration` once research-engine and architecture synthesizer suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C33 — `.harness/views/` Markdown export (`085`) and direct-edit import (`086`) round-trip losslessly, and `HybridRevisionEngine` (`087`) places canonical `'requirement_change'` holds.

Architecture.
- `interactive-architecture.md` (`.harness/views/` Editable Markdown Projections, `<!-- ef:node -->` Anchors, `.manifest.json` Optimistic `base_hash`, `ExportPauseLock`), `mid-build-steering.md` (Impact Walk & Surgical Revision Holds).
- `IMPLEMENTATION_TASKS.md` (`Task 085`–`Task 087`).
- Post-task invariant: `.harness/views/` Markdown export (`085`) and direct-edit import (`086`) round-trip losslessly, and `HybridRevisionEngine` (`087`) places canonical `'requirement_change'` holds.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C32` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 085` (`task/085-knowledge-views-exporter` @ `b104c7b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-085-knowledge-views-exporter`, roots `packages/planner/src/views-export, packages/planner/tests/views-export`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 086` (`task/086-markdown-direct-edit-importer` @ `8adf0a5`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-086-markdown-direct-edit-importer`, roots `packages/planner/src/views-import, packages/planner/tests/views-import`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 087` (`task/087-hybrid-revision-impact-engine` @ `a1e4945`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-087-hybrid-revision-impact-engine`, roots `packages/planner/src/revisions, packages/planner/tests/revisions`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/085-knowledge-views-exporter` (`b104c7b`), `task/086-markdown-direct-edit-importer` (`8adf0a5`), and `task/087-hybrid-revision-impact-engine` (`a1e4945`).

Freeze.
- Unified `.harness/views/.manifest.json` schema (`{ schemaVersion: 1, exportedAt: number, files: Record<relPath, { sha256: Sha256Prefixed, nodeIds: string[] }> }`), `<!-- ef:node id="..." rev="..." base_hash="sha256:..." -->` block syntax, and shared `ExportPauseLock`.
- `HybridRevisionEngine` (`087`) executes SQL `impactWalk` via `KnowledgeGraphRepo` (`C07`) and places holds via `HoldsAndSubmissionsRepo` (`C08`) using canonical `reason: 'requirement_change'`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-037`: Reconcile `.manifest.json` field names, `<!-- ef:node -->` `base_hash` (`toPrefixedSha256`), comment escaping, and `ExportPauseLock` between `packages/planner/src/views-export/**` (`085`) and `src/views-import/**` (`086`).
2. `F-039`: Change `HybridRevisionEngine` (`087`) hold reason from non-schema `'revision_in_flight'` to canonical `'requirement_change'` (`schema/state.sql` `task_holds`).
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `MarkdownDirectEditImporter` (`086`) runs `SecretRedactor.scanForSecrets` before committing user-edited `.harness/views/*.md` nodes and detects stale `base_hash` conflicts cleanly.

Shared files.
- Integration-owned shared surfaces: `packages/planner/src/views-export/**`, `packages/planner/src/views-import/**`, `packages/planner/src/revision/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `KnowledgeViewsExporter` to overwrite a `.harness/views/*.md` file that has unimported developer edits on disk (`ExportPauseLock` + `.manifest.json` hash check).
- Do not emit `'revision_in_flight'` to `state.db.task_holds`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- views-export views-import revision` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Exporting 20 `ProjectStateDb` nodes via `KnowledgeViewsExporter`, editing 1 requirement in Markdown, and importing via `MarkdownDirectEditImporter` updates `ProjectStateDb` losslessly and places `'requirement_change'` holds on impacted tasks via `HybridRevisionEngine`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `KnowledgeViewsExporter`, `MarkdownDirectEditImporter`, `ExportPauseLock`, and `HybridRevisionEngine` in `@ef-harness/planner`.

Stop.
- Commit on `harness/integration` once views round-trip and revision impact tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C34 — `KnowledgePacketSlicer` (`088`) and `KbPullToolHandlers` (`089`) align with `AttemptMcpServer` (`048`) on `kb.*` MCP tool names, `MUST | SHOULD | COULD` bands, and `WorkerTier` token caps.

Architecture.
- `knowledge-slicing.md` (`MUST / SHOULD / COULD` Bands, Junior `2–3k` / Senior `4–6k` Token Caps, Hard Auto-Split Refusal on Oversized `MUST`, Closed 28 `touches` Rule Matching, Pull-to-Push Promotion, Zero Sealed-Check Leakage).
- `IMPLEMENTATION_TASKS.md` (`Task 088`–`Task 089`).
- Post-task invariant: `KnowledgePacketSlicer` (`088`) and `KbPullToolHandlers` (`089`) align with `AttemptMcpServer` (`048`) on `kb.*` MCP tool names, `MUST | SHOULD | COULD` bands, and `WorkerTier` token caps.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C33` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 088` (`task/088-knowledge-packet-slicer` @ `c8cf1f8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-088-knowledge-packet-slicer`, roots `packages/planner/src/slicer, packages/planner/tests/slicer`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Unit `Task 089` (`task/089-rule-matching-pull-to-push` @ `cde3a46`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-089-rule-matching-pull-to-push`, roots `packages/planner/src/rule-matching, packages/planner/tests/rule-matching`): already ancestor of `harness/integration` (verify landed state; do not re-merge).
- Sequence note: Verify already-merged commits on `harness/integration`: `task/088-knowledge-packet-slicer` (`c8cf1f8`) and `task/089-rule-matching-pull-to-push` (`cde3a46`).

Freeze.
- `KnowledgePacketSlicer` (`compileTaskBrief(req: SliceBriefRequest): CompiledTaskBrief | MustBandOversizeRefusal`) using `BandName = 'MUST' | 'SHOULD' | 'COULD'` and `WorkerTier = 'Junior' | 'Mid' | 'Senior' | 'Principal'` (`C04`), supporting optional brownfield conventions (`<= 600` tokens) and `[RECENT SWEEP SYMBOL MAP]` (`<= 300` tokens) headers.
- `KbPullToolHandlers` (`089`) implementing exact `AttemptMcpServer` (`C18`) tool handlers `kb.search`, `kb.get_node`, `kb.list_rules`, and `kb.get_contract`, recording pull telemetry for pull-to-push rule promotion while hard-blocking sealed checks.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-021`, `F-039`: Unify `kb.search`, `kb.get_node`, `kb.list_rules`, and `kb.get_contract` method names and payload schemas across `AttemptMcpServer` (`048`), `KnowledgePacketSlicer` (`088`), and `KbPullToolHandlers` (`089`), normalizing band casing to `'MUST' | 'SHOULD' | 'COULD'` and worker levels to `'Junior' | 'Mid' | 'Senior' | 'Principal'`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Verify `KbPullToolHandlers` unconditionally filters out any node/check marked `sealed` or `visibility = 'oracle_only'` across both `kb.search` and `kb.get_node`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/planner/src/slicer/**`, `packages/planner/src/pull-tools/**`, `packages/mcp-server/src/tools.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not truncate `MUST` band rules to fit token budgets; emit `MustBandOversizeRefusal` requiring task auto-splitting.
- Do not expose Step 3b sealed acceptance checks through any `kb.*` MCP handler.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- slicer pull && pnpm --filter @ef-harness/mcp-server test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: End-to-end test invokes `kb.search`, `kb.get_node`, `kb.list_rules`, and `kb.get_contract` through `AttemptMcpServer` -> `KbPullToolHandlers` over `ProjectStateDb`, enforcing Junior/Senior caps and `0` sealed-check leaks.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `KnowledgePacketSlicer` and `KbPullToolHandlers` from `@ef-harness/planner` wired to `AttemptMcpServer`.

Stop.
- Commit on `harness/integration` once slicer and MCP pull-tool tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C35 — `@ef-harness/intake` lands sandboxed PDF/DOCX/HTML/CSV converters (`097`) and semantic chunker + OpenAPI/SQL/Prisma importer (`098`) over one `NormalizedDocument` and `CasBlobStore` contract.

Architecture.
- `external-intake.md` (Sandboxed Document Conversion, XXE/Zip-Bomb/Hidden-Text Stripping, Semantic Chunker, Exact OpenAPI/SQL/Prisma Contract Importer), `sandbox-and-security.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 097`–`Task 098`).
- Post-task invariant: `@ef-harness/intake` lands sandboxed PDF/DOCX/HTML/CSV converters (`097`) and semantic chunker + OpenAPI/SQL/Prisma importer (`098`) over one `NormalizedDocument` and `CasBlobStore` contract.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C34` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 097` (`task/097-external-intake-converters` @ `f41cfd0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-097-external-intake-converters`, roots `packages/intake/src/converters, packages/intake/tests/converters`): unmerged — run `git merge --no-ff task/097-external-intake-converters -m "integrate: Task 097 external-intake-converters"`.
- Unit `Task 098` (`task/098-intake-chunker-openapi-importer` @ `f266844`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-098-intake-chunker-openapi-importer`, roots `packages/intake/src/extraction, packages/intake/tests/extraction`): unmerged — run `git merge --no-ff task/098-intake-chunker-openapi-importer -m "integrate: Task 098 intake-chunker-openapi-importer"`.
- Sequence note: Merge `task/097-external-intake-converters` (`f41cfd0`) and `task/098-intake-chunker-openapi-importer` (`f266844`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- Unified `NormalizedDocument` (`{ docId: string, sourcePath: string, mimeType: string, rawCasSha256: Sha256Prefixed, sections: readonly NormalizedSection[], strippedHiddenSpansCount: number, warnings: readonly string[] }`) produced by `SandboxedDocumentConverter` (`097`) and consumed directly by `IntakeSemanticChunker` & `ExactSchemaImporter` (`098`).
- All `EvidenceLocator` citations emitted by `098` validate against `@ef-harness/shared-contracts` `EvidenceLocatorSchema` (`kind: 'doc_span'`, `C03`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-005`, `F-011`, `F-046`: Reconcile the `NormalizedDocument` field/section mismatch between `097` (`packages/intake/src/converters/**`) and `098` (`packages/intake/src/chunker/**`), wire both to `@ef-harness/db` `CasBlobStore` + `ProjectStateDb` (`KnowledgeGraphRepo`) and `@ef-harness/sandbox` `HarnessRunEngine`, and align locators to `EvidenceLocatorSchema`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `SandboxedDocumentConverter` rejects zip-bombs (compression ratio/total byte ceiling), XML `<!ENTITY` XXE payloads, and white-on-white `0pt`/`1pt` PDF prompt-injection spans before `098` chunks text.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/intake/package.json`, `packages/intake/src/converters/**`, `packages/intake/src/chunker/**`, `packages/intake/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not summarize OpenAPI paths/schemas via LLM when `ExactSchemaImporter` can parse deterministic endpoints and schemas directly.
- Do not ingest raw unredacted credentials from sample OpenAPI headers into `state.db`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/intake test -- converters chunker openapi` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Converting a fixture PDF/Markdown PRD and OpenAPI spec through `SandboxedDocumentConverter` -> `IntakeSemanticChunker` / `ExactSchemaImporter` stores raw blobs in `CasBlobStore`, strips hidden white-text injections, and writes `doc_span`-grounded contract nodes into `ProjectStateDb`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SandboxedDocumentConverter`, `IntakeSemanticChunker`, `ExactSchemaImporter`, and `NormalizedDocument` from `@ef-harness/intake`.

Stop.
- Commit on `harness/integration` once `097–098` intake tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C36 — `@ef-harness/intake` completes SVG/EXIF `BrandAssetSanitizer` (`099`) and `BugHarScrubber` (`100`) persisted in `ProjectStateDb` and `CasBlobStore` with zero rogue SQLite files.

Architecture.
- `external-intake.md` (SVG `<script>`/Event/External-Href Sanitizer, Raster EXIF GPS Stripper, Brand Token Extractor, HAR/Log Cookie/Auth/Token Scrubber & `SymptomCard`), `ui-design-system.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 099`–`Task 100`).
- Post-task invariant: `@ef-harness/intake` completes SVG/EXIF `BrandAssetSanitizer` (`099`) and `BugHarScrubber` (`100`) persisted in `ProjectStateDb` and `CasBlobStore` with zero rogue SQLite files.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C35` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 099` (`task/099-brand-asset-sanitizer-registry` @ `8c8e2f7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-099-brand-asset-sanitizer-registry`, roots `packages/intake/src/assets, packages/intake/tests/assets`): unmerged — run `git merge --no-ff task/099-brand-asset-sanitizer-registry -m "integrate: Task 099 brand-asset-sanitizer-registry"`.
- Unit `Task 100` (`task/100-bug-har-scrubber-triage` @ `74e4e4a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-100-bug-har-scrubber-triage`, roots `packages/intake/src/bug-scrubber, packages/intake/tests/bug-scrubber`): unmerged — run `git merge --no-ff task/100-bug-har-scrubber-triage -m "integrate: Task 100 bug-har-scrubber-triage"`.
- Sequence note: Merge `task/099-brand-asset-sanitizer-registry` (`8c8e2f7`) and `task/100-bug-har-scrubber-triage` (`74e4e4a`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `BrandAssetSanitizer` (`099` `sanitizeAndRegisterAsset(input): Promise<RegisteredBrandAsset>`) storing sanitized SVG/PNG/WebP bytes in `CasBlobStore` (`C11`) and asset metadata in `ProjectStateDb` (`KnowledgeGraphRepo` + `ArtifactCatalogRepo`).
- `BugIntakePipeline` / `HarAndLogScrubber` (`100` `ingestBugReport(input): Promise<SymptomCard>`, `getSymptomCard(id): SymptomCard | null`) scrubbing `Authorization`, `Cookie`, `Set-Cookie`, OAuth query params, and `SecretRedactor` patterns before persisting `SymptomCard` in `ProjectStateDb`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-011`, `F-012`, `F-046`, `F-079`: Delete `099`'s rogue `SqliteBrandAssetState` private SQLite schema in favor of `ProjectStateDb` + `CasBlobStore`, delegate `100` secret scrubbing to `@ef-harness/shared-observability` `SecretRedactor`, expose `getSymptomCard(id)` for `MysteryBugInvestigationPipeline` (`182`), and export all 4 submodules (`097–100`) from `packages/intake/src/index.ts`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Verify `BrandAssetSanitizer` strips `<script>`, `onload`/`onerror`, `foreignObject`, and external `xlink:href`/`href` SSRF vectors from SVGs and strips EXIF GPS tags from JPEG/PNG uploads.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/intake/package.json`, `packages/intake/src/brand-assets/**`, `packages/intake/src/bug-scrubber/**`, `packages/intake/src/index.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not write un-scrubbed raw HAR files containing session cookies or bearer tokens into `CasBlobStore` or `state.db`.
- Do not open standalone `new DatabaseSync(...)` files inside `packages/intake`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/intake test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Malicious SVG `<script>`/`onerror` and EXIF GPS metadata are stripped completely, HAR `Cookie`/`Authorization` headers are scrubbed to `0` raw secret bytes, and `getSymptomCard(id)` retrieves the persisted `SymptomCard` from `ProjectStateDb`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BrandAssetSanitizer`, `BugIntakePipeline`, `HarAndLogScrubber`, and `SymptomCard` exported from `@ef-harness/intake`.

Stop.
- Commit on `harness/integration` once `@ef-harness/intake` is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C37 — `MasterPlanner`, `FeaturePlanner` + Step 3b `IndependentOracleAuthorSealer`, and `DeterministicGraphCompiler` compile acyclic waves directly into `ProjectStateDb`.

Architecture.
- `architecture-and-planning.md` (Master Wave Plan, `<= 20%` Paperwork Budget, Step 3b Cross-Family Independent Sealed Oracles Authored Before Compile, Deterministic Graph Compiler & Auto-Split), `schema/state.sql` (`features`, `tasks`, `task_deps`, `checks`).
- `IMPLEMENTATION_TASKS.md` (`Task 090`–`Task 092`).
- Post-task invariant: `MasterPlanner`, `FeaturePlanner` + Step 3b `IndependentOracleAuthorSealer`, and `DeterministicGraphCompiler` compile acyclic waves directly into `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C36` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 090` (`task/090-master-planner-wave-budgets` @ `b6b1e95`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-090-master-planner-wave-budgets`, roots `packages/planner/src/master-plan, packages/planner/tests/master-plan`): unmerged — run `git merge --no-ff task/090-master-planner-wave-budgets -m "integrate: Task 090 master-planner-wave-budgets"`.
- Unit `Task 091` (`task/091-feature-planner-sealed-oracles` @ `c779647`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-091-feature-planner-sealed-oracles`, roots `packages/planner/src/feature-plan, packages/planner/tests/feature-plan`): unmerged — run `git merge --no-ff task/091-feature-planner-sealed-oracles -m "integrate: Task 091 feature-planner-sealed-oracles"`.
- Unit `Task 092` (`task/092-deterministic-graph-compiler` @ `95d6eb5`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-092-deterministic-graph-compiler`, roots `packages/planner/src/graph-compiler, packages/planner/tests/graph-compiler`): unmerged — run `git merge --no-ff task/092-deterministic-graph-compiler -m "integrate: Task 092 deterministic-graph-compiler"`.
- Sequence note: Merge `task/090-master-planner-wave-budgets` (`b6b1e95`), `task/091-feature-planner-sealed-oracles` (`c779647`), and `task/092-deterministic-graph-compiler` (`95d6eb5`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `MasterPlannerEngine` (`090`), `FeaturePlannerEngine` & `IndependentOracleAuthorSealer` + `HiddenCheckPoolStore` (`091`, enforcing cross-family model diversity when `>= 2` families exist and `>= 3` concrete input/output examples per sealed check), and `DeterministicGraphCompiler` (`092`).
- All 3 engines use async `Promise` model ports, canonical `ProjectKind` & `WorkerTier` (`C04`), and persist features, tasks, `task_deps`, and sealed `checks` strictly in `ProjectStateDb` (`C05`–`C08`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-040`, `F-041`, `F-080`: Delete the private `CREATE TABLE` SQLite schemas in `090`, `091`, and `092`, bind them to `ProjectStateDb` (`schema/state.sql`), implement the missing sibling methods on `DeterministicGraphCompiler` (`compileFeatureWave`, `validateDisjointWriteScopes`, `listSealedForFeatures` on `HiddenCheckPoolStore` for `186`), and unify `ProjectKind`/`WorkerTier` enums.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- Ensure `DeterministicGraphCompiler` hard-refuses compilation if Step 3b sealed checks are missing for a feature or if `KnowledgePacketSlicer` (`C34`) returns `MustBandOversizeRefusal` (triggering deterministic task split).
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/planner/package.json`, `packages/planner/src/master-plan/**`, `packages/planner/src/feature-plan/**`, `packages/planner/src/graph-compiler/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not expose `HiddenCheckPoolStore` sealed check bodies to `FeaturePlannerEngine` task briefs or worker slots.
- Do not allow cyclic `task_deps` or overlapping parallel `write_scope` globs within the same wave.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- master-plan feature-plan graph-compiler` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: End-to-end test plans a 2-feature project into `ProjectStateDb`, seals Step 3b cross-family checks in `HiddenCheckPoolStore`, and compiles acyclic `tasks` + `task_deps` with `<= 20%` paperwork budget.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `MasterPlannerEngine`, `FeaturePlannerEngine`, `IndependentOracleAuthorSealer`, `HiddenCheckPoolStore`, and `DeterministicGraphCompiler` in `@ef-harness/planner`.

Stop.
- Commit on `harness/integration` once `090–092` planning and compiler tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C38 — `Phase0ExecutionController` (`P0.1`–`P0.8` + Gate 0), Playwright `StyleguideRouteVerifier`, and `SequentialBuildRunner` execute over real sandboxed workers and verifiers.

Architecture.
- `build-pipeline.md` (Phase 0 `P0.1` Serial -> `P0.2..P0.8` Parallel + Gate 0 `/__styleguide`, Sequential Task Dispatcher), `ui-design-system.md` (Design Tokens, Anti-Slop Rules, `/__styleguide` Verification).
- `IMPLEMENTATION_TASKS.md` (`Task 093`–`Task 095`).
- Post-task invariant: `Phase0ExecutionController` (`P0.1`–`P0.8` + Gate 0), Playwright `StyleguideRouteVerifier`, and `SequentialBuildRunner` execute over real sandboxed workers and verifiers.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C37` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 093` (`task/093-phase0-controller-gate0` @ `1d460bd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-093-phase0-controller-gate0`, roots `packages/planner/src/phase0, packages/planner/tests/phase0`): unmerged — run `git merge --no-ff task/093-phase0-controller-gate0 -m "integrate: Task 093 phase0-controller-gate0"`.
- Unit `Task 094` (`task/094-ui-design-system-pipeline` @ `0e553ab`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-094-ui-design-system-pipeline`, roots `packages/planner/src/design-system, packages/planner/tests/design-system`): unmerged — run `git merge --no-ff task/094-ui-design-system-pipeline -m "integrate: Task 094 ui-design-system-pipeline"`.
- Unit `Task 095` (`task/095-sequential-task-dispatcher` @ `769e91a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-095-sequential-task-dispatcher`, roots `packages/planner/src/sequential-runner, packages/planner/tests/sequential-runner`): unmerged — run `git merge --no-ff task/095-sequential-task-dispatcher -m "integrate: Task 095 sequential-task-dispatcher"`.
- Sequence note: Merge `task/093-phase0-controller-gate0` (`1d460bd`), `task/094-ui-design-system-pipeline` (`0e553ab`), and `task/095-sequential-task-dispatcher` (`769e91a`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `Phase0ExecutionController` (`093`, running `P0.1` serial then `P0.2..P0.8` scoped by `ProjectKind` — skipping UI steps `P0.4`/`P0.8` on `cli_tool`/`backend_api` — using real `KernelPackageInstaller` `C18` and `HarnessRunEngine` `C18`).
- `UiDesignSystemPipeline` & `StyleguideRouteVerifier` (`094`, rendering `/__styleguide` in Playwright via `UiPlaywrightContractVerifier` `C24` and storing real screenshots in `CasBlobStore` `C11`).
- `SequentialBuildRunner` (`095`) driving `NativeWorkerLoop` (`C22`) -> `CleanVerifierHarness` (`C23`) -> `CandidateAcceptanceCoordinator` (`C25`) over `ProjectStateDb`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-040`, `F-041`, `F-042`, `F-043`: Delete private SQLite schemas and `LocalKernelPackageInstaller`/toy regex default ports in `093–095`, wire `093` to `KernelPackageInstaller` + `HarnessRunEngine`, wire `094` to `UiPlaywrightContractVerifier` + `CasBlobStore`, and wire `095` to `ProjectStateDb` + `NativeWorkerLoop` + `CleanVerifierHarness` + `CandidateAcceptanceCoordinator`.

Local defects.
- `F-042`: Replace `094`'s fake `solidPng` 1-color buffer generator with real Playwright screenshot capture (retaining deterministic mock injection only for headless unit tests).
- `F-043`: Fix `SequentialBuildRunner`'s `LocalFeatureIntegrator` bug (`journeys === 0` rejecting valid CLI/API features that have `0` UI journeys) and make `PostMergeSmokeChecker` actually execute smoke commands via `HarnessRunEngine`.

Shared files.
- Integration-owned shared surfaces: `packages/planner/package.json`, `packages/planner/src/phase0/**`, `packages/planner/src/design-system/**`, `packages/planner/src/sequential-runner/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not spawn unsandboxed `child_process` commands in `Phase0ExecutionController` or `PostMergeSmokeChecker`.
- Do not generate UI `/__styleguide` Phase 0 tasks when `projectKind` is `'cli_tool'` or `'backend_api'`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- phase0 design-system sequential` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Tests confirm `Phase0ExecutionController` skips `P0.4`/`P0.8` on `cli_tool`, runs `P0.1` before `P0.2..P0.8` on `web_fullstack` inside `HarnessRunEngine`, and `SequentialBuildRunner` completes both UI (`journeys > 0`) and CLI (`journeys === 0`) features.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `Phase0ExecutionController`, `UiDesignSystemPipeline`, `StyleguideRouteVerifier`, and `SequentialBuildRunner` in `@ef-harness/planner`.

Stop.
- Commit on `harness/integration` once `093–095` tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C39 — `FeatureIntegratorEngine` (`096`), `CompletionWaveController` (`101`), and `SpecialistPromptRunners` (`102`) execute async verified merges, sharded final audits, and grounded `ask-owner-responder@1` answers.

Architecture.
- `build-pipeline.md` (Feature Integration onto `harness/f/<feature>`, Completion Wave Sharded Final Audit `<= 2` Rounds & `<= 10%` Fix Cap, Landing Summary), `prompt-contracts.md` (`reviewer@1`, `final-project-auditor@1`, `ask-owner-responder@1`).
- `IMPLEMENTATION_TASKS.md` (`Task 096`, `Task 101`, `Task 102`).
- Post-task invariant: `FeatureIntegratorEngine` (`096`), `CompletionWaveController` (`101`), and `SpecialistPromptRunners` (`102`) execute async verified merges, sharded final audits, and grounded `ask-owner-responder@1` answers.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C38` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 096` (`task/096-feature-integrator-engine` @ `f69c07d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-096-feature-integrator-engine`, roots `packages/integrator/src/feature-integrator, packages/integrator/tests/feature-integrator`): unmerged — run `git merge --no-ff task/096-feature-integrator-engine -m "integrate: Task 096 feature-integrator-engine"`.
- Unit `Task 101` (`task/101-completion-wave-final-audit` @ `8660af4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-101-completion-wave-final-audit`, roots `packages/integrator/src/final-audit, packages/integrator/tests/final-audit`): unmerged — run `git merge --no-ff task/101-completion-wave-final-audit -m "integrate: Task 101 completion-wave-final-audit"`.
- Unit `Task 102` (`task/102-specialist-review-qa-prompts` @ `61496c7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-102-specialist-review-qa-prompts`, roots `packages/planner/src/specialists, packages/planner/tests/specialists`): unmerged — run `git merge --no-ff task/102-specialist-review-qa-prompts -m "integrate: Task 102 specialist-review-qa-prompts"`.
- Sequence note: Merge `task/096-feature-integrator-engine` (`f69c07d`), `task/101-completion-wave-final-audit` (`8660af4`), and `task/102-specialist-review-qa-prompts` (`61496c7`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `FeatureIntegratorEngine` (`096`) and `CompletionWaveController` & `LandingSummaryGenerator` (`101`) exported from `@ef-harness/integrator` and bound to async `CleanVerifierHarness` (`C23`), `RedBeforeGreenBlindBinder` (`C24`), `BudgetReservationLedger` (`C09`), and `ProjectStateDb`.
- `SpecialistPromptRunners` (`102` in `@ef-harness/planner`) running async `reviewer@1`, `dispute-adjudicator@1`, and `AskOwnerResponderEngine` (`ask-owner-responder@1`, returning grounded LLM explanation + actual file line bounds instead of discarding model output).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-044`, `F-047`, `F-054`: Convert sync model/verifier/binder ports in `096`, `101`, and `102` to async `Promise` contracts, delete `101`'s private `FinalAuditStore` SQLite DDL in favor of `ProjectStateDb`, wire `BudgetReservationLedger.getScopeSnapshot` (`C09`), and expose `AskOwnerResponderEngine.answerQuestion(req)` matching `FourRouteSteeringDispatcher` (`114`).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-044`: Fix `AskOwnerResponderEngine` (`102`) so it parses, validates (`AskOwnerResponderV1Schema`), and returns the model's grounded answer instead of discarding it for a static template, and compute real file line counts instead of hardcoding `1..400`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/integrator/package.json`, `packages/integrator/src/feature-integrator/**`, `packages/integrator/src/completion-wave/**`, `packages/integrator/src/index.ts`, `packages/planner/src/specialists/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `CompletionWaveController` to exceed `2` audit-fix rounds or `10%` of project build budget.
- Do not fabricate `code_span` line ranges beyond a file's real line count in `SpecialistPromptRunners`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/integrator test -- feature-integrator completion-wave && pnpm --filter @ef-harness/planner test -- specialists` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `FeatureIntegratorEngine` merges leaf tasks onto `harness/f/<slug>` verified by `CleanVerifierHarness`, `CompletionWaveController` enforces the 2-round/`10%` cap on `ProjectStateDb`, and `AskOwnerResponderEngine` returns validated `ask-owner-responder@1` answers.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `FeatureIntegratorEngine`, `CompletionWaveController`, `LandingSummaryGenerator` (`@ef-harness/integrator`), and `AskOwnerResponderEngine` (`@ef-harness/planner`).

Stop.
- Commit on `harness/integration` once `096`, `101`, and `102` suites pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C40 — `VersionedModelRoster` (`106`) and `HeftCriticalPathScheduler` (`107`) share canonical `WorkerTier` & `CrewPreset` contracts and dispatch concrete model IDs.

Architecture.
- `task-and-skill-architecture.md` (Crew Presets `budget | balanced | thorough`, Worker Tiers `Junior | Mid | Senior | Principal`, Expected-Cost Escalation), `execution-capacity.md` (HEFT Critical-Path Wave Scheduler).
- `IMPLEMENTATION_TASKS.md` (`Task 106`–`Task 107`).
- Post-task invariant: `VersionedModelRoster` (`106`) and `HeftCriticalPathScheduler` (`107`) share canonical `WorkerTier` & `CrewPreset` contracts and dispatch concrete model IDs.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C39` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 106` (`task/106-crew-levels-expected-cost` @ `279569d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-106-crew-levels-expected-cost`, roots `packages/planner/src/crew-levels, packages/planner/tests/crew-levels`): unmerged — run `git merge --no-ff task/106-crew-levels-expected-cost -m "integrate: Task 106 crew-levels-expected-cost"`.
- Unit `Task 107` (`task/107-heft-scheduler-crew-presets` @ `3f1744a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-107-heft-scheduler-crew-presets`, roots `packages/planner/src/scheduler, packages/planner/tests/scheduler`): unmerged — run `git merge --no-ff task/107-heft-scheduler-crew-presets -m "integrate: Task 107 heft-scheduler-crew-presets"`.
- Sequence note: Merge `task/106-crew-levels-expected-cost` (`279569d`) and `task/107-heft-scheduler-crew-presets` (`3f1744a`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `VersionedModelRoster` (`resolveModelForTier(tier: WorkerTier, connectionId?: string): ResolvedModelAssignment`, `estimateTaskExpectedCostMicroUsd(task, preset: CrewPreset): number`).
- `HeftCriticalPathScheduler` (`scheduleReadyWave(graph, preset: CrewPreset, capacity): ScheduledDispatch[]`) resolving every `ScheduledDispatch.modelId` via `VersionedModelRoster.resolveModelForTier` (never passing raw tier strings like `"Mid"` as `modelId`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-039`, `F-040`, `F-045`: Align `106` and `107` onto `@ef-harness/shared-contracts` `WorkerTier` (`"Junior" | "Mid" | "Senior" | "Principal"`), `CrewPreset` (`"budget" | "balanced" | "thorough"`), and `ProjectKind`, wiring `HeftCriticalPathScheduler` directly to `VersionedModelRoster`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-045`: Fix the dispatch bug in `107` where tier names (`"junior"`/`"Mid"`) were emitted in the `modelId` field instead of concrete provider model identifiers from `VersionedModelRoster`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/planner/src/crew-levels/**`, `packages/planner/src/scheduler/**`, `packages/planner/src/index.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit lowercase worker tiers or capitalized crew presets (`"Balanced"`) across package boundaries.
- Do not schedule tasks that hold active `'user_pause' | 'requirement_change' | 'budget' | 'ccr' | 'governor'` holds in `HoldsAndSubmissionsRepo`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- crew-levels scheduler` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `HeftCriticalPathScheduler` orders critical-path tasks highest, respects `CrewPreset` tier assignments, and populates valid concrete `modelId` + integer `expectedCostMicroUsd` from `VersionedModelRoster`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `VersionedModelRoster` and `HeftCriticalPathScheduler` exported from `@ef-harness/planner`.

Stop.
- Commit on `harness/integration` once `106–107` roster and HEFT scheduler tests pass.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C41 — `PlanPreviewAndAutoStartGate` (`108`) completes `@ef-harness/planner` with durable `global.db` 24h auto-start caps, and `Task 105` M2 Kitchen Exit Gate certifies the real M2 pipeline.

Architecture.
- `architecture-and-planning.md` (`Planned` Wave 1 vs `Projected` Wave 2+ Plan Preview, Explicit `Start build` Default & Bounded 24h Opt-In Auto-Start), `roadmap.md` (Milestone M2 Kitchen Exit Gate).
- `IMPLEMENTATION_TASKS.md` (`Task 105`, `Task 108`).
- Post-task invariant: `PlanPreviewAndAutoStartGate` (`108`) completes `@ef-harness/planner` with durable `global.db` 24h auto-start caps, and `Task 105` M2 Kitchen Exit Gate certifies the real M2 pipeline.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C40` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 108` (`task/108-plan-preview-autostart-gate` @ `95c9260`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-108-plan-preview-autostart-gate`, roots `packages/planner/src/plan-preview, packages/planner/tests/plan-preview`): unmerged — run `git merge --no-ff task/108-plan-preview-autostart-gate -m "integrate: Task 108 plan-preview-autostart-gate"`.
- Unit `Task 105` (`task/105-m2-kitchen-exit-gate` @ `f8e06c0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-105-m2-kitchen-exit-gate`, roots `benchmarks/m2-kitchen-e2e/.gitignore, benchmarks/m2-kitchen-e2e/baseline-metrics.schema.json, benchmarks/m2-kitchen-e2e/fixture, benchmarks/m2-kitchen-e2e/hidden, benchmarks/m2-kitchen-e2e/opening-prompt.txt`): unmerged — run `git merge --no-ff task/105-m2-kitchen-exit-gate -m "integrate: Task 105 m2-kitchen-exit-gate"`.
- Sequence note: Merge `task/108-plan-preview-autostart-gate` (`95c9260`) and `task/105-m2-kitchen-exit-gate` (`f8e06c0`) (`git merge --no-ff`) onto `harness/integration`.

Freeze.
- `PlanPreviewAndAutoStartGate` (`108`) consuming `MasterPlannerEngine` (`C37`), `VersionedModelRoster` & `HeftCriticalPathScheduler` (`C40`), and persisting rolling 24h auto-start spend counters durably in `GlobalBrokerDb` (`global.db.settings`/`grants`, never volatile RAM).
- Complete `@ef-harness/planner` barrel (`packages/planner/src/index.ts`) exporting `system-arch`, `feature-arch`, `views-export`, `views-import`, `revision`, `slicer`, `pull-tools`, `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, `sequential-runner`, `specialists`, `crew-levels`, `scheduler`, and `plan-preview`.
- `M2KitchenExitGate` (`tests/e2e/m2-exit-gate/**`) using `.js` ESM specifiers and executing the real M2 packages (`discovery` -> `corpus` -> `spec-expansion` -> `research-engine` -> `intake` -> `planner` -> `worker-loop` -> `verifier` -> `integrator`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-040`, `F-045`: Align `PlanPreviewAndAutoStartGate` (`108`) to `VersionedModelRoster`/`HeftCriticalPathScheduler` (`C40`) + `GlobalBrokerDb` (`C05`), and export all 17 `@ef-harness/planner` submodules from `packages/planner/src/index.ts`.
2. `F-048`: Convert `.ts` import extensions in `tests/e2e/m2-exit-gate/**` to `.js`, replace pre-baked static HTML/JS fixture copying with real M2 pipeline execution against deterministic mock model responses, and add `m2:replay` script hooks.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-045`: Fix volatile in-memory 24h auto-start spend tracking in `108` so restarting `harnessd` preserves cumulative 24h auto-start spend in `global.db`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/planner/src/plan-preview/**`, `packages/planner/src/index.ts`, `tests/e2e/package.json`, `tests/e2e/m2-exit-gate/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `PlanPreviewAndAutoStartGate` to auto-start builds by default or authorize production deploy effects (`Task 176`).
- Do not pass `m2-exit-gate` by copying static pre-written Kitchen app files without running `DiscoverySessionCoordinator`, `DeterministicGraphCompiler`, and `SequentialBuildRunner`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test && pnpm --filter @ef-harness/e2e test -- m2` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `PlanPreviewAndAutoStartGate` preserves 24h spend across `GlobalBrokerDb` reopen, and `m2-exit-gate` drives the real M2 packages end-to-end with `>= 90%` independent sealed check pass rate and `<= 20%` paperwork.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on the complete 17-module `@ef-harness/planner` barrel and green M2 Exit Gate.

Stop.
- Commit on `harness/integration` once Wave 3 (entire M2 stack) is 100% green.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C42 — Artifact handoffs (`harness.read_result`), role mailbox, and parallel feature branch coordination run over shared `ProjectStateDb`, `CasBlobStore`, and `GitEngine`.

Architecture.
- `agent-handoffs.md` (`ArtifactHandoffStore`, `harness.read_result` pull tool, `DurableRoleMailbox`, `WaitGraphCycleDetector`), `parallel-feature-integration.md` (`ParallelFeatureBranchManager`, `DependencyIntentAggregator`, `MigrationIntentAndConflictLinter`).
- `database-design.md`, `schema/state.sql` (`leases`, `feature_runtime`, `edges`, `read_sets`), `IMPLEMENTATION_TASKS.md` (`Task 109`–`Task 110`).
- Post-task invariant: Artifact handoffs (`harness.read_result`), role mailbox, and parallel feature branch coordination run over shared `ProjectStateDb`, `CasBlobStore`, and `GitEngine`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C41` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 109` (`task/109-artifact-handoff-mailbox-engine` @ `989041d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-109-artifact-handoff-mailbox-engine`, roots `packages/integrator/src/handoffs, packages/integrator/tests/handoffs`): unmerged — run `git merge --no-ff task/109-artifact-handoff-mailbox-engine -m "integrate: Task 109 artifact-handoff-mailbox-engine"`.
- Unit `Task 110` (`task/110-parallel-feature-branches-migrations` @ `08a8f36`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-110-parallel-feature-branches-migrations`, roots `packages/integrator/src/feature-branches, packages/integrator/tests/feature-branches`): unmerged — run `git merge --no-ff task/110-parallel-feature-branches-migrations -m "integrate: Task 110 parallel-feature-branches-migrations"`.
- Sequence note: Merge `task/109-artifact-handoff-mailbox-engine` (`989041d`) then `task/110-parallel-feature-branches-migrations` (`08a8f36`) (`git merge --no-ff`) onto `harness/integration` (C41 child).

Freeze.
- `ArtifactHandoffStore` (`packages/integrator/src/handoffs/index.ts`) stores pointer metadata in `ProjectStateDb` (`handoff_artifacts` + `role_mailbox` v2 migration) and raw payloads in `CasBlobStore` (`"sha256:<64-hex>"`), deleting `HANDOFF_DDL` private `cas_blobs`, `graph_edges`, and `contract_owners` tables.
- `ReadResultToolHandler` exposes `harness.read_result` via `AttemptMcpServer` (`packages/mcp-server/src/server.ts`) rejecting non-pull free-form chat payloads.
- `ParallelFeatureBranchManager` (`packages/integrator/src/feature-branches/index.ts`) delegates branch creation/leasing/freshness to `RuntimeLifecycleRepo` (`C11`), `WorktreeSlotPool` + `GitRefCasUpdater` (`C14`), and async `KernelPackageInstaller` (`C17`), deleting `feature_branch_runtime` and private `ref_leases`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-049`: Register `ReadResultToolHandler` on `AttemptMcpServer` (`packages/mcp-server/src/server.ts`) so sandboxed agents pull `harness.read_result` over MCP.
2. `F-049`: Replace `packages/integrator/src/handoffs/ddl.ts` (14 tables) and `feature-branches/state-db.ts` (6 tables) with additive `MigrationRunner` v2 DDL in `packages/db/src/migrations/**` and single-writer `ProjectStateDb`.
3. `F-050`: Wire `DependencyIntentAggregator` (`packages/integrator/src/feature-branches/**`) to async `KernelPackageInstaller` (`@ef-harness/sandbox`) and add `@ef-harness/{db,git-engine,mcp-server,sandbox,verifier,planner,shared-observability}` to `packages/integrator/package.json`.

Local defects.
- `F-049`: Remove raw binary `BLOB` persistence from SQLite in `packages/integrator/src/handoffs/ddl.ts` so payloads live exclusively in `CasBlobStore` keyed by `canonical` `"sha256:<64-hex>"` digests.
- `F-049`: Replace duplicated `WaitGraphCycleDetector` edge queries in `109` with `KnowledgeGraphRepo` (`state.db.edges`) queries.

Shared files.
- Integration-owned shared surfaces: `packages/integrator/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/mcp-server/src/server.ts`, `packages/integrator/src/handoffs/**`, `packages/integrator/src/feature-branches/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not keep raw SQLite `ref_leases`, `cas_blobs`, or `feature_branch_runtime` tables in `packages/integrator`.
- Do not allow `node scripts/agent-worktree.mjs commit`, `EF-Never-Merge`, or reverting `Task 002`–`108` integration commits.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/mcp-server test && pnpm --filter @ef-harness/integrator test -- handoffs feature-branches` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `AttemptMcpServer` dispatches `harness.read_result`, `handoffs` persists payloads in `CasBlobStore`, and `ParallelFeatureBranchManager` coordinates branches via `RuntimeLifecycleRepo` and `leases`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `ArtifactHandoffStore`, `ReadResultToolHandler`, `DurableRoleMailbox`, `ParallelFeatureBranchManager`, and `MigrationIntentAndConflictLinter` from `@ef-harness/integrator` subpath `handoffs`/`feature-branches` (exported cleanly in C43).

Stop.
- Commit `integrate: Task 109 artifact-handoff-mailbox-engine`, `integrate: Task 110 parallel-feature-branches-migrations`, and `integrate: wire handoffs/feature-branches` with `EF_HARNESS_MAINTAINER=1`; halt on unlisted conflicts.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C43 — `ProjectMergeQueue`, `ContractChangeRequestEngine`, and `FeatureUndoEngine` run sandboxed `CombinedRegressionGate` over real `state.db` and export all `@ef-harness/integrator` M3 APIs.

Architecture.
- `parallel-feature-integration.md` (Project Merge Queue & Conflict Resolution), `linked-architecture-revisions.md` (Contract Change Requests `ccr@1`), `stops-undo-and-reentry.md` (Planned Feature Undo).
- `prompt-contracts.md` (`project-integrator@1`, `ccr@1`), `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Task 111`, `Task 112`, `Task 129`).
- Post-task invariant: `ProjectMergeQueue`, `ContractChangeRequestEngine`, and `FeatureUndoEngine` run sandboxed `CombinedRegressionGate` over real `state.db` and export all `@ef-harness/integrator` M3 APIs.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C42` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 111` (`task/111-project-merge-queue-integrator` @ `72b37e6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-111-project-merge-queue-integrator`, roots `packages/integrator/src/merge-queue, packages/integrator/tests/merge-queue`): unmerged — run `git merge --no-ff task/111-project-merge-queue-integrator -m "integrate: Task 111 project-merge-queue-integrator"`.
- Unit `Task 112` (`task/112-contract-change-request-pipeline` @ `5ed8f81`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-112-contract-change-request-pipeline`, roots `packages/integrator/src/ccr, packages/integrator/tests/ccr`): unmerged — run `git merge --no-ff task/112-contract-change-request-pipeline -m "integrate: Task 112 contract-change-request-pipeline"`.
- Unit `Task 129` (`task/129-planned-feature-undo-engine` @ `94ca48c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-129-planned-feature-undo-engine`, roots `packages/integrator/src/undo, packages/integrator/tests/undo`): unmerged — run `git merge --no-ff task/129-planned-feature-undo-engine -m "integrate: Task 129 planned-feature-undo-engine"`.
- Sequence note: Merge `task/111-project-merge-queue-integrator` (`72b37e6`), `task/112-contract-change-request-pipeline` (`5ed8f81`), and `task/129-planned-feature-undo-engine` (`94ca48c`) (`git merge --no-ff`) in exact order `111 -> 112 -> 129` onto `harness/integration` (C42 child).

Freeze.
- `CombinedRegressionGate` (`packages/integrator/src/merge-queue/gate.ts`) is async, runs target repo `typecheck`, `lint`, `build`, migrations (`TemplateDbManager`), `CompletenessGateRunner`, `SafetyScanner`, and full tests inside `CleanVerifierRunner` + `HarnessRunEngine` (shared by `111` & `FeatureUndoEngine` `129`).
- `ProjectIntegratorEngine.resolve` and `CcrSemanticCompatibilityReviewer.review` invoke async `ModelProtocolAdapter` (`project-integrator@1`, `ccr@1`).
- `packages/integrator/src/index.ts` exports `feature-integrator`, `final-audit`, `handoffs`, `feature-branches`, `merge-queue`, `ccr`, and `undo` cleanly.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-049`: Migrate `merge-queue/state-db.ts` (`merge_queue_items`), `ccr/ledger.ts` (`ccr_requests`), and `undo/state-db.ts` (archival metadata on `nodes.status = 'retired'` + `feature_states = 'UNDONE'`) onto `ProjectStateDb` + `MigrationRunner` v2, deleting `feature_queue_runtime`, `undo_nodes`, and private `ref_leases`.
2. `F-049`: Replace all 12 `Local*` stand-in ports in `packages/integrator/src/ccr/engine.ts:96-114` with real `DurableRoleMailbox`/`WaitGraphCycleDetector` (`109`), `MigrationIntentAndConflictLinter` (`110`), `ProjectMergeQueue` (`111`), `HoldsSubmissionsRepo` (`021`), `SkeletonLockEnforcer` (`083`), `HybridRevisionEngine` (`087`), and `RevisionAutoStartPolicy` (`108`).
3. `F-050`: Wire `FeatureUndoEngine` (`129`) `undo/gate.ts` to `111` `CombinedRegressionGate`, replacing raw `spawnSync` over `features/**/*.test.js`.

Local defects.
- `F-050`: Delete hardcoded `build.mjs`, `template/app.sqlite`, `features/*/manifest.json`, and `node --check *.js` (which skipped all `.ts`/`.tsx` files) in `packages/integrator/src/merge-queue/gate.ts:90-218` and `engine.ts:182`.

Shared files.
- Integration-owned shared surfaces: `packages/integrator/src/index.ts`, `packages/db/src/migrations/**`, `packages/integrator/src/merge-queue/**`, `packages/integrator/src/ccr/**`, `packages/integrator/src/undo/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.

Do not.
- Do not allow `CombinedRegressionGate` to spawn unsandboxed host builds or skip `.ts`/`.tsx` files.
- Do not revert `Task 096` or `Task 101` exports from `packages/integrator/src/index.ts`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/integrator test -- merge-queue ccr undo feature-integrator final-audit` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CombinedRegressionGate` catches real `.ts`/`.tsx` compile/test regressions inside `HarnessRunEngine` + `CleanVerifierRunner` and `packages/integrator/src/index.ts` exports all M2/M3 integrator modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `ProjectMergeQueue`, `CombinedRegressionGate`, `ContractChangeRequestEngine`, and `FeatureUndoEngine` from `@ef-harness/integrator`.

Stop.
- Commit merges and `integrate: wire integrator m3 barrels/seams` with `EF_HARNESS_MAINTAINER=1`; halt if `undo` conflicts with `HoldsSubmissionsRepo` hold reasons.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C44 — `SteeringMessageRouter` (`router@1`) and async `FourRouteSteeringDispatcher` execute over `ProjectStateDb`, `AskOwnerResponderEngine`, and canonical `'user_pause'` holds.

Architecture.
- `routing-design.md` (Mid-Build Steering, `InputStartFocusSnapshot`, 4-Route Classification), `stops-undo-and-reentry.md` (`StopCoordinator`, `'user_pause'` holds).
- `prompt-contracts.md` (`router@1`, `ask-owner-responder@1`), `schema/state.sql` (`task_holds`, `outbox`), `IMPLEMENTATION_TASKS.md` (`Task 113`–`Task 114`).
- Post-task invariant: `SteeringMessageRouter` (`router@1`) and async `FourRouteSteeringDispatcher` execute over `ProjectStateDb`, `AskOwnerResponderEngine`, and canonical `'user_pause'` holds.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C43` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 113` (`task/113-message-sequencing-intent-router` @ `4c86c46`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-113-message-sequencing-intent-router`, roots `packages/steering/src/router, packages/steering/tests/router`): unmerged — run `git merge --no-ff task/113-message-sequencing-intent-router -m "integrate: Task 113 message-sequencing-intent-router"`.
- Unit `Task 114` (`task/114-four-route-steering-dispatcher` @ `05609eb`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-114-four-route-steering-dispatcher`, roots `packages/steering/src/dispatcher, packages/steering/tests/dispatcher`): unmerged — run `git merge --no-ff task/114-four-route-steering-dispatcher -m "integrate: Task 114 four-route-steering-dispatcher"`.
- Sequence note: Merge `task/113-message-sequencing-intent-router` (`4c86c46`) then `task/114-four-route-steering-dispatcher` (`05609eb`) (`git merge --no-ff`) onto `harness/integration` (C43 child).

Freeze.
- `SteeringMessageRouter.route` (`packages/steering/src/router/runtime.ts`) is async, invokes `ModelProtocolAdapter` (`router@1`), and propagates the validated `RouterV1` clauses into `OrderedMultiClauseExecutor` (retaining `planMessage` strictly for offline fallback).
- `FourRouteSteeringDispatcher` (`packages/steering/src/dispatcher/dispatcher.ts`) is async, calls `AskOwnerResponderEngine.answerQuestion` (`@ef-harness/planner`) on Route 1 with 0 graph-mutation/0-hold fingerprint assertions, and uses canonical `USER_PAUSED_REASON = 'user_pause'` (`schema/state.sql:326`).
- `ImmediateKernelStopController` (`packages/steering/src/dispatcher/kernel-stop.ts`) persists stop/pause state in `ProjectStateDb` (`kv` + `task_holds`) and telemetry in `TelemetryDb`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-053`: Delete duplicate `outbox`, `outbox_deliveries`, and `router_catalog` tables from `packages/steering/src/router/ddl.ts`, keeping only `user_messages`, `message_clauses`, and `input_focus_snapshots` via `MigrationRunner` v2 in `packages/db`, and route telemetry/runtime state away from RAM `SteeringRuntime`/`RouteTelemetry` into `ProjectStateDb` + `TelemetryDb`.
2. `F-054`: Add `@ef-harness/{db,shared-observability,git-engine,sandbox,worker-loop,discovery,planner,integrator}` to `packages/steering/package.json` and wire `SteeringMessageRouter` -> `OrderedMultiClauseExecutor` -> `FourRouteSteeringDispatcher` (`102`, `087`, `108`, `110`).

Local defects.
- `F-054`: Fix `packages/steering/src/router/runtime.ts:203-215` where `gateModel` validated `router@1` output and then discarded it in favor of regex `planMessage(...)`.
- `F-054`: Remove the bogus `answer.llmCalls !== 0` throw in `packages/steering/src/dispatcher/dispatcher.ts:145-150` (`READ_ONLY_LLM`) that rejected `Task 102` `OwnerAnswer`, and change `'user_paused'` -> `'user_pause'` in `dispatcher/types.ts:11` and `kernel-stop.ts:164,197`.

Shared files.
- Integration-owned shared surfaces: `packages/steering/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/steering/src/router/**`, `packages/steering/src/dispatcher/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit `'user_paused'` anywhere in `task_holds`.
- Do not add duplicate `outbox` or `router_catalog` tables inside `packages/steering`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/steering test -- router dispatcher` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `SteeringMessageRouter` honors real `router@1` clauses, Route-1 queries succeed against `AskOwnerResponderEngine`, and `pauseFeature` inserts canonical `'user_pause'` holds into `state.db`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on async `SteeringMessageRouter`, `InputStartFocusSnapshotter`, `FourRouteSteeringDispatcher`, and `ImmediateKernelStopController` in `packages/steering/src/{router,dispatcher}`.

Stop.
- Commit merges and `integrate: wire steering router/dispatcher` with `EF_HARNESS_MAINTAINER=1`; halt if `router@1` schema mismatches `shared-contracts`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C45 — `MultiInterpretationHoldEngine`, `SharedQuestionArbiter`, and `ColdOpenReconciler` share `ProjectStateDb` (`'parked'` attempts, `inbox_items`) and export `@ef-harness/steering` + `WelcomeBackScreen`.

Architecture.
- `agent-graph-routing.md` (Multi-Interpretation Hold & Additive/Contradictory Resume), `routing-design.md` (`SharedQuestionArbiter`, Owner-First Escalation Filter), `stops-undo-and-reentry.md` (`ColdOpenReconciler`, `WelcomeBackScreen`, `NoRunUntilResumeGate`).
- `schema/state.sql` (`task_runtime`, `task_holds`, `attempts`, `inbox_items`), `IMPLEMENTATION_TASKS.md` (`Task 115`, `Task 116`, `Task 130`).
- Post-task invariant: `MultiInterpretationHoldEngine`, `SharedQuestionArbiter`, and `ColdOpenReconciler` share `ProjectStateDb` (`'parked'` attempts, `inbox_items`) and export `@ef-harness/steering` + `WelcomeBackScreen`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C44` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 115` (`task/115-multi-interpretation-hold-engine` @ `2c95cd8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-115-multi-interpretation-hold-engine`, roots `packages/steering/src/holds, packages/steering/tests/holds`): unmerged — run `git merge --no-ff task/115-multi-interpretation-hold-engine -m "integrate: Task 115 multi-interpretation-hold-engine"`.
- Unit `Task 116` (`task/116-shared-question-queue-arbiter` @ `2370d7a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-116-shared-question-queue-arbiter`, roots `packages/steering/src/question-arbiter, packages/steering/tests/question-arbiter`): unmerged — run `git merge --no-ff task/116-shared-question-queue-arbiter -m "integrate: Task 116 shared-question-queue-arbiter"`.
- Unit `Task 130` (`task/130-reentry-reconciliation-welcome-back` @ `a92052c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-130-reentry-reconciliation-welcome-back`, roots `apps/renderer/src/cockpit, apps/renderer/tests/welcome-back, packages/steering/src/reentry, packages/steering/tests/reentry`): unmerged — run `git merge --no-ff task/130-reentry-reconciliation-welcome-back -m "integrate: Task 130 reentry-reconciliation-welcome-back"`.
- Sequence note: Merge `task/115-multi-interpretation-hold-engine` (`2c95cd8`), `task/116-shared-question-queue-arbiter` (`2370d7a`), and `task/130-reentry-reconciliation-welcome-back` (`a92052c`) (`git merge --no-ff`) in order `115 -> 116 -> 130` onto `harness/integration` (C44 child).

Freeze.
- `MultiInterpretationHoldEngine` (`packages/steering/src/holds/engine.ts`) operates on `ProjectStateDb` `task_runtime`/`task_holds` (`021`/`022`) + `hold_reason_details` v2 migration.
- `SharedQuestionArbiter` (`packages/steering/src/question-arbiter/index.ts`) persists questions in canonical `inbox_items` (`status` mapping `'retired'` cleanly or via v2 migration) and `inbox_subscribers` (`InboxOutboxRepo` `026`) and logs metrics to `TelemetryDb`.
- `ColdOpenReconciler.reconcile` (`packages/steering/src/reentry/cold-open-reconciler.ts`) maps interrupted orphaned attempts cleanly to canonical `'parked'` (`attempt_checkpoints`) and `WelcomeBackScreen` exports from `apps/renderer/src/cockpit/welcome-back/index.ts`.
- `packages/steering/src/index.ts` exports `router, dispatcher, holds, question-arbiter, reentry`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-053`: Delete crashing `CREATE TABLE task_runtime` / `CREATE TABLE task_holds` DDL in `packages/steering/src/holds/database.ts:18-128`, shadow `qa_inbox_items`/`qa_*`/`TELEMETRY_DDL` in `question-arbiter/ddl.ts:1-136`, and `InMemoryReentryStore` in `reentry/state-store.ts:66-180`.
2. `F-054`: Wire `SteeringMessageRouter` (`113`) -> `FourRouteSteeringDispatcher` (`114`) -> `MultiInterpretationHoldEngine` (`115`) -> `SharedQuestionArbiter` (`116`), and wire `ColdOpenReconciler` (`130`) to `@ef-harness/{db,git-engine,planner}` (`035, 038, 085, 116, 172, 173`).

Local defects.
- `F-053`: Fix `packages/steering/src/reentry/state-store.ts:179` writing invalid `attempts.state = 'CHECKPOINTED'` (violates `schema/state.sql:343` `CHECK`), emitting `'parked'` with `attempt_checkpoints` row instead.

Shared files.
- Integration-owned shared surfaces: `packages/steering/src/index.ts`, `packages/db/src/migrations/**`, `packages/steering/src/holds/**`, `packages/steering/src/question-arbiter/**`, `packages/steering/src/reentry/**`, `apps/renderer/src/cockpit/welcome-back/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.

Do not.
- Do not write `'CHECKPOINTED'` into `attempts.state` or embed `TELEMETRY_DDL` inside `state.db`.
- Do not allow `ColdOpenReconciler` to resume runs past `NoRunUntilResumeGate` automatically.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/steering test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `holds`, `question-arbiter`, and `reentry` execute against a real `ProjectStateDb` (`schema/state.sql`) without DDL collisions or `CHECK` constraint failures, and `@ef-harness/steering` exports all 5 modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `MultiInterpretationHoldEngine`, `SharedQuestionArbiter`, `StaleReplyReconciler`, `AdditiveVsContradictoryResumer`, and `ColdOpenReconciler` from `@ef-harness/steering`, plus `WelcomeBackScreen` in `apps/renderer`.

Stop.
- Commit merges and `integrate: wire steering m3 barrels/seams` with `EF_HARNESS_MAINTAINER=1`; halt if `apps/renderer` test paths fail `ef/layer-boundary`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C46 — Hardware telemetry (`117`), `PressureHysteresisStateMachine` (`118`), and `ThreePoolCapacityScheduler` (`119`) share canonical uppercase `GovernorPressure` and `GlobalBrokerDb` footprints.

Architecture.
- `app-shell-and-governor.md` (Windows Telemetry, Pressure Hysteresis `GREEN | YELLOW | ORANGE | RED`, Learned Footprints), `execution-capacity.md` (Three-Pool Scheduler).
- `schema/global.sql` (`footprints`), `IMPLEMENTATION_TASKS.md` (`Task 117`–`Task 119`).
- Post-task invariant: Hardware telemetry (`117`), `PressureHysteresisStateMachine` (`118`), and `ThreePoolCapacityScheduler` (`119`) share canonical uppercase `GovernorPressure` and `GlobalBrokerDb` footprints.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C45` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 117` (`task/117-governor-windows-telemetry` @ `dcee682`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-117-governor-windows-telemetry`, roots `packages/governor/src/telemetry, packages/governor/tests/telemetry`): unmerged — run `git merge --no-ff task/117-governor-windows-telemetry -m "integrate: Task 117 governor-windows-telemetry"`.
- Unit `Task 118` (`task/118-governor-hysteresis-footprints` @ `865cae2`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-118-governor-hysteresis-footprints`, roots `packages/governor/src/admission, packages/governor/tests/admission`): unmerged — run `git merge --no-ff task/118-governor-hysteresis-footprints -m "integrate: Task 118 governor-hysteresis-footprints"`.
- Unit `Task 119` (`task/119-three-pool-capacity-scheduler` @ `b9a1b25`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-119-three-pool-capacity-scheduler`, roots `packages/governor/src/capacity-pools, packages/governor/tests/capacity-pools`): unmerged — run `git merge --no-ff task/119-three-pool-capacity-scheduler -m "integrate: Task 119 three-pool-capacity-scheduler"`.
- Sequence note: Merge `task/117-governor-windows-telemetry` (`dcee682`), `task/118-governor-hysteresis-footprints` (`865cae2`), and `task/119-three-pool-capacity-scheduler` (`b9a1b25`) (`git merge --no-ff`) in order `117 -> 118 -> 119` onto `harness/integration` (C45 child).

Freeze.
- `GovernorPressure = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'` frozen in `@ef-harness/shared-contracts` (`normalizeGovernorPressure` accepts legacy case during internal boundary parsing, emits uppercase everywhere).
- `PressureHysteresisStateMachine` (`packages/governor/src/admission/**`) exposes `readonly pressure: GovernorPressure` and `subscribe(listener: (level: GovernorPressure) => void): () => void` (`Office` `165` & `Shell` `122` parity).
- `LearnedFootprintStore` (`packages/governor/src/admission/learned-footprint-store.ts`) persists extended 14-metric footprint calibration in `GlobalBrokerDb` (`global.db.footprints` additive v2 columns via `MigrationRunner`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-055`: Connect `WindowsResourceTelemetryCollector` (`117`) -> `PressureHysteresisStateMachine` + `HeavyLaneSemaphore` + `GpuWhisperPriorityArbiter` + `DiskHeadroomGuard` (`118`) -> `ThreePoolCapacityScheduler` (`119`) without casing mismatch exceptions (`CapacityError: Unknown governor pressure`).
2. `F-055`, `F-045`: Update `HeftCriticalPathScheduler` (`107` in `@ef-harness/planner`) and `ThreePoolCapacityScheduler` (`119`) to accept canonical uppercase `'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'` and wire `WorkloadFootprint` estimates cleanly.

Local defects.
- `F-055`: Fix `packages/governor/src/capacity-pools/scheduler.ts:105-108,192-198` expecting `'Green'|'Yellow'|'Orange'|'Red'` instead of `'GREEN'|'YELLOW'|'ORANGE'|'RED'`, and add pre-compiled `win32-helper.exe` build script fallback check in `117`.

Shared files.
- Integration-owned shared surfaces: `packages/shared-contracts/src/**`, `packages/governor/package.json`, `packages/db/src/migrations/**`, `packages/governor/src/{telemetry,admission,capacity-pools}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not keep TitleCase `'Green'`/`'Orange'` pressure keys as canonical outputs in `119` or `107`.
- Do not allow `117` to write outside `TelemetryDb` or `GlobalBrokerDb`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/governor test -- telemetry admission capacity-pools && pnpm --filter @ef-harness/planner test -- scheduler` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Feeding `PressureHysteresisStateMachine.sample(...)` directly into `ThreePoolCapacityScheduler.setPressure(...)` across `GREEN -> YELLOW -> ORANGE -> RED` throws `0` errors and `subscribe` fires deterministically.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `WindowsResourceTelemetryCollector`, `PressureHysteresisStateMachine` (`.pressure`, `.subscribe`), `GpuWhisperPriorityArbiter`, `LearnedFootprintStore`, and `ThreePoolCapacityScheduler`.

Stop.
- Commit merges and `integrate: wire governor telemetry/pools` with `EF_HARNESS_MAINTAINER=1`; halt if `global.db` migration breaks `67/67` schema scenarios.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C47 — `WindowsDpapiSecretsVault` (`120`) and `HumanStepProbeRegistry` (`121`) share `@ef-harness/db` single-writer metadata, `StreamingRedactor`, and export all `@ef-harness/governor` modules.

Architecture.
- `sandbox-and-security.md` (Windows DPAPI Secrets Vault, Runtime-Only Env Injection, No Secrets on Disk/Prompts/Logs), `build-cockpit.md` (Verified vs Attested Human Steps).
- `schema/global.sql`, `schema/state.sql` (`task_holds`), `IMPLEMENTATION_TASKS.md` (`Task 120`–`Task 121`).
- Post-task invariant: `WindowsDpapiSecretsVault` (`120`) and `HumanStepProbeRegistry` (`121`) share `@ef-harness/db` single-writer metadata, `StreamingRedactor`, and export all `@ef-harness/governor` modules.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C46` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 120` (`task/120-dpapi-secrets-vault-env-injection` @ `f1fad0a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-120-dpapi-secrets-vault-env-injection`, roots `packages/governor/src/vault, packages/governor/tests/vault`): unmerged — run `git merge --no-ff task/120-dpapi-secrets-vault-env-injection -m "integrate: Task 120 dpapi-secrets-vault-env-injection"`.
- Unit `Task 121` (`task/121-human-step-probing-verification` @ `f8fb5d0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-121-human-step-probing-verification`, roots `packages/governor/src/human-steps, packages/governor/tests/human-steps`): unmerged — run `git merge --no-ff task/121-human-step-probing-verification -m "integrate: Task 121 human-step-probing-verification"`.
- Sequence note: Merge `task/120-dpapi-secrets-vault-env-injection` (`f1fad0a`) then `task/121-human-step-probing-verification` (`f8fb5d0`) (`git merge --no-ff`) onto `harness/integration` (C46 child).

Freeze.
- `WindowsDpapiSecretsVault` (`packages/governor/src/vault/index.ts`) exposes async `storeSecret`, `readPlaintextForKernel`, and `deleteSecret`, persisting metadata via `GlobalBrokerDb` + `ProjectStateDb` (`MigrationRunner` v2 `vault_secret_metadata`) with zero raw `DatabaseSync` multi-file handles.
- `HumanStepStateStore` (`packages/governor/src/human-steps/store.ts`) uses `ProjectStateDb` (`human_steps` v2 migration) and canonical `HoldReason = 'governor'` with `source = 'human_step:<stepId>'` (`schema/state.sql:326`).
- `packages/governor/src/index.ts` exports `telemetry`, `admission`, `capacity-pools`, `vault`, and `human-steps` cleanly.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-055`: Replace `packages/governor/src/vault/metadata-store.ts:29-50,146-156` dual `DatabaseSync` handles on `global.db` + `state.db` with `@ef-harness/db` `GlobalBrokerDb` + `ProjectStateDb` passed cleanly via ports (never `ATTACH` across WAL DBs).
2. `F-055`: Replace duplicate `packages/governor/src/vault/redactor.ts` with `@ef-harness/shared-observability` `StreamingRedactor` + `PacketSecurityRedactor`, and add `@ef-harness/{db,shared-observability,sandbox,planner}` to `packages/governor/package.json`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-055`: Replace `WAITING_ON_HUMAN_STEP_REASON = 'waiting_on_human_step'` in `packages/governor/src/human-steps/store.ts:65-90` with canonical `'governor'` so `HoldsSubmissionsRepo` (`021`) and `HeftCriticalPathScheduler` (`107`) recognize human-step holds.

Shared files.
- Integration-owned shared surfaces: `packages/governor/src/index.ts`, `packages/governor/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/governor/src/{vault,human-steps}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit `'waiting_on_human_step'` into `task_holds.reason` or `ATTACH` `global.db` and `state.db` in one transaction.
- Do not revert `C46` pressure-level normalization.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/governor test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: All 5 `@ef-harness/governor` suites pass with single-writer `@ef-harness/db` handles and `@ef-harness/governor` exports every submodule.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `WindowsDpapiSecretsVault`, `RuntimeOnlyEnvInjector`, `LiveKeyTestRefusalGuard`, `HumanStepProbeRegistry`, and `AttestedVsVerifiedBadgePolicy` from `@ef-harness/governor`.

Stop.
- Commit merges and `integrate: wire governor m3 barrels/seams` with `EF_HARNESS_MAINTAINER=1`; halt if DPAPI redaction leaks fixture keys.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C48 — `SingleAppShell`, `PhaseLayoutPresetManager`, and `PopOutWindowCoordinator` share preload `MessagePort` RPC, `ShellLayoutContext`, and multi-window `stream_epoch` handling.

Architecture.
- `desktop-app.md` (Multi-Window Pop-Out Coordinator, `stream_epoch` Resync, Monitor Bounds Guard), `app-shell-and-governor.md` (Single App Shell, Permanent `Stop`, 48px Bar, Phase Presets).
- `kernel-schema-and-protocol.md` (Preload `MessagePort` IPC), `IMPLEMENTATION_TASKS.md` (`Task 122`–`Task 123`).
- Post-task invariant: `SingleAppShell`, `PhaseLayoutPresetManager`, and `PopOutWindowCoordinator` share preload `MessagePort` RPC, `ShellLayoutContext`, and multi-window `stream_epoch` handling.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C47` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 122` (`task/122-single-app-shell-framework` @ `2c6aeff`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-122-single-app-shell-framework`, roots `apps/renderer/src/shell, apps/renderer/tests/shell`): unmerged — run `git merge --no-ff task/122-single-app-shell-framework -m "integrate: Task 122 single-app-shell-framework"`.
- Unit `Task 123` (`task/123-phase-presets-popout-windows` @ `7a522a6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-123-phase-presets-popout-windows`, roots `apps/desktop/src/windows, apps/desktop/tests/windows, apps/renderer/src/presets, apps/renderer/tests/presets`): unmerged — run `git merge --no-ff task/123-phase-presets-popout-windows -m "integrate: Task 123 phase-presets-popout-windows"`.
- Sequence note: Merge `task/122-single-app-shell-framework` (`2c6aeff`) then `task/123-phase-presets-popout-windows` (`7a522a6`) (`git merge --no-ff`) onto `harness/integration` (C47 child).

Freeze.
- `SingleAppShell` (`apps/renderer/src/shell/shell.ts`) consumes injected preload `MessagePort` RPC client speaking canonical `run.stop`, `run.pause`, `run.resume` (`op_id` non-empty) and `events.subscribe`/`snapshot.get`, with zero direct `NamedPipeClient` inside `apps/renderer`.
- `ShellLayoutContext` (`apps/renderer/src/shell/**`) exposes `applyPreset(preset)`, `readCanvas()`, and `writeCanvas(state)` so `PhaseWorkspaceController` (`123`) and `Canvas` (`153`) share one shell API.
- `SharedHarnessdStream` (`apps/desktop/src/windows/shared-harnessd-stream.ts`) tracks `streamEpoch: string`, resets `lastSeq` + ring buffer on epoch change without throwing, and fans out across `PopOutWindowCoordinator` + `067` `MessagePort` bridge.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-063`: Declare `'react'`, `'react-dom'`, `'@types/react'`, and `'@types/react-dom'` in `apps/renderer/package.json`.
2. replace `BridgePayload` (`build.stop` without `op_id`) in `apps/renderer/src/shell/ports.ts:10-36` with canonical `@ef-harness/shared-contracts` RPC envelopes.
3. `F-027`, `F-063`: Wire `PopOutWindowCoordinator` and `SharedHarnessdStream` (`apps/desktop/src/windows/**`) into `apps/desktop/src/main.ts` (`067`) multi-window `MessagePort` map (never overwriting a single `renderer` port).

Local defects.
- `F-063`: Fix `isPressure` in `apps/renderer/src/shell/daemon-store.ts:56-64` accepting only lowercase `'green'..'red'` so canonical uppercase `'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'` from `118` is stored cleanly.
- `F-063`: Fix `SharedHarnessdStream.publish` (`apps/desktop/src/windows/shared-harnessd-stream.ts:18-23`) throwing on daemon restart `seq = 1` across `stream_epoch` resets, bounding retained history.

Shared files.
- Integration-owned shared surfaces: `apps/renderer/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `apps/renderer/src/shell/**`, `apps/renderer/src/presets/**`, `apps/desktop/src/main.ts`, `apps/desktop/src/windows/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not import `node:net` or named-pipe clients inside `apps/renderer` or require `build.stop` instead of `run.stop`.
- Do not overwrite primary window `MessagePort` entries when pop-out windows open.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/desktop test && pnpm --filter @ef-harness/renderer test -- shell presets` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Daemon restart with new `stream_epoch` (`seq = 1`) resyncs cleanly across primary + pop-out windows and `applyPreset`/`readCanvas`/`writeCanvas` work on `ShellLayoutContext`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SingleAppShell`, `DaemonStore`, `ShellLayoutContext` (`applyPreset`, `readCanvas`, `writeCanvas`), and `PopOutWindowCoordinator`.

Stop.
- Commit merges and `integrate: wire desktop/renderer shell` with `EF_HARNESS_MAINTAINER=1`; halt if Electron preload tests fail `contextIsolation`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C49 — `apps/daemon` projects `StateDbBoardRow[]` + `ThreePoolCapacitySnapshot` into `DaemonStore`, powering `BoardCockpitView`, `BoardHealthSignalEngine`, and validated `cockpit-explainer@1`.

Architecture.
- `build-cockpit.md` (7-Lane Board View, Zero-LLM Deterministic Status Lines, 5 Health Signals, On-Demand Explainer), `prompt-contracts.md` (`cockpit-explainer@1`).
- `schema/state.sql`, `schema/telemetry.sql`, `IMPLEMENTATION_TASKS.md` (`Task 124`–`Task 125`).
- Post-task invariant: `apps/daemon` projects `StateDbBoardRow[]` + `ThreePoolCapacitySnapshot` into `DaemonStore`, powering `BoardCockpitView`, `BoardHealthSignalEngine`, and validated `cockpit-explainer@1`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C48` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 124` (`task/124-board-cockpit-seven-lanes` @ `3bb233b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-124-board-cockpit-seven-lanes`, roots `apps/renderer/src/cockpit, apps/renderer/tests/cockpit-board`): unmerged — run `git merge --no-ff task/124-board-cockpit-seven-lanes -m "integrate: Task 124 board-cockpit-seven-lanes"`.
- Unit `Task 125` (`task/125-board-health-signals-explainer` @ `20d6ff1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-125-board-health-signals-explainer`, roots `apps/renderer/src/cockpit, apps/renderer/tests/cockpit-health`): unmerged — run `git merge --no-ff task/125-board-health-signals-explainer -m "integrate: Task 125 board-health-signals-explainer"`.
- Sequence note: Merge `task/124-board-cockpit-seven-lanes` (`3bb233b`) then `task/125-board-health-signals-explainer` (`20d6ff1`) (`git merge --no-ff`) onto `harness/integration` (C48 child).

Freeze.
- `DaemonStore` (`apps/renderer/src/shell/daemon-store.ts`) projects `{ revision, tasks: BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot }` driven by `apps/daemon` (`StateDbBoardRow` join over `task_runtime`, `task_holds`, `inbox_items`, and `ThreePoolCapacityScheduler`), satisfying `124` `DaemonStorePort`.
- `BoardCockpitView` (`apps/renderer/src/cockpit/board/**`) mounts `attachHealthSlots` (`apps/renderer/src/cockpit/health/board-slot.ts`) inline on task cards.
- `OnDemandCockpitExplainer` validates LLM outputs against `@ef-harness/shared-contracts` `CockpitExplainerOutputSchema` over daemon IPC and logs `TelemetryMetricRow` events via daemon IPC to `TelemetryDb` (`telemetry.db`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-064`: Add `StateDbBoardRow` + `ThreePoolCapacitySnapshot` query/event projection and `cockpit.explain` RPC handler to `apps/daemon` (`066`) using `ModelProtocolAdapter` (`cockpit-explainer@1`) + `TelemetryDb` (`014`).
2. `F-064`: Delete duplicate `CockpitExplainerV1Schema` class in `apps/renderer/src/cockpit/health/explainer.ts:2,108-118`, importing `CockpitExplainerOutputSchema` from `@ef-harness/shared-contracts`, and bind `DaemonStore` -> `BoardCockpitView` (`124`) -> `attachHealthSlots` (`125`).
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-064`: Replace volatile `InMemoryTelemetryLog` sink in `apps/renderer/src/cockpit/health/telemetry-log.ts:11-21` with typed preload telemetry dispatch to `apps/daemon` -> `TelemetryDb`.

Shared files.
- Integration-owned shared surfaces: `apps/daemon/src/index.ts`, `apps/daemon/src/server.ts`, `apps/renderer/src/shell/daemon-store.ts`, `apps/renderer/src/cockpit/board/**`, `apps/renderer/src/cockpit/health/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not invoke `cockpit-explainer@1` automatically on Board load or poll; strictly on user click.
- Do not open `telemetry.db` directly inside `apps/renderer`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/renderer test -- shell cockpit-board cockpit-health` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `DaemonStore` feeds live `StateDbBoardRow[]` + capacity snapshots into `BoardCockpitView`, `attachHealthSlots` renders 5 health signals, and 500-task lane virtualization renders `< 10 ms`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BoardCockpitView`, `mapTaskToBoardLane`, `BoardHealthSignalEngine`, and `DaemonStore` board snapshot types.

Stop.
- Commit merges and `integrate: wire cockpit board/health` with `EF_HARNESS_MAINTAINER=1`; halt if `cockpit-explainer@1` schema diverges from `@ef-harness/shared-contracts`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C50 — `WorkerInspectorPanel` queues binary stream reads, `CalmInboxPanel` drives daemon `116/120/121` RPCs, and `BudgetWindDownController` persists `stop_events` & reservations in `ProjectStateDb`.

Architecture.
- `build-cockpit.md` (Worker Inspector Pane, Calm Notification Inbox, Budget Wind-Down & Stop Cards), `stops-undo-and-reentry.md` (`WipBranchHandoffExporter`), `kernel-schema-and-protocol.md` (64 KB Credit Stream).
- `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Task 126`–`Task 128`).
- Post-task invariant: `WorkerInspectorPanel` queues binary stream reads, `CalmInboxPanel` drives daemon `116/120/121` RPCs, and `BudgetWindDownController` persists `stop_events` & reservations in `ProjectStateDb`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C49` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 126` (`task/126-worker-inspector-panel` @ `3dce5cd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-126-worker-inspector-panel`, roots `apps/renderer/src/cockpit, apps/renderer/tests/cockpit-inspector`): unmerged — run `git merge --no-ff task/126-worker-inspector-panel -m "integrate: Task 126 worker-inspector-panel"`.
- Unit `Task 127` (`task/127-calm-notification-inbox-ui` @ `5b91291`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-127-calm-notification-inbox-ui`, roots `apps/renderer/src/cockpit, apps/renderer/tests/cockpit-inbox`): unmerged — run `git merge --no-ff task/127-calm-notification-inbox-ui -m "integrate: Task 127 calm-notification-inbox-ui"`.
- Unit `Task 128` (`task/128-budget-winddown-stop-card-wip` @ `a8ca2fd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-128-budget-winddown-stop-card-wip`, roots `apps/renderer/src/cockpit, apps/renderer/tests/stop-card, packages/steering/src/budget-stops, packages/steering/tests/budget-stops`): unmerged — run `git merge --no-ff task/128-budget-winddown-stop-card-wip -m "integrate: Task 128 budget-winddown-stop-card-wip"`.
- Sequence note: Merge `task/126-worker-inspector-panel` (`3dce5cd`), `task/127-calm-notification-inbox-ui` (`5b91291`), and `task/128-budget-winddown-stop-card-wip` (`a8ca2fd`) (`git merge --no-ff`) in order `126 -> 127 -> 128` onto `harness/integration` (C49 child).

Freeze.
- `CreditLimitedStream` (`apps/renderer/src/cockpit/inspector/credit-stream.ts`) enqueues concurrent range reads when `outstanding >= INITIAL_STREAM_CREDITS` and resumes as `stream.credit` replenishes, instead of throwing `RangeLimitError`.
- `apps/daemon` (`066`) exposes typed RPC & Channel-1 handlers backing `126` (`SeekableZstdLogReader` `029`, `ContextSlicerEngine.sliceForTask` `088`, `ArtifactHandoffStore.readResult` `109`) and `127` (`StaleReplyReconciler.reconcile` `116`, `WindowsDpapiSecretsVault.storeSecret` `120`, `HumanStepProbeRegistry.runProbe` `121`).
- `BudgetWindDownController` & `WipBranchHandoffExporter` (`packages/steering/src/budget-stops/index.ts`, exported from `@ef-harness/steering`) persist `stop_events` (`MigrationRunner` v2) and reservations in `BudgetLedger` (`023`) via `ProjectStateDb`, calling `MinGit` (`035`) + `GitRefCasUpdater` (`039`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-065`: Register Channel-1 & JSON-RPC handlers in `apps/daemon` (`066`) for `fetchDiffRange`, `fetchLogChunk`, `fetchScreenshot`, `locateLineWindow` (`029` `SeekableZstdLogReader` wrapper), `sliceForTask` (`088`), `readResult` (`109`), `reconcile` (`116`), `storeSecret` (`120`), and `runProbe` (`121`).
2. `F-065`: Replace `packages/steering/src/budget-stops/stop-events.ts` raw `DatabaseSync` with `MigrationRunner` v2 `stop_events` + `ProjectStateDb`, back `AtomicBudgetReservationLedger` with `BudgetLedger` (`023`) + pluggable `AllowanceWindowPort` (bound to `140` in C54), and replace `exporter.ts` host `PATH` `git` with `@ef-harness/git-engine` (`035`/`039`).

Local defects.
- `F-065`: Fix `apps/renderer/src/cockpit/inspector/credit-stream.ts:44-48` throwing `RangeLimitError('stream credits exhausted')` under concurrent inspector tab switches.

Shared files.
- Integration-owned shared surfaces: `apps/daemon/src/**`, `packages/db/src/migrations/**`, `packages/steering/src/index.ts`, `packages/steering/src/budget-stops/**`, `apps/renderer/src/cockpit/{inspector,inbox,stop-card}/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `StopEventStore` to open a standalone `DatabaseSync` writer outside `@ef-harness/db`.
- Do not revert `C45` `@ef-harness/steering` exports or spawn ambient `git` from `WipBranchHandoffExporter`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/steering test && pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/renderer test -- cockpit-inspector cockpit-inbox stop-card` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `CreditLimitedStream` queues and drains concurrent range reads cleanly and `BudgetWindDownController` persists `stop_events` + WIP handoff branches via `MinGit`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `WorkerInspectorPanel`, `CalmInboxPanel`, `BudgetWindDownController` (with `AllowanceWindowPort`), and `WipBranchHandoffExporter`.

Stop.
- Commit merges and `integrate: wire inspector/inbox/budget-stops` with `EF_HARNESS_MAINTAINER=1`; halt if Channel-1 framing conflicts with `C13` `StreamCreditGrantSchema`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C51 — `apps/desktop` and `apps/daemon` mount Electron lifecycle/sleep hooks, `ParkFirstAutoUpdater`, `SignedComponentDownloader`, and lock-safe `TelemetryDb` diagnostics export.

Architecture.
- `desktop-app.md` (Single-Instance Daemon Lifecycle, System Tray, Power-Monitor Sleep/Wake Re-Entry, Component Downloads, Park-First Auto-Updater, Redacted Diagnostics Bundle).
- `database-design.md` (`TelemetryDb` close/reopen), `IMPLEMENTATION_TASKS.md` (`Task 131`–`Task 133`).
- Post-task invariant: `apps/desktop` and `apps/daemon` mount Electron lifecycle/sleep hooks, `ParkFirstAutoUpdater`, `SignedComponentDownloader`, and lock-safe `TelemetryDb` diagnostics export.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C50` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 131` (`task/131-electron-desktop-lifecycle` @ `304c4e7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-131-electron-desktop-lifecycle`, roots `apps/daemon/src/lifecycle, apps/daemon/tests/lifecycle, apps/desktop/src/lifecycle, apps/desktop/tests/lifecycle`): unmerged — run `git merge --no-ff task/131-electron-desktop-lifecycle -m "integrate: Task 131 electron-desktop-lifecycle"`.
- Unit `Task 132` (`task/132-component-downloader-park-updater` @ `f89dbc1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-132-component-downloader-park-updater`, roots `apps/daemon/src/components, apps/daemon/tests/components, apps/desktop/src/updater, apps/desktop/tests/updater`): unmerged — run `git merge --no-ff task/132-component-downloader-park-updater -m "integrate: Task 132 component-downloader-park-updater"`.
- Unit `Task 133` (`task/133-diagnostics-health-bundle-exporter` @ `ab4387b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-133-diagnostics-health-bundle-exporter`, roots `apps/daemon/src/diagnostics, apps/daemon/tests/diagnostics, apps/renderer/src/diagnostics, apps/renderer/tests/diagnostics`): unmerged — run `git merge --no-ff task/133-diagnostics-health-bundle-exporter -m "integrate: Task 133 diagnostics-health-bundle-exporter"`.
- Sequence note: Merge `task/131-electron-desktop-lifecycle` (`304c4e7`), `task/132-component-downloader-park-updater` (`f89dbc1`), and `task/133-diagnostics-health-bundle-exporter` (`ab4387b`) (`git merge --no-ff`) in order `131 -> 132 -> 133` onto `harness/integration` (C50 child).

Freeze.
- `apps/desktop/src/main.ts` mounts `DesktopLifecycleCoordinator`, `SystemTrayController`, `PowerMonitorSleepReconciler` (`131`), and `ParkFirstAutoUpdater` (`132`, declaring `"electron-updater"` in `apps/desktop/package.json` with injected updater port).
- `apps/daemon` (`NamedPipeServer` `031`) handles `daemon.shutdown`, component-download progress (`132`), and diagnostics bundle/metrics (`133`) over JSON-RPC (no HTTP `/lifecycle/shutdown` route).
- `PowerMonitorSleepReconciler` invokes `ColdOpenReconciler.reconcile()` (`130`).
- `CheckpointSchemaUpcasterRegistry` (`132`) integrates with `MigrationRunner` (`015`) and `AttemptCheckpointStore` (`053`).
- `rebuildTelemetryDatabase` (`133`) closes and reopens `TelemetryDb` (`014`) cleanly before removing SQLite/WAL files.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-066`: Replace HTTP `/lifecycle/shutdown` in `apps/daemon/src/lifecycle/lifecycle-router.ts` with `NamedPipeServer` RPC `daemon.shutdown` / `run.pause`, and fix `PowerMonitorSleepReconciler` calling nonexistent `reconcileAfterWake()` to call `ColdOpenReconciler.reconcile()` (`@ef-harness/steering`).
2. `F-066`: Add `'electron-updater'` + `@ef-harness/{steering,governor}` to `apps/desktop/package.json`, wire `131`/`132` into `apps/desktop/src/main.ts`, wire `131`/`132`/`133` into `apps/daemon/src/server.ts`, and mount `DiagnosticsHealthView` (`133`) in `apps/renderer`.

Local defects.
- `F-066`: Fix `apps/daemon/src/diagnostics/telemetry-db.ts:30-56` where `openTelemetryDatabase` opened rogue `DatabaseSync` handles and `rebuildTelemetryDatabase` unlinked live `telemetry.db`/`-wal`/`-shm` files without closing `TelemetryDb` (`014`).

Shared files.
- Integration-owned shared surfaces: `apps/desktop/package.json`, `apps/daemon/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `apps/desktop/src/main.ts`, `apps/daemon/src/server.ts`, `apps/renderer/src/diagnostics/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not unlink `telemetry.db`, `-wal`, or `-shm` while any `TelemetryDb` connection remains open.
- Do not bind an HTTP localhost listener for daemon shutdown control.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/desktop test && pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/renderer test -- diagnostics` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `rebuildTelemetryDatabase` cleanly closes `TelemetryDb`, deletes old WAL/DB files without `EBUSY`, reopens via `@ef-harness/db`, and diagnostics bundle passes `StreamingRedactor` (`0` secrets).
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `DesktopLifecycleCoordinator`, `SignedComponentDownloader`, `ParkFirstAutoUpdater`, `CheckpointSchemaUpcasterRegistry`, and `RedactedDiagnosticsBundleExporter`.

Stop.
- Commit merges and `integrate: wire desktop/daemon lifecycle/updater/diagnostics` with `EF_HARNESS_MAINTAINER=1`; halt if `electron-updater` version conflicts.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C52 — Milestone 3 Parallel Exit Gate executes the real integrated M3 stack against `KitchenHiddenAcceptanceSuite` and proves `>= 2.0x` speedup with `< 10 ms` Board virtualization.

Architecture.
- `roadmap.md` (Milestone 3 Exit Gate — Parallel Builds & Steering, `>= 2.0x` wall-clock speedup, `0%` acceptance regression, 50-worker `p99 < 50 ms`, 500-task Board `< 10 ms`).
- `IMPLEMENTATION_TASKS.md` (`Task 134`).
- Post-task invariant: Milestone 3 Parallel Exit Gate executes the real integrated M3 stack against `KitchenHiddenAcceptanceSuite` and proves `>= 2.0x` speedup with `< 10 ms` Board virtualization.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C51` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 134` (`task/134-m3-parallel-exit-gate` @ `7f37eee`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-134-m3-parallel-exit-gate`, roots `benchmarks/m3-parallel/.gitignore, benchmarks/m3-parallel/hidden-suite.port.json, benchmarks/m3-parallel/latency-curve.json, benchmarks/m3-parallel/m2-baseline.port.json, benchmarks/m3-parallel/machine-profile.json`): unmerged — run `git merge --no-ff task/134-m3-parallel-exit-gate -m "integrate: Task 134 m3-parallel-exit-gate"`.
- Sequence note: Merge `task/134-m3-parallel-exit-gate` (`7f37eee`) (`git merge --no-ff`) onto `harness/integration` (C51 child).

Freeze.
- `M3ParallelBenchmarkRunner` (`tests/e2e/m3-exit-gate/runner.ts`) uses `.js` relative import specifiers compiled by `tests/e2e/tsconfig.json` and executes real `@ef-harness/{db,planner,integrator,steering,governor,renderer,e2e}` implementations.
- Root `package.json` includes M3 Exit Gate replay verification hook via `@ef-harness/e2e` without bypassing `tsc`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-056`: Add `@ef-harness/{integrator,steering,governor,renderer}` to `tests/e2e/package.json` + `tests/e2e/tsconfig.json` references, include `m3-exit-gate/**/*.ts` in `tests/e2e/tsconfig.json`, and export `M3ParallelBenchmarkRunner` from `tests/e2e/src/index.ts`.
2. `F-056`: Replace all fake local stand-in classes (`HeftCriticalPathScheduler`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner`, 4-line `KitchenHiddenAcceptanceSuite`) in `tests/e2e/m3-exit-gate/{kitchen,merge-queue,schedule,scale,scenarios}.ts` with real `105, 107, 110–115, 118–120, 124, 129–130, 025` workspace imports.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-056`: Rewrite all `.ts` relative import specifiers in `tests/e2e/m3-exit-gate/*.ts` (`./fixtures.ts`, `./kitchen.ts`, etc.) to `.js` so `tsc -b` typechecks `m3-exit-gate` cleanly.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/src/index.ts`, `tests/e2e/m3-exit-gate/**`, `pnpm-lock.yaml` (single `pnpm install`).
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not leave mock stand-in classes in `tests/e2e/m3-exit-gate/` or evaluate 1-line strings instead of the real M2 Kitchen App.
- Do not weaken `C41` `m2-exit-gate` acceptance assertions.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test && node schema/schema-test.js` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/e2e test -- m3-exit-gate` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `M3ParallelBenchmarkRunner` compares real M2 vs M3 builds showing `>= 2.0x` speedup, `0%` hidden-suite pass-rate drop, 50-worker `CoordinatorWriteQueue` `p99 < 50 ms`, and 500-task `BoardCockpitView` `< 10 ms`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream Wave 5 (`providers` + `runtime-adapters`) relies on a green M0–M3 integration baseline and `M2KitchenE2eBenchmarkRunner`/`M3ParallelBenchmarkRunner`.

Stop.
- Commit `integrate: Task 134 m3-parallel-exit-gate` and `integrate: wire m3-exit-gate real stack` with `EF_HARNESS_MAINTAINER=1`; halt if speedup or pass-rate gates regress.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C53 — `SignedProviderPolicyEngine`, `ApiConnectionManager`, and `ChatGptSignInOAuth` share `GlobalBrokerDb` v2 migrations and real async `WindowsDpapiSecretsVault`.

Architecture.
- `provider-connections.md` (Signed Ed25519 Policy, Console-Only Anthropic, API Keys, Pricing, Sign in with ChatGPT OAuth), `open-design-questions.md` (Nov 16–18 Provider Decisions).
- `schema/global.sql` (`connections`), `IMPLEMENTATION_TASKS.md` (`Task 135`–`Task 137`).
- Post-task invariant: `SignedProviderPolicyEngine`, `ApiConnectionManager`, and `ChatGptSignInOAuth` share `GlobalBrokerDb` v2 migrations and real async `WindowsDpapiSecretsVault`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C52` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 135` (`task/135-signed-provider-policy-engine` @ `e6934db`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-135-signed-provider-policy-engine`, roots `packages/providers/src/policy, packages/providers/tests/policy`): unmerged — run `git merge --no-ff task/135-signed-provider-policy-engine -m "integrate: Task 135 signed-provider-policy-engine"`.
- Unit `Task 136` (`task/136-api-key-onboarding-pricing` @ `80e6ae8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-136-api-key-onboarding-pricing`, roots `packages/providers/src/api-keys, packages/providers/tests/api-keys`): unmerged — run `git merge --no-ff task/136-api-key-onboarding-pricing -m "integrate: Task 136 api-key-onboarding-pricing"`.
- Unit `Task 137` (`task/137-sign-in-with-chatgpt-oauth` @ `8ffeebd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-137-sign-in-with-chatgpt-oauth`, roots `packages/providers/src/siwc, packages/providers/tests/siwc`): unmerged — run `git merge --no-ff task/137-sign-in-with-chatgpt-oauth -m "integrate: Task 137 sign-in-with-chatgpt-oauth"`.
- Sequence note: Merge `task/135-signed-provider-policy-engine` (`e6934db`), `task/136-api-key-onboarding-pricing` (`80e6ae8`), and `task/137-sign-in-with-chatgpt-oauth` (`8ffeebd`) (`git merge --no-ff`) in order `135 -> 136 -> 137` onto `harness/integration` (C52 child).

Freeze.
- `GlobalBrokerDb` (`packages/db`) v2 migration adds `policy_history`, `connection_profiles`, and `model_weights` tables to `global.db` while keeping `connections` unconstrained across `'api_key' | 'siwc' | 'openrouter_oauth' | 'copilot_sdk' | 'cursor_sdk' | 'local'`.
- `SignedProviderPolicyEngine` (`packages/providers/src/policy/**`) implements `currentPriceTable()`, `readSiwcPolicy()`, and `copilotPremiumMultipliers()` alongside `activeDocument()`, `complianceLocks()`, `cliGate()`, `revocationHandler()`, and `rosterPort()`.
- `136` (`api-keys`) and `137` (`siwc`) persist connections strictly in `GlobalBrokerDb` (`014`) and secrets strictly in async `WindowsDpapiSecretsVault` (`120`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-057`: Add `@ef-harness/{db,governor,planner,shared-observability}` to `packages/providers/package.json`.
2. replace `135` `GlobalDbPolicyPort`, `136` `LocalGlobalDbConnections`, and `137` `SqliteSiwcInstallationStore` standalone `DatabaseSync` handles with `GlobalBrokerDb` (`014`).
3. `F-057`: Adapt `136` (`local-dpapi-vault.ts:30-64`) and `137` (`siwc/ports.ts:26-51`) from `put`/`getPlaintext` to async `WindowsDpapiSecretsVault` (`storeSecret`/`readPlaintextForKernel`/`deleteSecret`), deleting `136`'s ephemeral `randomBytes(32)` `dpapi-vault.json` fallback.

Local defects.
- `F-057`: Delete `packages/providers/src/api-keys/local-global-db-connections.ts:68-98` containing destructive `CHECK (route = 'api_key')` and `CHECK (provider IN (...))` constraints that crash all non-API-key routes.

Shared files.
- Integration-owned shared surfaces: `packages/providers/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/providers/src/{policy,api-keys,siwc}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not allow `sk-ant-oat*` or `claude setup-token` through `ZeroTokenApiKeyValidator` (`136`), or offer Antigravity.
- Do not store secrets in ephemeral JSON files or open rogue `DatabaseSync` writers on `global.db`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/providers test -- policy api-keys siwc` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `global.db` stores API-key and SIWC connections side by side without `CHECK` failures, and `WindowsDpapiSecretsVault` round-trips keys across reopen.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `SignedProviderPolicyEngine` (`currentPriceTable`, `readSiwcPolicy`, `copilotPremiumMultipliers`), `ApiConnectionManager`, `ZeroTokenApiKeyValidator`, and `ChatGptSignInOAuth`.

Stop.
- Commit merges and `integrate: wire providers policy/api-keys/siwc` with `EF_HARNESS_MAINTAINER=1`; halt if `global.db` migrations break `schema-test.js`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C54 — `OpenRouterAndLocalModels`, `CopilotAndCursorAuth`, and `AllowancePacingController` share `GlobalBrokerDb` + DPAPI and wire directly into `VersionedModelRoster` and `BudgetWindDownController`.

Architecture.
- `provider-connections.md` (OpenRouter OAuth, Local Ollama/LM Studio/vLLM, Copilot & Cursor Auth, AIMD Allowance Pacing & Per-Model Weight `k[model]`), `open-design-questions.md`.
- `schema/global.sql` (`connection_windows`, `settings`), `IMPLEMENTATION_TASKS.md` (`Task 138`–`Task 140`).
- Post-task invariant: `OpenRouterAndLocalModels`, `CopilotAndCursorAuth`, and `AllowancePacingController` share `GlobalBrokerDb` + DPAPI and wire directly into `VersionedModelRoster` and `BudgetWindDownController`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C53` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 138` (`task/138-openrouter-oauth-local-models` @ `01daab9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-138-openrouter-oauth-local-models`, roots `packages/providers/src/openrouter-local, packages/providers/tests/openrouter-local`): unmerged — run `git merge --no-ff task/138-openrouter-oauth-local-models -m "integrate: Task 138 openrouter-oauth-local-models"`.
- Unit `Task 139` (`task/139-copilot-cursor-subscription-auth` @ `7475bf8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-139-copilot-cursor-subscription-auth`, roots `packages/providers/src/copilot-cursor-auth, packages/providers/tests/copilot-cursor-auth`): unmerged — run `git merge --no-ff task/139-copilot-cursor-subscription-auth -m "integrate: Task 139 copilot-cursor-subscription-auth"`.
- Unit `Task 140` (`task/140-broker-allowance-pacing-aimd` @ `ab3b334`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-140-broker-allowance-pacing-aimd`, roots `packages/providers/src/pacing, packages/providers/tests/pacing`): unmerged — run `git merge --no-ff task/140-broker-allowance-pacing-aimd -m "integrate: Task 140 broker-allowance-pacing-aimd"`.
- Sequence note: Merge `task/138-openrouter-oauth-local-models` (`01daab9`), `task/139-copilot-cursor-subscription-auth` (`7475bf8`), and `task/140-broker-allowance-pacing-aimd` (`ab3b334`) (`git merge --no-ff`) in order `138 -> 139 -> 140` onto `harness/integration` (C53 child).

Freeze.
- `AllowancePacingController` (`packages/providers/src/pacing/**`) persists `connection_windows` (`GlobalBrokerDb` `014`) and `ModelAllowanceWeightLearner` `k[model]` weights (`global.db.model_weights` v2 migration, never volatile RAM `Map`).
- `VersionedModelRoster` (`106` `@ef-harness/planner`) queries `SignedProviderPolicyEngine` (`135`) and `AllowancePacingController` (`140`) cleanly without violating DAG layer boundaries (via injected roster policy/pacing ports or `providers` <-> `planner` interface in `@ef-harness/shared-contracts`).
- `packages/providers/src/index.ts` exports `policy`, `api-keys`, `siwc`, `openrouter-local`, `copilot-cursor-auth`, and `pacing` (`fallback-guard` added in C55).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-057`: Adapt `138` (`openrouter-local/ports.ts`) and `139` (`copilot-cursor-auth/local-ports.ts`) to real `GlobalBrokerDb` (`014` `connection_profiles` removing nonexistent `metadata_json` assumption on `connections`) and async `WindowsDpapiSecretsVault` (`120`).
2. `F-057`, `F-065`: Connect `140` (`GlobalConnectionWindowRepo` + `AllowancePacingController`) into `BudgetWindDownController` (`128` `@ef-harness/steering` `AllowanceWindowPort`) and `VersionedModelRoster` (`106` via `providers` feeding runtime/planner).

Local defects.
- `F-057`: Delete `packages/providers/src/copilot-cursor-auth/local-ports.ts:235-242` (`LocalWindowsDpapiSecretsVault` encrypting secrets with insecure single-byte XOR `^ 0x5a` in memory).

Shared files.
- Integration-owned shared surfaces: `packages/providers/src/index.ts`, `packages/providers/src/{openrouter-local,copilot-cursor-auth,pacing}/**`, `packages/planner/src/crew-levels/**`, `packages/steering/src/budget-stops/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not use `^ 0x5a` XOR masking or keep `InMemoryGlobalConnectionWindowRepo` / volatile `k[model]` `Map`s in production paths.
- Do not create an import cycle between `packages/providers` (rank 21) and `packages/planner` (rank 19); keep shared policy/pacing port types in `@ef-harness/shared-contracts` (rank 0).
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/providers test && pnpm --filter @ef-harness/steering test -- budget-stops && pnpm --filter @ef-harness/planner test -- crew-levels` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `connection_windows` and `k[model]` weights survive `GlobalBrokerDb` reopen and `CopilotAndCursorAuth` stores tokens solely via `WindowsDpapiSecretsVault`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on all 6 exported `@ef-harness/providers` modules plus `NoSilentPaidFallbackGuard` in C55.

Stop.
- Commit merges and `integrate: wire providers pacing/auth` with `EF_HARNESS_MAINTAINER=1`; halt if `eslint.config.mjs` reports a layer cycle between `providers` and `planner`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C55 — Connections UI enforces strict Anthropic `sk-ant-api` compliance over daemon IPC, and `@ef-harness/runtime-adapters/core` freezes the 10-method `AgentRuntimeAdapter` on real OS Jobs.

Architecture.
- `open-design-questions.md` (No Silent Paid Fallback, Console-Only Anthropic Rejection of `sk-ant-oat*`), `desktop-app.md` (`sandbox: true` Renderer), `agent-runtime-adapters.md` (Canonical 10-Method Contract).
- `sandbox-and-security.md` (`KILL_ON_JOB_CLOSE`), `IMPLEMENTATION_TASKS.md` (`Task 141`–`Task 142`).
- Post-task invariant: Connections UI enforces strict Anthropic `sk-ant-api` compliance over daemon IPC, and `@ef-harness/runtime-adapters/core` freezes the 10-method `AgentRuntimeAdapter` on real OS Jobs.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C54` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 141` (`task/141-no-silent-fallback-connections-ui` @ `7067800`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-141-no-silent-fallback-connections-ui`, roots `apps/renderer/src/connections, apps/renderer/tests/connections, packages/providers/src/fallback-guard, packages/providers/tests/fallback-guard`): unmerged — run `git merge --no-ff task/141-no-silent-fallback-connections-ui -m "integrate: Task 141 no-silent-fallback-connections-ui"`.
- Unit `Task 142` (`task/142-runtime-adapter-core-supervision` @ `e50d00a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-142-runtime-adapter-core-supervision`, roots `packages/runtime-adapters/src/core, packages/runtime-adapters/tests/core`): unmerged — run `git merge --no-ff task/142-runtime-adapter-core-supervision -m "integrate: Task 142 runtime-adapter-core-supervision"`.
- Sequence note: Merge `task/141-no-silent-fallback-connections-ui` (`7067800`) then `task/142-runtime-adapter-core-supervision` (`e50d00a`) (`git merge --no-ff`) onto `harness/integration` (C54 child).

Freeze.
- `apps/renderer/src/connections/key-detect.ts` accepts ONLY `sk-ant-api` as `'anthropic_console'`, explicitly rejecting `sk-ant-oat*` and `claude setup-token` with `ANTHROPIC_COMPLIANCE_MESSAGE` (`135`/`136`).
- `apps/renderer/src/connections/**` has ZERO `node:sqlite` or vault imports, calling `apps/daemon` IPC for usage summaries and key storage.
- `AgentRuntimeAdapter` (`packages/runtime-adapters/src/core/interface.ts`) freezes `readonly runtime: ForeignRuntimeId`, `probe()`, `authStatus(connectionId?)`, `startSession(spec: SessionStartSpec)` (with optional `attemptId`, `taskId`, `modelId`, `connectionId`), `sendTurn()`, `interrupt()`, `resume(checkpointRef)`, `respondPermission()`, `usage()`, `terminate()`, and `dispose()` returning promises consistently for `assertAgentRuntimeAdapter`.
- `packages/runtime-adapters/package.json` declares `@ef-harness/{shared-contracts,shared-observability,db,sandbox,mcp-server,corpus,governor,providers}`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-058`: Move `TelemetryReceiptStore` SQLite queries (`apps/renderer/src/connections/receipts.ts`) into `apps/daemon` (`TelemetryDb` + `GlobalBrokerDb`) over `shared-contracts` RPC, adapt `FallbackGuardPort` (`connections/ports.ts:27-43`) to `NoSilentPaidFallbackGuard.evaluate` (`packages/providers/src/fallback-guard/guard.ts:143`), and export `fallback-guard` from `packages/providers/src/index.ts`.
2. `F-060`: Delete `packages/runtime-adapters/src/core/windows-job.ts` (blocking 20s `Atomics.wait` PowerShell script missing `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) and delegate OS job/sandbox/MCP/pool/secrets supervision to `@ef-harness/sandbox` (`040, 044–047`), `@ef-harness/mcp-server` (`048`), `@ef-harness/governor` (`119, 120`), and `@ef-harness/shared-observability` (`011`).

Local defects.
- `F-058`: Fix `detectPastedKeyProvider` (`apps/renderer/src/connections/key-detect.ts:7,11-18`) matching `'sk-ant-'` (which accepted `sk-ant-oat01-...`) and delete `import { DatabaseSync } from 'node:sqlite'` in `apps/renderer/src/connections/receipts.ts:1`.
- `F-059`: Ensure `SessionStartSpec` and `assertAgentRuntimeAdapter` in `packages/runtime-adapters/src/core/interface.ts:113-142` cover all `143`–`149` adapter metadata fields cleanly.

Shared files.
- Integration-owned shared surfaces: `packages/providers/src/index.ts`, `packages/runtime-adapters/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `apps/daemon/src/**`, `apps/renderer/src/connections/**`, `packages/runtime-adapters/src/core/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not allow `apps/renderer/src/connections/**` to import `node:sqlite`, `node:fs`, or plain vault handles.
- Do not use `Atomics.wait` or `taskkill`-only supervision inside `packages/runtime-adapters/src/core/**`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/providers test && pnpm --filter @ef-harness/renderer test -- connections && pnpm --filter @ef-harness/runtime-adapters test -- core` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `sk-ant-oat01-...` is blocked in both `apps/renderer/src/connections` and `@ef-harness/providers`, zero `node:sqlite` imports exist in `apps/renderer/src/connections/**`, and `core` supervises processes via `WindowsJobObjectManager` (`KILL_ON_JOB_CLOSE`).
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on frozen `AgentRuntimeAdapter`, `assertAgentRuntimeAdapter`, `AdapterRegistry`, `DeterministicSupervisionPolicyEngine`, and `NoSilentPaidFallbackGuard`.

Stop.
- Commit merges and `integrate: wire connections ui + runtime-adapters core` with `EF_HARNESS_MAINTAINER=1`; halt if `sk-ant-oat` compliance check fails.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C56 — `GenericAcpAdapter`, `CodexRuntimeAdapter`, and `CopilotRuntimeAdapter` conform to frozen `AgentRuntimeAdapter` over real `WindowsJobObjectManager` and `AllowlistProxyServer`.

Architecture.
- `agent-runtime-adapters.md` (`GenericAcpAdapter`, `CodexRuntimeAdapter`, `CopilotRuntimeAdapter`), `sandbox-and-security.md` (Job Objects & Loopback Proxy).
- `IMPLEMENTATION_TASKS.md` (`Task 143`–`Task 145`).
- Post-task invariant: `GenericAcpAdapter`, `CodexRuntimeAdapter`, and `CopilotRuntimeAdapter` conform to frozen `AgentRuntimeAdapter` over real `WindowsJobObjectManager` and `AllowlistProxyServer`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C55` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 143` (`task/143-generic-acp-adapter` @ `4ff2425`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-143-generic-acp-adapter`, roots `packages/runtime-adapters/src/acp, packages/runtime-adapters/tests/acp`): unmerged — run `git merge --no-ff task/143-generic-acp-adapter -m "integrate: Task 143 generic-acp-adapter"`.
- Unit `Task 144` (`task/144-codex-runtime-adapter` @ `2a84057`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-144-codex-runtime-adapter`, roots `packages/runtime-adapters/src/codex, packages/runtime-adapters/tests/codex`): unmerged — run `git merge --no-ff task/144-codex-runtime-adapter -m "integrate: Task 144 codex-runtime-adapter"`.
- Unit `Task 145` (`task/145-copilot-runtime-adapter` @ `5f2d8c7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-145-copilot-runtime-adapter`, roots `packages/runtime-adapters/src/copilot, packages/runtime-adapters/tests/copilot`): unmerged — run `git merge --no-ff task/145-copilot-runtime-adapter -m "integrate: Task 145 copilot-runtime-adapter"`.
- Sequence note: Merge `task/143-generic-acp-adapter` (`4ff2425`), `task/144-codex-runtime-adapter` (`2a84057`), and `task/145-copilot-runtime-adapter` (`5f2d8c7`) (`git merge --no-ff`) in order `143 -> 144 -> 145` onto `harness/integration` (C55 child).

Freeze.
- `GenericAcpAdapter` (`143`), `CodexRuntimeAdapter` (`144`), and `CopilotRuntimeAdapter` (`145`) each define `readonly runtime` (`'acp' | 'codex' | 'copilot'`), implement all 10 async `AgentRuntimeAdapter` methods (`../core/interface.js`), and pass `assertAgentRuntimeAdapter`.
- `CodexRuntimeAdapter` and `CopilotRuntimeAdapter` delegate ACP fallback paths to `GenericAcpAdapter` (`143`) and permission checks to `DeterministicSupervisionPolicyEngine` (`142`), executing OS subprocesses via `WindowsJobObjectManager` (`040`) and `AllowlistProxyServer.proxyUrl` (`044`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-059`: Update `GenericAcpAdapter.probe()` (`'ready'` status), `CodexRuntimeAdapter.authStatus()` (async Promise), `CopilotRuntimeAdapter.authStatus/resume/respondPermission/usage` (matching `SessionStartSpec` & `checkpointRef: string`), and remove duplicated `CodexAcpFallbackTransport`/`CopilotAcpFallbackAdapter` + local supervision/redactor helpers.
2. `F-060`: Delete `acp/job.ts` `LocalWindowsJob` (`taskkill`), `codex/process.ts` `killPid`, and `copilot` `InMemoryJobSupervisor`/`LocalLoopbackProxy`, wiring `040`, `044`, `047`, `048`, `119`, `120`, and `011`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-060`: Replace dead `DEFAULT_PROXY = 'http://127.0.0.1:9'` in `packages/runtime-adapters/src/codex/adapter.ts:132,188` with required `AllowlistProxyServer.proxyUrl` (`044`) or explicit sandbox proxy configuration error.

Shared files.
- Integration-owned shared surfaces: `packages/runtime-adapters/src/acp/**`, `packages/runtime-adapters/src/codex/**`, `packages/runtime-adapters/src/copilot/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not leave `DEFAULT_PROXY = 'http://127.0.0.1:9'` or `InMemoryJobSupervisor` as production defaults.
- Do not mutate `core/interface.ts` signatures frozen in C55.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/runtime-adapters test -- core acp codex copilot` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `AdapterRegistry` registers `GenericAcpAdapter`, `CodexRuntimeAdapter`, and `CopilotRuntimeAdapter` passing `assertAgentRuntimeAdapter`, with zero `127.0.0.1:9` proxy defaults.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `GenericAcpAdapter`, `CodexRuntimeAdapter`, and `CopilotRuntimeAdapter` conforming to `AgentRuntimeAdapter`.

Stop.
- Commit merges and `integrate: wire acp/codex/copilot adapters` with `EF_HARNESS_MAINTAINER=1`; halt if `AgentRuntimeAdapter` signatures mismatch C55.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C57 — `CursorRuntimeAdapter`, `ClaudeCodeRuntimeAdapter`, and `GeminiCliRuntimeAdapter` conform to `AgentRuntimeAdapter` with Console-only Anthropic and OFF-by-default Gemini CLI.

Architecture.
- `agent-runtime-adapters.md` (`CursorRuntimeAdapter`, `ClaudeCodeRuntimeAdapter` Console-Only, `GeminiCliRuntimeAdapter` Opt-In & Zero `~/.gemini`), `open-design-questions.md`.
- `schema/global.sql` (`settings`), `IMPLEMENTATION_TASKS.md` (`Task 146`–`Task 148`).
- Post-task invariant: `CursorRuntimeAdapter`, `ClaudeCodeRuntimeAdapter`, and `GeminiCliRuntimeAdapter` conform to `AgentRuntimeAdapter` with Console-only Anthropic and OFF-by-default Gemini CLI.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C56` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 146` (`task/146-cursor-runtime-adapter` @ `b6c107e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-146-cursor-runtime-adapter`, roots `packages/runtime-adapters/src/cursor, packages/runtime-adapters/tests/cursor`): unmerged — run `git merge --no-ff task/146-cursor-runtime-adapter -m "integrate: Task 146 cursor-runtime-adapter"`.
- Unit `Task 147` (`task/147-claude-code-headless-adapter` @ `de69e3e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-147-claude-code-headless-adapter`, roots `packages/runtime-adapters/src/claude-code, packages/runtime-adapters/tests/claude-code`): unmerged — run `git merge --no-ff task/147-claude-code-headless-adapter -m "integrate: Task 147 claude-code-headless-adapter"`.
- Unit `Task 148` (`task/148-gemini-cli-optional-adapter` @ `d200038`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-148-gemini-cli-optional-adapter`, roots `packages/runtime-adapters/src/gemini-cli, packages/runtime-adapters/tests/gemini-cli`): unmerged — run `git merge --no-ff task/148-gemini-cli-optional-adapter -m "integrate: Task 148 gemini-cli-optional-adapter"`.
- Sequence note: Merge `task/146-cursor-runtime-adapter` (`b6c107e`), `task/147-claude-code-headless-adapter` (`de69e3e`), and `task/148-gemini-cli-optional-adapter` (`d200038`) (`git merge --no-ff`) in order `146 -> 147 -> 148` onto `harness/integration` (C56 child).

Freeze.
- `CursorRuntimeAdapter` (`146`), `ClaudeCodeRuntimeAdapter` (`147`), and `GeminiCliRuntimeAdapter` (`148`) each define `readonly runtime` (`'cursor' | 'claude_code' | 'gemini_cli'`) and implement all 10 async `AgentRuntimeAdapter` methods (`../core/interface.js`).
- `ClaudeCodeRuntimeAdapter` enforces Console API key auth only (`sk-ant-api*`, rejecting `sk-ant-oat*` / `setup-token`).
- `GeminiCliRuntimeAdapter` persists OFF-by-default opt-in in `GlobalBrokerDb.settings` (`014`, never `~/.gemini` or `MemoryGlobalSettingsStore`).
- All three share `GenericAcpAdapter` (`143`), `DeterministicSupervisionPolicyEngine` (`142`), `WindowsJobObjectManager` (`040`), `AllowlistProxyServer` (`044`), and `AttemptMcpServer` (`048`) dynamic MCP endpoint.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-059`, `F-061`: Add `readonly runtime` and align async `authStatus`, `resume(checkpointRef: string)`, `respondPermission`, and `usage` on `146`, `147`, and `148` to `core/interface.ts`.
2. `F-060`, `F-061`: Delete `146` `CursorAcpFallbackAdapter` + `cursor/local-ports.ts` (`InMemoryJobSupervisor`/`LocalLoopbackProxy`) and `148` `LocalGenericAcpAdapter` + hardcoded `'http://127.0.0.1:46322/mcp'` + `MemoryGlobalSettingsStore`, binding real `143`, `014`, `040`, `044`, and `048`.

Local defects.
- `F-061`: Ensure `GeminiCliRuntimeAdapter` (`148`) contains zero filesystem reads touching `~/.gemini` and fails closed unless explicit consent is recorded in `GlobalBrokerDb.settings`.

Shared files.
- Integration-owned shared surfaces: `packages/runtime-adapters/src/cursor/**`, `packages/runtime-adapters/src/claude-code/**`, `packages/runtime-adapters/src/gemini-cli/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.

Do not.
- Do not read `~/.gemini` or allow `sk-ant-oat*` / `claude setup-token` in `147` or `148`.
- Do not hardcode `http://127.0.0.1:46322/mcp` or fall back to `InMemoryJobSupervisor`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/runtime-adapters test -- cursor claude-code gemini-cli` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `assertAgentRuntimeAdapter` passes for `Cursor`, `ClaudeCode`, and `GeminiCli`, `ClaudeCode` rejects OAuth tokens, and `GeminiCli` stays OFF by default with `GlobalBrokerDb` persistence.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `CursorRuntimeAdapter`, `ClaudeCodeRuntimeAdapter`, and `GeminiCliRuntimeAdapter` conforming to `AgentRuntimeAdapter`.

Stop.
- Commit merges and `integrate: wire cursor/claude-code/gemini-cli adapters` with `EF_HARNESS_MAINTAINER=1`; halt if any `~/.gemini` path reference remains.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C58 — `OpenCodeRuntimeAdapter` (`149`) conforms cleanly to `AgentRuntimeAdapter` and `ForeignRuntimeResumeCoordinator` (`150`) checkpoints via `ProjectStateDb` without DDL/JSON clobbers.

Architecture.
- `agent-runtime-adapters.md` (`OpenCodeRuntimeAdapter`, Ephemeral Config Isolation, Checkpoints & Idle Parking, Additive vs Contradictory Resume).
- `schema/state.sql` (`attempts`, `attempt_checkpoints`), `IMPLEMENTATION_TASKS.md` (`Task 149`–`Task 150`).
- Post-task invariant: `OpenCodeRuntimeAdapter` (`149`) conforms cleanly to `AgentRuntimeAdapter` and `ForeignRuntimeResumeCoordinator` (`150`) checkpoints via `ProjectStateDb` without DDL/JSON clobbers.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C57` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 149` (`task/149-opencode-acp-runtime-adapter` @ `90dcdea`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-149-opencode-acp-runtime-adapter`, roots `packages/runtime-adapters/src/opencode, packages/runtime-adapters/tests/opencode`): unmerged — run `git merge --no-ff task/149-opencode-acp-runtime-adapter -m "integrate: Task 149 opencode-acp-runtime-adapter"`.
- Unit `Task 150` (`task/150-foreign-runtime-checkpoint-resume` @ `2cc3418`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-150-foreign-runtime-checkpoint-resume`, roots `packages/runtime-adapters/src/resume, packages/runtime-adapters/tests/resume`): unmerged — run `git merge --no-ff task/150-foreign-runtime-checkpoint-resume -m "integrate: Task 150 foreign-runtime-checkpoint-resume"`.
- Sequence note: Merge `task/149-opencode-acp-runtime-adapter` (`90dcdea`) then `task/150-foreign-runtime-checkpoint-resume` (`2cc3418`) (`git merge --no-ff`) onto `harness/integration` (C57 child).

Freeze.
- `OpenCodeRuntimeAdapter` (`packages/runtime-adapters/src/opencode/runtime-adapter.ts`) exposes `readonly runtime = 'opencode'`, async `probe()`/`authStatus()`, ephemeral isolated config overriding repo `opencode.json`, `GenericAcpAdapter` (`143`) delegation, and `WindowsJobObjectManager` (`040`) supervision.
- `SqliteAttemptCheckpointStore` (`packages/runtime-adapters/src/resume/checkpoint-store.ts`) uses `@ef-harness/db` (`RuntimeLifecycleRepo` `022`) + `AttemptCheckpointStore` (`053`), merging `foreignRuntimeCheckpoint` into `attempt_checkpoints.contract_versions` JSON without overwriting native sibling keys or issuing `CREATE TABLE attempts`.
- `ForeignRuntimeResumeCoordinator` (`150`) wires `DirtySnapshotEngine` (`037`), `WorktreeSlotPool` (`038`), `ContextSlicerEngine` (`088`), `AdditiveVsContradictoryResumer` (`115`), `SessionProcessCapGuard` (`119`), and `CheckpointSchemaUpcasterRegistry` (`132`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-061`: Add `@ef-harness/{git-engine,worker-loop,planner,steering,desktop}` (or inject desktop/coordinator checkpoint upcaster port via `@ef-harness/shared-contracts` respecting DAG rank `24`) to `packages/runtime-adapters/package.json`.
2. replace `NoopWorktreeSlot`, `LocalDirtySnapshotEngine`, `IdentityBriefCompiler`, and `LocalAdditiveVsContradictoryResumer`.
3. `F-061`, `F-066`: Connect `CheckpointSchemaUpcasterRegistry` (`132`) cleanly into `ForeignRuntimeResumeCoordinator`.

Local defects.
- `F-061`: Delete `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY)` and standalone `DatabaseSync` in `packages/runtime-adapters/src/resume/checkpoint-store.ts:20-34,71-96` (which crashed with `SQLITE_CONSTRAINT_NOTNULL` on `schema/state.sql` `attempts` and overwrote `contract_versions`).

Shared files.
- Integration-owned shared surfaces: `packages/runtime-adapters/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/runtime-adapters/src/opencode/**`, `packages/runtime-adapters/src/resume/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow repo `opencode.json` to override harness MCP/permission lockdown.
- Do not overwrite `attempt_checkpoints.contract_versions` keys written by native `Task 053` checkpoints.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/runtime-adapters test -- opencode resume` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `OpenCodeRuntimeAdapter` passes `assertAgentRuntimeAdapter` and cross-runtime checkpoint save/resume (`Native <-> Codex`) succeeds against real `schema/state.sql` `attempts`/`attempt_checkpoints`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C59` conformance & M4 gate rely on all 7 runtime adapters (`143–149`) and `ForeignRuntimeResumeCoordinator` (`150`).

Stop.
- Commit merges and `integrate: wire opencode adapter + resume coordinator` with `EF_HARNESS_MAINTAINER=1`; halt if `ef/layer-boundary` reports an upward import on `desktop`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C59 — `AdapterConformanceRunner` (`151`) drives all real `143`–`149` adapters, exports `@ef-harness/runtime-adapters`, and M4 Exit Gate (`152`) certifies real M4 packages.

Architecture.
- `agent-runtime-adapters.md` (`Automated Conformance Suite` P01–P10), `roadmap.md` (`Milestone 4 Exit Gate` — Subscription Pacing & Conformance, 0 silent paid fallbacks).
- `schema/global.sql`, `IMPLEMENTATION_TASKS.md` (`Task 151`–`Task 152`).
- Post-task invariant: `AdapterConformanceRunner` (`151`) drives all real `143`–`149` adapters, exports `@ef-harness/runtime-adapters`, and M4 Exit Gate (`152`) certifies real M4 packages.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C58` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 151` (`task/151-automated-adapter-conformance-suite` @ `f8b7b3f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-151-automated-adapter-conformance-suite`, roots `packages/runtime-adapters/src/conformance, packages/runtime-adapters/tests/conformance`): unmerged — run `git merge --no-ff task/151-automated-adapter-conformance-suite -m "integrate: Task 151 automated-adapter-conformance-suite"`.
- Unit `Task 152` (`task/152-m4-plans-conformance-exit-gate` @ `6a166dd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-152-m4-plans-conformance-exit-gate`, roots `benchmarks/m4-plans/chatgpt-plus-profile.json, benchmarks/m4-plans/hidden-suite.port.json, benchmarks/m4-plans/kitchen-tasks.json, benchmarks/m4-plans/opening-spec.txt, tests/e2e/m4-exit-gate`): unmerged — run `git merge --no-ff task/152-m4-plans-conformance-exit-gate -m "integrate: Task 152 m4-plans-conformance-exit-gate"`.
- Sequence note: Merge `task/151-automated-adapter-conformance-suite` (`f8b7b3f`) then `task/152-m4-plans-conformance-exit-gate` (`6a166dd`) (`git merge --no-ff`) onto `harness/integration` (C58 child).

Freeze.
- `AdapterConformanceRunner` (`packages/runtime-adapters/src/conformance/runner.ts`) drives real `AgentRuntimeAdapter` instances (`143`–`149`: `probe`, `startSession`, `sendTurn`, `interrupt`, `resume`, `usage`, `terminate`) and persists version-keyed verdicts in `GlobalBrokerDb` (`global.db.adapter_conformance` v2 migration).
- `packages/runtime-adapters/src/index.ts` exports `core, acp, codex, copilot, cursor, claude-code, gemini-cli, opencode, resume, conformance` cleanly.
- `M4AllowancePacedBenchmark` (`tests/e2e/m4-exit-gate/**`) uses `.js` import specifiers compiled by `tests/e2e/tsconfig.json` and exercises real `@ef-harness/{providers,runtime-adapters,renderer,e2e}` (`105` `KitchenHiddenAcceptanceSuite`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-061`: Add `adapter_conformance` table in `packages/db/src/migrations/**` and wire `createConformanceStack` (`151`) from volatile `InMemoryAdapterConformanceDb` to `GlobalBrokerDb` (`014`).
2. `F-062`: Add `@ef-harness/{providers,runtime-adapters,renderer}` to `tests/e2e/package.json` + `tests/e2e/tsconfig.json`, include `m4-exit-gate/**/*.ts`, export `runM4Certification` from `tests/e2e/src/index.ts`, and replace all fake local stand-in files (`m4-exit-gate/{pacing,wire,kitchen,certifier,conformance,handoff,analytics}.ts`) and static `hidden-suite.port.json` scoring with real package calls.

Local defects.
- `F-061`: Fix `packages/runtime-adapters/src/conformance/probes.ts:126-220` evaluating synthetic `AdapterBehavior` structs instead of calling real `AgentRuntimeAdapter` methods.
- `F-062`: Convert all `.ts` relative import specifiers in `tests/e2e/m4-exit-gate/*.ts` to `.js` so `tsc -b` compiles cleanly.

Shared files.
- Integration-owned shared surfaces: `packages/runtime-adapters/src/index.ts`, `packages/db/src/migrations/**`, `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/src/index.ts`, `tests/e2e/m4-exit-gate/**`, `pnpm-lock.yaml` (single `pnpm install`).
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not score `KitchenHiddenAcceptanceSuite` statically from `hidden-suite.port.json` or test `AdapterConformanceRunner` on mock `AdapterBehavior` objects.
- Do not bypass `NoSilentPaidFallbackGuard` (`141`) in M4 replay certification.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test && node schema/schema-test.js` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/runtime-adapters test && pnpm --filter @ef-harness/e2e test -- m4-exit-gate` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `AdapterConformanceRunner` passes `P01–P10` against real `143–149` adapters and `m4-exit-gate` executes real `@ef-harness/{providers,runtime-adapters,renderer}` end-to-end.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream Wave 6 (`brownfield`, `dictation`, `renderer`, `office`, `ui-checks`) relies on complete M0–M4 integration and green `m4-exit-gate`.

Stop.
- Commit merges and `integrate: wire runtime-adapters + m4-exit-gate` with `EF_HARNESS_MAINTAINER=1`; halt if any conformance probe fails against real adapters.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C60 — Brownfield L0/L1/L2 indexers (`166`–`168`) run hermetic `MinGit`, async `web-tree-sitter` WASM, real `refs` PageRank maps, and `code-index.db.module_cards`.

Architecture.
- `brownfield-discovery.md` (Layer 0 Scanner, Layer 1 Tree-Sitter WASM + Personalized PageRank, Layer 2 Cached Module Cards & Stale-Docs Detector), `database-design.md` (`schema/code-index.sql`).
- `prompt-contracts.md` (`module-card-writer@1`), `IMPLEMENTATION_TASKS.md` (`Task 166`–`Task 168`).
- Post-task invariant: Brownfield L0/L1/L2 indexers (`166`–`168`) run hermetic `MinGit`, async `web-tree-sitter` WASM, real `refs` PageRank maps, and `code-index.db.module_cards`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C59` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 166` (`task/166-brownfield-l0-repo-scanner` @ `01c9d1f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-repo-scanner`, roots `packages/brownfield/src/l0-scan, packages/brownfield/tests/l0-scan`): unmerged — run `git merge --no-ff task/166-brownfield-l0-repo-scanner -m "integrate: Task 166 brownfield-l0-repo-scanner"`.
- Unit `Task 167` (`task/167-brownfield-l1-code-map` @ `49b2404`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-167-brownfield-l1-code-map`, roots `packages/brownfield/src/l1-codemap, packages/brownfield/tests/l1-codemap`): unmerged — run `git merge --no-ff task/167-brownfield-l1-code-map -m "integrate: Task 167 brownfield-l1-code-map"`.
- Unit `Task 168` (`task/168-brownfield-l2-summaries` @ `a9d88c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-168-brownfield-l2-summaries`, roots `packages/brownfield/src/l2-cards, packages/brownfield/tests/l2-cards`): unmerged — run `git merge --no-ff task/168-brownfield-l2-summaries -m "integrate: Task 168 brownfield-l2-summaries"`.
- Sequence note: Merge `task/166-brownfield-l0-repo-scanner` (`01c9d1f`), `task/167-brownfield-l1-code-map` (`49b2404`), and `task/168-brownfield-l2-summaries` (`a9d88c3`) (`git merge --no-ff`) in order `166 -> 167 -> 168` onto `harness/integration` (C59 child).

Freeze.
- `BrownfieldL0RepoScanner` (`166`) runs exclusively via Hermetic `MinGit` (`@ef-harness/git-engine`) and persists `observed` nodes (`kind = 'research_fact' | 'component'`, `basis = 'observed'`, never invalid `'brownfield_module'`) via `KnowledgeGraphRepo` + `state.db.kv`.
- `WasmTreeSitterIndexer` (`167`) declares `"web-tree-sitter"` + copies `.wasm` grammars in `packages/brownfield/package.json`, parses files asynchronously in 25-file batches yielding on canonical uppercase `'ORANGE' | 'RED'` Governor pressure (`118`), and `CompactCodeMapQueryService.renderPersonalizedMap` traverses real `import:`/`refs` edges.
- `CodeIndexDb` (`schema/code-index.sql` + `packages/db`) adds `module_cards` v2 migration supporting `SqliteModuleCardStore` (`168`) keyed by `(file_path, file_content_sha256, prompt_version)` with `ModuleCardWriterV1Schema` (`009`) + `StreamingRedactor` (`011`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-073`: Add `"web-tree-sitter"` + grammar `.wasm` build-copy script + `@ef-harness/{db,git-engine,shared-observability}` to `packages/brownfield/package.json`, and replace duplicate `packet-security-redactor.ts` (`168`) with `@ef-harness/shared-observability` (`011`).
2. `F-073`, `F-074`: Add `module_cards` DDL migration in `packages/db` (`CodeIndexDb`), replace `InMemoryModuleCardStore`/`InMemoryObservedModuleGraph` (`168`) with `SqliteModuleCardStore`, and wire `166 -> 167 -> 168`.

Local defects.
- `F-073`: Fix `wasm-tree-sitter-indexer.ts:61-136` synchronous blocking loop and lowercase `'orange'|'red'` check (`line 90` -> `'ORANGE'|'RED'`), load real WASM AST in `web-tree-sitter-loader.ts`, and replace synthetic `global[i] -> global[i+1]` edges in `compact-code-map-query-service.ts:84-88`.
- `F-074`: Replace `spawnSync('git', ...)` from `PATH` in `l0-scan/git-exec.ts:19-35` with `MinGit` (`035`) and remove invalid `node_kinds` `'brownfield_module'` writes.

Shared files.
- Integration-owned shared surfaces: `packages/brownfield/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/brownfield/src/{l0-scan,l1-codemap,l2-cards}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not check lowercase `'orange'|'red'` Governor levels or spawn ambient `git` from `PATH`.
- Do not emit linear synthetic `global[i] -> global[i+1]` edges in `renderPersonalizedMap`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/brownfield test -- l0-scan l1-codemap l2-cards` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `WasmTreeSitterIndexer` parses JS/TS via WASM asynchronously across 25-file batches, `renderPersonalizedMap` ranks real `refs` edges, and `SqliteModuleCardStore` persists cards in `code-index.db`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream tasks rely on `BrownfieldL0RepoScanner`, `CompactCodeMapQueryService`, `ModuleCardCacheEngine`, and `StaleDocsDetector`.

Stop.
- Commit merges and `integrate: wire brownfield l0-l2` with `EF_HARNESS_MAINTAINER=1`; halt if `web-tree-sitter` WASM grammars fail to resolve from `dist/`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C61 — `BrownfieldOpeningController` (`169`) and `BaselineTestHealthRunner` (`170`) persist `work_items`/`quarantined_tests` in `state.db` and export all `@ef-harness/brownfield` APIs.

Architecture.
- `brownfield-discovery.md` (Brownfield Opening, Change Requests, Pre-Settled Observed Criteria, `<= 600`-Token Conventions Injection, Baseline Test-Health Quarantine).
- `schema/state.sql` (`work_items`, `quarantined_tests`, `kv`), `IMPLEMENTATION_TASKS.md` (`Task 169`–`Task 170`).
- Post-task invariant: `BrownfieldOpeningController` (`169`) and `BaselineTestHealthRunner` (`170`) persist `work_items`/`quarantined_tests` in `state.db` and export all `@ef-harness/brownfield` APIs.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C60` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 169` (`task/169-brownfield-opening-flow` @ `596121a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-169-brownfield-opening-flow`, roots `packages/brownfield/src/opening, packages/brownfield/tests/opening`): unmerged — run `git merge --no-ff task/169-brownfield-opening-flow -m "integrate: Task 169 brownfield-opening-flow"`.
- Unit `Task 170` (`task/170-brownfield-baseline-test-health` @ `555e097`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-170-brownfield-baseline-test-health`, roots `packages/brownfield/src/test-health, packages/brownfield/tests/test-health`): unmerged — run `git merge --no-ff task/170-brownfield-baseline-test-health -m "integrate: Task 170 brownfield-baseline-test-health"`.
- Sequence note: Merge `task/169-brownfield-opening-flow` (`596121a`) then `task/170-brownfield-baseline-test-health` (`555e097`) (`git merge --no-ff`) onto `harness/integration` (C60 child).

Freeze.
- `BrownfieldOpeningController` (`packages/brownfield/src/opening/index.ts`) persists `work_items` in `ProjectStateDb` (`state.db.work_items`), queries `BrownfieldL0RepoScanner` (`166`), `CompactCodeMapQueryService` (`167`), and `ModuleCardCacheEngine` (`168`), pre-settles criteria via `DiscoverySessionCoordinator.preSettleObservedCriteria` (`069`), and injects `<= 600`-token repo conventions into `ContextSlicerEngine` (`088`).
- `BaselineTestHealthRunner` (`packages/brownfield/src/test-health/index.ts`) executes inside `WorktreeSlotPool.acquire` (`038`) + `HarnessRunEngine.execute` (`048`) and persists failing baseline tests into `state.db.quarantined_tests` (`ProjectStateDb`).
- `packages/brownfield/src/index.ts` exports `l0-scan`, `l1-codemap`, `l2-cards`, `opening`, and `test-health` cleanly.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-074`: Add `@ef-harness/{sandbox,discovery,planner,test-env}` to `packages/brownfield/package.json`.
2. adapt `169` calls (`l0.scanSummary`, `codeMap.listModulesForPaths`) and `170` calls (`l0Scanner.detectScripts`, `worktrees.checkoutIsolated`, `harness.runInSandbox`) to actual `166`, `167`, `038` (`acquire`), and `048` (`execute`) signatures.
3. `F-074`: Add `preSettleObservedCriteria` on `DiscoverySessionCoordinator` (`packages/discovery`) backed by `basis: 'observed'` settlements, and replace `InMemoryWorkItemStore` (`opening/work-item-store.ts:4-29`) + `test-health/in-memory.ts` with `ProjectStateDb` (`work_items`, `quarantined_tests`, `kv`).

Local defects.
- `F-074`: Ensure `packages/brownfield/src/index.ts` exports all 5 brownfield submodules instead of stub `packageIdentity()` only.

Shared files.
- Integration-owned shared surfaces: `packages/brownfield/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/brownfield/src/index.ts`, `packages/brownfield/src/{opening,test-health}/**`, `packages/discovery/src/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not store `work_items` or `quarantined_tests` only in volatile memory maps.
- Do not run baseline test-health probes outside `WorktreeSlotPool` + `HarnessRunEngine`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/discovery test && pnpm --filter @ef-harness/brownfield test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Reopening `ProjectStateDb` preserves `work_items` + `quarantined_tests`, `DiscoverySessionCoordinator` accepts `observed` pre-settlements, and `packages/brownfield/src/index.ts` exports all 5 modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream Canvas (`C64`), Investigations (`C72`), and M5 Gate (`C69`) rely on all 5 `@ef-harness/brownfield` exports.

Stop.
- Commit merges and `integrate: wire brownfield opening/test-health` with `EF_HARNESS_MAINTAINER=1`; halt if `work_items` or `quarantined_tests` columns conflict with `schema/state.sql`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C62 — `EditorCoexistenceWatcher`, `ZeroStashLandingExecutor`, and `HumanFixFlowEngine` use `@parcel/watcher`, `ProjectStateDb` (`'editor_overlap'`, `HUMAN_OWNED`), and CAS-safe branch landing.

Architecture.
- `editor-coexistence.md` (`@parcel/watcher` Debounced Watching, Active Scope Overlap Holds, Zero-Stash Safe Landing, Human Fixed It Myself Takeover).
- `schema/state.sql` (`task_holds`, `task_runtime`, `nodes`), `IMPLEMENTATION_TASKS.md` (`Task 171`–`Task 173`).
- Post-task invariant: `EditorCoexistenceWatcher`, `ZeroStashLandingExecutor`, and `HumanFixFlowEngine` use `@parcel/watcher`, `ProjectStateDb` (`'editor_overlap'`, `HUMAN_OWNED`), and CAS-safe branch landing.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C61` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 171` (`task/171-editor-coexistence-watcher` @ `84fc19a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-171-editor-coexistence-watcher`, roots `packages/integrator/src/coexistence-watcher, packages/integrator/tests/coexistence-watcher`): unmerged — run `git merge --no-ff task/171-editor-coexistence-watcher -m "integrate: Task 171 editor-coexistence-watcher"`.
- Unit `Task 172` (`task/172-safe-landing-engine` @ `7d47942`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-172-safe-landing-engine`, roots `packages/integrator/src/landing, packages/integrator/tests/landing`): unmerged — run `git merge --no-ff task/172-safe-landing-engine -m "integrate: Task 172 safe-landing-engine"`.
- Unit `Task 173` (`task/173-human-fixed-it-myself` @ `0583866`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-173-human-fixed-it-myself`, roots `packages/integrator/src/human-fix, packages/integrator/tests/human-fix`): unmerged — run `git merge --no-ff task/173-human-fixed-it-myself -m "integrate: Task 173 human-fixed-it-myself"`.
- Sequence note: Merge `task/171-editor-coexistence-watcher` (`84fc19a`), `task/172-safe-landing-engine` (`7d47942`), and `task/173-human-fixed-it-myself` (`0583866`) (`git merge --no-ff`) in order `171 -> 172 -> 173` onto `harness/integration` (C61 child).

Freeze.
- `packages/integrator/package.json` declares `"@parcel/watcher"` in runtime `dependencies`.
- `EditorCoexistenceWatcher` (`171`) places and releases holds via `HoldsSubmissionsRepo` composite key `(task, reason, source)` (`HoldReason = 'user_pause' | 'requirement_change' | 'budget' | 'ccr' | 'governor' | 'editor_overlap'` across `021`/`107`/`171`).
- `ZeroStashLandingExecutor` (`172`) persists `LandingReceipt` in `ProjectStateDb` (`landing_receipts` v2 migration), aborts cleanly without mutating user work when developer `HEAD !== targetBranch`, and prunes ONLY `harness/f/*` refs that are ancestors of `landedSha` via `GitRefCasUpdater` (`039`) + `ParallelFeatureBranchManager` (`110`).
- `HumanFixFlowEngine` (`173`) transitions `task_runtime` to `'HUMAN_OWNED'`, `nodes`, and `attempts` in `ProjectStateDb`.
- `packages/integrator/src/index.ts` adds `coexistence-watcher`, `landing`, and `human-fix` exports.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-051`: Add `'@parcel/watcher'` to `packages/integrator/package.json` and remove `watch-backend.ts:49-67`'s 12-parent directory walk.
2. `F-051`: Replace `HumanFixStateDb` (`hf_tasks`, `hf_contracts`, `hf_active_workers` in `human-fix/state-db.ts:8-35,115-125`) with `@ef-harness/db` (`ProjectStateDb`), align `ActiveScopeOverlapDetector` (`171`) with `(task, reason, source)` hold keys, and export `coexistence-watcher, landing, human-fix` from `packages/integrator/src/index.ts`.

Local defects.
- `F-051`: Replace RAM-only `new Map()` in `packages/integrator/src/landing/receipt-store.ts:4-18` with `ProjectStateDb` persistence, and fix `postLandingCleanup` (`zero-stash-executor.ts:193-212`) deleting unmerged future `harness/f/*` branches or skipping CAS ref updates.

Shared files.
- Integration-owned shared surfaces: `packages/integrator/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/{repos/holds*,migrations/**}`, `packages/integrator/src/index.ts`, `packages/integrator/src/{coexistence-watcher,landing,human-fix}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not delete `harness/f/*` feature branches that are not ancestors of `landedSha`.
- Do not revert C43 M3 exports in `packages/integrator/src/index.ts`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/integrator test -- coexistence-watcher landing human-fix` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `@parcel/watcher` loads from `packages/integrator`, overlapping edits place/clear `'editor_overlap'` holds on `(task, reason, source)`, `postLandingCleanup` preserves unmerged `harness/f/*` branches, and `HUMAN_OWNED` mutates real `task_runtime`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C70` (`ship-deploy`) and `C69` (`m5-exit-gate`) rely on `LandingReceipt`, `EditorCoexistenceWatcher`, `ZeroStashLandingExecutor`, and `HumanFixFlowEngine`.

Stop.
- Commit merges and `integrate: wire integrator coexistence/landing/human-fix` with `EF_HARNESS_MAINTAINER=1`; halt if `@parcel/watcher` native binary fails to load.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C63 — `@ef-harness/dictation` packages `gpt2.tiktoken` into `dist/`, wires `stt` with `vocabulary` + `GlobalBrokerDb` + GPU/Whisper governor arbitration, and exports cleanly.

Architecture.
- `interactive-architecture.md` (Local Whisper Dictation, `224`-Token Initial Prompt Budget via BPE, Two-Occurrence Correction Learner, Project-Verified Spoken-ID Normalization).
- `schema/global.sql` (`vocabulary`, `settings`), `IMPLEMENTATION_TASKS.md` (`Task 157`–`Task 158`).
- Post-task invariant: `@ef-harness/dictation` packages `gpt2.tiktoken` into `dist/`, wires `stt` with `vocabulary` + `GlobalBrokerDb` + GPU/Whisper governor arbitration, and exports cleanly.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C62` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 157` (`task/157-local-whisper-dictation-engine` @ `6ebcdcd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-157-local-whisper-dictation-engine`, roots `packages/dictation/src/stt, packages/dictation/tests/stt`): unmerged — run `git merge --no-ff task/157-local-whisper-dictation-engine -m "integrate: Task 157 local-whisper-dictation-engine"`.
- Unit `Task 158` (`task/158-dictation-vocabulary-normalizer` @ `1dd0dda`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-158-dictation-vocabulary-normalizer`, roots `packages/dictation/src/vocabulary, packages/dictation/tests/vocabulary`): unmerged — run `git merge --no-ff task/158-dictation-vocabulary-normalizer -m "integrate: Task 158 dictation-vocabulary-normalizer"`.
- Sequence note: Merge `task/157-local-whisper-dictation-engine` (`6ebcdcd`) then `task/158-dictation-vocabulary-normalizer` (`1dd0dda`) (`git merge --no-ff`) onto `harness/integration` (C62 child).

Freeze.
- `packages/dictation/package.json` `build` script runs `tsc -p tsconfig.json && node -e "...copy src/vocabulary/gpt2.tiktoken -> dist/vocabulary/gpt2.tiktoken..."` so `import('./packages/dictation/dist/index.js')` resolves `gpt2.tiktoken` with zero `ENOENT`.
- `LocalWhisperSttEngine` (`157`) queries `WhisperInitialPromptBuilder`, `TwoOccurrenceCorrectionLearner`, and `ProjectVerifiedSpokenIdNormalizer` (`158`), persisting learned terms in `GlobalBrokerDb` (`014` `global.db.vocabulary` + `settings`, deleting `MemoryGlobalDbVocabularyDriver`).
- `packages/dictation/src/index.ts` exports both `stt` (`157`) and `vocabulary` (`158`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-069`: Add `@ef-harness/{db,sandbox,governor,shared-observability}` (plus daemon downloader adapter port compatible with `132` `SignedComponentDownloader`) to `packages/dictation/package.json`.
2. `F-069`: Adapt `LocalWhisperSttEngine.start` (`stt/whisper-engine.ts:186-210`) from TitleCase `'Red'` (`'RED'` canonical), `gpu.acquireInteractive()` -> `GpuWhisperPriorityArbiter.activateDictation`/`deactivateDictation` (`118`), `components.resolveWhisperComponent` -> `SignedComponentDownloader` (`132`), and `jobs.superviseWhisper` -> `WindowsJobObjectManager` (`040`).
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-069`: Fix missing `gpt2.tiktoken` copy in `packages/dictation/package.json` build pipeline (which caused `ENOENT` at runtime from `dist/vocabulary/whisper-bpe.js`).

Shared files.
- Integration-owned shared surfaces: `packages/dictation/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/dictation/src/index.ts`, `packages/dictation/src/stt/**`, `packages/dictation/src/vocabulary/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow `LocalWhisperSttEngine` to ignore `PressureHysteresisStateMachine` `'RED'` pressure.
- Do not write BPE/vocabulary entries to RAM-only maps when `GlobalBrokerDb` is supplied.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `node -e "import('./packages/dictation/dist/index.js')" && pnpm --filter @ef-harness/dictation test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Compiled `dist/vocabulary/whisper-bpe.js` loads `gpt2.tiktoken` cleanly and `LocalWhisperSttEngine` invokes `WhisperInitialPromptBuilder` + `TwoOccurrenceCorrectionLearner` + `GlobalBrokerDb`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C64` (`SingleComposerView`) and `apps/daemon` dictation IPC handlers rely on `LocalWhisperSttEngine` and `ProjectVerifiedSpokenIdNormalizer` from `@ef-harness/dictation`.

Stop.
- Commit merges and `integrate: wire dictation stt/vocabulary` with `EF_HARNESS_MAINTAINER=1`; halt if built `dist/index.js` fails `gpt2.tiktoken` load.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C64 — Architecture Canvas (`@xyflow/react`+`elkjs`), 14-type Popovers, and Single Composer persist `state.db.canvas_layout` via `ShellLayoutContext` and dictation IPC.

Architecture.
- `interactive-architecture.md` (4-Level Semantic Zoom Canvas, `ELK.js` Layout Preservation, 14-Type Popovers, Multi-Box Selection, Single Unified Composer).
- `database-design.md`, `dictation-and-canvas.mmd`, `IMPLEMENTATION_TASKS.md` (`Task 153`–`Task 155`).
- Post-task invariant: Architecture Canvas (`@xyflow/react`+`elkjs`), 14-type Popovers, and Single Composer persist `state.db.canvas_layout` via `ShellLayoutContext` and dictation IPC.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C63` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 153` (`task/153-interactive-architecture-canvas` @ `f38da6d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-153-interactive-architecture-canvas`, roots `apps/renderer/src/canvas, apps/renderer/tests/canvas-graph`): unmerged — run `git merge --no-ff task/153-interactive-architecture-canvas -m "integrate: Task 153 interactive-architecture-canvas"`.
- Unit `Task 154` (`task/154-canvas-popovers-multiselection` @ `cb0b77d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-154-canvas-popovers-multiselection`, roots `apps/renderer/src/canvas, apps/renderer/tests/canvas-popovers`): unmerged — run `git merge --no-ff task/154-canvas-popovers-multiselection -m "integrate: Task 154 canvas-popovers-multiselection"`.
- Unit `Task 155` (`task/155-single-composer-state-machine` @ `8405651`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-155-single-composer-state-machine`, roots `apps/renderer/src/composer, apps/renderer/tests/composer`): unmerged — run `git merge --no-ff task/155-single-composer-state-machine -m "integrate: Task 155 single-composer-state-machine"`.
- Sequence note: Merge `task/153-interactive-architecture-canvas` (`f38da6d`), `task/154-canvas-popovers-multiselection` (`cb0b77d`), and `task/155-single-composer-state-machine` (`8405651`) (`git merge --no-ff`) in order `153 -> 154 -> 155` onto `harness/integration` (C63 child).

Freeze.
- `apps/renderer/package.json` declares `"@xyflow/react"` and `"elkjs"` in `dependencies`.
- `ProjectStateDb` (`packages/db` `MigrationRunner` v2) includes `canvas_layout (node_id TEXT PRIMARY KEY, view_level TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, pinned_by_user INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)` exposed via `apps/daemon` (`066`) IPC to `SavedNodePositionStore` (`153`).
- `CanvasSelectionContext` (`153`) -> `MultiBoxSelectionController` + `NodeTypePopoverRegistry` (`154`) -> `ComposerTargetStateMachine` (`155`) -> `ShellLayoutContext.readCanvas`/`writeCanvas` (`122`), with `155` microphone toggle wired over `apps/daemon` IPC to `@ef-harness/dictation` (`157–158`) and `169` Brownfield layer filter tabs.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-067`, `F-068`: Add `@xyflow/react` + `elkjs` to `apps/renderer/package.json` (and `@ef-harness/dictation` to `apps/daemon/package.json`), wire `SavedNodePositionStore` (`153`) over preload IPC to `state.db.canvas_layout`, and delete `MemoryCanvasLayoutPersistence`/`MemoryShellLayoutContext` defaults (`canvas/graph/local-ports.ts:18-120`).
2. `F-068`: Bind `153` selection -> `154` popovers -> `155` `ComposerTargetStateMachine` + `113` `InputStartFocusSnapshot` inside `122` `SingleAppShell`.

Local defects.
- `F-068`: Verify `MultiBoxSelectionController` respects sealed-oracle non-leak policy and clears cleanly on zoom transitions.

Shared files.
- Integration-owned shared surfaces: `apps/renderer/package.json`, `apps/daemon/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `apps/renderer/src/canvas/{graph,popovers}/**`, `apps/renderer/src/composer/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not allow selecting Canvas boxes to answer open Inbox questions automatically.
- Do not lose `pinned_by_user` Canvas coordinates across daemon/renderer restarts.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/renderer test -- canvas-graph canvas-popovers composer` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `state.db.canvas_layout` persists pinned coordinates across restart, `@xyflow/react` + `elkjs` resolve in `apps/renderer`, and Canvas/Popover selection updates `ComposerTargetStateMachine`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C65` (`intents`, `tabs`) and `C66` (`point-to-fix`) rely on `CanvasSelectionContext`, `MultiBoxSelectionController`, `PostSendChangeHighlighter`, and `ComposerTargetStateMachine`.

Stop.
- Commit merges and `integrate: wire canvas/popovers/composer` with `EF_HARNESS_MAINTAINER=1`; halt if `ShellLayoutContext` lacks `readCanvas`/`writeCanvas`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C65 — `apps/renderer/src/canvas/{intents,tabs}` drops all illegal `node:sqlite`/`node:fs`/`node:crypto` imports and delegates impact/spec/plan queries and intents to `apps/daemon` IPC.

Architecture.
- `security-and-governance.md` & `desktop-app.md` (Zero Node Built-Ins Inside Sandboxed `apps/renderer`), `interactive-architecture.md` (Box-Chat Intents, Impact Walk, `PostSendChangeHighlighter`, Spec/Matrix/Plan/Runtime Tabs).
- `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Task 156`, `Task 159`).
- Post-task invariant: `apps/renderer/src/canvas/{intents,tabs}` drops all illegal `node:sqlite`/`node:fs`/`node:crypto` imports and delegates impact/spec/plan queries and intents to `apps/daemon` IPC.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C64` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 156` (`task/156-canvas-box-chat-intents` @ `2c03735`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-156-canvas-box-chat-intents`, roots `apps/renderer/src/canvas, apps/renderer/tests/canvas-intents`): unmerged — run `git merge --no-ff task/156-canvas-box-chat-intents -m "integrate: Task 156 canvas-box-chat-intents"`.
- Unit `Task 159` (`task/159-spec-browser-plan-tree-tabs` @ `cd7bfd6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-159-spec-browser-plan-tree-tabs`, roots `apps/renderer/src/canvas, apps/renderer/tests/canvas-tabs`): unmerged — run `git merge --no-ff task/159-spec-browser-plan-tree-tabs -m "integrate: Task 159 spec-browser-plan-tree-tabs"`.
- Sequence note: Merge `task/156-canvas-box-chat-intents` (`2c03735`) then `task/159-spec-browser-plan-tree-tabs` (`cd7bfd6`) (`git merge --no-ff`) onto `harness/integration` (C64 child).

Freeze.
- `apps/renderer/src/canvas/intents/**` and `apps/renderer/src/canvas/tabs/**` contain ZERO `node:sqlite`, `node:fs`, or `node:crypto` imports.
- `apps/daemon` (`066`) serves Canvas intent-impact walks and Spec/Matrix/Plan/Runtime queries/mutations over `shared-contracts` RPC backed by `@ef-harness/db` (`014`–`023`), `@ef-harness/spec-expansion` (`079`–`080`), `@ef-harness/planner` (`087, 108`), and `@ef-harness/steering`.
- `BoxChatIntentController` (`156`) binds to `ComposerTargetStateMachine` (`155`) + `InputStartFocusSnapshot` (`113`), triggers `PostSendChangeHighlighter` (`154`), and routes intents over IPC to `PremiseSupersessionReopener` (`071`), `HybridRevisionEngine` (`087`), `AskOwnerResponderEngine` (`102`), `RevisionAutoStartPolicy` (`108`), `FeatureUndoEngine` (`129`), and `DictationVocabularyManager` (`158`), deleting all 9 `Local*` stand-ins.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-067`: Move `IntentGraph` queries (`apps/renderer/src/canvas/intents/graph.ts`, rewriting queries onto canonical `schema/state.sql` `nodes`/`edges`/`names` rather than fabricated 20-column `sql.ts`) and `CanonicalStateDb` projections (`tabs/state-db.ts`) into `apps/daemon/src/canvas/**` behind typed IPC methods.
2. `F-068`: Remove duplicate `draft`/`cursor`/`locks` state from `BoxChatIntentController` (`controller.ts:56-149`), delegating draft/target state solely to `ComposerTargetStateMachine` (`155`).
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-067`: Delete `INTENT_GRAPH_SCHEMA_SQL` (`canvas/intents/sql.ts:32-115`) and the 8th divergent `ef_search_text` UDF (`canvas/tabs/state-db.ts:93-122`).

Shared files.
- Integration-owned shared surfaces: `apps/daemon/src/**`, `apps/renderer/src/canvas/intents/**`, `apps/renderer/src/canvas/tabs/**`, `packages/shared-contracts/src/packets/rpc.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not leave any `node:sqlite`, `node:fs`, or `node:crypto` import anywhere inside `apps/renderer/src/canvas/**`.
- Do not allow `Cancel` on `ZeroTokenImpactPreviewModal` to mutate `state.db`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/renderer test -- canvas-intents canvas-tabs composer` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `rg "node:(sqlite|fs|crypto)" apps/renderer/src/canvas` returns `0` matches, and `BoxChatIntentController` + `Spec/Plan Tabs` round-trip over `apps/daemon` IPC.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C69` (`m5-exit-gate`) relies on sandbox-clean `canvas/{graph,popovers,intents,tabs}` and `composer`.

Stop.
- Commit merges and `integrate: wire daemon-backed canvas intents/tabs` with `EF_HARNESS_MAINTAINER=1`; halt if any `node:` built-in remains in `apps/renderer/src/canvas`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C66 — `LivePreviewDaemonRunner` (`160`) supervises real `WorktreeSlotPool` + `WindowsJobObjectManager` servers, `P0.8` installs `DevOnlyJsxSourceTagPlugin`, and `VisualSteerRouter` (`161`) runs daemon-side.

Architecture.
- `ui-design-system.md` (Isolated Preview Webview, Ephemeral App Server Supervision, Dev-Only `data-ef-source`, `Point-to-Fix`, Before/After Baseline Approver).
- `prompt-contracts.md` (`visual-steer@1`), `security-and-governance.md`, `IMPLEMENTATION_TASKS.md` (`Task 160`–`Task 161`).
- Post-task invariant: `LivePreviewDaemonRunner` (`160`) supervises real `WorktreeSlotPool` + `WindowsJobObjectManager` servers, `P0.8` installs `DevOnlyJsxSourceTagPlugin`, and `VisualSteerRouter` (`161`) runs daemon-side.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C65` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 160` (`task/160-live-app-preview-runner` @ `82213b1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-160-live-app-preview-runner`, roots `apps/daemon/src/preview, apps/daemon/tests/preview, apps/renderer/src/preview, apps/renderer/tests/preview-host`): unmerged — run `git merge --no-ff task/160-live-app-preview-runner -m "integrate: Task 160 live-app-preview-runner"`.
- Unit `Task 161` (`task/161-jsx-source-plugin-point-to-fix` @ `58a5508`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-161-jsx-source-plugin-point-to-fix`, roots `apps/renderer/src/preview, apps/renderer/tests/preview-point-to-fix, packages/planner/src/jsx-source-plugin, packages/planner/tests/jsx-source-plugin`): unmerged — run `git merge --no-ff task/161-jsx-source-plugin-point-to-fix -m "integrate: Task 161 jsx-source-plugin-point-to-fix"`.
- Sequence note: Merge `task/160-live-app-preview-runner` (`82213b1`) then `task/161-jsx-source-plugin-point-to-fix` (`58a5508`) (`git merge --no-ff`) onto `harness/integration` (C65 child).

Freeze.
- `createLivePreviewDaemonRunner` (`apps/daemon/src/preview/create-runner.ts`) uses real `GlobalBrokerDb.port_leases` (`014`), `WorktreeSlotPool` (`038`), `WindowsJobObjectManager` (`040`), `TestEnvOrchestrator` (`050`), `TemplateDbManager` (`052`), `ProjectMergeQueue` (`111`), and `RuntimeOnlyEnvInjector` (`120`).
- `DevOnlyJsxSourceTagPlugin` (`161`) is exported from `packages/planner/src/index.ts` and installed during `Phase0ExecutionController` `P0.8` (`093`).
- `validateEfSourceInWorkspace` in `apps/renderer/src/preview/point-to-fix/source-path.ts` uses pure POSIX normalization (ZERO `node:path`), while `realpath` containment, `VisualSteerRouter` (`visual-steer@1` `009` + `CodeIndexDb` `167`), and `BeforeAfterBaselineApprover` (`CasBlobStore` `028`, `UiPlaywrightContractVerifier` `057`) execute in `apps/daemon` over IPC bound to `155` & `160`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-070`: Replace all 7 `Local*` mock ports in `apps/daemon/src/preview/create-runner.ts:31-69` and delete `local-job-supervisor.ts` (`readonly killOnJobClose = true as const` fake).
2. `F-042`, `F-070`: Export `DevOnlyJsxSourceTagPlugin` from `packages/planner/src/index.ts`, invoke it in `packages/planner/src/phase0/**` (`P0.8`), and route `VisualSteerRouter` (`161`) via `apps/daemon` -> `ModelProtocolAdapter` (`visual-steer@1`) + `CodeIndexDb` (`167`).
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-070`: Delete `import path from 'node:path'` in `apps/renderer/src/preview/point-to-fix/source-path.ts:1` and replace hardcoded 3-regex / `'src/unknown/Unknown.tsx'` stubs in `visual-steer-router.ts:10-97` with `visual-steer@1` daemon routing.

Shared files.
- Integration-owned shared surfaces: `packages/planner/src/index.ts`, `packages/planner/src/phase0/**`, `apps/daemon/package.json`, `apps/daemon/src/preview/**`, `apps/renderer/src/preview/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit `data-ef-source` attributes in production builds (`NODE_ENV === 'production'`).
- Do not allow `import ... from 'node:path'` inside `apps/renderer/src/preview/**`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/planner test -- jsx-source-plugin phase0 && pnpm --filter @ef-harness/daemon test -- preview && pnpm --filter @ef-harness/renderer test -- preview-host preview-point-to-fix` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `LivePreviewDaemonRunner` allocates real `port_leases` + `WorktreeSlotPool` + `WindowsJobObjectManager`, `P0.8` installs `DevOnlyJsxSourceTagPlugin`, and Point-to-Fix routes via daemon `visual-steer@1`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C69` (`174` & `175`) relies on `BeforeAfterBaselineApprover` and sandboxed `preview`.

Stop.
- Commit merges and `integrate: wire preview runner + point-to-fix` with `EF_HARNESS_MAINTAINER=1`; halt if `node:` imports remain in `apps/renderer/src/preview`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C67 — `OfficePixiViewport` (`162`) and `OfficeCastProjector` (`163`) render browser-safe `pixi.js` tiles/sprites over unified 11 canonical kebab-case `ROOM_IDS` and `floorplan-v1.tmj` `deskAnchors`.

Architecture.
- `office-view.md` (PixiJS 2D Floor Plan Renderer, Cozy Sprites, 11 Canonical Rooms, Seated Cast Projection, Status Tags, Flow Bubbles), `cockpit-and-office.mmd`.
- `security-and-governance.md` (Sandboxed Renderer Assets Without `node:fs`), `IMPLEMENTATION_TASKS.md` (`Task 162`–`Task 163`).
- Post-task invariant: `OfficePixiViewport` (`162`) and `OfficeCastProjector` (`163`) render browser-safe `pixi.js` tiles/sprites over unified 11 canonical kebab-case `ROOM_IDS` and `floorplan-v1.tmj` `deskAnchors`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C66` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 162` (`task/162-office-pixijs-floor-sprites` @ `73d1bd4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floor-sprites`, roots `apps/renderer/assets/office, apps/renderer/src/office, apps/renderer/tests/office-renderer`): unmerged — run `git merge --no-ff task/162-office-pixijs-floor-sprites -m "integrate: Task 162 office-pixijs-floor-sprites"`.
- Unit `Task 163` (`task/163-office-seated-cast-tags-flows` @ `e70dc27`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-163-office-seated-cast-tags-flows`, roots `apps/renderer/src/office, apps/renderer/tests/office-cast`): unmerged — run `git merge --no-ff task/163-office-seated-cast-tags-flows -m "integrate: Task 163 office-seated-cast-tags-flows"`.
- Sequence note: Merge `task/162-office-pixijs-floor-sprites` (`73d1bd4`) then `task/163-office-seated-cast-tags-flows` (`e70dc27`) (`git merge --no-ff`) onto `harness/integration` (C66 child); keep empty initial `task-162` branch excluded per `## Exclusions`.

Freeze.
- `apps/renderer/package.json` declares `"pixi.js"` in `dependencies` and its `build` script copies `assets/office/**` into `dist/assets/office/**`.
- `TiledFloorPlanLoader` and `CozyPixelSpriteAtlasEngine` (`apps/renderer/src/office/renderer/**`) load assets via browser-safe URL/`fetch`/buffer injection with ZERO `node:fs`, `node:path`, or `node:url` imports in `apps/renderer/src/office/**`.
- `OfficeRoomId` is canonically frozen across `office/{renderer,cast}` to the 11 kebab-case `ROOM_IDS` from `162` (`'ceo-office'`, `'front-desk'`, `'discovery-lounge'`, `'research-library'`, `'architecture-studio'`, `'planning-war-room'`, `'engineering-bullpen'`, `'qa-verification-lab'`, `'integration-merge-bay'`, `'shipping-dock'`, `'break-room'`), and `OfficeCastProjector` (`163`) uses `LoadedFloorPlan.deskAnchors` instead of hardcoded `ROOM_ORIGIN`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-071`: Add `"pixi.js"` + `assets/office` dist copy step to `apps/renderer/package.json`, removing `node:fs`/`node:path`/`node:url` from `apps/renderer/src/office/renderer/{asset-paths,tiled-floor-plan-loader,cozy-pixel-sprite-atlas-engine}.ts`.
2. `F-072`: Update `apps/renderer/src/office/cast/rooms.ts:4-16,59` and `office-cast-projector.ts:104,136-139` from `'qa-lab'` to canonical `'qa-verification-lab'` + all 11 `ROOM_IDS`, passing `LoadedFloorPlan` (`162`) desk/room anchors into `OfficeCastProjector`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-071`: Fix `OfficePixiViewport.bootstrap` (`apps/renderer/src/office/renderer/office-pixi-viewport.ts:17-20,74-111`) hardcoding `800 x 600` (use `options.width` / `options.height`) and leaving `this.world` empty (mount layered tile, prop, character, badge, and label PixiJS display objects).

Shared files.
- Integration-owned shared surfaces: `apps/renderer/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `apps/renderer/src/office/renderer/**`, `apps/renderer/src/office/cast/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not merge `task/162-office-pixijs-floorplan-sprites` (`6497730`) — it is superseded by `73d1bd4`.
- Do not import `node:fs`, `node:path`, or `node:url` anywhere inside `apps/renderer/src/office/**` or reintroduce `'qa-lab'`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/renderer test -- office-renderer office-cast` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `rg "node:(fs|path|url)" apps/renderer/src/office` returns `0` matches, `OfficePixiViewport` honors arbitrary `options.width x options.height`, and `OfficeCastProjector` places seated cast strictly on `LoadedFloorPlan` anchors across all 11 `ROOM_IDS`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C68` (`164–165`) relies on canonical 11 `ROOM_IDS`, `LoadedFloorPlan`, `OfficePixiViewport`, and `OfficeCastProjector`.

Stop.
- Commit merges and `integrate: wire office renderer/cast` with `EF_HARNESS_MAINTAINER=1`; halt if `pixi.js` version conflicts or any `node:` import remains.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C68 — `TruthfulAnimationDirector` (`164`) and `OfficeAccessibility` (`165`) integrate cleanly with `LoadedFloorPlan`, `OfficeCastProjector`, `118` Pressure, and `122–127` Cockpit inside `SingleAppShell`.

Architecture.
- `office-view.md` (A* Walkable Pathfinding, `ORANGE` Auto Board Fallback, Reduced-Motion & Static Override, 11-Room Semantic Screen-Reader Mirror, Click -> Inspector/Inbox Selection), `cockpit-and-office.mmd`.
- `app-shell-and-governor.md` (`ORANGE | RED` Pressure Policy), `IMPLEMENTATION_TASKS.md` (`Task 164`–`Task 165`).
- Post-task invariant: `TruthfulAnimationDirector` (`164`) and `OfficeAccessibility` (`165`) integrate cleanly with `LoadedFloorPlan`, `OfficeCastProjector`, `118` Pressure, and `122–127` Cockpit inside `SingleAppShell`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C67` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 164` (`task/164-office-animation-director-v2` @ `0272a00`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-v2`, roots `apps/renderer/src/office, apps/renderer/tests/office-director`): unmerged — run `git merge --no-ff task/164-office-animation-director-v2 -m "integrate: Task 164 office-animation-director-v2"`.
- Unit `Task 165` (`task/165-office-accessibility-auto-fallback` @ `c3401c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-165-office-accessibility-auto-fallback`, roots `apps/renderer/src/office, apps/renderer/tests/office-a11y`): unmerged — run `git merge --no-ff task/165-office-accessibility-auto-fallback -m "integrate: Task 165 office-accessibility-auto-fallback"`.
- Sequence note: Merge `task/164-office-animation-director-v2` (`0272a00`) then `task/165-office-accessibility-auto-fallback` (`c3401c3`) (`git merge --no-ff`) onto `harness/integration` (C67 child); keep empty initial `task-164` branch excluded per `## Exclusions`.

Freeze.
- `LoadedFloorPlan` (`162`) adapts cleanly to `WalkableGridPort` (`164`, deriving room doorways/walkable cells from `floorplan-v1.tmj` rather than `createSyntheticOfficeWalkableGrid()`), and `OfficeCastProjector` (`163`) adapts cleanly to `OfficeCastProjectorPort` (`164`).
- `OfficeSemanticMirrorTree` (`apps/renderer/src/office/a11y/types.ts`) covers all 11 canonical kebab-case `ROOM_IDS` (replacing 6 snake_case IDs like `'qa_lab'`/`'merge_bay'`) + priority-flagged group in logical Tab order.
- `OrangePressureAutoBoardFallback` (`165`) forces `director.setMotionEnabled(false)` when `userOverrodeOrangeFallback` is active under `'ORANGE' | 'RED'`, binds to `PressureHysteresisStateMachine` (`.pressure`, `.subscribe`), and unified `OfficeView` mounts in `apps/renderer/src/index.ts` (`122`) wired to `123–127`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-072`: Build thin adapter bridges connecting `TiledFloorPlanLoader` (`162`) -> `WalkableGridPort` (`164`) and `OfficeCastProjector.project(...)` (`163`) -> `OfficeCastProjectorPort` (`164`).
2. `F-072`: Replace snake_case `OFFICE_LOGICAL_TAB_ROOMS` in `apps/renderer/src/office/a11y/types.ts:1-21` with all 11 kebab-case `ROOM_IDS`, adapt `PressureMachinePort` (`165`) to `PressureHysteresisStateMachine` (`118` in `C46`), and export unified `OfficeView` from `apps/renderer/src/index.ts` wired to `122–127`.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-072`: Fix `OrangePressureAutoBoardFallback.setUserOverride(true)` (`apps/renderer/src/office/a11y/orange-pressure-auto-board-fallback.ts:56-63`) calling `this.pixi.start()` under `ORANGE`/`RED` without enforcing `director.setMotionEnabled(false)`.

Shared files.
- Integration-owned shared surfaces: `apps/renderer/src/index.ts`, `apps/renderer/src/office/director/**`, `apps/renderer/src/office/a11y/**`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not merge `task/164-office-animation-director-astar` (`6497730`) — it is superseded by `0272a00`.
- Do not allow animated walk cycles during `'ORANGE'` override or omit any of the 11 rooms from `OfficeSemanticMirrorTree`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/renderer test -- office-renderer office-cast office-director office-a11y` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: All 4 Office suites operate end-to-end against real `floorplan-v1.tmj`, `OfficeSemanticMirrorTree` exposes all 11 canonical rooms, and `ORANGE` user override forces `director.setMotionEnabled(false)`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C69` (`m5-exit-gate`) relies on unified mounted `OfficeView` and all 11 canonical `ROOM_IDS`.

Stop.
- Commit merges and `integrate: wire office director/a11y + renderer shell` with `EF_HARNESS_MAINTAINER=1`; halt if any room ID mismatches `C67`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C69 — `UiConsistencyPipeline` (`174`) drives active Playwright/`axe-core`/CAS checks across canonical `ProjectKind`, and M5 Exit Gate (`175`) certifies real M5 packages end-to-end.

Architecture.
- `ui-design-system.md` (Verifying UI Consistency, 6-Stage Pipeline, `375/768/1440` Viewports, `axe-core` AA Contrast, Touch Targets), `roadmap.md` (Milestone 5 Exit Gate — Brownfield + UX `resume-changer`).
- `resume-changer-benchmark.json`, `IMPLEMENTATION_TASKS.md` (`Task 174`–`Task 175`).
- Post-task invariant: `UiConsistencyPipeline` (`174`) drives active Playwright/`axe-core`/CAS checks across canonical `ProjectKind`, and M5 Exit Gate (`175`) certifies real M5 packages end-to-end.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C68` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 174` (`task/174-ui-consistency-pipeline` @ `a885fb8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-174-ui-consistency-pipeline`, roots `packages/integrator/src/ui-checks, packages/integrator/tests/ui-checks`): unmerged — run `git merge --no-ff task/174-ui-consistency-pipeline -m "integrate: Task 174 ui-consistency-pipeline"`.
- Unit `Task 175` (`task/175-m5-exit-gate` @ `14d3964`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-175-m5-exit-gate`, roots `benchmarks/m5-resume-changer/fixture.json, tests/e2e/m5-exit-gate, tests/e2e/tests`): unmerged — run `git merge --no-ff task/175-m5-exit-gate -m "integrate: Task 175 m5-exit-gate"`.
- Sequence note: Merge `task/174-ui-consistency-pipeline` (`a885fb8`) then `task/175-m5-exit-gate` (`14d3964`) (`git merge --no-ff`) onto `harness/integration` (C68 child).

Freeze.
- `UiConsistencyPipeline` (`packages/integrator/src/ui-checks/ui-consistency-pipeline.ts`, exported from `@ef-harness/integrator`) triggers for `'web_saas' | 'web_static' | 'desktop_electron' | 'mobile_web'` (`hasUiSignals` canonical `ProjectKind`, not `'ui'` only) and runs active `UiPlaywrightContractVerifier` (`057`), `DesignTokenLintRuleset` (`094`), `BrandAssetRegistry` (`099`), `CompletenessGateRunner` (`054`), `AdvisoryTasteVisionReviewer` (`102`), `BeforeAfterBaselineApprover` (`161`), and `CasBlobStore` (`028`, deleting 1x1 pixel `InMemoryCasStore`).
- `tests/e2e/m5-exit-gate/**` uses `.js` import specifiers compiled by `tests/e2e/tsconfig.json`, and exercises real `@ef-harness/{brownfield,dictation,renderer,integrator,daemon,db}` against `resume-changer-benchmark.json` and real SQLite `state.db` + `code-index.db`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-052`: Replace `LocalStaticAuditGate`, `LocalDesignTokenLint`, `LocalBrandAssetRegistry`, `MemoryBeforeAfterBaseline`, and `LocalTasteReviewer` (`packages/integrator/src/ui-checks/local-ports.ts:5-61`) with real `054, 094, 099, 161, 102, 057, 028` imports, and export `ui-checks` from `packages/integrator/src/index.ts`.
2. `F-075`: Add `@ef-harness/{brownfield,dictation}` (plus `integrator, daemon, renderer, db`) to `tests/e2e/package.json` + `tests/e2e/tsconfig.json`, include `m5-exit-gate/**/*.ts`, and replace toy stand-ins (`m5-exit-gate/{brownfield,office,ux}.ts`, regex `CodeIndexDatabase` stub, `.git/HEAD`-only `runLiveCertification`) with real package calls.
3. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-052`: Fix `hasUiSignals` (`ui-consistency-pipeline.ts:27-30`) skipping `'web_saas'` / `'web_static'` and Stages 3–6 passing vacuously without launching `UiPlaywrightContractVerifier`.
- `F-075`: Convert all `.ts` relative imports in `tests/e2e/m5-exit-gate/*.ts` to `.js`.

Shared files.
- Integration-owned shared surfaces: `packages/integrator/src/index.ts`, `packages/integrator/src/ui-checks/**`, `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/m5-exit-gate/**`, `pnpm-lock.yaml` (single `pnpm install`).
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not return `'not_applicable_no_ui'` on `'web_saas'` or store 1x1 red dummy pixels in place of real Playwright screenshots.
- Do not check `schema.includes('CREATE TABLE symbols')` without opening a real SQLite `CodeIndexDb`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test && node schema/schema-test.js` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/integrator test -- ui-checks && pnpm --filter @ef-harness/e2e test -- m5-exit-gate` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `UiConsistencyPipeline` captures real multi-width `UiPlaywrightContractVerifier` results in `CasBlobStore`, and `m5-exit-gate` drives real M5 packages against `resume-changer`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream Wave 7 (`ship-deploy`, `investigations`, `portability`, `meta-lab`, `packaging`, `m6-release`) builds on certified M0–M5.

Stop.
- Commit merges and `integrate: wire ui-checks + m5-exit-gate` with `EF_HARNESS_MAINTAINER=1`; halt if Playwright or real M5 E2E assertions fail.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C70 — `ExternalEffectLedger` enforces live `StopCoordinator` + `writer_epoch` fencing via `EffectsRepo`, `GitHubRateAwareQueue` persists in `GlobalBrokerDb`, and CI case-repair preserves nested paths.

Architecture.
- `ship-and-deploy.md` (External Effect Ledger, Write-Ahead Dispatch, Production Approval Binding, GitHub Rate-Aware Queue, Bounded CI Repair Loop, Linux Case-Sensitivity Repair).
- `database-design.md`, `schema/state.sql` (`effects`, `ship_runs`), `prompt-contracts.md` (`ci-triage@1`), `IMPLEMENTATION_TASKS.md` (`Task 176`–`Task 178`).
- Post-task invariant: `ExternalEffectLedger` enforces live `StopCoordinator` + `writer_epoch` fencing via `EffectsRepo`, `GitHubRateAwareQueue` persists in `GlobalBrokerDb`, and CI case-repair preserves nested paths.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C69` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 176` (`task/176-external-effect-ledger` @ `7b46817`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-176-external-effect-ledger`, roots `packages/ship-deploy/src/effects, packages/ship-deploy/tests/effects`): unmerged — run `git merge --no-ff task/176-external-effect-ledger -m "integrate: Task 176 external-effect-ledger"`.
- Unit `Task 177` (`task/177-github-connector-queue` @ `b32f60e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-177-github-connector-queue`, roots `packages/ship-deploy/src/github, packages/ship-deploy/tests/github`): unmerged — run `git merge --no-ff task/177-github-connector-queue -m "integrate: Task 177 github-connector-queue"`.
- Unit `Task 178` (`task/178-push-pr-ci-repair` @ `3dcb870`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-178-push-pr-ci-repair`, roots `packages/ship-deploy/src/ci-loop, packages/ship-deploy/tests/ci-loop`): unmerged — run `git merge --no-ff task/178-push-pr-ci-repair -m "integrate: Task 178 push-pr-ci-repair"`.
- Sequence note: Merge `task/176-external-effect-ledger` (`7b46817`), `task/177-github-connector-queue` (`b32f60e`), and `task/178-push-pr-ci-repair` (`3dcb870`) (`git merge --no-ff`) in order `176 -> 177 -> 178` onto `harness/integration` (C69 child).

Freeze.
- `ExternalEffectLedger` (`176`) executes over `@ef-harness/db` single-writer `EffectsRepo` (`029`), reading live STOP state from `StopCoordinator`/`kv` (`114`) and `writer_epoch` from `meta` (`187`), deleting private `project_runtime` DDL.
- `GitHubRateAwareQueue` (`177`) persists rate counters in `GlobalBrokerDb` (`014` `global.db.github_rate_state` v2 migration, never process-local `sharedQueues` `Map`), and `BoundedCiRepairLoop` (`178`) persists `ship_runs` via `ProjectStateDb` (`state.db.ship_runs`).
- `LinuxCaseSensitivityAutoRepair` (`178`) rewrites mismatched case imports using `path.posix.relative(path.posix.dirname(importerFile), trackedPath)` preserving intermediate directories and `..` prefixes.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-077`: Add `@ef-harness/{shared-observability,db,git-engine,verifier,integrator,governor}` to `packages/ship-deploy/package.json`.
2. delete duplicate `canonical-hash.ts`/`redactor.ts` (`176, 178`) in favor of `007` `canonicalJson` and `011` `StreamingRedactor`.
3. wire `176 -> 177 -> 178`, `MinGit` + `SafetyScanner` (`035–036`), `CiTriageV1Schema` (`009`), and `LandingSummaryGenerator` (`101`).

Local defects.
- `F-076`: Remove `project_runtime` table creation in `packages/ship-deploy/src/effects/store.ts:19-25,140-145` so `StopCoordinator` + `writer_epoch` genuinely fence dispatches.
- `F-076`: Fix `rewriteImportLine` in `packages/ship-deploy/src/ci-loop/linux-case-sensitivity-auto-repair.ts:36-47,69` turning `'./Components/Header'` or `'../utils/DateFormat'` into `'./header'` / `'./dateFormat'`.

Shared files.
- Integration-owned shared surfaces: `packages/ship-deploy/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/ship-deploy/src/{effects,github,ci-loop}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not allow `ExternalEffectLedger` to auto-retry `unknown_outcome` effects or embed Git tokens inside remote URLs.
- Do not store `ship_runs` or GitHub rate-limit quotas in volatile memory maps.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/ship-deploy test -- effects github ci-loop` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `STOP` in `StopCoordinator` or bumped `writer_epoch` in `meta` blocks `ExternalEffectLedger`, `ship_runs` survives reopen, and `'../utils/DateFormat'` repairs accurately to `'../utils/dateFormat'`.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C71` (`deploy-adapters`, `live-migrations`, `post-deploy`) relies on `ExternalEffectLedger`, `GitHubRateAwareQueue`, and `SqliteShipRunStore`.

Stop.
- Commit merges and `integrate: wire ship-deploy effects/github/ci-loop` with `EF_HARNESS_MAINTAINER=1`; halt if `EffectsRepo` schema conflicts with `C11`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C71 — Deploy adapters (`179`), live expand-contract migrations (`180`), and post-deploy verification (`181`) bind RFC 8785 `{targetEnv, commitSha, envDiff}` hashes and export `@ef-harness/ship-deploy`.

Architecture.
- `ship-and-deploy.md` (Vercel + Docker/SSH Adapters, Expand-Then-Contract Migrations, Post-Deploy Playwright Smoke & Rollback), `open-design-questions.md`.
- `schema/state.sql` (`effects`, `ship_runs`), `IMPLEMENTATION_TASKS.md` (`Task 179`–`Task 181`).
- Post-task invariant: Deploy adapters (`179`), live expand-contract migrations (`180`), and post-deploy verification (`181`) bind RFC 8785 `{targetEnv, commitSha, envDiff}` hashes and export `@ef-harness/ship-deploy`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C70` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 179` (`task/179-deploy-adapter-vercel-docker` @ `1ad270e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-179-deploy-adapter-vercel-docker`, roots `packages/ship-deploy/src/deploy-adapters, packages/ship-deploy/tests/deploy-adapters`): unmerged — run `git merge --no-ff task/179-deploy-adapter-vercel-docker -m "integrate: Task 179 deploy-adapter-vercel-docker"`.
- Unit `Task 180` (`task/180-expand-contract-migrations` @ `d6d7f53`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-180-expand-contract-migrations`, roots `packages/ship-deploy/src/live-migrations, packages/ship-deploy/tests/live-migrations`): unmerged — run `git merge --no-ff task/180-expand-contract-migrations -m "integrate: Task 180 expand-contract-migrations"`.
- Unit `Task 181` (`task/181-post-deploy-verify-rollback` @ `53ef907`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-181-post-deploy-verify-rollback`, roots `packages/ship-deploy/src/post-deploy, packages/ship-deploy/tests/post-deploy`): unmerged — run `git merge --no-ff task/181-post-deploy-verify-rollback -m "integrate: Task 181 post-deploy-verify-rollback"`.
- Sequence note: Merge `task/179-deploy-adapter-vercel-docker` (`1ad270e`), `task/180-expand-contract-migrations` (`d6d7f53`), and `task/181-post-deploy-verify-rollback` (`53ef907`) (`git merge --no-ff`) in order `179 -> 180 -> 181` onto `harness/integration` (C70 child).

Freeze.
- `VercelDeployAdapter` & `DockerOverSshDeployAdapter` (`179`) bind `canonicalPayloadHash = canonicalSha256({ targetEnv, commitSha, envDiff })` (`007`, never bare `commitSha`), inject SSH/API tokens via `WindowsDpapiSecretsVault` (`120`), and gate swaps via `ApprovalCard` (`127`).
- `LiveMigrationOrchestrator` (`180`) dispatches through `ExternalEffectLedger` (`176`) + `ProjectStateDb` (`state.db.ship_runs`), deleting `MigrationStateStore.open` rogue `DatabaseSync` and `MigrationStateStore.record` (`ON CONFLICT(idempotency_key)` `payload_hash` clobber).
- `PostDeployPipeline` (`181`) persists smoke screenshots/receipts in `CasBlobStore` (`028`) + `state.db.ship_runs`, uses `CleanVerifierRunner` (`055`), and `packages/ship-deploy/src/index.ts` exports all 6 submodules wired to `apps/daemon` Ship RPCs.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-076`: Delete `MigrationStateStore.open` and `MigrationStateStore.record` in `packages/ship-deploy/src/live-migrations/state-store.ts:54-72,285-317`, routing migration effect records directly to `176` `ExternalEffectLedger` (throwing `PayloadHashMismatchError` on mismatched `idempotency_key` reuse).
2. `F-077`: Replace `InMemoryCasBlobStore`/`InMemoryPostDeployStore` (`181`) with `028` `CasBlobStore` + `SqliteShipRunStore` (`178`), export `effects, github, ci-loop, deploy-adapters, live-migrations, post-deploy` from `packages/ship-deploy/src/index.ts`, and mount Ship RPCs in `apps/daemon/src/server.ts`.

Local defects.
- `F-077`: Fix `DockerOverSshDeployAdapter.planDeploy` (`packages/ship-deploy/src/deploy-adapters/docker-ssh-adapter.ts:75-81`) passing `canonicalPayloadHash: commitSha` without `envDiff` or `targetEnv`.

Shared files.
- Integration-owned shared surfaces: `packages/ship-deploy/src/index.ts`, `packages/ship-deploy/src/{deploy-adapters,live-migrations,post-deploy}/**`, `apps/daemon/src/server.ts`.
- Lockfile policy: zero `package.json` or `pnpm-lock.yaml` dependency edits required in this wave; preserve all already-landed barrel exports.
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not pass secrets on SSH/Docker command-line `-e KEY=VAL` arguments (keep `0600` stdin-piped env files).
- Do not allow `envDiff` edits to reuse an old `commitSha` approval hash.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/ship-deploy test && pnpm --filter @ef-harness/daemon test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Changing `envDiff` invalidates `DockerOverSshDeployAdapter` approval hash, `MigrationStateStore` rejects mismatched `payload_hash` via `ExternalEffectLedger`, and `packages/ship-deploy` exports all 6 modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C74` (`portability`), `C76` (`192`), and `C79` (`v1.0 release`) rely on all 6 `@ef-harness/ship-deploy` modules.

Stop.
- Commit merges and `integrate: wire ship-deploy barrels/daemon RPCs` with `EF_HARNESS_MAINTAINER=1`; halt if `PayloadHashMismatchError` fails to trigger.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C72 — `MysteryBugPipeline` (`182`) persists `investigations` in `ProjectStateDb` and drives `FlakeSafeGitBisector` (`183`) with non-discarding `125` neighbor probing, `MinGit`, and `finally` resets.

Architecture.
- `investigations-and-sweeps.md` (6-Stage Mystery-Bug Diagnostic Pipeline, Flake-Safe Git Bisector Exit-`125` Handling, `ddmin` Input Shrinker, Symptom-Patch Detector).
- `prompt-contracts.md` (`investigator@1`), `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Task 182`–`Task 183`).
- Post-task invariant: `MysteryBugPipeline` (`182`) persists `investigations` in `ProjectStateDb` and drives `FlakeSafeGitBisector` (`183`) with non-discarding `125` neighbor probing, `MinGit`, and `finally` resets.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C71` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 182` (`task/182-mystery-bug-investigation` @ `e61ea0c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-182-mystery-bug-investigation`, roots `packages/investigations/src/pipeline, packages/investigations/tests/pipeline`): unmerged — run `git merge --no-ff task/182-mystery-bug-investigation -m "integrate: Task 182 mystery-bug-investigation"`.
- Unit `Task 183` (`task/183-investigation-localization-toolkit` @ `1a6730f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-183-investigation-localization-toolkit`, roots `packages/investigations/src/localization, packages/investigations/tests/localization`): unmerged — run `git merge --no-ff task/183-investigation-localization-toolkit -m "integrate: Task 183 investigation-localization-toolkit"`.
- Sequence note: Merge `task/182-mystery-bug-investigation` (`e61ea0c`) then `task/183-investigation-localization-toolkit` (`1a6730f`) (`git merge --no-ff`) onto `harness/integration` (C71 child).

Freeze.
- `ProjectStateDb` (`packages/db` `MigrationRunner` v2) includes `investigations` + `sweep_symbol_maps` tables, backing `SqliteInvestigationStore` (`182`, deleting `:memory:` ad-hoc DDL default).
- `FlakeSafeGitBisector` (`183`) runs git operations exclusively via Hermetic `MinGit` (`035`), restores `badRef` inside `finally`, and on `GIT_BISECT_SKIP_EXIT` (`125`) probes unskipped neighbors around `mid` (`mid - 1`, `mid + 1`, ...) instead of discarding `[low .. mid - 1]`.
- `MysteryBugPipeline` (`182`) invokes `FlakeSafeGitBisector`, `DeltaDebuggingInputShrinker`, and `SymptomPatchDetector` (`183`) alongside `009` (`InvestigatorV1Schema`), `028` (`CasBlobStore`), `038` (`WorktreeSlotPool`), `050`/`055`/`057` (`test-env`/`verifier`), `100` (`BugIntakePipeline`), `167` (`CompactCodeMapQueryService`), and `170` (`BaselineTestHealthRunner`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-079`: Add `@ef-harness/{db,git-engine,sandbox,test-env,verifier,intake,planner,brownfield,integrator,shared-observability}` to `packages/investigations/package.json`.
2. add clean query adapters on `167` (`queryAroundRoutes` or adapt `182` to `CompactCodeMapQueryService`) and `100` (`BugIntakePipeline` symptom cards) plus wire `183` into `182` Stages 3/5.

Local defects.
- `F-078`: Fix `packages/investigations/src/localization/flake-safe-git-bisector.ts:30-52,143-203` (`execFileSync('git', ...)` -> `MinGit` `035`.
- add `try/finally` checkout restore.
- replace `if (exit === 125) { low = mid + 1; continue; }` with bounded neighbor probe around `mid`).
- `F-078`: Replace `:memory:` default `CREATE TABLE investigations` in `packages/investigations/src/pipeline/investigation-store.ts:18-36` with `@ef-harness/db` v2 migration.

Shared files.
- Integration-owned shared surfaces: `packages/investigations/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/db/src/migrations/**`, `packages/investigations/src/{pipeline,localization}/**`, `packages/brownfield/src/l1-codemap/**`, `packages/intake/src/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not allow `FlakeSafeGitBisector` to discard `[low .. mid - 1]` when `commits[mid]` returns exit code `125`.
- Do not leave temp worktree `HEAD` detached after an aborted bisection.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/investigations test -- pipeline localization` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Bisection tests prove that skipping `commits[mid]` (`125`) still localizes culprits in `[low .. mid - 1]` and restores `badRef` on failure, and `investigations` rows persist across `ProjectStateDb` reopen.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C73` (`sweeps`) and `C76` (`194`) rely on `MysteryBugPipeline` and `FlakeSafeGitBisector`.

Stop.
- Commit merges and `integrate: wire investigations pipeline/localization` with `EF_HARNESS_MAINTAINER=1`; halt if `182` upstream adapters fail typecheck.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C73 — `SweepOrchestrator` (`184`) and `PostSweepBriefSymbolUpdater` (`185`) run sandboxed `ts-morph`/`@ast-grep/napi` codemods, use `path_leases` (`'exclusive'`), and update `'READY'`/`'BLOCKED'` briefs.

Architecture.
- `investigations-and-sweeps.md` (Repo-Wide Sweeps, `'intent' -> 'exclusive'` `path_leases`, Sandboxed Deterministic Codemods, Name-Boundary Verification, Post-Sweep Symbol Map Updates).
- `prompt-contracts.md` (`sweep-planner@1`, `sweep-worker@1`), `schema/state.sql` (`path_leases`, `task_states`), `IMPLEMENTATION_TASKS.md` (`Task 184`–`Task 185`).
- Post-task invariant: `SweepOrchestrator` (`184`) and `PostSweepBriefSymbolUpdater` (`185`) run sandboxed `ts-morph`/`@ast-grep/napi` codemods, use `path_leases` (`'exclusive'`), and update `'READY'`/`'BLOCKED'` briefs.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C72` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 184` (`task/184-sweep-ownership-engine` @ `b2e1a1d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-184-sweep-ownership-engine`, roots `packages/investigations/src/sweeps, packages/investigations/tests/sweeps`): unmerged — run `git merge --no-ff task/184-sweep-ownership-engine -m "integrate: Task 184 sweep-ownership-engine"`.
- Unit `Task 185` (`task/185-sweep-safety-guards` @ `afa760f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-185-sweep-safety-guards`, roots `packages/investigations/src/sweep-guards, packages/investigations/tests/sweep-guards`): unmerged — run `git merge --no-ff task/185-sweep-safety-guards -m "integrate: Task 185 sweep-safety-guards"`.
- Sequence note: Merge `task/184-sweep-ownership-engine` (`b2e1a1d`) then `task/185-sweep-safety-guards` (`afa760f`) (`git merge --no-ff`) onto `harness/integration` (C72 child).

Freeze.
- `packages/investigations/package.json` declares `"ts-morph"` and `"@ast-grep/napi"` (plus `jscodeshift` if retained) in `dependencies`, promoting `ts-morph-backend.ts` from `tests/sweeps/` into `src/sweeps/`.
- `DeterministicCodemodRunner` (`184`) executes codemod passes inside `HarnessRunEngine` (`048` OS sandbox) and guarantees zero disk mutations when `step.dryRun === true`.
- `SweepLeaseCoordinator` (`184`) writes `path_leases` (`mode: 'intent' -> 'exclusive'`, never invalid `'granted'`) via `TaskClaimLeasesRepo` (`020`), `PostSweepBriefSymbolUpdater` (`185`) persists `sweep_symbol_maps` in `state.db` and updates canonical uppercase `'READY' | 'BLOCKED'` tasks + `ContextSlicerEngine` (`088`), and `packages/investigations/src/index.ts` exports `pipeline, localization, sweeps, sweep-guards`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-079`: Wire `SweepOrchestrator` (`184`) -> `PersistedNameBoundaryGate` + `PostSweepBriefSymbolUpdater` (`185`) -> `NameRegistryRepo` (`019`), `ContextSlicerEngine` (`088`), `ProjectMergeQueue` (`111`), and `MinGit`/`RefLeaseManager` (`035, 039`).
2. `F-079`: Map `packages/investigations/src/sweeps/sweep-lease-coordinator.ts:28-53` (`openSweepIntent`/`grantSweepLease` using `'granted'`) onto `TaskClaimLeasesRepo` (`020` `path_leases` `'intent'` -> `'exclusive'`).

Local defects.
- `F-078`: Fix `packages/investigations/src/sweeps/deterministic-codemod-runner.ts:30-96` executing `ts-morph`/`ast-grep` unsandboxed in-process and mutating files during `jscodeshift` `dryRun: true`.
- `F-079`: Fix `packages/investigations/src/sweep-guards/post-sweep-brief-symbol-updater.ts:18-27,49-70` filtering `task.status === 'queued' | 'paused'` instead of canonical uppercase `'READY' | 'BLOCKED'`.

Shared files.
- Integration-owned shared surfaces: `packages/investigations/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/investigations/src/index.ts`, `packages/investigations/src/{sweeps,sweep-guards}/**`, `packages/investigations/tests/sweeps/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not write `mode = 'granted'` into `state.db.path_leases` or match lowercase `'queued'`/`'paused'` task states.
- Do not mutate source files when `dryRun: true`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/investigations test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Codemod `dryRun: true` leaves disk untouched, `SweepLeaseCoordinator` writes valid `'exclusive'` `path_leases`, `'READY'`/`'BLOCKED'` tasks receive `[RECENT SWEEP SYMBOL MAP]` updates persisted in `state.db`, and `@ef-harness/investigations` exports all 4 modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C76` (`194`) and `C78`/`C79` rely on exported `@ef-harness/investigations`.

Stop.
- Commit merges and `integrate: wire investigations sweeps/guards + barrel` with `EF_HARNESS_MAINTAINER=1`; halt if `ts-morph` or `@ast-grep/napi` native bindings fail.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C74 — `@ef-harness/portability` packages `age-encryption`, exports all sealed checks per feature, rehydrates real `schema/state.sql` DBs, and persists `GlobalMultiProjectBroker` in `global.db`.

Architecture.
- `projects-portability-and-sync.md` (Orphan Portability Branch `harness/portability`, `age`-Encrypted Sealed Checks, Rehydration From Bundle, Cross-Device Lease & `writer_epoch`, Global Multi-Project Broker).
- `database-design.md`, `schema/state.sql`, `schema/global.sql` (`grants`, `port_leases`), `IMPLEMENTATION_TASKS.md` (`Task 186`–`Task 188`).
- Post-task invariant: `@ef-harness/portability` packages `age-encryption`, exports all sealed checks per feature, rehydrates real `schema/state.sql` DBs, and persists `GlobalMultiProjectBroker` in `global.db`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C73` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 186` (`task/186-orphan-branch-portability` @ `1a42698`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-186-orphan-branch-portability`, roots `packages/portability/src/exporter, packages/portability/tests/exporter`): unmerged — run `git merge --no-ff task/186-orphan-branch-portability -m "integrate: Task 186 orphan-branch-portability"`.
- Unit `Task 187` (`task/187-rehydrate-zip-lease` @ `2e76f37`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-187-rehydrate-zip-lease`, roots `packages/portability/src/rehydration, packages/portability/tests/rehydration`): unmerged — run `git merge --no-ff task/187-rehydrate-zip-lease -m "integrate: Task 187 rehydrate-zip-lease"`.
- Unit `Task 188` (`task/188-global-resource-broker` @ `82f90b9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-188-global-resource-broker`, roots `packages/portability/src/broker, packages/portability/tests/broker`): unmerged — run `git merge --no-ff task/188-global-resource-broker -m "integrate: Task 188 global-resource-broker"`.
- Sequence note: Merge `task/186-orphan-branch-portability` (`1a42698`), `task/187-rehydrate-zip-lease` (`2e76f37`), and `task/188-global-resource-broker` (`82f90b9`) (`git merge --no-ff`) in order `186 -> 187 -> 188` onto `harness/integration` (C73 child).

Freeze.
- `packages/portability/package.json` declares `"age-encryption"` in `dependencies` (deleting `createRequire(../../../../package.json)` in `186`).
- `OrphanBranchPortabilityExporter` (`186`) serializes EVERY sealed check per `featureId` into `checks-sealed/<featureId>.age` (`rehydration` `187` imports shared YAML/`age`/`redactor` helpers from `186` and `@ef-harness/shared-contracts`/`shared-observability`, deleting duplicates).
- `rebuildStateDatabase` (`187`) builds a real on-disk `ProjectStateDb` initialized from `schema/state.sql` (`nodes`, `edges`, `names`, `rollups`, `tasks`, `checks`, contentless `kb_words` via `ef_search_text`, canonical SHA-256 digests, and `meta.writer_epoch`).
- `MachineWideSlotCoordinator` (`188`) retains `readonly baselineLimits` so `setGovernorOrange(false)` restores full slots, and backs grants/port leases on `GlobalBrokerDb` (`014`) + `BrokerGrantIssuer` (`024`).
- `packages/portability/src/index.ts` exports `exporter, rehydration, broker` wired into `apps/daemon`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).

Seams.
1. `F-080`, `F-081`: Add `@ef-harness/{shared-observability,db,git-engine,planner,steering,governor,providers,ship-deploy}` to `packages/portability/package.json`.
2. replace `InMemoryGlobalGrantStore` and RAM `portLeases` (`188`) with `GlobalBrokerDb` + `BrokerGrantIssuer`.
3. connect `186–188` to `017, 035, 091, 118, 119, 120, 130, 140, 176, 177` inside `apps/daemon/src/server.ts`.

Local defects.
- `F-080`: Fix `orphan-branch-portability-exporter.ts:126-134` (`seenFeatureFiles` dropping 2nd+ sealed checks per feature), rewrite `:memory:` 6-table `BOOTSTRAP_SQL` in `rehydration-schema.ts:6-143`, and preserve `baselineLimits` in `machine-wide-slot-coordinator.ts:50-56`.

Shared files.
- Integration-owned shared surfaces: `packages/portability/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/portability/src/index.ts`, `packages/portability/src/{exporter,rehydration,broker}/**`, `apps/daemon/src/server.ts`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not resolve `age-encryption` relative to `../../../../package.json` or drop 2nd+ sealed checks per feature.
- Do not rehydrate `state.db` with `:memory:`, `name_registry`, `feature_rollups`, or `sha256:${id}:${rev}` fake hashes.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/portability test && pnpm --filter @ef-harness/daemon test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Multi-check export/rehydration restores a real on-disk `ProjectStateDb` readable by `KnowledgeGraphRepo`/`Fts5SearchRepo`, `setGovernorOrange(true)` then `(false)` restores full `pool2WarmSlots`, and `@ef-harness/portability` exports all 3 modules.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C76`–`C79` rely on `@ef-harness/portability` exports and `writer_epoch` parity with `176`.

Stop.
- Commit merges and `integrate: wire portability/broker + daemon` with `EF_HARNESS_MAINTAINER=1`; halt if rehydrated DB fails `schema/state.sql` triggers.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C75 — `ThreeLevelEvalRunner` & `PairedStatisticalPromotionEngine` (`191`) run real `MetaLabBenchmarkRegistry` (`189`), `SimDevDriver` (`190`), and RFC 8785 cache checks.

Architecture.
- `meta-lab.md` (Benchmark Suite, Prompt Contamination Scanner, 10 Simulated Developer Personas, Exact-Input Cache, Three-Level Funnel, Paired Statistical Promotion).
- `prompt-contracts.md`, `IMPLEMENTATION_TASKS.md` (`Task 189`–`Task 191`).
- Post-task invariant: `ThreeLevelEvalRunner` & `PairedStatisticalPromotionEngine` (`191`) run real `MetaLabBenchmarkRegistry` (`189`), `SimDevDriver` (`190`), and RFC 8785 cache checks.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C74` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 189` (`task/189-metalab-benchmark-registry` @ `e5e794e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-189-metalab-benchmark-registry`, roots `packages/meta-lab/src/benchmarks, packages/meta-lab/tests/benchmarks`): unmerged — run `git merge --no-ff task/189-metalab-benchmark-registry -m "integrate: Task 189 metalab-benchmark-registry"`.
- Unit `Task 190` (`task/190-metalab-simulated-developers` @ `b950b62`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-190-metalab-simulated-developers`, roots `packages/meta-lab/src/sim-dev, packages/meta-lab/tests/sim-dev`): unmerged — run `git merge --no-ff task/190-metalab-simulated-developers -m "integrate: Task 190 metalab-simulated-developers"`.
- Unit `Task 191` (`task/191-metalab-eval-promotion` @ `6bfc3f7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-191-metalab-eval-promotion`, roots `packages/meta-lab/src/evals, packages/meta-lab/tests/evals`): unmerged — run `git merge --no-ff task/191-metalab-eval-promotion -m "integrate: Task 191 metalab-eval-promotion"`.
- Sequence note: Merge `task/189-metalab-benchmark-registry` (`e5e794e`), `task/190-metalab-simulated-developers` (`b950b62`), and `task/191-metalab-eval-promotion` (`6bfc3f7`) (`git merge --no-ff`) in order `189 -> 190 -> 191` onto `harness/integration` (C74 child).

Freeze.
- `ThreeLevelEvalRunner` (`packages/meta-lab/src/evals/runner.ts`) loads real benchmarks from `MetaLabBenchmarkRegistry` (`189`, gated by `PromptContaminationScanner`), runs `SimDevDriver` (`190`) using RFC 8785 `ExactInputModelResponseCache` (`007`, deleting `${caseId}:${candidateId}` mock key), measures real token/cost/paperwork/latency deltas, and enforces `SkillVettingPipeline` (`078`).
- `packages/meta-lab/package.json` declares `@ef-harness/{shared-contracts,shared-observability,db,sim,sandbox,verifier,corpus,research-engine,intake,governor,runtime-adapters,ship-deploy,investigations,portability}`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-082`: Add missing workspace dependencies to `packages/meta-lab/package.json` and connect `189` (`MetaLabBenchmarkRegistry`, `PromptContaminationScanner`) + `190` (`SimDevDriver`, `ExactInputModelResponseCache`) + `009` + `078` directly into `191` `ThreeLevelEvalRunner` (leaving red-team veto hook for C76).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-082`: Delete hardcoded `LEVEL_1_CASES`, `candidateId.endsWith('-futility')` check, `tokenCostBaseline: base.durationMs`, and hardcoded `paperworkPct: 0.12` in `packages/meta-lab/src/evals/runner.ts:12-67,81-119`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `packages/meta-lab/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `packages/meta-lab/src/{benchmarks,sim-dev,evals}/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not key `ExactInputModelResponseCache` on candidate ID alone or hardcode `paperworkPct: 0.12`.
- Do not bypass `PromptContaminationScanner` on promoted benchmarks.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/meta-lab test -- benchmarks sim-dev evals` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `ThreeLevelEvalRunner` runs `MetaLabBenchmarkRegistry` cases through `SimDevDriver` and RFC 8785 `ExactInputModelResponseCache` cleanly.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C76` relies on `benchmarks`, `sim-dev`, and `evals` (with `runRedTeamGate` wired next).

Stop.
- Commit merges and `integrate: wire meta-lab benchmarks/sim-dev/evals` with `EF_HARNESS_MAINTAINER=1`; halt if `eslint.config.mjs` reports a DAG violation in `meta-lab`.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C76 — `FullDaemonFaultSimulator`, `RedTeamSecuritySuiteRunner`, and `ArchitectureReviewTrialsSuite` exercise real workspace stacks and export `@ef-harness/meta-lab`.

Architecture.
- `meta-lab.md` (Chaos Fault Injection, Adversarial Red-Team Suite with Hard Promotion Veto), `architecture-review-decisions.md` + `architecture-audit-response.md` + `architecture-deep-review.md` (Review Areas A–J & Trials 1–6).
- `sandbox-and-security.md`, `IMPLEMENTATION_TASKS.md` (`Task 192`–`Task 194`).
- Post-task invariant: `FullDaemonFaultSimulator`, `RedTeamSecuritySuiteRunner`, and `ArchitectureReviewTrialsSuite` exercise real workspace stacks and export `@ef-harness/meta-lab`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C75` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 192` (`task/192-metalab-fault-injection` @ `06f62c4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-192-metalab-fault-injection`, roots `packages/meta-lab/src/fault-sim, packages/meta-lab/tests/fault-sim`): unmerged — run `git merge --no-ff task/192-metalab-fault-injection -m "integrate: Task 192 metalab-fault-injection"`.
- Unit `Task 193` (`task/193-metalab-red-team-suite` @ `d76f749`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-193-metalab-red-team-suite`, roots `packages/meta-lab/src/red-team, packages/meta-lab/tests/red-team`): unmerged — run `git merge --no-ff task/193-metalab-red-team-suite -m "integrate: Task 193 metalab-red-team-suite"`.
- Unit `Task 194` (`task/194-architecture-review-trials` @ `da32d6f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-194-architecture-review-trials`, roots `tests/e2e/review-trials, tests/e2e/tests`): unmerged — run `git merge --no-ff task/194-architecture-review-trials -m "integrate: Task 194 architecture-review-trials"`.
- Sequence note: Merge `task/192-metalab-fault-injection` (`06f62c4`), `task/193-metalab-red-team-suite` (`d76f749`), and `task/194-architecture-review-trials` (`da32d6f`) (`git merge --no-ff`) in order `192 -> 193 -> 194` onto `harness/integration` (C75 child).

Freeze.
- `SimulatedDaemonStack` (`192`) boots real `@ef-harness/{db,sim,governor,steering,runtime-adapters,ship-deploy}` (`034, 118, 130, 150, 176`, deleting private `REAL`-float `STATE_DDL`/`GLOBAL_DDL`) and tests crash/ENOSPC/429/disconnect recovery.
- `RedTeamSecuritySuiteRunner` (`193`) attacks real `045, 046, 048, 054, 078, 082, 097, 100, 120, 142, 149, 186` implementations (deleting placeholder `'SQLite format 3\x00[redacted]'` sinks), wires `runRedTeamGate()` veto into `191` `ThreeLevelEvalRunner`, and `packages/meta-lab/src/index.ts` exports all 5 submodules.
- `ArchitectureReviewTrialsSuite` (`tests/e2e/review-trials/lib/{area-a..area-j,trials}.ts`) imports and tests real integrated `@ef-harness/*` packages (deleting `PolicyDatabase` + inline toy functions + non-canonical identity `ef_search_text`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-082`: Export `benchmarks, sim-dev, evals, fault-sim, red-team` from `packages/meta-lab/src/index.ts`, wire `193` `runRedTeamGate()` into `191` promotion gate, and replace `192`/`193` mock stand-ins with real `@ef-harness/*` dependencies.
2. `F-083`: Add `@ef-harness/*` dependencies to `tests/e2e/package.json` + `tests/e2e/tsconfig.json`, include `review-trials/**/*.ts`, and rewrite `tests/e2e/review-trials/lib/{sqlite,area-a..area-j,trials}.ts` to verify real workspace packages (catching regressions in `141`, `144`, `ef_search_text`).

Local defects.
- `F-082`: Delete `STATE_DDL` (`REAL` float money/units) in `packages/meta-lab/src/fault-sim/daemon-stack.ts:10-45` and dummy sink writes in `red-team/attacks.ts:50-119`.
- `F-083`: Remove inline `area-h` / `area-a` toy implementations in `tests/e2e/review-trials/lib/` that hid `F-010`/`F-058`/`F-060`.

Shared files.
- Integration-owned shared surfaces: `packages/meta-lab/src/index.ts`, `packages/meta-lab/src/{fault-sim,red-team,evals}/**`, `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/review-trials/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).

Do not.
- Do not use `REAL` floats for money/allowance in fault simulations or certify inline toy helpers in `review-trials`.
- Do not allow `ThreeLevelEvalRunner` promotion without a passing `runRedTeamGate()`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/meta-lab test && pnpm --filter @ef-harness/e2e test -- review-trials` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `FullDaemonFaultSimulator` passes SQLite-real fault injection, `RedTeamSecuritySuiteRunner` exercises real sandbox/vault defenses and vetoes insecure candidates in `191`, and `review-trials` executes live package assertions across Areas A–J & Trials 1–6.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C78`–`C79` rely on exported `@ef-harness/meta-lab` and live `review-trials`.

Stop.
- Commit merges and `integrate: wire meta-lab + live review-trials` with `EF_HARNESS_MAINTAINER=1`; halt if any real red-team or Area A–J assertion fails.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C77 — Windows NSIS packaging (`196`) bundles real compiled apps, `corpus/**`, Office art, WASM, and `electron-builder`, while `verify-docs-diagrams.mjs` (`197`) verifies real non-empty paths.

Architecture.
- `desktop-app.md` (Packaging & Distribution `< 180 MB` NSIS, Bundled `harnessd`, `MinGit`, `gitleaks`, WASM, Corpus, Office Art, Provider Policy), `v1-knowledge-corpus.md`, `prompt-contracts.md`.
- `IMPLEMENTATION_TASKS.md` (`Task 196`–`Task 197`).
- Post-task invariant: Windows NSIS packaging (`196`) bundles real compiled apps, `corpus/**`, Office art, WASM, and `electron-builder`, while `verify-docs-diagrams.mjs` (`197`) verifies real non-empty paths.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C76` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 196` (`task/196-windows-packaging-nsis` @ `d9af2d6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-196-windows-packaging-nsis`, roots `apps/desktop/build/electron-builder.yml, apps/desktop/build/fixtures, apps/desktop/build/nsis, scripts/packaging/audit-asar.mjs, scripts/packaging/build-win-nsis.mjs`): unmerged — run `git merge --no-ff task/196-windows-packaging-nsis -m "integrate: Task 196 windows-packaging-nsis"`.
- Unit `Task 197` (`task/197-docs-diagram-consistency` @ `5bf94b0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-197-docs-diagram-consistency`, roots `scripts/verify-docs-diagrams.mjs, tests/e2e/docs-parity`): unmerged — run `git merge --no-ff task/197-docs-diagram-consistency -m "integrate: Task 197 docs-diagram-consistency"`.
- Sequence note: Merge `task/196-windows-packaging-nsis` (`d9af2d6`) then `task/197-docs-diagram-consistency` (`5bf94b0`) (`git merge --no-ff`) onto `harness/integration` (C76 child).

Freeze.
- `apps/desktop/package.json` declares `"electron"` and `"electron-builder"`.
- `scripts/packaging/lib/staging.mjs` stages real built `apps/{desktop,renderer,daemon}/dist`, real `corpus/{packs,elaborations,rules-seams,policies,skills}/**`, real `apps/renderer/assets/office/**`, real `z3-solver` + `web-tree-sitter` WASM, signed policy (`135`), and `MinGit`/`gitleaks`, invoked via `electron-builder --config apps/desktop/build/electron-builder.yml` (deleting `MZEFHARNESS\r\n`, `module.exports = {}`, and `.nsis-stub.zip` fixtures).
- `scripts/verify-docs-diagrams.mjs` points `verifySchemaParity` & `verifyContractParity` at REAL repo paths (`packages/db/src/migrations`, `packages/shared-contracts/src/{prompts,vocab,packets}`, `corpus/skills/m2/infer-or-ask/SKILL.md`), fails closed if absent (no vacuous `if (fs.existsSync)` skip), and compares `tools/merge-diagrams.js` output in a temp dir without mutating tracked `ef-harness-complete.mmd`.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-084`: Wire `196` `staging.mjs` + `audit-asar.mjs` to real compiled `dist/` outputs from `apps/{desktop,renderer,daemon}`, real `corpus/` assets (`104`), real `135` policy, `162` Office assets, and `081`/`167` WASM binaries.
2. `F-085`: Fix nonexistent `packages/kernel/src/migrations`, `packages/contracts/src/...`, and `corpus/skills/m2` check assumptions in `scripts/verify-docs-diagrams.mjs:257-438`, and add `@ef-harness/e2e` test hook for `docs-parity`.

Local defects.
- `F-084`: Delete `writeLaunchStub` (`MZEFHARNESS\r\n`), `createProductionAsar` dummy `module.exports = {}`, and `apps/desktop/build/fixtures/**` placeholder bundling in `scripts/packaging/lib/staging.mjs:20-160`.
- `F-085`: Fix `verifyDiagramSync` (`scripts/verify-docs-diagrams.mjs:53-72`) overwriting tracked `ef-harness-complete.mmd` in place.

Shared files.
- Integration-owned shared surfaces: `apps/desktop/package.json`, `pnpm-lock.yaml` (single `pnpm install`), `apps/desktop/build/electron-builder.yml`, `scripts/packaging/**`, `scripts/verify-docs-diagrams.mjs`, `tests/e2e/docs-parity/**`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit dummy `MZEFHARNESS` text stubs or wrap `verifySchemaParity` checks in silent pass-if-missing guards.
- Do not leave `ef-harness-complete.mmd` dirty in `git status` when running `verify-docs-diagrams.mjs`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint && node scripts/verify-docs-diagrams.mjs` -> all exit `0`.
- Package-targeted gate commands: `node scripts/packaging/build-win-nsis.mjs --unsigned-dev && node scripts/packaging/audit-asar.mjs && pnpm --filter @ef-harness/e2e test -- packaging docs-parity` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `audit-asar.mjs` verifies real compiled `apps/desktop/dist`, `apps/renderer/dist`, `corpus/skills/m2/infer-or-ask/SKILL.md`, WASM, and `verify-docs-diagrams.mjs` leaves `git status` clean.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C79` relies on green Windows NSIS `audit-asar` and `verify-docs-diagrams.mjs`.

Stop.
- Commit merges and `integrate: wire real packaging + docs parity` with `EF_HARNESS_MAINTAINER=1`; halt if `electron-builder` or `verify-docs-diagrams.mjs` fails.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C78 — `FullLifecycleMultiProjectE2eSuite` (`195`) and `PerformanceAndScaleCertifier` (`198`) run real M0–M6 packages over real named-pipe IPC, SQLite WAL, and `MinGit`.

Architecture.
- `roadmap.md` (Full Cross-Milestone Lifecycle: Greenfield + Brownfield + Mid-Build Steer + Recovery + Multi-Project Broker, Performance & Scale Budgets: 50 workers `p99 < 50 ms`, 500-task Board `< 10 ms`, 200-box Canvas `< 16 ms`).
- `IMPLEMENTATION_TASKS.md` (`Task 195`, `Task 198`).
- Post-task invariant: `FullLifecycleMultiProjectE2eSuite` (`195`) and `PerformanceAndScaleCertifier` (`198`) run real M0–M6 packages over real named-pipe IPC, SQLite WAL, and `MinGit`.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C77` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 195` (`task/195-e2e-cross-milestone-suite` @ `73526dc`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-195-e2e-cross-milestone-suite`, roots `tests/e2e/full-lifecycle, tests/e2e/tests`): unmerged — run `git merge --no-ff task/195-e2e-cross-milestone-suite -m "integrate: Task 195 e2e-cross-milestone-suite"`.
- Unit `Task 198` (`task/198-performance-scale-cert` @ `dff302b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-198-performance-scale-cert`, roots `tests/e2e/perf-scale`): unmerged — run `git merge --no-ff task/198-performance-scale-cert -m "integrate: Task 198 performance-scale-cert"`.
- Sequence note: Merge `task/195-e2e-cross-milestone-suite` (`73526dc`) then `task/198-performance-scale-cert` (`dff302b`) (`git merge --no-ff`) onto `harness/integration` (C77 child).

Freeze.
- `FullLifecycleMultiProjectE2eSuite` (`tests/e2e/full-lifecycle/**`) and `PerformanceAndScaleCertifier` (`tests/e2e/perf-scale/**`) use `.js` relative imports compiled by `tests/e2e/tsconfig.json` and execute real `@ef-harness/{db,ipc,git-engine,sandbox,verifier,discovery,spec-expansion,research-engine,intake,brownfield,dictation,planner,integrator,steering,governor,providers,runtime-adapters,ship-deploy,investigations,portability}` + `apps/{daemon,desktop,renderer}`.
- `perf-scale` measures real `MigrationRunner`/`CoordinatorWriteQueue` (`015, 025`), `MarkdownExporter` (`085`), `WindowsResourceTelemetryCollector` (`117`), `BoardCockpitView` (`124`), `InteractiveArchitectureCanvas` (`153`), `TruthfulAnimationDirector` (`164`), and `OrphanBranchPortabilityExporter` (`186`).
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-086`: Add all remaining workspace package dependencies to `tests/e2e/package.json` + `tests/e2e/tsconfig.json`, include `full-lifecycle/**/*.ts` + `perf-scale/**/*.ts`, delete `NamedPipeIpcSimulator` + 1-table `journey_stage` stub (`195`) and `perf-scale/ports/*.ts` local loops (`198`), and wire real named-pipe `031` IPC + real SQLite WAL + real `MinGit`.
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-086`: Convert all `.ts` relative import specifiers in `tests/e2e/perf-scale/**` (`./scorecard.ts`, etc.) to `.js`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/src/index.ts`, `tests/e2e/full-lifecycle/**`, `tests/e2e/perf-scale/**`, `pnpm-lock.yaml` (single `pnpm install`).
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not use `NamedPipeIpcSimulator` arrays or dummy 1-table SQLite loops to pass `195` or `198`.
- Do not relax `50 ms` `p99` write-queue or `10 ms`/`16 ms` UI frame budgets.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/e2e test -- full-lifecycle perf-scale` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: Real Greenfield/Brownfield/Recovery multi-project E2E journeys and real M0–M6 performance budgets pass over `harnessd` named pipes and SQLite WAL.
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Downstream `C79` relies on live `full-lifecycle` and `perf-scale` suites compiled under `@ef-harness/e2e`.

Stop.
- Commit merges and `integrate: wire full-lifecycle + perf-scale e2e` with `EF_HARNESS_MAINTAINER=1`; halt if real latency or cross-milestone journeys fail.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.

### C79 — Security audit (`199`) & v1.0 Release Certification (`200`) certify the real 28-package product (`productExecuted: true`) end-to-end across all repo gates.

Architecture.
- `sandbox-and-security.md` (SQLite WAL 8-Step Secret Purge, DPAPI, Sandbox Tier Containment, Console-Only Anthropic), `roadmap.md` (v1.0 Release Certification Across All 7 Frozen Suites & Full Entry Journey).
- `architecture.md`, `CONTRIBUTING_AGENTS.md`, `IMPLEMENTATION_TASKS.md` (`Task 199`–`Task 200`).
- Post-task invariant: Security audit (`199`) & v1.0 Release Certification (`200`) certify the real 28-package product (`productExecuted: true`) end-to-end across all repo gates.

Land.
- Base checkout: `C:/Users/Ayush/Desktop/ef-wt/integration` on branch `harness/integration` at `C78` child commit (or `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` if verifying prior landed commits; halt if `HEAD` was reset).
- Unit `Task 199` (`task/199-security-privacy-audit` @ `f56f166`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-199-security-privacy-audit`, roots `tests/e2e/security-audit, tests/e2e/tests`): unmerged — run `git merge --no-ff task/199-security-privacy-audit -m "integrate: Task 199 security-privacy-audit"`.
- Unit `Task 200` (`task/200-release-certification-gate` @ `500e7bd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-200-release-certification-gate`, roots `benchmarks/m6-release/cli.ts, benchmarks/m6-release/src, tests/e2e/m6-exit-gate, tests/e2e/tests`): unmerged — run `git merge --no-ff task/200-release-certification-gate -m "integrate: Task 200 release-certification-gate"`.
- Sequence note: Merge `task/199-security-privacy-audit` (`f56f166`) then `task/200-release-certification-gate` (`500e7bd`) (`git merge --no-ff`) onto `harness/integration` (C78 child).

Freeze.
- `FinalSecurityPrivacyAuditSuite` (`199`) and `V1ReleaseCertificationRunner` (`200`) use `.js` imports compiled by `tests/e2e/tsconfig.json` and `benchmarks/m6-release/tsconfig.json`, and execute real `@ef-harness/*` packages with `productExecuted: true` across ALL 7 frozen benchmark suites (`suite:kitchen-web` through `suite:red-team-security`).
- `199` tests real SQLite WAL + `SecretPurgeEngine` (`030`), `WindowsDpapiSecretsVault` (`120`), `apps/renderer/src/connections/compliance.ts` (`141`), `HarnessRunEngine` (`047`), and `RedTeamSecuritySuiteRunner` (`193`) — deleting plain-text `'state.db'` files and local `ports/*.ts` stubs.
- Module syntax rule: keep NodeNext `.js` relative import specifiers, `import type` under `verbatimModuleSyntax`, and zero explicit `undefined` on optional fields (`exactOptionalPropertyTypes`).
- Public exports & layer boundary: consume peer workspace packages solely via their root `@ef-harness/<pkg>` barrel (`ef/layer-boundary` compliant; zero deep internal package imports).

Seams.
1. `F-086`: Replace `tests/e2e/security-audit/ports/*.ts`, `benchmarks/m6-release/src/replay-matrix.ts`, and `productExecuted: false` stubs (`benchmarks/m6-release/src/gates.ts:66-150`) with live execution of real M0–M6 exit gates (`034, 068, 105, 134, 152, 175, 193, 194, 195, 196, 197, 198, 199`), confirming every user-visible entry journey from Electron `apps/desktop` -> `apps/daemon` -> `apps/renderer` (Discover -> Plan -> Build -> Verify -> Integrate -> Cockpit/Office/Canvas/Preview -> Land -> Ship).
2. Runtime integration check: verify all modified imports resolve cleanly across built `dist/` declarations under `pnpm build && pnpm typecheck`.

Local defects.
- `F-086`: Convert all `.ts` relative import specifiers in `tests/e2e/security-audit/**`, `tests/e2e/m6-exit-gate/**`, and `benchmarks/m6-release/**` to `.js`, and delete the fake UTF-8 text file `'state.db'` writer in `tests/e2e/security-audit/runner.ts:36-61`.
- Verify no synchronous host spawns, volatile in-memory fallback maps, or mock stand-ins remain active on default production code paths for this wave.

Shared files.
- Integration-owned shared surfaces: `tests/e2e/security-audit/**`, `tests/e2e/m6-exit-gate/**`, `benchmarks/m6-release/**`, `tests/e2e/tsconfig.json`, `package.json` (release cert scripts), `pnpm-lock.yaml`.
- Dependency manifest & lockfile policy: reconcile workspace/package versions in `package.json` first and run `pnpm install` once per wave (`harness/integration` base wins over incoming stubs).
- Harmonized working-tree rule: verify zero secrets, zero conflict markers, and zero unanchored TODO/FIXME comments remain before committing.

Do not.
- Do not emit `productExecuted: false` or read static `replay-matrix.ts` numbers as passing certification.
- Do not leave any shadow port, unmerged non-excluded branch, or uncommitted dirty change on `harness/integration`.
- Do not invoke `node scripts/agent-worktree.mjs commit`, attach `EF-Never-Merge`, silence type errors by reverting earlier `Cxx` commits, or edit `schema/**` unless explicitly required above.
- Do not allow unit tests in this wave to pass solely via local mock doubles where the real upstream package is now available on `harness/integration`.

Done when.
- Workspace gate commands (run from `C:/Users/Ayush/Desktop/ef-wt/integration`): `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test && node schema/schema-test.js && pnpm verify:diagrams && node scripts/verify-docs-diagrams.mjs` -> all exit `0`.
- Package-targeted gate commands: `pnpm --filter @ef-harness/e2e test` -> all exit `0` with zero skipped suites.
- Schema integrity check: `node schema/schema-test.js` continues passing `67/67 passed`.
- Observable proof: `V1ReleaseCertificationRunner` reports `productExecuted: true` across all 7 suites (`100%` of `199` active branches landed on `harness/integration`, only empty `task/162-office-pixijs-floorplan-sprites` & `task/164-office-animation-director-astar` excluded).
- Maintainer commit step: run `EF_HARNESS_MAINTAINER=1 git commit` on `harness/integration` using `integrate: Task NNN <slug>` / `integrate: wire ...` subjects.
- Explicitly frozen downstream contract handoff: Pipeline complete: every `F-001`–`F-086` seam resolved and full EF Harness v1.0 architecture verified.

Stop.
- Commit final `integrate: Task 199/200 + v1.0 release certification` with `EF_HARNESS_MAINTAINER=1`; halt on any non-zero exit across workspace gates.
- Unlisted conflict or contract drift: if a merge conflict appears outside `Shared files.` or an already-landed signature diverges from `Freeze.`, stop immediately and report the file path and opposing hunks instead of inventing a third contract.
