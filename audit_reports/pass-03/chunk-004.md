# Pass 03 — Chunk 004: Planner M2 Architecture, Views Export/Import, Revisions, Slicer & Rule Matching (`Tasks 083–089`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-004`
- **Unit IDs:** `Task 083`, `Task 084`, `Task 085`, `Task 086`, `Task 087`, `Task 088`, `Task 089` (`packages/planner` merged M2 half)
- **Branches and commits:**
  - `task/083-system-architecture-synthesizer` (`e753d6f`, merged into `harness/integration`)
  - `task/084-feature-architecture-wireframes` (`8ce7ede`, merged into `harness/integration`)
  - `task/085-knowledge-views-exporter` (`b104c7b`, merged into `harness/integration`)
  - `task/086-markdown-direct-edit-importer` (`8adf0a5`, merged into `harness/integration`)
  - `task/087-hybrid-revision-impact-engine` (`a1e4945`, merged into `harness/integration`)
  - `task/088-knowledge-packet-slicer` (`c8cf1f8`, merged into `harness/integration`)
  - `task/089-rule-matching-pull-to-push` (`cde3a46`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/planner`
- **Governing architecture documents:** `build-pipeline.md`, `knowledge-database.md`, `planning-and-crew.md`, `verification-and-runtime.md`, `prompt-contracts.md`, `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 083–089`).

## 2. Units inspected
- `Task 083` (`e753d6f`), `Task 084` (`8ce7ede`), `Task 085` (`b104c7b`), `Task 086` (`8adf0a5`), `Task 087` (`a1e4945`), `Task 088` (`c8cf1f8`), `Task 089` (`cde3a46`).

## 3. Files inspected
- `packages/planner/package.json`
- `packages/planner/src/system-arch/{synthesizer.ts,skeleton-lock.ts}` (`083`)
- `packages/planner/src/feature-arch/{synthesizer.ts,skeleton-lock.ts}` (`084`)
- `packages/planner/src/views-export/{ef-node-marker.ts,exporter.ts}` (`085`)
- `packages/planner/src/views-import/{markers.ts,manifest.ts,importer.ts}` (`086`)
- `packages/planner/src/revisions/engine.ts` (`087`)
- `packages/planner/src/slicer/{slicer.ts,skills.ts,types.ts}` (`088`)
- `packages/planner/src/rule-matching/{kb-pull-tool-handlers.ts,pull-to-push-feedback-analyzer.ts}` (`089`)
- `schema/state.sql` (`lines 250–360`)

## 4. Architecture documents consulted
- `knowledge-database.md` (`.harness/views/` Markdown export/import round-trip, `<!-- ef:node -->` markers, `ef-fields` YAML, `.manifest.json`, `Must`/`Should`/`Could` brief slicing, `kb.*` pull tools, pull-to-push promotion, hybrid revision impact walk)
- `build-pipeline.md` (`system-architect@1`, upfront skeleton lock, `feature-architect@1` JIT wave synthesis)
- `schema/state.sql` (`names` trigger from `fields.names`, `task_holds.reason`)

## 5. Contracts and signatures discovered
- `SystemArchitectureSynthesizer.synthesize(input): Promise<SynthesisResult>` & `SkeletonLockEnforcer` (`083`)
- `JitFeatureArchitectureSynthesizer.synthesize(request): SynthesisResult` & `SkeletonLockEnforcer` (`084`)
- `KnowledgeViewExporter.exportAll() / exportIncremental(): Promise<ExportResult>` & `EfNodeMarkerFormatter` (`085`)
- `MarkdownDirectEditImporter.reconcile(): ImportSession` (`086`)
- `HybridRevisionEngine.commitBatch(input): RevisionBatchRecord` (`087`)
- `KnowledgePacketSlicer.compile(graph, request): CompiledBrief` (`088`)
- `KbPullToolHandlers.register(server)` & `PullToPushFeedbackAnalyzer.run(input, hook)` (`089`)

## 6. Confirmed findings
- **F-037** (**CRITICAL**) — `views-export` (`Task 085`) and `views-import` (`Task 086`) are completely incompatible on `.manifest.json` (`{ revision, records }` vs `{ files, nodes }`), `<!-- ef:node -->` opener `base_hash` (`sha256:<64-hex>` vs `/^[0-9a-f]{64}$/`), `<a id="..."></a>` anchor injection (polluting `localProse` in `086`), marker escaping (`\<!--` vs `<!-- ef:escaped`), `ef-fields` YAML serialization, `ExportPauseLock` method names (`pause`/`isPaused` vs `acquire`/`release`), and synchronous `DocImportModel.complete` in `086`.
- **F-038** (**HIGH**) — `system-arch` (`Task 083`) and `feature-arch` (`Task 084`) define duplicate conflicting `SkeletonLockEnforcer` and `DeterministicArchConsistencyGate` classes (`arch_role` vs `role`, `ArchitectureStore` vs `SkeletonSnapshot`), `084` `JitFeatureArchitectureSynthesizer.synthesize` is synchronous without calling `feature-architect@1` or persisting to `state.db` (`persisted: true` is returned on in-memory arrays, and `registeredNames` uses `fields.registeredNames` instead of `schema/state.sql`'s trigger-watched `fields.names`), while `083` `seed()` re-inserts existing `decision`/`spec_item`/`rule` IDs.
- **F-039** (**HIGH**) — Three-way MCP `kb.*` tool-name and band/hold mismatch across `AttemptMcpServer` (`048`), `KnowledgePacketSlicer` (`088` `KB_PULL_TOOL_IDS`: `kb.get`, `kb.contract`, `kb.neighbors`, `kb.why`, lowercase `"must"|"should"|"could"`, `WORKER_LEVELS = ["junior", "senior"]` only), `KbPullToolHandlers` & `PullToPushFeedbackAnalyzer` (`089`: `kb.get_node`, `kb.get_contract`, `kb.list_rules_for_tags`, uppercase `"MUST"|"SHOULD"|"COULD"`, unwired `SlicerPromotionHook`), and `HybridRevisionEngine` (`087`: `task_holds.reason = "revision_in_flight"` instead of `schema/state.sql` & `Task 021`/`107` `"requirement_change"`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `083` (`system-arch`) → `084` (`feature-arch`) → `090–092` (`master-plan`, `feature-plan`, `graph-compiler`).
- `085` (`views-export`) ↔ `086` (`views-import`) → `087` (`revisions`) → `107–108` (`scheduler`, `plan-preview`).
- `078/104` (`skill-vetting`) + `077` (`tag-detector`) → `088` (`slicer`) ↔ `089` (`rule-matching`) ↔ `048` (`mcp-server`).

## 9. Defects and missing integrations
- `packages/planner/package.json` depends only on `@ef-harness/shared-contracts`, `yaml`, and `@parcel/watcher` — missing `@ef-harness/db`, `@ef-harness/discovery`, `@ef-harness/spec-expansion`, `@ef-harness/research-engine`, `@ef-harness/mcp-server`, `@ef-harness/meta-lab`, and `@ef-harness/worker-loop`.
- Broken `.harness/views/` export↔import round-trip (`085` ↔ `086`).
- Broken `kb.*` MCP tool names and band casing (`048` ↔ `088` ↔ `089`).

## 10. Tests and verification performed
- Line-by-line comparison of `views-export/{ef-node-marker.ts,exporter.ts}` vs `views-import/{markers.ts,manifest.ts,importer.ts}`, `system-arch` vs `feature-arch`, `revisions/engine.ts` vs `schema/state.sql`, and `slicer` vs `rule-matching` vs `mcp-server`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- Unmerged `packages/planner` execution submodules (`Tasks 090–095`: `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, `sequential-runner`) — next in `pass-03/chunk-005`.
