---
task_id: "Task-076"
branch: "task/076-corpus-web-api-cli-elaborations"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "corpus/packs/web-api-cli/**"
  - "corpus/elaborations/**"
  - "corpus/policies/**"
  - "packages/discovery/tests/corpus-web-api-cli/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 076 handoff

M2 Web (6), API (5), and CLI (4) question packs, 86 option elaborations, and universal policies `UP-01` through `UP-08`. Commit stays on `task/076-corpus-web-api-cli-elaborations`.

## Exports Provided

Machine-readable bundle manifest: `corpus/packs/web-api-cli/manifest.yaml`.

### Pack paths

- `corpus/packs/web-api-cli/web.yaml` — 6 questions
- `corpus/packs/web-api-cli/api.yaml` — 5 questions
- `corpus/packs/web-api-cli/cli.yaml` — 4 questions
- `corpus/elaborations/web.yaml`
- `corpus/elaborations/api.yaml`
- `corpus/elaborations/cli.yaml`
- `corpus/elaborations/core-data-auth.yaml` — elaborations for the Task 075 question ids below
- `corpus/policies/universal-policies.yaml`

Question ids use the dotted catalog ids from `v1-knowledge-corpus.md`. `code` is `Q-WEB-01`..`Q-WEB-06`, `Q-API-01`..`Q-API-05`, `Q-CLI-01`..`Q-CLI-04`.

| Code | Id | Decision this pack records |
|---|---|---|
| Q-WEB-01 | `ui.responsive_targets` | Breakpoints and mobile-vs-desktop priority |
| Q-WEB-02 | `ui.pages_inventory` | Client routing / SSR / SEO for that page inventory. Criteria also include `ui.routing`, `ui.ssr`, `ui.seo` |
| Q-WEB-03 | `ui.forms_validation_style` | Autosave, drafts, multi-step, optimistic UI. `no_forms` means no data-entry forms |
| Q-WEB-04 | `ui.states_style` | Tables and lists: paging, virtualization, print, export, plus loading / empty / error for those views |
| Q-WEB-05 | `ui.look_and_feel` | Theme, dark mode, design-token set |
| Q-WEB-06 | `ui.accessibility_level` | Browser matrix on a WCAG AA floor |
| Q-API-01 | `api.style` | REST/OpenAPI, RPC, webhooks, or private RPC. Criteria include `api.error_format` (the error document is part of the schema contract) |
| Q-API-02 | `api.consumers` | Public vs internal callers and the versioning promise |
| Q-API-03 | `api.pagination` | Pagination, filtering, and sorting. This is the task's list-query question |
| Q-API-04 | `api.rate_limits` | Rate limit, idempotency key, payload size |
| Q-API-05 | `jobs.background_needed` | Inline work, durable jobs, or webhook retry |
| Q-CLI-01 | `cli.output_format` | Command tree: prompts vs `--json` / `--yes` / pipes |
| Q-CLI-02 | `cli.config_location` | Precedence flags > env > project file > user config |
| Q-CLI-03 | `cli.exit_codes` | Exit codes and stdout/stderr split |
| Q-CLI-04 | `cli.distribution` | Install shape plus state, cache, credentials, and cross-platform paths |

### Universal policies `UP-01`..`UP-08`

These are the task's engineering baselines (Pass 2). They are not the screen-state rows in the corpus doc's policy table. Loading, empty, and error copy for lists lives on `ui.states_style`. Form submit behavior lives on `ui.forms_validation_style`. Destructive confirmation is `UP-04`. Date display is `UP-05`.

A scope matches a task when every `all` tag is present and, if `any` is non-empty, at least one `any` tag is present. An empty scope matches nothing.

| Id | Statement | Touches |
|---|---|---|
| UP-01 | Secrets come from the environment or a vault, are never hardcoded, and are never logged | `any: [credentials, config_env, logging]` |
| UP-02 | Server-side validation against the canonical schema before a state change | `any: [form_input, inbound_webhook, external_api, route]` |
| UP-03 | Structured user-safe errors; no stack, SQL, or internal path in the caller-facing body | `any: [route, interactive_ui, logging]` |
| UP-04 | Authorize mutations, apply one effect per idempotency key, confirm destructive actions by name | `any: [destructive_write, authz, route]` |
| UP-05 | UTC storage, IANA display, integer minor units | `any: [time_display, scheduling, money]` |
| UP-06 | Page ceiling 100, upload ceiling 10485760 bytes, timeout cap 30000 ms | `any: [search, file_upload, route, rate_limited]` |
| UP-07 | WCAG AA contrast, accessible names, keyboard focus, tap targets >= 24 CSS pixels | `any: [interactive_ui, form_input]` |
| UP-08 | Structured logs with a request id, an unauthenticated health endpoint, and a fixed clock/seed seam | `any: [logging, route, background_job]` |

