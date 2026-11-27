---
task_id: "Task-104"
branch: "task/104-corpus-wave2-packs-14-skills"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "corpus/packs/wave2-expanded/**"
  - "corpus/elaborations/wave2/**"
  - "corpus/skills/wave2/**"
  - "packages/discovery/tests/corpus-wave2/**"
  - ".agent-handoffs/task-104.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 104 handoff

Wave 2 browser-extension, mobile, and desktop probe packs (15 questions), 46 option elaborations, and the remaining 14 vetted skills that complete the 20-skill v1 catalog. Commit stays on `task/104-corpus-wave2-packs-14-skills`.

## Exports Provided

Machine-readable indexes:

- `corpus/packs/wave2-expanded/manifest.yaml` — 15 question codes and pack paths.
- `corpus/packs/wave2-expanded/activation-table.yaml` — platform activation predicates.
- `corpus/skills/wave2/manifest.json` — SHA-256 pins, git blob ids, token counts, and canary receipts for the 14 Wave 2 skills.
- `corpus/skills/wave2/v1-catalog-index.json` — combined 20-skill index (`6` M2 port rows + `14` Wave 2 rows).

### Question packs

| File | Codes | Ids |
|---|---|---|
| `corpus/packs/wave2-expanded/browser-extension.yaml` | `Q-EXT-01`..`Q-EXT-05` | `extension.surface`, `extension.host_permissions`, `extension.service_worker_state`, `extension.messaging_csp`, `extension.store_packaging` |
| `corpus/packs/wave2-expanded/mobile.yaml` | `Q-MOB-01`..`Q-MOB-05` | `mobile.delivery`, `mobile.offline_sync`, `mobile.device_permissions`, `mobile.store_iap`, `mobile.ergonomics` |
| `corpus/packs/wave2-expanded/desktop.yaml` | `Q-DSK-01`..`Q-DSK-05` | `desktop.distribution`, `desktop.privilege_boundary`, `desktop.lifecycle`, `desktop.secret_storage`, `desktop.ergonomics` |

Elaborations, one per option (46 total): `corpus/elaborations/wave2/browser-extension.yaml`, `corpus/elaborations/wave2/mobile.yaml`, `corpus/elaborations/wave2/desktop.yaml`.

Called-out oracle hints:

- `extension.service_worker_state` / `chrome_storage_local`: `MV3 service worker survives 30s idle unload without losing state.`
- `desktop.secret_storage` / `os_keychain`: `Desktop app stores secrets in OS keychain rather than plaintext JSON.`
- `mobile.delivery` / `pwa_mobile_web`: `Mobile PWA degrades cleanly offline.`

### Activation predicates

A pack turns on only when an explicit target matches or a settled option in the table matches. An empty `settled_all` does not match. Web SaaS, CLI, and API projects with none of those signals get zero Wave 2 questions.

| Pack | Explicit target | Settled any | Settled all | Skill injected | Not applicable when active |
|---|---|---|---|---|---|
| `browser-extension` | `browser_extension` | `delivery.platform=browser_extension` | none | `browser-extension-mv3@1` | `ui.pages_inventory`, criteria `ui.ssr`, `ui.seo` |
| `mobile` | `native_mobile` | `delivery.platform=native_mobile` | none | none | none |
| `desktop` | `desktop_app` | `delivery.platform=desktop` | `desktop.shell=electron` AND `data.storage.engine=sqlite` | `desktop-electron-ipc-security@1` | `ui.pages_inventory`, criteria `ui.ssr`, `ui.seo` |

`Staff open a link on their phones.` settles `mobile_web` (`delivery.platform=web_browser`) and does not activate `native_mobile`, App Store, in-app purchase, or React Native questions. That reading is the local stand-in for M11.

Symmetric conflicts that stage defaults do not select together:

- `extension.host_permissions` / `all_urls` conflicts with `extension.store_packaging` / `chrome_and_firefox_disclosed`.
- `desktop.secret_storage` / `plaintext_json` conflicts with `desktop.privilege_boundary` / `electron_context_isolation`.

