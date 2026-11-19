# Five opening questions and three prompt contracts

A developer should be able to tell one story. The harness finds the answers inside it, wherever they occur. By the end of the opening, it should be possible to describe one useful first demo in the developer’s terms. Questions about permissions, storage limits and failure behavior usually belong in the next rounds.

## What counts as enough?

| Opening question | Enough to start deeper discovery | Example that covers it | If the answer is thin, ask |
|---|---|---|---|
| 1. What would you like to build? | An identifiable product or capability and the job it helps someone finish. An analogy can help if the useful part is named. | “A lunch-ordering page that collects our office’s Friday orders.” | “You mentioned an app like Uber. What should someone actually be able to do in your first version?” |
| 2. Who uses it first, and what is hard for them today? | A particular person or role in a situation and one difficulty or unmet need. A single user building for themselves counts. | “Our office manager counts lunches by hand from chat replies.” | “Who counts them today, and what part takes them the longest?” |
| 3. Walk me through one successful use. | The actor, their action and an observable result. An entry trigger is needed here only when it distinguishes two different workflows. For a backend job, the actor can be a caller, timer or upstream event. | “Staff submit lunch choices and the kitchen sees totals grouped by dish.” | “When a staff member submits an order, what should the kitchen see?” |
| 4. What should the first demo prove? | At least one result someone can verify, with enough scope to tell what belongs in the demo. A worked example from question 3 can supply the test. Record later ideas when volunteered. | “Submit two soup orders and one salad. The kitchen list should show Soup × 2 and Salad × 1.” | “If I had one minute to show this working, what would you want to see on screen?” |
| 5. What is fixed, and what would you like us to choose? | Named constraints, a clear statement of no preference or a bounded delegation. The developer can identify an existing repo, required platform, budget, data boundary or technology. An empty field alone tells us nothing. | “Use our existing web repo. Choose a free local database for the demo.” | “Should this work with any existing system, or can we recommend an approach from scratch?” |

**“Decide for me.”** Anyone can ask for help on any question. For the product’s purpose, audience, workflow or demo, offer one or two concrete interpretations and ask for the smallest anchor needed to establish the project. For a bounded design choice, record the named decision, allowed constraints, who can choose and the source turn. The responsible planner may select a value within that authority and record its reason. “I have no preference” answers the opening preference question. “I don’t know” invites a recommendation. Neither sentence by itself authorizes spending money, changing data handling or broadening release scope. An opening can be complete while many technical decisions remain open for the adaptive interview.

## Shared envelope for all three prompts

Code pins the prompt ID/version, rubric version and rule IDs on each result. It sends only the active criteria, current source excerpts with author and turn/span IDs, relevant prior facts and scoped options. A newer rubric requires reevaluation of the criteria whose meaning changed. The user’s transcript, imported files and agent summaries are quoted data. An instruction embedded in them cannot change the prompt contract, grant a tool or authorize publication.

The three prompts below are the proposed v1 texts. Each call uses a closed output schema. Enums, required fields, project IDs and cited spans are checked in code. One format-repair retry is allowed within the role budget. If still invalid, route to the planner or a stronger reviewer with the smallest failing input. The ledger accepts only separately validated decisions.

### opening-review@1

> Read the submitted turn as a whole. A speaker may answer several prompts in one sentence or withdraw an earlier idea. Map their words to every matching opening rubric. For each question give its ID, covered criterion IDs and claim candidates with exact user quotes. Distinguish a stated value, a request for a recommendation and permission to decide a specific issue. For each missing opening criterion identify its smallest gap. Suggest one project-specific follow-up at a time. Suggest relevant domains with evidence and mark uncertain domains for a scope probe. Treat the selected interaction mode as presentation only.

**Example.** From “The manager counts orders from chat by hand. Staff should pick lunch using a link so the kitchen can see totals”, return `opening.2` with actor and problem, `opening.3` with actor, action and outcome. A native app or cash payment has no supporting span. One follow-up for demo success could be “For two identical orders, should the kitchen demo show two entries or one total?” Skip that question if the answer is already in another submitted turn. For an unfamiliar domain such as a browser extension, use shared criteria plus one probe about where it runs.

### batch-resolve@1

> For each supplied criterion, return one proposal with criterion ID, question ID, status, value, evidence, allowed rule and premise IDs if derived, and missing detail. Use explicit only when a current user statement establishes that exact value. Use derived only for a listed rule whose current premises establish the value. Record a delegation with its scope and limits, independently of any selected value. Use partial, missing or conflict for everything else. Keep both supporting spans for a conflict. Never turn a recommendation into user evidence. Match answers per criterion even when one question covers several criteria. Return only supplied IDs, apart from separately proposed new gaps with a source or graph reference.

