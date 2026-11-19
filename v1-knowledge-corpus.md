# The v1 knowledge corpus: questions, policies, rules, skills and seams

The harness is only as good as its content: catalog questions, stage policies, cross-cutting rules, skills and seam templates. Writing all ~200 questions before anything runs would stall the project for weeks; writing them sloppily would make discovery miss real decisions. Skills are not written by hand: they are downloaded from the most-used public skills that cover the most ground. This document fixes the **minimum corpus that unlocks milestone M2** (plan to code on the benchmark projects), the vocabularies that keep it consistent, and how it grows.

## Decisions in plain words

1. **M2 ships with 44 questions, 14 cross-cutting rules, 6 skills, 10 seam templates and about 60 elaborations.** Everything else is added when the meta-lab shows a gap. The skills are downloaded, not written.
2. **Questions decide; elaborations fill in detail.** A stage default is always an option of a catalog question. Spec expansion fills cells only through *elaborations attached to the chosen option*, never through free-standing defaults. Discovery and expansion therefore can't disagree.
3. **What a task touches is described with a closed list of tags.** Planners pick from it, code also detects tags from the diff, and cross-cutting rules match only these tags.
4. **Every corpus entry ships with test cases** and is promoted through the [meta-lab](meta-lab.md#promotion-rules).

## The 44 questions for M2

Chosen to cover the three M2 benchmarks (kitchen web app, expense CLI, booking API). ⚑ = must-ask.

| Pack | Questions |
|---|---|
| **Core (18)** | `product.purpose` ⚑ · `product.audience` ⚑ · `product.stage` · `actors.roles` · `workflows.primary` · `workflows.secondary` · `data.entities` · `data.ownership` · `product.persists_data` · `errors.user_facing_style` · `testing.expectations` · `delivery.platform` · `deploy.target` · `constraints.deadline_budget` · `constraints.stack_preferences` · `integrations.external` (⚑ when money or personal data flows) · `time.locale_timezone` · `content.language` |
| **Data (6)** | `data.storage.engine` · `data.retention_deletion` · `data.personal_data` ⚑ · `data.import_existing` · `data.backup` · `data.concurrent_edits` |
| **Auth (5)** | `auth.needed` · `auth.method` ⚑ · `auth.roles_permissions` · `auth.session_length` · `auth.account_recovery` |
| **Web frontend (6)** | `ui.pages_inventory` · `ui.look_and_feel` · `ui.responsive_targets` · `ui.forms_validation_style` · `ui.states_style` · `ui.accessibility_level` |
| **Backend API (5)** | `api.consumers` · `api.style` · `api.error_format` · `api.rate_limits` · `jobs.background_needed` |
| **CLI (4)** | `cli.distribution` · `cli.config_location` · `cli.output_format` · `cli.exit_codes` |

The remaining ~156 questions from [discovery depth](discovery-depth-and-catalog.md#domain-packs-for-v1) (payments, extensions, mobile, AI features, notifications, deeper cross-cutting packs) are written after M2, in order of how often benchmarks and real projects activate them.

**Authoring standard for each question:** the schema in [discovery depth](discovery-depth-and-catalog.md#catalog-entry-schema), plus at least 5 labeled examples (answers and what they settle), 2 negative examples (answers that must *not* settle it), and stage recommendations for all three stages.

## Stage defaults and elaborations: one chain

```
stage (Prototype / MVP / Production)
   └─▶ question.recommend[stage] ─▶ chosen option ─▶ option.elaborations ─▶ spec cells
```

- A question's `recommend` rules name an option per stage. That is the **only** place a stage default lives.
- Each option carries **elaborations**: rules that fill spec-expansion cells when that option is chosen.
- A spec cell whose subject is covered by a question is filled **only** from that question's chosen option. Free-standing policies are allowed only for cells no question covers (universal UI hygiene, for example), and they may not conflict with any elaboration (checked on load).

```yaml
id: data.concurrent_edits
options:
  - id: last_write_wins
    label: Last save wins
    elaborations:
      - cell: concurrency.*.same_entity
        value: "The later save replaces the earlier one; no warning."
  - id: optimistic_version
    label: Warn when someone else changed it
    elaborations:
      - cell: concurrency.*.same_entity
        value: "If the record changed since it was opened, then the system shall reject the save and show 'Someone else changed this. Reload?'"
      - cell: fields.*.version
        value: "Every editable entity has an integer version incremented on save."
recommend:
  - {when: stage == prototype, option: last_write_wins}
  - {when: stage in [mvp, production], option: optimistic_version}
```

**Stage coherence test (meta-lab):** for each stage, resolve every question with its stage default, run spec expansion on each benchmark, and require zero contradictions. This catches a Production default that clashes with another Production default before any user sees it.

### Universal policies (no question covers them)

| ID | Cell | Value |
|---|---|---|
| UP-01 | Screen · loading | Skeleton or spinner after 300 ms; no layout jump |
| UP-02 | Screen · empty | Message naming what's missing and the action to add it |
| UP-03 | Screen · error | Message, cause in plain words if known, Retry |
| UP-04 | Form · submit | Button disabled while submitting; success feedback |
| UP-05 | Destructive action | Confirmation naming the item |
| UP-06 | Long list | Paginate or virtualize above 100 items |
| UP-07 | Dates in UI | Shown in the zone decided by `time.locale_timezone` |
| UP-08 | Unknown route | Not-found page with a way back |

## Touches tags (closed vocabulary)

Every task declares which of these it touches; code adds tags it detects in the diff (imports, ORM calls, route files, environment reads). Entities carry data tags from the data model, and a task touching an entity inherits them. New tags require a corpus change, not a planner's invention.

| Group | Tags |
|---|---|
| Data sensitivity | `personal_data` · `credentials` · `money` · `user_content` |
| Identity | `authn` · `authz` · `session` |
| Time | `scheduling` · `time_display` |
| I/O | `file_upload` · `file_download` · `external_api` · `inbound_webhook` · `outbound_message` · `background_job` · `realtime` |
| Data operations | `destructive_write` · `bulk_write` · `migration` · `search` |
| UI | `form_input` · `route` · `interactive_ui` |
| Operations | `logging` · `config_env` · `caching` · `rate_limited` · `concurrent_edit` |

Detection examples: a new file under the routes folder → `route`; `process.env` read → `config_env`; ORM `delete`/`deleteMany` → `destructive_write`; a `fetch` to a non-local host → `external_api`; an entity tagged `personal_data` in the data model → `personal_data`.

## Cross-cutting rules for v1

| ID | Rule | Scope (any) | Check kind |
|---|---|---|---|
| X-01 | Every server action and endpoint checks the caller's role | `authz`, `route` with server handler | Generated negative test per role |
| X-02 | Inputs are validated at the boundary with the shared schema | `form_input`, `inbound_webhook`, `external_api` (responses) | Invalid-input tests |
| X-03 | Times are stored in UTC and shown in the project's display zone | `scheduling`, `time_display` | Boundary tests across zones and daylight-saving changes |
| X-04 | Money uses integer minor units and one rounding rule | `money` | Property test |
| X-05 | Secrets come only from configuration, never code or logs | `credentials`, `config_env`, `logging` | Static scan |
| X-06 | Destructive actions confirm and can be undone or audited | `destructive_write` | Journey test |
| X-07 | Personal data is never written to logs | `personal_data` with `logging` | Lint rule + log capture test |
| X-08 | File uploads limit type and size and are stored outside public paths | `file_upload` | Upload tests |
| X-09 | Inbound webhooks verify signatures and are idempotent | `inbound_webhook` | Replayed and forged webhook tests |
| X-10 | Outbound calls have timeouts and bounded retries | `external_api`, `outbound_message` | Fault-injection test |
| X-11 | Errors use the shared error format and banner | `route`, `interactive_ui` | Contract and UI checks |
| X-12 | Background jobs are idempotent and safe to retry | `background_job` | Double-run test |
| X-13 | Interactive elements have accessible names and keyboard access | `interactive_ui` | Accessibility scan + keyboard journey |
| X-14 | Sign-in and other abuse-prone endpoints are rate limited | `authn`, `rate_limited` | Burst test |

The *Scope* column is written in the one scope language from [knowledge slicing](knowledge-slicing.md#cross-cutting-rules-reach-every-task-they-apply-to): a list means `any: [...]`, “with” means `all: [...]` (X-07 is `all: [personal_data, logging]`), and “route with server handler” is the tag `route` plus `authz`. Each rule carries its check template, so the planner instantiates checks rather than inventing them.

## Skills for M2

Skills are **downloaded** from the most-used public skills that cover the widest ground (UI, forms, APIs, migrations, tests), then pinned by content digest. They are not written by hand. `infer-or-ask` stays ours, because it encodes this harness's discovery rules. A downloaded skill still passes the [community-skill checks](meta-lab.md#community-and-custom-skills) before a worker can load it, and it must beat the same tasks without it before it becomes `active`.

The slots below say which areas the first downloads must cover:

| Skill | Why it is in the first set |
|---|---|
| `infer-or-ask@1` | Exists; drives discovery resolution ([skill](skills/infer-or-ask/SKILL.md)) |
| `accessible-ui@1` | Every UI task; most common source of failed interaction checks |
| `forms-and-validation@1` | Forms are in all web benchmarks; X-02 compliance |
| `api-implementation@1` | Booking API benchmark; error format, validation, auth checks |
| `schema-migration@1` | Expand-then-contract, migration fixtures, rollback safety |
| `unit-test-design@1` | Development tests and fixtures for rule tasks |

The other 14 slots in [task and skill architecture](task-and-skill-architecture.md#skill-catalog-and-loading) are filled the same way: download the most-used skill for that area when evaluations show the area needs one.

## Seam templates for v1

A seam template activates when both of its packs are active. It adds a few project-local questions, a contract template, edge cases and rules.

| Seam | Added questions | Contract template | Edge cases | Rules activated |
|---|---|---|---|---|
| Web UI ↔ own API | Typed client or fetch? Where do errors surface? | Typed endpoint client, error mapping | Slow response, 401 mid-session, validation errors shown per field | X-02, X-11 |
| API ↔ database | Transaction boundaries per operation | Repository interface | Partial failure, unique conflict | X-06 |
| Auth ↔ every protected surface | Which routes are public? What happens on expired session? | Session check middleware | Expired session during form submit | X-01 |
| UI ↔ payments | Hosted checkout or embedded? What confirms payment: redirect or webhook? | Checkout start, webhook handler, order state machine | User closes tab after paying; duplicate webhook; refund | X-04, X-09 |
| Backend ↔ email/notifications | Which events send messages? Provider? | Message template contract | Provider down; bounce; duplicate send | X-10, X-12 |
| Background worker ↔ auth and data | Which identity do jobs run as? | Job payload schema | Job runs twice; user deleted before job runs | X-12 |
| Browser extension ↔ API | How does the extension prove the user? Where is the token kept? | Extension auth handshake | Token revoked; API version mismatch | X-01, X-05 |
| File upload ↔ storage | Where are files stored? Who can read them? | Upload URL and metadata contract | Upload interrupted; oversized file | X-08 |
| Third-party sign-in ↔ accounts | Link to existing email accounts? | Account-linking flow | Same email, different provider | X-01 |
| CLI ↔ API or files | Where are credentials stored? Offline behavior? | Command contract and exit codes | No network; corrupt config | X-05, X-10 |

## How the corpus grows

| Signal (from the meta-lab or real projects) | Action |
|---|---|
| A gold decision was missed by discovery | Candidate new question or new inference rule |
| The same project-local question is generated in 3+ projects | Promote to a shared question |
| Workers repeatedly fail the same kind of check | Candidate skill or new rule check template |
| A spec cell is often filled as `proposed` | Candidate elaboration on the relevant option |
| A tag is often added by diff detection but missing from plans | Planner prompt or tag definition fix |

Rough order after M2: payments pack and seam, notifications, AI features, mobile and extension probes, deeper cross-cutting packs.

[Discovery depth](discovery-depth-and-catalog.md) · [Spec expansion](spec-expansion.md) · [Knowledge slicing](knowledge-slicing.md) · [Meta-lab](meta-lab.md)