`UP-07` uses `interactive_ui` and `form_input` for the task's illustrative tags `ui`, `web_frontend`, and `forms`. `route` is omitted so a headless API route does not inherit the UI floor. A pure CLI tag set (`config_env`, `logging`, `credentials`) does not match `UP-07`. Form autosave clauses are tagged `form_input` only, so a static page tagged `route` + `interactive_ui` does not receive them. `cli.output_format` / `json_noninteractive` says logs go strictly to stderr and stdout is one JSON document, including when `UP-08` also asks for structured logs.

### Elaboration index (86)

Each row is `(id, question_id, option_id)`. Every entry has clauses, an edge case, a numeric bound, an oracle hint, and a closed touches scope.

- `ELAB-Q-WEB-01-MOBILE-FIRST` -> `ui.responsive_targets` / `mobile_first`
- `ELAB-Q-WEB-01-DESKTOP-FIRST` -> `ui.responsive_targets` / `desktop_first`
- `ELAB-Q-WEB-01-RESPONSIVE-PARITY` -> `ui.responsive_targets` / `responsive_parity`
- `ELAB-Q-WEB-02-CLIENT-ROUTING` -> `ui.pages_inventory` / `client_routing`
- `ELAB-Q-WEB-02-SSR-SEO` -> `ui.pages_inventory` / `ssr_seo`
- `ELAB-Q-WEB-02-STATIC-EXPORT` -> `ui.pages_inventory` / `static_export`
- `ELAB-Q-WEB-02-HYBRID-PUBLIC-SSR` -> `ui.pages_inventory` / `hybrid_public_ssr`
- `ELAB-Q-WEB-03-SIMPLE-SUBMIT` -> `ui.forms_validation_style` / `simple_submit`
- `ELAB-Q-WEB-03-AUTOSAVE-DRAFTS` -> `ui.forms_validation_style` / `autosave_drafts`
- `ELAB-Q-WEB-03-MULTI-STEP` -> `ui.forms_validation_style` / `multi_step`
- `ELAB-Q-WEB-03-OPTIMISTIC-AUTOSAVE` -> `ui.forms_validation_style` / `optimistic_autosave`
- `ELAB-Q-WEB-03-NO-FORMS` -> `ui.forms_validation_style` / `no_forms`
- `ELAB-Q-WEB-04-CAPPED-FULL-LIST` -> `ui.states_style` / `capped_full_list`
- `ELAB-Q-WEB-04-PAGED-ROWS` -> `ui.states_style` / `paged_rows`
- `ELAB-Q-WEB-04-VIRTUALIZED-WINDOW` -> `ui.states_style` / `virtualized_window`
- `ELAB-Q-WEB-04-PRINT-AND-EXPORT` -> `ui.states_style` / `print_and_export`
- `ELAB-Q-WEB-05-LIGHT-ONLY` -> `ui.look_and_feel` / `light_only`
- `ELAB-Q-WEB-05-SYSTEM-LIGHT-DARK` -> `ui.look_and_feel` / `system_light_dark`
- `ELAB-Q-WEB-05-BRAND-TOKENS` -> `ui.look_and_feel` / `brand_tokens`
- `ELAB-Q-WEB-06-WCAG-AA-EVERGREEN` -> `ui.accessibility_level` / `wcag_aa_evergreen`
- `ELAB-Q-WEB-06-WCAG-AA-PINNED-LEGACY` -> `ui.accessibility_level` / `wcag_aa_pinned_legacy`
- `ELAB-Q-WEB-06-WCAG-AA-KEYBOARD-FIRST` -> `ui.accessibility_level` / `wcag_aa_keyboard_first`
- `ELAB-Q-API-01-REST-OPENAPI` -> `api.style` / `rest_openapi`
- `ELAB-Q-API-01-RPC-SCHEMA` -> `api.style` / `rpc_schema`
- `ELAB-Q-API-01-WEBHOOKS-AND-REST` -> `api.style` / `webhooks_and_rest`
- `ELAB-Q-API-01-INTERNAL-RPC-ONLY` -> `api.style` / `internal_rpc_only`
- `ELAB-Q-API-02-INTERNAL-UNVERSIONED` -> `api.consumers` / `internal_unversioned`
- `ELAB-Q-API-02-PUBLIC-URL-VERSION` -> `api.consumers` / `public_url_version`
- `ELAB-Q-API-02-PUBLIC-HEADER-VERSION` -> `api.consumers` / `public_header_version`
- `ELAB-Q-API-03-OFFSET-PAGE` -> `api.pagination` / `offset_page`
- `ELAB-Q-API-03-CURSOR-PAGE` -> `api.pagination` / `cursor_page`
- `ELAB-Q-API-03-CURSOR-FILTER-SORT` -> `api.pagination` / `cursor_filter_sort`
- `ELAB-Q-API-04-BASIC-LIMITS` -> `api.rate_limits` / `basic_limits`
- `ELAB-Q-API-04-STRICT-PUBLIC` -> `api.rate_limits` / `strict_public`
- `ELAB-Q-API-04-INTERNAL-HIGH-CEILING` -> `api.rate_limits` / `internal_high_ceiling`
- `ELAB-Q-API-05-NONE-INLINE` -> `jobs.background_needed` / `none_inline`
- `ELAB-Q-API-05-DURABLE-JOBS` -> `jobs.background_needed` / `durable_jobs`
- `ELAB-Q-API-05-WEBHOOKS-WITH-RETRY` -> `jobs.background_needed` / `webhooks_with_retry`
- `ELAB-Q-CLI-01-HUMAN-INTERACTIVE` -> `cli.output_format` / `human_interactive`
- `ELAB-Q-CLI-01-JSON-NONINTERACTIVE` -> `cli.output_format` / `json_noninteractive`
- `ELAB-Q-CLI-01-DUAL-TTY-OR-PIPE` -> `cli.output_format` / `dual_tty_or_pipe`
- `ELAB-Q-CLI-02-FLAGS-ENV-PROJECT-USER` -> `cli.config_location` / `flags_env_project_user`
- `ELAB-Q-CLI-02-ENV-ONLY` -> `cli.config_location` / `env_only`
- `ELAB-Q-CLI-02-PROJECT-FILE-ONLY` -> `cli.config_location` / `project_file_only`
- `ELAB-Q-CLI-03-CONVENTIONAL-SPLIT` -> `cli.exit_codes` / `conventional_split`
- `ELAB-Q-CLI-03-POSIX-SYSEXITS` -> `cli.exit_codes` / `posix_sysexits`
- `ELAB-Q-CLI-03-STDOUT-MESSAGES` -> `cli.exit_codes` / `stdout_messages`
- `ELAB-Q-CLI-04-OS-CONFIG-DIRS` -> `cli.distribution` / `os_config_dirs`
- `ELAB-Q-CLI-04-PROJECT-LOCAL-DOTDIR` -> `cli.distribution` / `project_local_dotdir`
- `ELAB-Q-CLI-04-PORTABLE-SINGLE-FILE` -> `cli.distribution` / `portable_single_file`
- `ELAB-Q-CORE-01-INTERNAL-WORKFLOW` -> `product.purpose` / `internal_workflow`
- `ELAB-Q-CORE-02-OFFICE-STAFF` -> `product.audience` / `office_staff`
- `ELAB-Q-CORE-03-PROTOTYPE-SLICE` -> `product.stage` / `prototype_slice`
- `ELAB-Q-CORE-03-MVP-SLICE` -> `product.stage` / `mvp_slice`
- `ELAB-Q-CORE-03-PRODUCTION-SLICE` -> `product.stage` / `production_slice`
- `ELAB-Q-CORE-04-STAFF-AND-MANAGER` -> `actors.roles` / `staff_and_manager`
- `ELAB-Q-CORE-05-ONE-HAPPY-PATH` -> `workflows.primary` / `one_happy_path`
- `ELAB-Q-CORE-06-NONE-THIS-RELEASE` -> `workflows.secondary` / `none_this_release`
- `ELAB-Q-CORE-07-NAMED-BY-USER` -> `data.entities` / `named_by_user`
- `ELAB-Q-CORE-08-CREATOR-OWNED` -> `data.ownership` / `creator_owned`
- `ELAB-Q-CORE-09-PERSISTS` -> `product.persists_data` / `persists`
- `ELAB-Q-CORE-10-PLAIN-WITH-RETRY` -> `errors.user_facing_style` / `plain_with_retry`
- `ELAB-Q-CORE-11-AUTOMATED-ACCEPTANCE` -> `testing.expectations` / `automated_acceptance`
- `ELAB-Q-CORE-12-WEB-BROWSER` -> `delivery.platform` / `web_browser`
- `ELAB-Q-CORE-13-LOCAL-ONLY` -> `deploy.target` / `local_only`
- `ELAB-Q-CORE-13-SINGLE-HOSTED` -> `deploy.target` / `single_hosted`
- `ELAB-Q-CORE-14-UNSET-OPEN` -> `constraints.deadline_budget` / `unset_open`
- `ELAB-Q-CORE-15-NO-STACK-MANDATE` -> `constraints.stack_preferences` / `no_stack_mandate`
- `ELAB-Q-CORE-16-NONE-THIS-RELEASE` -> `integrations.external` / `none_this_release`
- `ELAB-Q-CORE-16-NAMED-HTTP` -> `integrations.external` / `named_http`
- `ELAB-Q-CORE-17-UTC-STORAGE-IANA-DISPLAY` -> `time.locale_timezone` / `utc_storage_iana_display`
- `ELAB-Q-CORE-18-ENGLISH-ONLY` -> `content.language` / `english_only`
- `ELAB-Q-DATA-01-POSTGRES` -> `data.storage.engine` / `postgres`
- `ELAB-Q-DATA-01-SQLITE` -> `data.storage.engine` / `sqlite`
- `ELAB-Q-DATA-02-SOFT-DELETE` -> `data.retention_deletion` / `soft_delete`
- `ELAB-Q-DATA-03-CONTACT-ONLY` -> `data.personal_data` / `contact_only`
- `ELAB-Q-DATA-04-NO-IMPORT` -> `data.import_existing` / `no_import`
- `ELAB-Q-DATA-05-SCHEDULED-SNAPSHOT` -> `data.backup` / `scheduled_snapshot`
- `ELAB-Q-DATA-06-LAST-WRITE-WINS` -> `data.concurrent_edits` / `last_write_wins`
- `ELAB-Q-DATA-06-OPTIMISTIC-VERSION` -> `data.concurrent_edits` / `optimistic_version`
- `ELAB-Q-AUTH-01-REQUIRED` -> `auth.needed` / `required`
- `ELAB-Q-AUTH-02-MAGIC-LINK` -> `auth.method` / `magic_link`
- `ELAB-Q-AUTH-02-PASSWORD` -> `auth.method` / `password`
- `ELAB-Q-AUTH-03-RBAC` -> `auth.roles_permissions` / `rbac`
- `ELAB-Q-AUTH-04-WORKDAY` -> `auth.session_length` / `workday`
- `ELAB-Q-AUTH-05-EMAIL-RESET` -> `auth.account_recovery` / `email_reset`

