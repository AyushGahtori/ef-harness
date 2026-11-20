---
task_id: "Task-103"
branch: "task/103-corpus-wave1-expanded-packs"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "corpus/packs/wave1-expanded/**"
  - "corpus/elaborations/wave1/**"
  - "packages/discovery/tests/corpus-wave1/**"
  - ".agent-handoffs/task-103.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 103 handoff

Wave 1 expanded catalog packs for Payments, Notifications, AI/LLM, and Privacy/Scale/Observability, plus 68 option elaborations. Commit stays on `task/103-corpus-wave1-expanded-packs`.

## Exports Provided

No production module. `packages/discovery/src/index.ts` is frozen and this task adds no file under `src/`. The packs are the export.

### Pack manifest

| Pack | File | Questions | Activation flag (`applies_when`) |
|---|---|---|---|
| Payments | `corpus/packs/wave1-expanded/payments.yaml` | `Q-PAY-01`..`Q-PAY-08` (8) | `billing.activation` equals `active` |
| Notifications | `corpus/packs/wave1-expanded/notifications.yaml` | `Q-NTF-01`..`Q-NTF-06` (6) | `messaging.activation` equals `active` |
| AI/LLM | `corpus/packs/wave1-expanded/ai-llm.yaml` | `Q-AI-01`..`Q-AI-06` (6) | `ai.activation` equals `active` |
| Privacy, scale, observability | `corpus/packs/wave1-expanded/privacy-scale-obs.yaml` | `Q-PSO-01`..`Q-PSO-08` (8) | `privacy.activation` equals `active` |

Elaborations, one per option (68, above the 45 floor):

- `corpus/elaborations/wave1/payments.yaml` (`wave1-payments`)
- `corpus/elaborations/wave1/notifications.yaml` (`wave1-notifications`)
- `corpus/elaborations/wave1/ai-llm.yaml` (`wave1-ai-llm`)
- `corpus/elaborations/wave1/privacy-scale-obs.yaml` (`wave1-privacy-scale-obs`)

Every question has at least 5 positive examples (one `spoken_dictation`) and 2 negative examples, closed touches tags, stage rationales, and an acyclic `requires` graph inside the pack. Question-level `conflicts_with` is empty so Prototype, MVP, and Production can all recommend a safe option. Option pairs that must not be chosen together are elaboration cells `conflicts_with` plus `layer1_warning`.

Called-out options:

- `Q-PAY-01` / `stripe_subscriptions` label `Stripe Subscriptions`
- `Q-PAY-02` / `stripe_checkout` label `Stripe Checkout` conflicts with `Q-PAY-03` / `client_redirect_marks_paid` (`Client redirect marks order paid without webhooks`). Warning text includes `browser-close / spoofed-redirect revenue loss` and `server-side signed webhook fulfillment`.
- `Q-PAY-03` / `signed_webhook_fulfillment` oracle states duplicate-event idempotency: replaying the same signed webhook event id fulfills once.
- `Q-NTF-01` / `transactional_email` label `Transactional Email via Resend/SMTP`
- `Q-AI-01` / `rag_over_user_pdfs` label `RAG over user PDFs` and `ai_chat_over_pdfs` label `AI chat over uploaded company PDFs`
- `Q-AI-04` and `Q-AI-05` are irreversible `must_ask` and stay applicable in Prototype (token quota and PII/egress).
- `Q-PSO-01` / `soft_delete_30_day` label `Soft-delete with 30-day purge`. `hard_delete` (`Hard delete user on GDPR request`) conflicts with `Q-PSO-02` / `immutable_plain_email`. The offer is `Q-PSO-02:anonymized_actor_id` (`Anonymized actor-ID audit trail`).

### Activation predicate table

Task 075's question schema rejects an unknown `requires_settled` key. Each Wave 1 question stores the gate in `applies_when`. A pack adds zero denominator questions until every clause matches. Discovery sets the flag from the utterance or from the core decision named below. It does not infer the flag from a generic external integration, a receipt upload, a phone link, or a single catering email.

| Flag | Set when | Left unset when |
|---|---|---|
| `billing.activation=active` | Utterance matches `stripe` or `paid pro tier` | `integrations.external=none`, "we might add payments later", or a non-Stripe integration such as maps. Core question is Task 075 `integrations.external`. |
| `messaging.activation=active` | Utterance matches `transactional email`, `notification preferences`, `unsubscribe`, `resend/smtp`, `sms alerts`, or `in-app bell` | Core `notifications.outbound=email_only` for "emails totals to catering". That decision stays on the core question. |
| `ai.activation=active` | Utterance matches `AI chat`, `RAG`, `LLM`, `language model`, or `uploaded company PDFs` | "use on their phones", "no AI", or "upload a photo of the receipt" |
| `privacy.activation=active` | Utterance matches `GDPR`, `CCPA`, `right to be forgotten`, `uploaded company PDFs`, or `regulated personal`, or settled `privacy.class=regulated_personal_data` | Core `privacy.class=basic_contact_data` on a kitchen or expense tool |

Unlock counts for Task 074: Payments `+8`, Notifications `+6`, AI/LLM `+6`, Privacy `+8`. The local explainer renders one new group as `+8 Payments questions unlocked`.

Irreversible `must_ask` questions: `Q-PAY-03`, `Q-PAY-05`, `Q-PAY-07`, `Q-PAY-08`, `Q-AI-04`, `Q-AI-05`, `Q-PSO-01`, `Q-PSO-02`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/discovery/src/index.ts` for this task. There is no new production export to re-export.

When Task 075 is on the integration branch, discovery tests should import the real loader and validator from the barrel and the local port under `packages/discovery/tests/corpus-wave1/port/` can be deleted:

```ts
export { CorpusPackLoader, CorpusQualityValidator, loadCorpusPacks } from "./corpus-loader/index.js";
```

When Task 077 is wired, replace `StageCoherenceSelfTest` in the test port with the planner barrel export. No root `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edit.

