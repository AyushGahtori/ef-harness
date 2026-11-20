---
task_id: "Task-088"
branch: "task/088-knowledge-packet-slicer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/slicer/**"
  - "packages/planner/tests/slicer/**"
  - ".agent-handoffs/task-088.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 088 handoff

Knowledge packet slicer: Must / Should / Could bands, Start + Middle + End checklist layout, junior and senior token caps, pinned `sliceSha256`, and oversized-Must refusal. Commit stays on `task/088-knowledge-packet-slicer`.

## Exports Provided

Import from `packages/planner/src/slicer/index.ts` until the planner barrel is wired:

- `KnowledgePacketSlicer` — `compile(graph, request)` and `reconstruct(reader, manifest)`.
- `BriefLayoutCompiler` — Start / Middle / End checklist text and region token offsets.
- `BandTokenBudgeter` — whitespace token counts, remaining Should budget, relevance trim, skill excerpts.
- `OversizedMustAutoSplitGuard` and `OversizedMustTaskError` — hard refusal when Must alone is above 3,000 (junior) or 6,000 (senior), with per-node attribution and split or senior cost recommendations.
- `BriefManifestStore` — writes `slicer_brief_manifests` and pushed `read_sets` rows.
- `SqliteSliceGraph`, `createSliceDatabase`, and the insert helpers — in-memory graph port.
- `assertWorkerBriefPacket` / `buildWorkerBriefPacket` — local `task-packet@1` shape.
- `LocalEntityTagInheritor`, `LocalSkillSelector`, `RULE_CATALOG`, `KB_PULL_TOOL_IDS`, `LEVEL_BUDGETS`.

`compile` throws `OversizedMustTaskError` instead of returning a truncated Must band. Sealed `hidden_check` / `sealed_oracle` / `oracle-author@1` nodes are stripped, counted in `checks_hidden_count`, and logged as `OracleLeakPreventedAssertion`. `BriefLayoutCompiler.compile` throws `OracleLeakError` if a caller hands it a sealed item directly.

Compiled manifest fields: `includedNodeIds`, `trimmedShouldIds`, `couldIndexIds`, `tokenBreakdown`, `sliceSha256`, plus pinned items, node versions, and the rendered brief. `sliceSha256` is SHA-256 over RFC 8785 canonical JSON `{ level, nodes: [{ contentHash, id, version }], skills: [{ id, sha256 }], taskId }`. Numbers in that payload are integers.

Token ceilings: junior target 2,000–3,000 (hard 3,200, Must refusal above 3,000); senior target 4,000–6,000 (hard 6,400, Must refusal above 6,000). A junior Must band that fits in one senior brief recommends `Split into 2 Junior tasks` at $0.10 (2 × $0.05) or `Assign Senior level` at $0.40. Larger bands recommend the piece counts `ceil(tokens / 3000)` and `ceil(tokens / 6000)`.

Should trim keeps higher `relevance` first. Research facts, stubs, and module cards that do not fit move wholly to Could pointers (`kb.get_fact('id')`, `kb.contract('id@version')`, `kb.code('path')`). Skills may be excerpted down to the remaining words, still under the 2-skill and 3,500 combined caps. Informal tags `api` and `data` match only `X-01`, `X-02`, `UP-02`, and `UP-03`. `ui` / `payment` stay on the UI and money rules. Screen specs linked by `documents` enter Must only when the task has a UI tag.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` in this task. When integration is allowed to touch the barrel, re-export:

```ts
export {
  BandTokenBudgeter,
  BriefLayoutCompiler,
  BriefManifestStore,
  KnowledgePacketSlicer,
  LocalEntityTagInheritor,
  LocalSkillSelector,
  OversizedMustAutoSplitGuard,
  OversizedMustTaskError,
  SqliteSliceGraph,
  assertWorkerBriefPacket,
} from "./slicer/index.js";
```

No root `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits. No `packages/*/src/index.ts` edit.

## Dependency Intents (New Packages Requested)

None. Token counts and the RFC 8785 hash use `node:crypto` and a whitespace word counter. The graph fixture uses built-in `node:sqlite` (`DatabaseSync`). Do not add `tiktoken`, `zod`, or `better-sqlite3` for this task.

## Contract Change Requests

None of `schema/`, `.opencode/`, or `.githooks/` were edited.