Low-frequency options on the 29-question port carry `elaboration_exempt_reason` instead of an elaboration. Every option on the 15 owned questions is elaborated.

Called-out contracts:

- `auth.method` / `magic_link`: single-use 15-min token, hashed at rest, rate-limited resend, generic "If an account exists..." response, expired-link resend. Oracle: `Expired magic link returns 400/410 and shows resend link`.
- `data.storage.engine` / `postgres`: transactional migrations, parameterized queries, indexes on foreign keys and filters, UTC `timestamptz`, connection pooling.
- `cli.output_format` / `json_noninteractive`: `Logs go strictly to stderr; stdout is reserved for machine-readable output.` Oracle: `CLI --json emits valid single JSON doc on stdout and zero logs on stdout`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen. This task adds no production source file, so there is nothing to re-export yet.

When Task 075's barrel exports the loader, point discovery tests at that barrel and delete the local port:

```ts
export { CorpusPackLoader, CorpusQualityValidator } from "./corpus-loader/index.js";
```

Until then, tests import:

- `CorpusPackLoader`, `parseCorpusYaml`, `findRepoRoot` from `packages/discovery/tests/corpus-web-api-cli/load-bundle.ts`
- `CorpusQualityValidator`, `applicableSlice`, `inventoryIssues`, `TOUCHES_TAGS` from `packages/discovery/tests/corpus-web-api-cli/corpus-port.ts`

