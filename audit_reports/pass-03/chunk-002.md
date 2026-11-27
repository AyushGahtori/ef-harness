# Pass 03 — Chunk 002: Corpus Loader, Cross-Cutting Tag Detector, Skill Vetter & Corpus Waves (`Tasks 075–078, 103–104`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-002`
- **Unit IDs:** `Task 075`, `Task 076`, `Task 077`, `Task 078`, `Task 103`, `Task 104`
- **Branches and commits:**
  - `task/075-corpus-loader-core-data-auth` (`db21117`, merged into `harness/integration`)
  - `task/076-corpus-web-api-cli-elaborations` (`8764a25`, merged into `harness/integration`)
  - `task/077-cross-cutting-rules-seams-tags` (`b73f44c`, merged into `harness/integration`)
  - `task/078-skill-vetting-quarantine-catalog` (`404d945`, merged into `harness/integration`)
  - `task/103-corpus-wave1-expanded-packs` (`1637274`, unmerged)
  - `task/104-corpus-wave2-packs-14-skills` (`c02800d`, unmerged)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration`, `C:/Users/Ayush/Desktop/ef-wt/task-103-corpus-wave1-expanded-packs`, `C:/Users/Ayush/Desktop/ef-wt/task-104-corpus-wave2-packs-14-skills`
- **Governing architecture documents:** `discovery-depth-and-catalog.md`, `completeness-and-quality.md`, `security-and-governance.md`, `research/question-catalog-and-depth.md`, `skills/infer-or-ask/SKILL.md`, `IMPLEMENTATION_TASKS.md` (`Tasks 075–078, 103–104`).

## 2. Units inspected
- `Task 075` (`db21117`), `Task 076` (`8764a25`), `Task 077` (`b73f44c`), `Task 078` (`404d945`), `Task 103` (`1637274`), `Task 104` (`c02800d`).

## 3. Files inspected
- `packages/discovery/src/corpus-loader/{load.ts,interpret.ts,validate.ts,yaml.ts}`
- `corpus/packs/core-data-auth/core.yaml` (`Task 075`)
- `corpus/packs/web-api-cli/{manifest.yaml,web.yaml}`, `corpus/elaborations/{web.yaml,core-data-auth.yaml}`, `corpus/policies/universal-policies.yaml` (`Task 076`)
- `corpus/rules-seams/{cross-cutting-rules.yaml,seam-templates.yaml}`, `packages/planner/src/tag-detector/catalog.ts` (`Task 077`)
- `corpus/skills/manifest.json`, `packages/meta-lab/src/skill-vetting/{catalog.ts,registry.ts}` (`Task 078`)
- `corpus/packs/wave1-expanded/payments.yaml`, `corpus/elaborations/wave1/payments.yaml` (`Task 103`)
- `corpus/packs/wave2-expanded/{manifest.yaml,desktop.yaml}`, `corpus/skills/wave2/manifest.json` (`Task 104`)

## 4. Architecture documents consulted
- `discovery-depth-and-catalog.md` (corpus pack schema, `Q-*` question IDs, option elaborations, universal policies `UP-01..UP-08`, cross-cutting rules `X-01..X-12`, seam templates `S-01..S-10`)
- `security-and-governance.md` (quarantine skill vetting, pinned `manifest.json`, closed 28-tag `TOUCHES_TAGS`)

## 5. Contracts and signatures discovered
- `CorpusPackLoader` / `loadCorpusPacks(corpusRoot, options): CorpusBundle` (`packages/discovery/src/corpus-loader/load.ts`)
- `CorpusQualityValidator.validate(bundle: CorpusBundle): void` (`validate.ts`)
- `parseStrictYaml(source, filePath, options)` (`yaml.ts`)
- `RulesSeamsCatalogLoader.load(): RulesSeamsCatalog` (`packages/planner/src/tag-detector/catalog.ts`)
- `SkillManifestRegistry` (`packages/meta-lab/src/skill-vetting/registry.ts`): `manifestFile()`, `skillDirectory(skillId)`, `loadForMount(skillId)`

## 6. Confirmed findings
- **F-032** (**CRITICAL**) — `loadCorpusPacks(repositoryCorpusRoot())` (`Task 075`) crashes immediately on `harness/integration` and when landing `Task 104`:
  1. `yaml.ts` rejects YAML anchors/aliases (`&a1` / `*a1`) and multi-line folded plain scalars used throughout `Task 076` (`web-api-cli/*.yaml`, `elaborations/*.yaml`) and `Task 104` (`wave2-expanded/*.yaml`, `elaborations/wave2/*.yaml`).
  2. `collectCorpusFiles` walks `manifest.yaml` (`076`, `104`) and `activation-table.yaml` (`104`) inside `corpus/packs/**` and treats them as `question_pack` documents, throwing `CorpusShapeError`.
  3. `075` + `103` use canonical Format A (`kind: question_pack`, `Q-CORE-01` IDs, `positive_examples`/`negative_examples`, `consequences`, `cells`), whereas `076` + `104` use incompatible Format B (`pack`/`pack_version`, dotted `id: ui.responsive_targets` + `code: Q-WEB-01`, `examples: { positive, negative }`, `clauses`, object `bounds`), `076` `universal-policies.yaml` omits `kind`/`id`/`cell`/`value`, and `077` `cross-cutting-rules.yaml` & `seam-templates.yaml` use rich schemas (`requirement`, `verification_check`, `left`/`right`/`contract_shape`) rejected by `075` `readRulePack`/`readSeamPack`.
  4. `076` `corpus/elaborations/core-data-auth.yaml` targets nonexistent dotted question IDs and option IDs (`product.purpose` / `internal_workflow`, `product.audience` / `office_staff`) from its private test fixture `port/task-075-questions.json` instead of `Task 075`'s real `Q-CORE-01..18`, `Q-DATA-01..06`, `Q-AUTH-01..05` questions and options!
- **F-033** (**HIGH**) — `packages/meta-lab/src/skill-vetting` (`Task 078`) and `Task 104` (`corpus/skills/wave2`) have a split skill manifest/directory layout and invalid `allowedTouches` vocabulary:
  1. `M2_CATALOG_META` and `corpus/skills/manifest.json` (`078`) use 10 non-canonical `allowedTouches` strings (`"requirements"`, `"decisions"`, `"debugging"`, `"regression"`, `"tests"`, `"verification"`, `"accessibility"`, `"schema"`, `"migrations"`, `"validation"`) outside `Task 010`'s closed 28-tag `TOUCHES_TAGS`.
  2. `SkillManifestRegistry` (`078`) hardcodes `corpus/skills/manifest.json` (6 skills) and `corpus/skills/m2/<skillId>`, while `Task 104` puts 14 skills in `corpus/skills/wave2/<skillId>` with a separate `corpus/skills/wave2/manifest.json` (containing extra `wave`, `tokenizer`, `quarantineReceipt` fields) and duplicates M2 skills under `packages/discovery/tests/corpus-wave2/port/m2-skills/`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `corpus/**` (`075, 076, 077, 103, 104`) → consumed by `CorpusPackLoader` (`075`), `RulesSeamsCatalogLoader` (`077`), `SpecMatrixGenerator` & `OptionElaborationCompiler` (`079–080`), `RuleMatchingEngine` (`089`), `GreedyQuestionSelector` (`072`), and `StageDepthController` (`073`).
- `corpus/skills/**` + `SkillManifestRegistry` (`078, 104`) → consumed by `KnowledgePacketSlicer` (`088`) and `MetaLabBenchmarkRegistry` (`189`).

## 9. Defects and missing integrations
- Unified corpus YAML schema + loader breaks across `075` ↔ `076` ↔ `077` ↔ `103` ↔ `104`.
- `core-data-auth.yaml` elaborations (`076`) do not match `core-data-auth/*.yaml` question/option IDs (`075`).
- Unified 20-skill manifest and `TOUCHES_TAGS` compliance broken between `078` and `104`.

## 10. Tests and verification performed
- Directly compared `load.ts`, `interpret.ts`, `validate.ts`, and `yaml.ts` (`075`) against actual YAML documents in `075`, `076`, `077`, `103`, and `104`, and compared `skill-vetting/{catalog.ts,registry.ts}` (`078`) against `corpus/skills/manifest.json` (`078`) and `corpus/skills/wave2/manifest.json` (`104`).

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- How `packages/spec-expansion` (`079–081` + dirty `task-079`) consumes `CorpusBundle` (`elaborations`, `policies`, `rules`) and writes `nodes`/`edges` into `state.db`, plus `packages/research-engine` (`082`) — next in `pass-03/chunk-003`.