## Dependency Intents (New Packages Requested)

No new package. `packages/discovery/package.json` is frozen.

`packages/discovery/tests/corpus-wave1/port/load.ts` imports `yaml` (`parse` with `uniqueKeys: true`). It resolves through the root devDependency (`yaml` `^2.8.0`). Add `yaml` to `@ef-harness/discovery` devDependencies when dependency wiring is allowed. Do not edit the lockfile from this task.

## Contract Change Requests

None for `schema/`, `.opencode/`, or `.githooks/`.

Local ports, because sibling branches are not on this base (`6497730`):

- **Task 010.** `TOUCHES_TAGS` in `packages/discovery/tests/corpus-wave1/port/tags.ts` is the closed 28. Swap for the shared-contracts vocabulary barrel. Do not deep-import `packages/shared-contracts/src/vocabularies/**`.
- **Task 071.** `INFERENCE_RULES` in the same file is the allowlist the questions use (`infer.from_explicit_user_span`, `infer.from_stated_technology`). Swap for the Task 071 export.
- **Task 073.** `CorpusQualityValidator` rejects `must_ask: false` when reversibility is `costly` or `irreversible`. Swap for Task 073 `MustAskPolicyFloor`.
- **Task 075.** The test port's `CorpusQualityValidator` stands in for `packages/discovery/src/corpus-loader`. The YAML was authored to that schema (`kind`, question keys, elaboration keys, `Q-PAY-01` ids, criterion keys with a dot). `applies_when` is the `requires_settled` encoding because a `requires_settled` key fails `assertKeys`. Option-level conflicts are elaboration cells because question-level `conflicts_with` would mark every preset as clashing. Swap the port for `CorpusPackLoader` / `CorpusQualityValidator` and keep these files on disk.
- **Tasks 075 and 076 / Task 077.** `m2StagePort()` is `local-port:task-075-076` with the 44 dotted ids from Task 077 (`product.purpose` through `cli.exit_codes`) and that port's Prototype/MVP/Production recommendations. This branch does not contain `corpus/packs/core-data-auth/**` or `corpus/packs/web-api-cli/**`. `combinedStageCatalog` appends the 28 Wave 1 questions (72 total) without rewriting the 44 recommendations. Point the port at the real packs when they are integrated. Task 075's on-disk ids are `Q-CORE-*` / `Q-DATA-*` / `Q-AUTH-*`, while this port and Task 076 use the dotted catalog ids. Retarget only if those packs publish the dotted ids; do not fork the 44 inside Wave 1 files.
- **Task 074.** `DenominatorDeltaExplainer` in `port/activate.ts` renders `+8 Payments questions unlocked` from pack title plus added count. The real explainer reads `state.db` and uses a longer sentence. Feed it a scope group `{ label: "Payments", count: 8 }` (and Notifications 6, AI/LLM 6, Privacy 8) so the user-facing line still contains that phrase.
- **Task 077 `StageCoherenceSelfTest`.** `port/stage.ts` is the local copy. Wave 1 stage options carry `conflicts_with` cells and no numeric elaboration cells, so they do not collide with the port's `retention.days` numbers.

Worktree was created with `--base 649773097c387ae534b686ea5825f449f843aa7c` because current `harness/integration` had moved and its lockfile did not match `packages/shared-contracts/package.json`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-103-corpus-wave1-expanded-packs`:

- `pnpm --filter @ef-harness/discovery test -- corpus-wave1` — pass, 13 tests. Covers 8/6/6/8 questions, 68 elaborations, closed 28 tags, five-positive and two-negative floors, irreversible must-ask ids, 72-question Prototype/MVP/Production coherence with the 44-id port unchanged, a forced Checkout-plus-redirect coherence failure, kitchen dormancy (0 Wave 1), expense CLI (0 payments and 0 AI), Stripe-only `+8 Payments questions unlocked`, paid SaaS (payments + notifications), RAG (AI + privacy), Prototype AI egress and quota, both layer-1 conflicts, the webhook idempotency oracle, and validator failures for a bad tag, four positive examples, a cycle, a dangling require, an asymmetric conflict, and `must_ask: false` on an irreversible question.
- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 103` — pass (`harmony ok for Task-103`, exit 0). That command also re-ran repository `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- The 44 M2 questions are not on this branch. Coherence uses the Task 077 in-memory port. Loading only the Wave 1 YAML with Task 075's validator succeeds on its own because every `applies_when` criterion is owned inside the Wave 1 packs (`billing.activation` on `Q-PAY-01`, and the same pattern for the other three flags).
- Question-level `conflicts_with` stays empty. The Checkout/redirect pair and the GDPR/plain-email pair are option conflicts. Recommended defaults are the safe sides (`signed_webhook_fulfillment`, `soft_delete_30_day`, `anonymized_actor_id`), so the three presets stay conflict-free.
- A catering summary email does not activate `notifications.yaml`. Product messaging is a separate flag from core `notifications.outbound`.
- `privacy.class=regulated_personal_data` activates the whole privacy/scale/observability pack, not a privacy-only subset. The pack is one file of 8 questions.
- Positive examples are grounded on the MVP recommended option. They are not a second copy of every option label.
- No model calls. Activation, quality, oracle lint, and stage coherence are deterministic.
