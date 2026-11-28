---
task_id: "Task-158"
branch: "task/158-dictation-vocabulary-normalizer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/dictation/src/vocabulary/**"
  - "packages/dictation/tests/vocabulary/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 158 handoff

Per-project dictation vocabulary, 224-token highest-weight-last Whisper prompt, 2-occurrence correction memory, and project-verified spoken-ID normalization. Commit stays on `task/158-dictation-vocabulary-normalizer`.

## Exports Provided

Import from `packages/dictation/src/vocabulary/index.ts`:

- `ProjectDictationVocabularyManager` and `createProjectDictationVocabularyManager`
- `WhisperInitialPromptBuilder`
- `TwoOccurrenceCorrectionLearner`
- `ProjectVerifiedSpokenIdNormalizer`
- `WHISPER_PROMPT_TOKEN_LIMIT` (`224`) and `CARRY_INITIAL_PROMPT_FLAG` (`--carry-initial-prompt`)
- `MemoryVocabularyStore`, `MemoryProjectStateCatalog`, `FrozenGlobalVocabularyStore`, `MemoryGlobalDbVocabularyDriver`
- Ports: `VocabularyStore`, `ProjectStateIdCatalog`, `KnowledgeGraphVocabularyPort`, `NameRegistryVocabularyPort`, `BrownfieldSymbolVocabularyPort`, `CanvasFocusVocabularyPort`, `LocalWhisperPromptPort`, `GlobalDbVocabularyDriver`

`buildPrompt` always returns `args: ["--prompt", text, "--carry-initial-prompt"]` with `tokenCount <= 224` and terms ordered lowest effective weight first. Promoted corrections expose tooltip `Auto-corrected from '<heard>' · Undo` and `undo(spanId)`. Spoken IDs become `R17`, `T-42`, `REQ-3`, or `A0014` only when that id is in the project catalog and the phrase is not `there`/`they`/`we`/`you are <number>`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/dictation/src/index.ts` is outside this task's owned subtree. The integrator should re-export the vocabulary barrel:

```ts
export {
  CARRY_INITIAL_PROMPT_FLAG,
  ProjectDictationVocabularyManager,
  ProjectVerifiedSpokenIdNormalizer,
  TwoOccurrenceCorrectionLearner,
  WHISPER_PROMPT_TOKEN_LIMIT,
  WhisperInitialPromptBuilder,
  createProjectDictationVocabularyManager,
} from "./vocabulary/index.js";
```

No root `package.json` or workspace barrel change.

## Dependency Intents (New Packages Requested)

None. Whisper BPE ranks are vendored at `packages/dictation/src/vocabulary/gpt2.tiktoken` (openai-whisper GPT-2 ranks). No new npm dependency.

## Contract Change Requests

Do not edit frozen `schema/global.sql` from this branch. The live table is:

`vocabulary(term, project, weight, source CHECK ('correction','glossary','dependency','pattern','global'), heard_as, hits, updated_at)` with `project ''` = global.

Task 158's logical row is `term, project_id, weight, source ('entity_auto'|'user_correction'|'user_manual'|'tech_stack'), correction_from, occurrence_count, last_used_at, suppressed`.

`FrozenGlobalVocabularyStore` writes the CHECK-legal columns (`user_correction`→`correction`, `user_manual`→`glossary`, `tech_stack`→`dependency`, `entity_auto`→`pattern`, `correction_from`→`heard_as`, `occurrence_count`→`hits`, `last_used_at`→`updated_at`) and stores `suppressed`, logical `source`, `heard_forms`, and distinct `occurrence_ids` in settings key `dictation.vocabulary.sidecar.v1` until an additive migration adds `suppressed` and the task source enum.

## Sibling Ports (swap when those branches land)

Sibling task branches are not on this base. Local ports stand in:

| Sibling | Local port | Swap |
| --- | --- | --- |
| Task 014 `GlobalDbRepo.vocabulary` | `GlobalDbVocabularyDriver` + `FrozenGlobalVocabularyStore` | Drive upsert/list/delete on `global.db.vocabulary` and the sidecar setting. |
| Task 017 `KnowledgeGraphRepo` | `KnowledgeGraphVocabularyPort.listCanonicalNames` | Active entity/feature/module titles from `state.db`. |
| Task 019 `NameRegistryRepo` | `NameRegistryVocabularyPort.listRegisteredNames` | Registered canonical names. Also back `ProjectStateIdCatalog` (`hasActiveRule`, `hasTask`, `hasActiveWorker`, `hasRequirement`) with real `R17` / `T-42` / `A0014` / `REQ-3` rows. |
| Task 154 Canvas focus | `CanvasFocusVocabularyPort.describeBox` | `focusCanvasBox(projectId, "entity:DietaryTag" \| "feature:CateringEmail")` boosts the box and neighbors to the prompt tail. |
| Task 156 `Correct (misheard)` | `TwoOccurrenceCorrectionLearner.observeCorrection` | Pass a distinct `occurrenceId` per turn. Count `>= 2` promotes; a suppressed row never re-learns. |
| Task 157 `LocalWhisperSttEngine` | `LocalWhisperPromptPort.applyCarryInitialPrompt` | Pass `prompt.args` to whisper.cpp on every 30s window. |
| Task 167 L0/L1 symbols | `BrownfieldSymbolVocabularyPort.listSymbolNames` | `kind: "library"` becomes `tech_stack`; other symbols become `entity_auto`. Case-only tech aliases canonicalize to `PostgreSQL`, `Playwright`, `Supabase`, `MenuItem`, `Mailpit`, `Stripe`, `OAuth`, `SQLite`, `Next.js`, `tRPC`, `Prisma`, `Vite`, `Postgres`. |

Project brand terms stay on `project_id` until `promoteToGlobal`. Global rows use `project_id === ""`.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/dictation test -- vocabulary` — 5 files, 16 tests passed. Covers `<= 224` BPE tokens over 800 terms (highest weight at the tail, `--carry-initial-prompt`), composite focus ordering, 1-occurrence vs 2-occurrence promotion, casing (`PostgreSQL` / `Supabase` / `OAuth` / `SQLite` / `Next.js` / `tRPC` / `Prisma` / `Vite`), permanent `suppressed` opt-out, `"there are two menus"` vs `"change rule two"`, nonexistent `T-99`, and `project_id` isolation.
- `pnpm --filter @ef-harness/dictation typecheck` — passed (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/dictation lint` — passed (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 158 --require-ready` — passed (`harmony ok for Task-158`, exit 0).

## Known Limitations / Follow-Ups

- `packages/dictation/src/index.ts` does not re-export this barrel yet (owned-path boundary).
- Suppression and the task source enum cannot live in the frozen `vocabulary` CHECK. The settings sidecar is the stand-in until Task 014/015 migrate the table.
- Spoken-ID existence is whatever `ProjectStateIdCatalog` reports. Wire it to `state.db` in Task 017/019; this branch does not open SQLite.
- Auto-correction undo restores the matched draft slice. Spoken-ID replacements are deterministic text rewrites, not Composer widgets.