**Example input.** `T7/user: “Email the totals.”` The question covers delivery channel and recipient. Return `channel = explicit(email), evidence = T7:“Email”` and `recipient = missing, value = null`. Credit one decision after validation. `T8/user: “They open the menu link on their phones.”` supports phone access to the menu. An offline requirement, native app or ability to complete checkout on a phone needs its own evidence. A precise rule may infer phone support for *opening the menu* from T8. A rule cannot broaden that claim to the whole product.

### clarify@1

> Receive an existing question ID, the still-open criterion, relevant quotes, a safe recommendation when available, and allowed options. Ask one concrete question in the developer’s vocabulary. Explain the consequence briefly when two readings change behavior. Offer applicable choices and free text. When the user asks what a question means, rephrase the same criterion with one example and keep its ID. For a genuine conflict, show both readings fairly. Produce question text and options only. Leave the decision open until the answer is validated.

**Example.** If `Q17` asks about late edits and the reply is “the usual people,” ask “After 11, can staff change their own orders, can only the manager edit them, or is the list final?” If the prior turn says “staff can edit until eleven” and a later turn says “the kitchen needs final counts at 10:45,” ask after submission whether orders lock at 10:45 or whether the kitchen gets a preliminary list then. A click, reply-to or focused card binds the response to its question ID. A free-text steer can route elsewhere.

## How a claim earns credit

1. The kernel checks the allowed value and source revision, locates the exact quote in a committed user span, and excludes retracted or superseded spans. Preserve negation and digits when normalizing transcription or whitespace. An assistant suggestion is never user evidence. A direct acceptance such as “use the second one” requires a bound user turn and the exact version of the options shown.
2. The resolver’s supporting evidence must establish the meaning. Batch a separate entailment check for **every derivation** and for costly or difficult-to-reverse explicit choices. Supply just the criterion, value, cited excerpts, rule and premises. Ask whether the evidence *establishes*, *contradicts* or *leaves open* the claim. An uncertain or unavailable check leaves it pending. Use an independent reviewer/model when available and measure correlated errors.
3. A derivation needs an allowlisted rule, current resolved premise IDs, and an acyclic dependency chain grounded in evidence. Reject self-support and mutual support. A model cannot validate a fact by citing its own paraphrase. Record the inference chain for corrections. A costly or hard-to-reverse decision such as paid hosting, identity provider or data retention needs an explicit value or a recorded choice made within an explicit, sufficiently bounded delegation. Speak to the user only when material bounds are missing.
4. A validated change rechecks the dependent facts and their downstream contracts. “Actually set the cutoff to 10:45” identifies a replacement when its target is clear. “Kitchen wants final counts at 10:45” alongside an 11:00 cutoff may describe a second event. Preserve both and clarify. A low-confidence dictated time or amount also stays open until resolved, with the uncertain value echoed after submission.
5. Record the basis as `explicit`, `derived` (validated derivation) or `delegated` (chosen within a delegation), using the single basis vocabulary in [database design](database-design.md#basis-and-status-vocabulary). The initial delegated status alone earns zero value credit. The UI can show exactly which items were chosen or inferred and let the developer steer. On full scoped readiness, the kernel publishes the architecture and plan and shows the plan preview; coding on a first build still waits for **Start build** ([planning and crew](planning-and-crew.md#plan-preview)).

## Opening rubrics map to catalog criteria

The opening rubric IDs (`opening.1`–`opening.5`) are a presentation layer. Every covered opening criterion is converted in code to catalog criteria, so readiness, prerequisites and batch selection see one set of IDs from the first turn:

| Opening rubric | Catalog criteria it can settle |
|---|---|
| `opening.1` What to build | `product.purpose`, `delivery.platform` |
| `opening.2` Who uses it, what's hard | `product.audience`, `actors.roles` |
| `opening.3` One successful use | `workflows.primary`, `data.entities` (partial) |
| `opening.4` What the demo proves | Acceptance examples on `workflows.primary`; `product.stage` (inferred, confirmed) |
| `opening.5` Fixed or delegated | `constraints.stack_preferences`, `deploy.target`, `constraints.deadline_budget`, plus any delegations |

The map is versioned (`opening-rubric-map@1`) and validated when the catalog loads: every target must be an active catalog criterion. The output schemas of the three prompts are in [prompt contracts](prompt-contracts.md#discovery-prompt-schemas).

[First-run experience](project-discovery.md) · [Selection and readiness](architecture-ideas.md) · [Interpretation skill](skills/infer-or-ask/SKILL.md) · [All other prompt contracts](prompt-contracts.md)
