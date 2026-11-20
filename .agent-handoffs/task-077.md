---
task_id: "Task-077"
branch: "task/077-cross-cutting-rules-seams-tags"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "corpus/rules-seams/**"
  - "packages/planner/src/tag-detector/**"
  - "packages/planner/tests/tag-detector/**"
  - ".agent-handoffs/task-077.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 077 handoff

Cross-cutting rules `X-01`–`X-14`, the 10 seam templates, diff auto-tagging, entity tag inheritance, and the stage coherence self-test. Commit stays on `task/077-cross-cutting-rules-seams-tags`.

## Exports Provided

Import from `packages/planner/src/tag-detector/index.ts` until the planner barrel is wired:

- `RulesSeamsCatalogLoader` loads `corpus/rules-seams/cross-cutting-rules.yaml` and `corpus/rules-seams/seam-templates.yaml`, then runs `StaticRuleLintGate`.
- `DiffAutoTagDetector` reads a unified diff and returns the closed touches tags, per-file signals, and a scope-creep warning when planned tags are passed.
- `EntityTagInheritor` copies entity tags across `touches`, `reads`, and `writes` links onto tasks, endpoints, screens, and APIs, and lists packet rule ids.
- `StageCoherenceSelfTest` checks Prototype, MVP, and Production for `conflicts_with`, `requires`, and numeric elaboration clashes.
- `SeamTaskAutoMatcher` proposes seam templates when two tasks or features share an entity, endpoint, or event and the seam's tag scope matches.
- `StaticRuleLintGate` enforces the 120-token ceiling, non-empty verification checks, closed `{ any, all }` scopes, and positive/negative match cases.
- `matchesScopePredicate`, `CLOSED_TOUCH_TAGS`, and `normalizeTouchTag` are the local scope language. `global: true` is the only way an empty scope is legal.
- `m2StagePort`, `injectPrototypeAuthPreferenceClash`, and `injectNumericDefaultClash` feed the self-test.

`DiffAutoTagDetector` and `EntityTagInheritor` load the on-disk rule catalog when no rules are passed in.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` in this task. When integration is allowed to touch the barrel, re-export the tag-detector public API from `@ef-harness/planner`:

- `RulesSeamsCatalogLoader`
- `DiffAutoTagDetector`
- `EntityTagInheritor`
- `StageCoherenceSelfTest`
- `SeamTaskAutoMatcher`
- `StaticRuleLintGate`

No root `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

## Dependency Intents (New Packages Requested)

`packages/planner/src/tag-detector/catalog.ts` imports `yaml` (`parse` from the `yaml` package). `package.json` is frozen, so this resolves through the root devDependency (`yaml` `^2.8.0`) rather than a declared planner dependency. Add `yaml` to `@ef-harness/planner` dependencies when dependency wiring is allowed. No new package is required.

## Contract Change Requests

None for `schema/`, `.opencode/`, or `.githooks/`. Rule and seam documents live under `corpus/rules-seams/`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-077-cross-cutting-rules-seams-tags`:

- `pnpm --filter @ef-harness/planner test -- tag-detector` — 19 passed (catalog inventory, scope language, token ceiling, diff tags, comment/fixture ignore, scope creep, entity inheritance, seam matching, stage coherence and both negative injections).
- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `node scripts/verify-harmony.mjs --task 077` — `harmony ok for Task-077` (exit 0). The commit gate runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports should be swapped at integration:

- **Task 010.** `TOUCH_TAG_SOURCE` is `local-port:task-010` in `closed-tags.ts`. Replace `CLOSED_TOUCH_TAGS` and `matchesScopePredicate` with the `@ef-harness/shared-contracts` vocabulary barrel once Task 010 exports it. Do not deep-import `packages/shared-contracts/src/vocabularies/**`.
- **Tasks 075 and 076.** `STAGE_CATALOG_SOURCE` is `local-port:task-075-076`. `RulesSeamsCatalogLoader.loadStageCatalog()` returns the in-memory 44-question port (`M2_QUESTION_IDS` from the v1 corpus: core 18, data 6, auth 5, web 6, api 5, cli 4). It does not read `corpus/packs/core-data-auth/**`, `corpus/packs/web-api-cli/**`, `corpus/elaborations/**`, or `corpus/policies/**`. Point `loadStageCatalog()` at those packs when they exist. The port is internally coherent for Prototype, MVP, and Production.
- **Corpus scope plus two task-text tags.** Titles and the corpus scope tags are kept. `X-02` `any` also includes `search` so pagination and bounded queries are selectable. `X-12` `any` also includes `concurrent_edit` so shared-counter locking is selectable. Both extensions are called out in the YAML.
- **Edge-case ids versus the corpus table.** The corpus assigns personal-data redaction to `X-07` (`all: [personal_data, logging]`) and time zones to `X-03`. Inherited `pii` is kept as a label, normalized to `personal_data` for scope checks, and injects `X-07`. `money` injects `X-04`. `multi_tenant` is kept as a label and injects `X-01` (tenant scoping lives on that rule). Diff signals use the informal names `migrations` and `external_http` and emit closed tags `migration` and `external_api`. Scope creep then queues rules whose scopes match the new tags (`external_api` → `X-02` and `X-10`). It does not invent checks for `X-03` or `X-14`, which do not scope to those tags.
- **Planned-tag aliases.** `ui` normalizes to `interactive_ui`. `pii` normalizes to `personal_data`. Unknown planned tags are reported and do not hide detected tags.
- **CLI parsers.** `commander`, `yargs`, and `minimist` are recorded as a `cli_args` signal. The closed 28 tags have no CLI tag, so none is invented.
- **Graph input.** `EntityTagInheritor` takes an in-memory snapshot. `schema/state.sql` edge types do not include `touches`, `reads`, or `writes`; a later db reader should project those links into `KnowledgeGraphSnapshot`. `belongs_to` does not propagate tags.
- **No model calls.** Tag detection, inheritance, seam matching, lint, and coherence are deterministic TypeScript.