### Wave 2 skills (`corpus/skills/wave2/<id>/SKILL.md`)

Each directory also stores `quarantine-report.json` (0 canary accesses, 0 hidden Unicode, 0 global-config writes). `sha256` in the manifest covers every file except that receipt. `pinnedCommitSha` is the git blob id of `SKILL.md`. Token counts use `cl100k-o200k-upper-bound-v1` and are all under 2,000.

| Skill | Roles | Touches | Tokens |
|---|---|---|---|
| `react-state-and-forms@1` | worker | `form_input`, `interactive_ui` | 429 |
| `playwright-e2e-reliability@1` | worker | `interactive_ui` | 350 |
| `stripe-billing-webhooks@1` | worker | `money`, `inbound_webhook` | 355 |
| `auth-session-rbac@1` | worker | `authn`, `authz`, `session` | 345 |
| `rest-openapi-contracts@1` | worker | `external_api` | 368 |
| `cli-ergonomics-and-io@1` | worker | `config_env` | 366 |
| `background-jobs-idempotency@1` | worker | `background_job` | 348 |
| `file-uploads-and-media@1` | worker | `file_upload` | 351 |
| `performance-profiling-sql@1` | worker | `search` | 355 |
| `brownfield-safe-refactoring@1` | worker | `migration` | 377 |
| `codemods-and-sweeps@1` | worker | `migration` | 375 |
| `desktop-electron-ipc-security@1` | worker | `interactive_ui`, `credentials` | 349 |
| `browser-extension-mv3@1` | worker | `interactive_ui`, `route` | 371 |
| `docker-ci-deploy-hygiene@1` | worker | `config_env` | 338 |

Test-local ports, until the discovery and meta-lab barrels exist:

- `CorpusQualityValidator`, `StageCoherenceSelfTest`, `PlatformActivationGate`, `SkillTokenBudgetEnforcer`, `StaticSkillSecurityVetter`, `CanarySkillQuarantineHarness` from `packages/discovery/tests/corpus-wave2/ports.ts`.
- `loadWave2Bundle` from `packages/discovery/tests/corpus-wave2/load.ts`.

