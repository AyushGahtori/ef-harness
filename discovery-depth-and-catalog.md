# Discovery depth, the question catalog and “accept all recommended”

The harness is for developers who want to understand the system they are building, so depth is a feature, not a cost to minimize. Depth still has to respect time: a developer should be able to say “take your recommendations” in one click, keep going, and only be stopped for decisions that really need them. Research: [catalog and depth](research/question-catalog-and-depth.md).

## Decisions in plain words

1. **Every batch has “Accept all recommended”.** One click accepts the highlighted option on every question in the batch. The developer can still change any of them first.
2. **“Autopilot to ready” keeps going.** It accepts recommendations batch after batch until the architecture is complete, then shows the result. It stops only for **must-ask** questions.
3. **Must-ask is a short, fixed list.** Purpose and audience, spending money, real personal data, identity and login provider, anything hard to reverse, legal or compliance duties, and anything that contradicts what the developer already said.
4. **The project stage changes the recommendations, not the honesty.** A prototype still sees that scale and privacy exist; their recommended answer is “not in this release”, so one click settles all of them.
5. **Everything chosen for you stays visible.** A “Chosen for you” list shows every recommended answer that was accepted in bulk. Any item can be reopened later through the canvas.

## The developer's view

```
Batch 3 of discovery · 5 questions                         [Accept all recommended]  [Autopilot ▸]

1  Where is data stored?           ● SQLite file (recommended for Prototype)  ○ Postgres  ○ Other
2  Who can edit after cutoff?      ● Manager only (recommended)   ○ Staff   ○ Nobody      ← must-ask? no
3  How are staff identified?       ○ Magic link  ○ Company SSO  ○ No login (recommended for 8 people)   ⚑ must-ask
4  Expected users                  ● Under 20 (from your message: “my 8 coworkers”)  ✓ already answered
5  Accessibility target            ● Keyboard + screen-reader basics (recommended)  ○ WCAG 2.2 AA audit
```

- Question 4 was settled from evidence; it is shown for transparency and needs nothing.
- Question 3 is must-ask (identity), so **Accept all** fills 1, 2 and 5, and leaves 3 highlighted for an explicit choice.
- **Autopilot** shows a progress strip: “Autopilot: batch 4… 5… stopped at 2 must-ask questions.”

## Project stage

The stage is inferred from opening question 4 (“What should the first demo prove?”) and question 5 (constraints), and shown as a chip the developer can change: **Prototype · MVP · Production**.

| Stage | Effect on recommendations | Example |
|---|---|---|
| Prototype | Cross-cutting packs (scale, compliance, observability, multi-region) collapse into one line with recommended “Not in this release”. Simple local choices are recommended. | “Scale, compliance and monitoring: not in this release (Prototype). [Review]” |
| MVP | Basic privacy, error handling, accessibility basics and deployment become applicable with pragmatic defaults. | “Logs: console + file (recommended for MVP)” |
| Production | Full cross-cutting packs apply; recommendations favor durability and auditability. | “Backups: daily with 7-day retention (recommended)” |

Changing the chip later reopens the criteria whose applicability changed and shows how many (“Production adds 14 decisions”). A risk trigger overrides the stage: adding payments to a prototype still activates the payments must-ask questions.

## How much to ask: the interrogation guard

Before a question reaches the developer, code scores it:

```
ask_value = impact × uncertainty
impact      = risk tier weight × (number of tasks and contracts that depend on it + 1)
uncertainty = 0 if evidence settles it, low if a recommendation is clearly dominant, high if options differ materially
```

- Must-ask questions are always asked (unless already answered with evidence).
- In **Autopilot**, questions below the threshold are resolved with their recommendation and listed as *chosen for you*.
- Outside Autopilot, low-value questions are still shown, but grouped at the end of the batch with recommendations preselected, so “Accept all” clears them.
- Per stage there is a soft cap on user-visible questions per feature (for example 10 for a Prototype, 25 for Production). Reaching it pushes remaining low-tier questions into “chosen for you”, never silently drops them.

## How accepted recommendations count

