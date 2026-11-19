# Spec expansion: from 20 answers to a complete, consistent spec

Twenty answers from a pleasant interview don't contain every screen state, permission, validation rule and failure mode an app needs. Without an explicit step, those gaps get filled silently by whichever worker meets them, differently each time. **Spec expansion** is that step. It systematically generates every detail the settled decisions imply, fills each one with a recorded basis, checks the whole set for contradictions, and only then declares the information complete. Research: [spec expansion](research/spec-expansion.md).

## Decisions in plain words

1. **The spec's size is computed, not chosen.** It follows from the entities, roles, screens, endpoints and rules the project actually has. A 3-screen tool gets a short spec; a SaaS app gets a long one. Line counts are an output, never a target.
2. **Every gap is a cell in a matrix.** Generators produce matrices (role × action, field × validation, screen × state, endpoint × failure, rule × boundary). A matrix cell can't be left blank.
3. **Each filled cell says where its value came from:** the developer, a valid inference, a stage default, a model proposal, or a question.
4. **Contradictions are checked by code first, models second.** Compatibility rules and constraint checks catch conflicting defaults deterministically; a model checks only pairs that code flags as related.
5. **“100% info” means: every required cell filled with a valid basis, zero unresolved contradictions, zero critical questions open.**

## Where it sits

```
Discovery (interview, Autopilot) ─▶ Spec expansion ─▶ Research ─▶ Architecture ─▶ Planning
                                    (project-wide now; feature details just in time, see build pipeline)
```

## Generators

Each generator is deterministic code that reads the decision graph and emits empty cells. Most of the expansion costs no tokens.

| Generator | Input | Cells produced | Example cell |
|---|---|---|---|
| Permission matrix | Entities, actions, roles | entity × action × role → allow / deny / conditional | Order · edit · Staff → allowed until cutoff |
| Field rules | Data model fields | field → type, required, limits, format, unique, default, who can set it | Order.quantity → integer 1–20, required |
| Entity lifecycle | Entities with a status | states, transitions, who triggers, forbidden transitions, side effects | Order: draft → submitted → locked; locked → submitted forbidden |
| Screen states | Screens | screen × {loading, empty, populated, error, unauthorized, partial data} | Kitchen list · empty → “No orders yet” |
| Interaction completeness | Screen specs | every control → action, disabled condition, feedback | Print button → disabled while empty |
| Endpoint failures | API contracts | endpoint × {invalid input, unauthenticated, forbidden, not found, conflict, rate limited, upstream failure, timeout} | POST /orders · conflict → 409 with message |
| Boundaries | Rules with numbers, times, sizes | before / at / after; zero, one, many, maximum; time zone and daylight-saving changes | Cutoff 10:45 · at 10:45:00 → rejected or accepted? |
| Concurrency | Entities editable by more than one actor | two actors, same entity, same moment → outcome | Two managers edit the menu → last write wins or conflict? |
| Lists | Collections shown to users | sort, pagination, search, empty, very large | Order history · 2,000 rows → paginated by 50 |
| Deletion and retention | Entities | soft or hard delete, cascade, restore, retention period | Delete dish with past orders → hide, keep history |
| Notifications | Events | who is notified, channel, when, failure handling | Order locked → no notification |
| Formatting | Dates, money, names | locale, time zone, currency, rounding | Times shown in office time zone |

Generators only produce cells for things that exist. No entity with a status → no lifecycle cells.

## Filling cells