`applicableSlice(bundle, taskTags, chosenOptions)` is the slicer stand-in Task 088 can replace. It returns policy ids and the clauses whose touches match.

## Dependency Intents (New Packages Requested)

No new package. `packages/discovery/package.json` is frozen.

The test loader imports the workspace-root `yaml` package (`uniqueKeys: true`). It resolves by walking up to the root install. If a future isolated install stops that walk, add `yaml` to `@ef-harness/discovery` devDependencies in a wiring change. Do not edit the lockfile from this task.

## Contract Change Requests

None. No schema, barrel, or package manifest edit.

Sibling swap for Task 075: `CorpusPackLoader` reads `corpus/packs/core-data-auth/**/*.yaml` when that directory contains YAML. On this branch it does not, so the loader uses `packages/discovery/tests/corpus-web-api-cli/port/task-075-questions.json` (`core_source: "task-075-port"`). That port is 18 core + 6 data + 5 auth questions with the dotted ids above (`Q-CORE-01`..`Q-AUTH-05` in `code`). Low-frequency options are exempt. Stage defaults on the port are a coherent stand-in (for example prototype SQLite and later PostgreSQL, magic link with authentication required) so the combined 44-question `requires` graph stays acyclic and the three stage presets do not select a `conflicts_with` pair.

