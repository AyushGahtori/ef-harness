---
task_id: "Task-084"
branch: "task/084-feature-architecture-wireframes"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/feature-arch/**"
  - "packages/planner/tests/feature-arch/**"
  - ".agent-handoffs/task-084.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 084 handoff

JIT one-wave-ahead `feature-architect@1` synthesis, screen specs, low-fi wireframes, and architecture document sharding. Commit stays on `task/084-feature-architecture-wireframes`.

## Exports Provided

Import from `packages/planner/src/feature-arch/index.ts` until the planner barrel is wired:

- `JitFeatureArchitectureSynthesizer` synthesizes one wave ahead, anchors wave N+1 to a scanned tree, materializes graph nodes and edges, runs the consistency gate, and shards the result.
- `ScreenSpecGenerator` builds canonical `screen_spec` records and rejects incomplete M03 states, unknown primitives, and raw styling.
- `LowFiWireframeRenderer` renders deterministic SVG and ASCII wireframes at 1440px and 375px and flags horizontal overflow.
- `ArchDocumentSharder` projects nodes into `architecture/system.md`, `architecture/features/<slug>.md`, `architecture/screens/<slug>.md`, and `architecture/contracts/<slug>.md`, with a 3,000-token ceiling and one canonical shard per node.

`ScreenSpecSignoff` exposes a hash, a line diff of the spec plus both wireframes, and structured label, route, role, and state edits for pre-build review.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` in this task. When integration is allowed to touch the barrel, re-export these from `@ef-harness/planner`:

- `JitFeatureArchitectureSynthesizer`
- `ScreenSpecGenerator`
- `LowFiWireframeRenderer`
- `ArchDocumentSharder`

No root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

## Dependency Intents (New Packages Requested)

None. The module uses Node built-ins only. It does not import `zod` or `mermaid`. When Task 009 exports `FeatureArchitectV1Schema` from `@ef-harness/shared-contracts`, replace `parseFeatureArchitectV1` with that validator through the package barrel.

## Contract Change Requests

None. `schema/state.sql` has no `screen_spec` node kind. Screen specs are stored as `arch_node` with `fields.role = "screen_spec"`. Edges use the existing edge types (`implements`, `produces_contract`, `handles_edge_case`, `belongs_to`, `obeys`, `depends_on`).

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-084-feature-architecture-wireframes`:

- `pnpm --filter @ef-harness/planner test -- feature-arch` — 19 passed (wave 1 synthesis, premature wave 3, wave 2 fixture anchoring, phantom export, M03 states, raw styling, 1440/375 wireframes and mobile overflow, signoff diff, shard ceiling and single-owner shards, write-path collision, hoist and split, skeleton CCR, hoisted rule, gate fault classes, headless CLI/API with zero screens, 5% paperwork ceiling, feature-architect schema).
- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `node scripts/verify-harmony.mjs --task 084` — `harmony ok for Task-084` (exit 0). The commit gate runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports should be swapped at integration:

- **Task 009.** `LOCAL_PORTS.featureArchitectV1Schema` is `local-port:task-009`. `parseFeatureArchitectV1` is a closed structural parser for `{ flows, screens, state_machines, internal_contracts, handling, hoisted_rules }` and the `{ blocked: true, reason }` exit. Replace it with the Zod `FeatureArchitectV1Schema` from `@ef-harness/shared-contracts`. Do not deep-import `packages/shared-contracts/src/**`.
- **Task 083.** `SkeletonLockEnforcer.source` and `DeterministicArchConsistencyGate.source` are `local-port:task-083`. `MERMAID_PARSER_SOURCE` is `local-port:task-083-mermaid`. The gate checks dangling refs, shadowed names, unhoisted duplicated rules, orphan requirements, feature cycles, seam ids `S-01`..`S-10`, disjoint write paths, and skeleton locks. Diagram checks are structural (header, arrows, balanced brackets, unquoted parentheses in `[]` labels). Swap both classes and `mermaidIssues` for the Task 083 exports, including the real in-process Mermaid parser.
- **Task 077.** `SEAM_CATALOG_SOURCE` is `local-port:task-077`. `SEAM_TEMPLATES` is the ten seam ids, names, shared edge kinds, and contract shapes. Replace it with `RulesSeamsCatalogLoader` / `seam-templates.yaml`. Bindings instantiate `templateId`, `sharedKind`, `sharedName`, and `peer` on an `arch_node` with `fields.role = "seam_binding"`.
- **Task 079.** `M03_SOURCE` is `local-port:task-079`. Web screens require `empty`, `loading`, `populated`, `error`, `validation_error`, `unauthorized`, and `offline/slow`. `print` is required only when the screen or feature tags include `print`.
- **Task 094.** `LAYOUT_TEMPLATE_SOURCE` is `local-port:task-094`. Allowed templates are `app-shell`, `page-header`, `list-detail`, `form-page`, `empty-state`, and `error-state`. Allowed primitives are the Phase 0 kit (`AppShell`, `PageHeader`, `Button`, `Card`, `Input`, `Table`, `Dialog`, `Toast`, `EmptyState`, `ErrorState`, `Form`, `Nav`, `Text`, `Stack`). On wave 2+, a primitive must also appear in the scanned design-system components.
- **Task 090.** `LOCAL_PORTS.paperworkBudget` is `local-port:task-090`. The ceiling is `floor(waveTokenBudget * 0.05)` using a whitespace word count. This does not read the Task 090 ledger.
- **Task 017 and Task 019.** `LOCAL_PORTS.knowledgeGraph` is `local-port:task-017` and `LOCAL_PORTS.nameRegistry` is `local-port:task-019`. Nodes and edges are in-memory records shaped like `state.db` (`kind`, `fields.basis`, edge types). Names are `fields.registeredNames`. Nothing is written to SQLite. Swap persistence to `KnowledgeGraphRepo` and `NameRegistryRepo` when those barrels exist.
- **Tasks 154 and 156.** `LOCAL_PORTS.boxChatSignoff` is `local-port:task-154-156`. `ScreenSpecSignoff` is the diffable spec and wireframe surface those tasks should call. It is not their box-chat UI.
- **Observed tree.** Wave N+1 scans a caller-supplied directory for export signatures, `CREATE TABLE` columns, and PascalCase components under `components/`, `ui/`, or `design-system/`. Tests point that root at `packages/planner/tests/feature-arch/fixtures/integration`. Point `integrationRoot` at the live `harness/integration` worktree when a merged wave is actually present. A missing export in a hinted file with exactly one value export is rewritten to that export; a hinted module path that exists replaces the stale write path.
- **Write-path collisions.** The default policy is `reject` and nothing is persisted. `hoist-shared` moves the path to `phase0-foundation`. `split-modules` rewrites `src/lib/formatters.ts` to `src/lib/<slug>/formatters.ts`.
- **No model calls.** Synthesis, validation, wireframes, sharding, and the gate are deterministic TypeScript over the structured brief.