`SkillTokenBudgetEnforcer.selectForTask` keeps at most 2 skills and at most 3,500 combined tokens, ranked by an active-pack boost, then exact role, then tag specificity, then overlap.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/discovery/src/index.ts` in this task. There is no new production module to re-export. The corpus files are the contract.

When integration is allowed to touch barrels, point the Wave 2 tests at the sibling barrels and delete the local ports:

```ts
export { CorpusPackLoader, CorpusQualityValidator } from "./corpus-loader/index.js";
export { StageCoherenceSelfTest } from "@ef-harness/planner";
export {
  CanarySkillQuarantineHarness,
  SkillManifestRegistry,
  SkillTokenBudgetEnforcer,
  StaticSkillSecurityVetter,
} from "@ef-harness/meta-lab";
```

Merge `corpus/skills/wave2/manifest.json` into Task 078's `corpus/skills/manifest.json`. Do not keep two pin lists for the same skill id. `v1-catalog-index.json` is the 20-row index Task 088, Task 189, and Task 191 can read until that merge exists.

No root `package.json`, workspace, tsconfig, eslint, or schema edit.

## Dependency Intents (New Packages Requested)

No new package. `packages/discovery/package.json` is frozen.

`packages/discovery/tests/corpus-wave2/load.ts` loads the root `yaml` package (`uniqueKeys: true`) with `createRequire` on the workspace `package.json`. If a future isolated install cannot see that root dependency, add `yaml` to `@ef-harness/discovery` devDependencies in a wiring change. Do not edit the lockfile from this task.

## Contract Change Requests

None. Frozen foundation files were not edited.

Sibling branches are not on this base (`6497730`). Local ports to swap at integration:

- Task 010 closed 28 touches tags: `TOUCHES_TAGS` in `ports.ts`. Replace with the shared-contracts barrel. Do not keep both lists.
- Tasks 075 and 076: `CorpusQualityValidator` / pack loading. The Wave 2 YAML uses the same question and elaboration shape as Task 076, including anchors. This port does not apply Task 076's framework-name lint, because `Q-MOB-01` is required to name React Native, Expo, and native iOS/Android.
- Task 077 `StageCoherenceSelfTest`: the class in `ports.ts` is the local port. `STAGE_CATALOG_SOURCE` is `local-port:task-075-076-077-103`. The 44 M2 ids are the Task 077 list. The 28 Wave 1 ids are topic stubs for Task 103 (`payments` 8, `notifications` 6, `ai` 6, privacy/scale/observability 8), each with one non-conflicting `catalog_default`. Replace `prior-catalog.ts` with the real pack files when `corpus/packs/core-data-auth`, `corpus/packs/web-api-cli`, and `corpus/packs/wave1-expanded` are present. Do not merge those branches into this one.
- Task 078 skill gates: `StaticSkillSecurityVetter`, `SkillTokenBudgetEnforcer`, and `CanarySkillQuarantineHarness` in `ports.ts`. The vetter also rejects `~/.config`, `$HOME`, and `%USERPROFILE%` home-directory writes. The 6 M2 skills under `packages/discovery/tests/corpus-wave2/port/m2-skills/` are short offline stand-ins (`m2Source: local-port:task-078`), not the Task 078 bytes. Swap them for `corpus/skills/m2/**` and recompute `v1-catalog-index.json` when Task 078 lands.
- Tasks 070 and 071: `settleUtterance` maps a phone-link sentence to `mobile_web` and does not set `native_mobile`. Swap for the discovery settling result.

`harness/integration` had moved past `6497730` when this worktree was created, and that tip failed `pnpm install --frozen-lockfile`. This branch was created with `--base 649773097c387ae534b686ea5825f449f843aa7c`, the commit named in the task brief.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-104-corpus-wave2-packs-14-skills`:

- `pnpm --filter @ef-harness/discovery test -- corpus-wave2` — pass, 1 file, 11 tests. Covers 15 questions, 46 elaborations, closed 28 tags, duplicate id and asymmetric conflict in under 500 ms, 87-question stage coherence (44 + 28 + 15) with a deliberate conflict and a broken `requires`, web/CLI/API dormancy, the phone-link near miss, extension skill injection with SSR/SEO marked not applicable, Electron plus SQLite desktop activation, 20/20 canary receipts, the top-2 skill cap, a 2045-token rejection (`2045 > 2000`), and a `~/.config/tool` home-directory rejection.
- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 104` — pass (`harmony ok for Task-104`, exit 0). The command also ran repository `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- The 44 M2 questions and 28 Wave 1 questions in the coherence catalog are id-level stubs. They prove the combined graph has no duplicate ids and that Wave 2 stage defaults do not clash with a coherent prior catalog. They are not the authored Task 075, 076, or 103 texts.
- The 6 M2 skill files in the test port are original short texts with the Task 078 smoke phrases. Replacing them with Task 078's pinned bytes will change `v1-catalog-index.json` hashes for those six rows. The 14 Wave 2 hashes stay on `corpus/skills/wave2/manifest.json`.
- `corpus/skills/manifest.json` is outside this task's write scope, so the Wave 2 pin file is `corpus/skills/wave2/manifest.json`.
- Quarantine does not call a model. A clean skill is one the static vetter accepts, under the token cap, with a smoke section, and with no canary or home-config instruction. The harness does not start a network.
- Skill touches used for ranking are the strings in the manifest. Several of them are closed touches tags. The M2 port also uses Task 078's non-tag labels (`requirements`, `debugging`, `tests`).
- High-frequency options are all elaborated. There are no `elaboration_exempt_reason` rows in Wave 2.
