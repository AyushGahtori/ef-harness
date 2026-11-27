# Pass 06 — Chunk 003 Audit Report (`packages/portability` Orphan-Branch `harness-state` Exporter, Portable Zip/Rehydration/Lease & Multi-Project Global WFQ Resource Broker — `Tasks 186–188`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-003`
- **Units Audited (3):**
  - `Task 186` (`task/186-orphan-branch-portability` @ `1a42698`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-186-orphan-branch-portability`, unmerged, clean)
  - `Task 187` (`task/187-rehydrate-zip-lease` @ `2e76f37`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-187-rehydrate-zip-lease`, unmerged, clean)
  - `Task 188` (`task/188-global-resource-broker` @ `82f90b9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-188-global-resource-broker`, unmerged, clean)
- **Governing Architecture Documents:** `projects-portability-and-sync.md`, `open-design-questions.md`, `execution-capacity.md`, `provider-connections.md`, `database-design.md`, `schema/state.sql`, `schema/global.sql`, `projects-portability-and-sync.mmd`, `research/portability-and-sync.md`.

## 2. Files Directly Inspected
- `packages/portability/package.json` & `packages/portability/src/index.ts` (`task-186`)
- `packages/portability/src/exporter/{repository-root.ts,age-sealed-checks-encryptor.ts,orphan-branch-portability-exporter.ts}` (`Task 186`)
- `packages/portability/src/rehydration/{orphan-branch-rehydrator.ts,age-sealed-checks-decryptor.ts,rehydration-schema.ts}` (`Task 187`)
- `packages/portability/src/broker/{global-multi-project-broker.ts,in-memory-global-grant-store.ts,machine-wide-slot-coordinator.ts}` (`Task 188`)

## 3. Verified Local Strengths
- `OrphanBranchPortabilityExporter` (`186`) exports via `git fast-import` onto `refs/heads/harness-state` without working-tree checkout, enforces `10 s` quiet debounce, skips no-op commits when `canonicalGraphSha256` is unchanged, blocks secrets before `git fast-import`, and enforces public-repo OFF-by-default push gating (`PublicRemotePushGuard`).
- `CrossDeviceLeaseManager`, `PortableZipArchiveManager`, and `LostKeyOracleRegenerator` (`187`) enforce default Read-Only Viewer mode on foreign active leases, non-FF `--force-with-lease` epoch takeover (`epoch + 1`), zip-slip path-traversal rejection, and graceful lost-`age`-key rehydration with oracle regeneration.
- `WeightedFairQueueArbiter`, `ReservedInteractiveLanePerConnection`, and `CrossProjectGrantLeaseManager` (`188`) enforce `8:4:2:1` WFQ fairness without starvation, reserved interactive fast-lane bypass, bounded partial budget grants without over-allocation, and 10-minute expired-grant reclamation.

## 4. Local Implementation Defects Discovered
1. **Undeclared `"age-encryption"` Dependency, Monorepo-Root `createRequire` Packaged-App Crash & Multi-Check Feature Drop (`Tasks 186–187` — `F-080`):**
   - `packages/portability/package.json:20-22` lists only `@ef-harness/shared-contracts` (omitting `"age-encryption"`). `186` (`age-sealed-checks-encryptor.ts:17-20`) resolves `age-encryption` via `createRequire(path.join(repositoryRoot(), "package.json"))` (`../../../../package.json`), which crashes in packaged Electron apps lacking the monorepo root; `187` (`age-sealed-checks-decryptor.ts:14`) calls `await import("age-encryption")`, failing strict pnpm resolution.
   - `OrphanBranchPortabilityExporter.runExport` (`orphan-branch-portability-exporter.ts:126-134`) tracks `seenFeatureFiles` by `checks-sealed/<featureId>.age` and `continue`s on subsequent checks for the same feature, silently dropping all sealed checks beyond the first per feature!