- `schema/state.sql` has no `brief_manifest` column on `attempts` or `task_runtime`. This task stores the pin in a slicer-owned table `slicer_brief_manifests (attempt_id, task_id, level, brief_text, manifest_json, slice_sha256)` and records pushed nodes in the existing `read_sets` shape (`how = 'pushed'`). Integration should add a real manifest column or keep this table in a migration owned by the kernel.
- `edge_types` does not include `touches`, `reads`, `writes`, or `belongs_to`. The slice reader accepts those link types on its fixture table. A `KnowledgeGraphRepo` adapter must project them into `SliceEdge` rows. `task_scopes.mode` (`write` | `read`) is also a local column; the real table is write prefixes only, and read boundaries should keep coming from task fields until the schema grows a read scope.
- `module_cards` has no summary text. The reader uses a `summary` column when present. Swap that for the artifact body from Task 168.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-088-knowledge-packet-slicer`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- slicer` — 14 passed. Covers Must/Should/Could partitioning, stable `sliceSha256`, junior 2–3k and senior 4–6k caps, the 7,800-token checkout refusal (`Order: 2.1k`, `Payment: 2.4k`, `Tax: 1.8k`), the 3,400-token junior split-or-senior recommendation, oracle stripping plus a direct layout throw, Start/Middle/End structure, `kb.get_fact('F-12')` fallback, the api/data rule bundle at 2,100 tokens, three-path dedup, shared project prefix, historical `R-7` reconstruction, the 2-skill / 3,500 cap, the 1,800 Should budget, and senior-only failure-mode excerpts.
- `node scripts/verify-harmony.mjs --task 088` — `harmony ok for Task-088` (exit 0). The command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`. The commit gate runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports should be swapped at integration:

- **Task 008.** `assertWorkerBriefPacket` is the local structural stand-in for `WorkerBriefSchema` / `TaskPacketV1Schema` (`local-port:task-008`). Replace it with the Zod schema from `@ef-harness/shared-contracts` once that barrel exports it. `budget.usd`, `budget.slots`, and `limits` are integer zeros. Wire real micro-USD and wall limits from the ledger when Task 023 is on the base. `checks_hidden_count` is a count only; sealed ids never enter `must`, `should`, or `could`.
- **Task 017.** `SqliteSliceGraph.source` is `local-port:task-017`. Replace `neighborhood`, `getNode`, and `getNodeAsOf` with `KnowledgeGraphRepo` (`getNode`, `getNodeAsOf`, current edges). Reconstruction reads `node_versions` for non-synthetic, non-excerpt items and checks `content_hash`.
- **Tasks 076 and 077.** `RULE_CATALOG_SOURCE` is `local-port:task-076-077`. The catalog copies the X-01..X-14 and UP-01..UP-08 scopes and adds informal `api` / `data` selectors so a task tagged only `['api', 'data']` receives exactly `X-01`, `X-02`, `UP-02`, and `UP-03`. `LocalEntityTagInheritor.source` is `local-port:task-077`. Swap both for `EntityTagInheritor` and the on-disk rule and policy catalogs. Inherited `pii` / `money` / `multi_tenant` behavior stays on that task.
- **Task 078.** `LocalSkillSelector.source` is `local-port:task-078`. It ranks vetted skills by exact role, tag specificity, overlap, then shorter text, and keeps at most 2 skills and 3,500 combined whitespace tokens. Swap for `SkillManifestRegistry` plus `SkillTokenBudgetEnforcer`. This counter is not the cl100k/o200k upper bound from Task 078; do not mix the two numbers without converting.
- **Task 089.** `KB_PULL_TOOL_IDS` lists `kb.search`, `kb.get`, `kb.neighbors`, `kb.contract`, `kb.why`, `kb.code`, and `kb.get_fact`. The handlers are not implemented here. Trimmed Should facts use the pointer form `kb.get_fact('F-12')`.
- **Task 168.** Module-card summaries are a local column. Swap for brownfield module-card artifacts.
- **Tokenizer.** Band math uses one whitespace word as one token so fixtures can hit 2,100, 3,400, and 7,800 exactly. A later shared tokenizer should replace `countTokens` without changing the ceiling constants.
- **Senior failure modes.** `fields.failureModes` on a consumed contract, entity, or endpoint is a Should excerpt for senior briefs only. The excerpt is pinned as synthetic text (`id#failure`) because it is not the node body.
- **Under-target briefs.** A task whose Must band and available Should material are below 2,000 (junior) or 4,000 (senior) is still compiled. The caps refuse overflow; they do not pad.
- **Cache prefix.** `project`, `stack`, and sorted `universal` lines are rendered before `## START` and are identical for every task that shares the same `ProjectPrefix`. Task rules stay after that prefix.