This fits the existing evidence rules in [opening prompts](opening-prompts.md#how-a-claim-earns-credit):

| Action | Recorded basis | Credit |
|---|---|---|
| Developer picks an option or clicks **Accept all** on a batch they can see | `explicit` acceptance of the shown option versions | Full |
| **Autopilot** resolves a batch the developer did not see | basis `delegated`, delegation scope = “autopilot, risk ≤ medium, stage = Prototype” | Full, listed in *Chosen for you* |
| A must-ask question | Never delegated by Autopilot | Needs an explicit answer |

The plan preview ([planning and crew](planning-and-crew.md#plan-preview)) flags tasks whose decisions were all chosen under delegation, so the developer can glance at them before building.

## Catalog entry schema

Each catalog question is a versioned YAML entry. Project-local questions use the same schema with `scope: project`.

```yaml
id: data.storage.engine
version: 3
scope: shared                       # shared | project
domains: [data]                     # packs that include it
title: Where is data stored?
explain: >
  The storage engine decides how data survives restarts, how many people can write
  at once and how hard it is to move later.
criteria:                           # decisions this question can settle
  - data.storage.engine
  - data.storage.location
applies_when:                       # all must hold
  - fact: product.persists_data == true
prerequisites: [product.purpose, deploy.target]
risk_tier: high                     # low | medium | high | critical
reversibility: hard                 # easy | moderate | hard
must_ask: false                     # true forces an explicit answer
options:
  - id: sqlite
    label: SQLite file
    consequences: Single machine, zero setup, easy to copy.
  - id: postgres
    label: Postgres
    consequences: Concurrent writers, needs a server or hosted service.
  - id: other
    label: Something else
recommend:                          # first matching rule wins
  - when: stage == prototype or deploy.target == local
    option: sqlite
  - when: users.concurrent_writers > 5 or stage == production
    option: postgres
inference_rules:                    # which evidence may settle it without asking
  - rule: infer.from_stated_technology   # “we use Postgres” settles it
  - rule: infer.from_repo_dependency     # brownfield: prisma provider = postgresql
invalidates_on_change: [data.migrations.strategy, deploy.services]
examples:
  - answer: “A local SQLite file is fine for the demo.”
    settles: {data.storage.engine: sqlite}
stage_applicability: {prototype: yes, mvp: yes, production: yes}
status: active                      # draft | evaluated | active | deprecated
eval: {asked: 0, changed_build_decision: 0, user_marked_unhelpful: 0}
```

The kernel validates entries on load: unique IDs, criteria exist, prerequisites acyclic, every recommendation names a real option, `must_ask` only on `high` or `critical`.

## Domain packs for v1

A project's packs are the union of everything its opening review activates. Criteria are deduplicated by ID, so a browser extension with a backend asks about login once.

| Pack | Depth in v1 | Approximate questions |
|---|---|---|
| Core (always): purpose, actors, workflows, data ownership, errors, testing, delivery | Deep | 35 |
| Web frontend: pages, states, forms, responsive, look and feel | Deep | 30 |
| Backend API: endpoints, validation, jobs, rate limits | Deep | 25 |
| Data: storage, schema, migrations, retention | Deep | 20 |
| Auth and identity: login method, roles, sessions | Deep | 15 |
| Payments | Probe + must-ask | 10 |
| Browser extension, mobile, desktop app, CLI | Probe | 8 each |
| AI/LLM features: model, evals, cost, fallbacks | Probe | 10 |
| Email and notifications | Probe | 8 |
| Cross-cutting: privacy, accessibility, time and dates, concurrency, scale, observability | Stage-dependent | 25 total |

That totals roughly 200. **Probe** packs ask a few scope-defining questions and generate project-local questions for the rest. Later releases: cloud infrastructure (AWS/GCP), real-time and multiplayer, games, data pipelines.

**Seams between packs.** When two packs connect (extension ↔ backend, frontend ↔ payments), a small set of *seam templates* generates project-local questions such as “How does the extension prove which user it is to your API?”. These are created once per seam, not per pack.

## Who writes and versions questions

Questions follow the same lifecycle as skills ([task and skill architecture](task-and-skill-architecture.md#skill-lifecycle)): *draft → evaluated → active → deprecated*. An entry becomes *active* after it changed a build decision in held-out sample projects without duplicating another entry. Project-local questions that recur across projects are candidates for promotion; promotion is a reviewed edit to the shared catalog, never automatic.

## Edge cases

| Situation | Behavior |
|---|---|
| Developer clicks Autopilot on the very first batch | Allowed. The opening five are must-ask by nature; Autopilot starts after them. |
| Autopilot accepts a recommendation that conflicts with a later explicit answer | The explicit answer wins; dependents of the delegated value are rechecked. |
| Developer later says “I never chose SQLite” | Shown in *Chosen for you* with the batch and time. Reopening it is a normal change. |
| A recommendation rule can't decide (no matching `when`) | The question cannot be auto-resolved and is shown to the developer. |
| Stage switches from Prototype to Production mid-build | Opens the new criteria as a scope addition; running tasks continue unless a new decision affects their contract. |

[Diagram](discovery-depth-and-catalog.svg) · [Editable Mermaid](discovery-depth-and-catalog.mmd) · [Architecture ideas (selection and readiness)](architecture-ideas.md) · [Interactive architecture](interactive-architecture.md) · [Planning and crew](planning-and-crew.md) · [Research](research/question-catalog-and-depth.md)