2. **Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` (`Task 187` `rehydration-schema.ts:6-143` — `F-080`):**
   - Opens `new DatabaseSync(":memory:")` instead of writing a durable `state.db` file and creates a custom 6-table schema that diverges from `schema/state.sql`: uses `name_registry` (instead of `names`), `feature_rollups` (instead of `rollups`), non-contentless `kb_words` without `ef_search_text`, inserts `edge` entities into `nodes` as `kind = 'arch_node'` (instead of `edges`), fabricates non-hex `` `sha256:${entity.id}:${entity.revision}` `` hashes, and omits `tasks`, `decisions`, `work_items`, and `checks`.
3. **Permanent 1-Slot Lock on `setGovernorOrange(false)` Recovery (`Task 188` `machine-wide-slot-coordinator.ts:50-56` — `F-080`):**
   - `setGovernorOrange(true)` mutates `this.limits.pool2WarmSlots = 1` without saving the baseline `initialLimits`; calling `setGovernorOrange(false)` on `GREEN` recovery evaluates `singleSlot ? 1 : this.limits.pool2WarmSlots` (`=== 1`), leaving `pool2WarmSlots` and `heavyLanePermits` stuck at `1` permanently!

## 5. Cross-Unit Contract & Seam Mismatches
1. **3-Way `packages/portability` Silo Isolation (`186`–`188`), Empty Barrel, Duplicated `age`/YAML/Secret Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` (`F-081`):**
   - `packages/portability/src/index.ts` is an empty `packageIdentity()` stub across all 3 branches, with zero cross-imports (`187` duplicates `age-sealed-checks-encryptor.ts`, `repository-root.ts`, `secret-patterns.ts`, and `yaml-format.ts`).
   - `186` uses `InMemoryKnowledgeGraph` and duplicates `canonical-hash.ts` and `packet-security-redactor.ts` instead of `007`, `011`, `017` `KnowledgeGraphRepo`, `035` `MinGit`, `091` `HiddenCheckPoolStore`, `120` `WindowsDpapiSecretsVault`, and `177` `GitHubAuthConnector`.
   - `187` `CrossDeviceLeaseManager` is unwired from `176` `LeaseEpochFencingGuard` and `130` `InterruptedRunDetector`.
   - `188` `GlobalMultiProjectBroker` ships only `InMemoryGlobalGrantStore` and an in-memory `portLeases` `Map` instead of `@ef-harness/db` `GlobalBrokerDb` (`014` `global.db.grants` & `port_leases`) and `024` `BrokerGrantIssuer`, and is unwired from `118`, `119`, and `140`.

## 6. Shared-File & Ownership Conflicts
- `packages/portability/src/index.ts` and `packages/portability/package.json` must export `exporter`, `rehydration`, and `broker` and declare `"age-encryption"`, `"yaml"`, and `@ef-harness/{db,git-engine,governor,providers,shared-observability,planner,ship-deploy}`.

## 7. Runtime Wiring Gaps
- Wire `186` + `187` to real `@ef-harness/db` `StateDb` (`schema/state.sql` + `SqliteConnection` + `ef_search_text` + `MigrationRunner`), `091` `HiddenCheckPoolStore`, `120` `WindowsDpapiSecretsVault`, `130` `InterruptedRunDetector`, and `176` `LeaseEpochFencingGuard`.
- Wire `188` `GlobalMultiProjectBroker` in `apps/daemon` (`066`) to `014` `GlobalBrokerDb`, `024` `BrokerGrantIssuer`, `118` `HeavyLaneSemaphore`/`PressureHysteresisStateMachine`, `119` `ThreePoolCapacityScheduler`, and `140` `AllowancePacingController`.

## 8. Architecture & Security Violations
- `F-080`: `186` drops 2nd+ sealed hidden checks per feature during `harness-state` export, weakening hidden oracle integrity on rehydrated devices.

## 9. Test Coverage & Verification Gaps
- `187`'s round-trip test verified against its own 6-table `:memory:` `BOOTSTRAP_SQL` rather than canonical `schema/state.sql`, and `188`'s governor test did not assert slot count restoration after `ORANGE → GREEN` recovery.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-080` (`HIGH`):** `portability` (`186`–`188`) Undeclared `"age-encryption"` & Packaged-App `createRequire` Crash, Dropped 2nd+ Sealed Checks Per Feature, Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` & Permanent 1-Slot `setGovernorOrange(false)` Lock.
- **`F-081` (`HIGH`):** `packages/portability` (`186`–`188`) 3-Way Internal Silos, Empty Barrel, Duplicate `age`/YAML/Redactor Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` Bypassing `global.db` (`014` & `024`).

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`186, 187, 188`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`, `schema/state.sql`, and `schema/global.sql`.
- [x] Cross-checked against `007, 011, 014, 017, 024, 035, 091, 118, 119, 120, 130, 140, 176, 177`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-080`–`F-081`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-004`: `Tasks 189–194` (`packages/meta-lab` benchmark registry, simulated developer harnesses, 3-level eval & McNemar/bootstrap promotion engine, chaos fault-injection simulator, red-team security suite, and `Task 194` external architecture review acceptance trials).