When Task 075 lands, keep these question ids and the elaborated option ids, or retarget `corpus/elaborations/core-data-auth.yaml`. Do not merge the sibling branch into this one.

Closed 28 touches tags are copied in the test port from the corpus table (Task 010). Swap that list for the shared-contracts barrel when `TOUCHES_TAGS` is exported there.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-076-corpus-web-api-cli-elaborations`:

- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/discovery test -- corpus-web-api-cli` — pass, 14 tests, 1 file, exit 0. Covers Web 6 / API 5 / CLI 4, combined 44 questions, 86 elaborations, `UP-01`..`UP-08`, link integrity, closed tags, stable bundle hash, stage-default conflicts, CLI vs web-form vs API scoping, magic-link / PostgreSQL / JSON oracles, dangling refs, bad tags, short examples, cycles, asymmetric conflicts, 5 MB vs 20 MB bound clash, framework syntax, duplicate YAML keys, and a costly question with `must_ask: false`.
- `node scripts/verify-harmony.mjs --task 076` — pass (`harmony ok for Task-076`, exit 0). That command also re-ran repository typecheck, lint, and test.

## Known Limitations / Follow-Ups

- The 29 Core/Data/Auth questions are a local port, not Task 075's pack files. Their positive examples are generated from each high-frequency option's behavioral meaning. The 15 Web/API/CLI questions use hand-written utterances, including spoken near-misses.
- Task 077 owns the full stage-coherence self-test. This task only checks that the three presets' recommended options do not select a conflicting pair.
- Elaboration bound keys are namespaced per option, so the authored bundle has no co-selectable numeric clash. `UP-06` owns `upload.max_bytes` (10485760) and `query.page.ceiling` (100). The 5 MB vs 20 MB detector is covered by a synthetic pair in the test, not by two live elaborations.
- `stdout_messages` conflicts with `json_noninteractive` and `dual_tty_or_pipe`. `internal_rpc_only` conflicts with the two public version options. `webhooks_and_rest` conflicts with `none_inline`. `public_anonymous` conflicts with sign-in methods. None of those pairs are stage defaults.
- A project that tags a task with both UI tags and `config_env` can receive both `UP-07` and a CLI elaboration if that CLI option was chosen. The closed tag list has no `cli` tag, so exclusion is by the tags on the task plus which options were selected.
- `CorpusPackLoader.bundleHash` hashes the loaded file bytes. Swapping the port JSON for Task 075's YAML changes the hash on purpose.