| Basis | When | Credit |
|---|---|---|
| `explicit` | A developer statement establishes it | Full |
| `derived` | An allowlisted inference rule from settled facts ([infer-or-ask](skills/infer-or-ask/SKILL.md)) | Full |
| `defaulted` | An **elaboration of the chosen catalog option** fills it (e.g. option `optimistic_version` fills every same-entity concurrency cell), or, for cells no question covers, a **universal policy** (e.g. “validation errors appear inline next to the field”) ([v1 corpus](v1-knowledge-corpus.md#stage-defaults-and-elaborations-one-chain)) | Full, listed under *Chosen for you* |
| `proposed` | The `spec-expander@1` prompt proposes a value for a cell that no elaboration or universal policy covers; must pass the consistency checks | Full if risk is low; medium-risk items go to review |
| *(status)* `asked` | High-impact and no safe default: the cell stays open as a question, which isn't a basis | Goes through the interrogation guard ([discovery depth](discovery-depth-and-catalog.md#how-much-to-ask-the-interrogation-guard)) |

**Order is fixed:** settled decisions and derivation rules first (code), then option elaborations and universal policies (code), and only then `spec-expander@1` for the remaining cells. A cell filled by an earlier step is never offered to a later one. Bases follow the single vocabulary in [database design](database-design.md#basis-and-status-vocabulary).

Each cell becomes a **spec item** written in an established requirement pattern (EARS), so it reads the same everywhere and maps cleanly to a test:

| Pattern | Template | Example |
|---|---|---|
| Ubiquitous | The *system* shall *response* | The order page shall show prices in euros. |
| Event | When *trigger*, the *system* shall *response* | When staff submit an order, the system shall show a confirmation with the order number. |
| State | While *state*, the *system* shall *response* | While orders are locked, the system shall hide the Edit button for staff. |
| Unwanted | If *condition*, then the *system* shall *response* | If the kitchen list fails to load, then the system shall show “Couldn't load orders · Retry”. |
| Optional | Where *feature is included*, the *system* shall *response* | Where printing is enabled, the kitchen page shall show a Print button. |

Every spec item has an ID, pattern, text, basis, source decision IDs, risk tier and an **oracle sketch** (how a test would observe it), which the planner later turns into an acceptance check ([completeness gate](completeness-gate.md#traceability-every-requirement-has-a-task-and-a-check)).

## Contradiction checks

Delegated choices made in different batches can clash: SQLite chosen in batch 1, multi-region background workers in batch 4. Checks run after every expansion round and before declaring readiness.

| Layer | How | Catches |
|---|---|---|
| **1 · Compatibility rules** (deterministic) | Catalog entries carry `conflicts_with` and `requires` rules over decision values | “SQLite file storage” + “multiple server instances writing” → conflict |
| **2 · Constraint check** (deterministic) | Decisions as variables with allowed values; rules as constraints; a small solver finds unsatisfiable combinations and the **smallest set of decisions** to change | Three decisions that are fine in pairs but impossible together |
| **3 · Cross-matrix checks** (deterministic) | Linked IDs compared across matrices | Permission matrix denies staff editing after cutoff, but a screen spec shows an Edit button to staff while locked |
| **4 · Numeric and time checks** (deterministic) | Intervals and orderings | Cutoff 11:00 but kitchen needs final counts at 10:45 |
| **5 · Semantic pairs** (model) | Only for pairs that share an entity, rule or screen and that layers 1–4 didn't decide; the model answers *conflict / compatible / unclear* with quotes | Two free-text rules that say different things in different words |

**Resolving a conflict**

| Conflicting items | Resolution |
|---|---|
| Both delegated or defaulted | The Manager picks the option that keeps more explicit decisions intact, records the reason, and lists it under *Chosen for you* |
| One explicit, one delegated | The explicit one wins; the delegated one is changed and its dependents rechecked |
| Both explicit | Question to the developer with both quotes ([clarify@1](opening-prompts.md#clarify1)) |

## What the developer sees

```
Spec complete · 1,184 items
  explicit 96 · derived 311 · defaulted 702 · proposed 67 (12 to review) · asked 8
  Contradictions found and resolved: 5 (2 needed you)        [Review proposed items]  [Browse spec]
```

The spec browser groups items by feature and matrix; the review list shows medium-risk proposed items with one-click accept, edit or reject.

## Cost

Generators and layers 1–4 are free. `spec-expander@1` runs on a Mid model per feature in parallel, and only for cells needing judgement. Semantic pair checks run on a cheap model for flagged pairs only. Expansion is part of the paperwork budget ([build pipeline](build-pipeline.md#economics-paperwork-budget)).

## Edge cases

| Situation | Behavior |
|---|---|
| A generator produces thousands of cells (e.g. 40 entities × 6 roles × 5 actions) | Rows with identical rules collapse into one rule with a scope (“Admins can do everything”); only exceptions stay as separate items. |
| The developer changes a decision after expansion | Only cells whose source decisions changed are regenerated; their tests and tasks are invalidated through the normal revision path. |
| A proposed value is wrong but nobody notices | It is labeled *proposed* everywhere it appears, including the task brief, and the plan preview lists tasks that rely on proposed items. |
| No stage default exists for a cell | It becomes proposed or asked; the missing default is logged for the meta-lab to add. |

[Diagram](spec-expansion.svg) · [Editable Mermaid](spec-expansion.mmd) · [Discovery depth](discovery-depth-and-catalog.md) · [Build pipeline](build-pipeline.md) · [Completeness gate](completeness-gate.md) · [Research](research/spec-expansion.md)
