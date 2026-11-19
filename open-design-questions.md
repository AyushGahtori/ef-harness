# Open design questions

This is the discussion backlog for the coding harness. The first section records decisions already revisited; the table below contains experiments or product choices that can still change the design.

Use [the main architecture](architecture.md) for the current design and links to the detailed topic notes.

## Interview decisions already made

- Show five broad opening questions. In all-at-once mode, examples start collapsed. In one-at-a-time mode, each example starts expanded. Accept typed or dictated answers that span multiple topics.
- Let the developer finish speaking. No live model graph during dictation: speech becomes local text, nothing is sent until the developer presses Send, and the canvas updates once afterwards. Recommended options are preselected but never auto-sent.
- After the opening answers are sufficiently clear, choose five deeper questions internally. Use earlier answers to settle as many as the evidence permits. Offer options and a write-your-own answer for the rest. Keep a continuous discovery chat and show progress against the needs of this particular project.
- Keep the bottom chat box available throughout the session. A developer can steer while answering, planning or building. Later tasks may use different chats and model tiers. When an answer is insufficient, clarify it in its current batch.

## Decisions to revisit

The working design has four routes: general question, current feature update, new feature and execution control. We use execution control for the fourth route; it is a design choice, not a claim about the original forgotten fourth example. See [the routing design](routing-design.md) for the evidence rules and the Resume Changer baseline.

**Revisited on 13 November 2026**

- **Worker division and integration.** Interchangeable workers lease independent tasks. Consecutive groups suit comparable tasks; a ready queue can redistribute unstarted tasks and dispatches tasks built solely on `explicit` user facts ahead of tasks that rely on `derived` or `delegated` choices. The original planner owns the combined result and normally spends most of its integration pass connecting the pieces. A successor can inherit the planner role. [Worker diagram](parallel-feature-integration.svg)
- **Router context and agent numbering.** Use stable agent IDs, indexed lookup and typed ownership links. Retrieve a small candidate set for ambiguous language and clarify when evidence cannot distinguish the targets. Candidate limits are an evaluation parameter. [Router diagram](agent-graph-routing.svg)
- **Requirement links and revision recovery.** Keep separate architecture and runtime graphs, link them by typed bridges and generate a human-readable Mermaid view. The coordinator commits the canonical SQLite revision, changed briefs and outbox together. JSON, Mermaid and Markdown are revision-labeled views. [Revision diagram](linked-architecture-revisions.svg) · [Design notes](linked-graphs-design.md)
- **Question catalog.** Reuse the earlier decision: keep general prompts in the shared library and adapt them to the project when used. Local variants and evidence belong with the project. Cross-domain evaluation, reviewer assignment and retention limits remain implementation details for later. [Existing catalog discussion](routing-design.md)

Decisions from this round: “maybe add X” includes X in the current release unless deferred explicitly. Resolve conflicts immediately after speech submission. At full planning readiness, build and validate the graph. Publish relevant plans and tests, then start eligible tasks automatically; an unresolved consuming task stays held. These choices settle the release-intent, interruption timing and coding triggers raised in earlier entries below.

**Revisited after the external review:** [Opening rubrics and prompt contracts](opening-prompts.md), [verification and isolated workers](verification-and-isolation.md), [kernel, budgets and recovery](coordinator-and-recovery.md) and [failure scenarios](architecture-review-decisions.md) now have proposed rules. Evaluate those rules before spending another discussion re-deciding them. The review’s countdown, universal confirmation and fixed mutation thresholds are not requirements; instead, ready-queue ordering prioritizes `explicit`-grounded tasks first, and verification uses red-before-green plus at least one held-back case on rule-bearing logic tasks as the default baseline while keeping properties, targeted boundary mutations and replays selective.

**Revisited on 16 November 2026** (ten-question architecture round)

| Question | Decision | Design |
|---|---|---|
| 1 · Onboarding and non-API access | Three ways to pay: API keys, plans the developer already has, local models. ChatGPT plans connect through Sign in with ChatGPT (plan allowance, not API billing). Copilot and Cursor plans connect officially through their SDKs. Gemini plans only through the developer's own unmodified Gemini CLI, off by default with a policy notice (the Claude plan route was withdrawn on 17 November; Claude uses API keys). Foreign agents are supervised by rules over their event streams, not by an AI. Budgets have an allowance currency and per-connection pacing. | [Provider connections](provider-connections.md) · [Agent runtime adapters](agent-runtime-adapters.md) · [Diagram](onboarding-providers-and-runtimes.svg) |
| 2 · Folders and brownfield | Git is required and bundled; dirty work is snapshotted through a temporary index; the checkout is never touched. Existing repos get five change prompts, four reading layers and a measured test baseline. | [Workspace and Git](workspace-and-git.md) · [Brownfield discovery](brownfield-discovery.md) · [Diagram](workspace-git-and-brownfield.svg) |
| 3 · Dictation and graph correction | No live graph; explicit Send only; one visible composer target; clicking a box never answers a question; inline edits show an impact preview. Readiness shown in words with reasons for every change. | [Interactive architecture](interactive-architecture.md) · [Diagram](dictation-and-canvas.svg) |
| 4 · Interrogation depth | Built for developers, so depth stays. Every batch has Accept all recommended; Autopilot runs to readiness and stops only for must-ask decisions; the project stage sets recommendations. Catalog schema and v1 packs defined. | [Discovery depth and catalog](discovery-depth-and-catalog.md) · [Diagram](discovery-depth-and-catalog.svg) |
| 5 · Planning and crew | Seven-stage planning pipeline with live progress; Phase 0 foundation by low-effort recipes; first build waits for Start build on the plan preview; crew size and model level computed per wave, never fixed. | [Planning and crew](planning-and-crew.md) · [Diagram](planning-and-crew.svg) |
| 6 · UI consistency | Tokens, kit and style guide in Phase 0; lint and layout checks block, vision review advises; point-to-fix in the App preview. | [UI design system](ui-design-system.md) · [Diagram](ui-design-system.svg) |
| 7 · Build cockpit | Board with code-written status lines; owner-first, batched inbox; vault-only secrets; probed human steps; optional animated Office view with the developer as CEO. | [Build cockpit](build-cockpit.md) · [Office view](office-view.md) · [Diagram](cockpit-and-office.svg) |
| 8 · Real-app verification | Interaction contracts with semantic locators; blind post-hoc binder when needed; hint ladder for hidden checks; layered checks for visual, migration, timing and AI behavior. | [Verification for real apps](verification-for-real-apps.md) · [Diagram](verification-for-real-apps.svg) |
| 9 · Editor coexistence | Merge queue advances a harness branch, so dirty checkouts never block it; landing only when safe; “I fixed it myself” runs the same verification and credits the developer. | [Editor coexistence](editor-coexistence.md) · [Diagram](editor-coexistence.svg) |
| 10 · Stops, undo, re-entry | Checkpoint every turn; limits park instead of fail; export unfinished branches; undo by inventory with shared pieces and data kept; welcome-back reconciliation before Resume. The infer-or-ask skill is drafted. | [Stops, undo and re-entry](stops-undo-and-reentry.md) · [Skill](skills/infer-or-ask/SKILL.md) · [Diagram](stops-undo-and-reentry.svg) |

**Round 2 (16 November 2026, afternoon)**: ten more areas plus an external audit ([audit response](architecture-audit-response.md)).

| Question | Decision | Design |
|---|---|---|
| 1 · Desktop app | Window over a detached per-user daemon on a user-only named pipe; tray while building; small installer with checksum-verified on-demand downloads; updates only after parking; forward-only database migrations with backups; local logs, traces and a redacted diagnostics bundle | [Desktop app](desktop-app.md) · [Diagram](desktop-app.svg) |
| 2 · Sandbox and internet | One execution path (`harness.run`) for every agent; tiered Windows sandbox (MXC, sandbox users, restricted token, container); no direct internet for coding workers; doc fetcher; kernel-only installs with scripts blocked; threat model | [Sandbox and security](sandbox-and-security.md) · [Diagram](sandbox-and-security.svg) |
| 3 · After main | Effects ledger for push, PR, deploy, migrations; CI triage and bounded repair loop; GitHub queue within published limits; expand-then-contract migrations with rehearsal and backup; post-deploy smoke and rollback | [Ship and deploy](ship-and-deploy.md) · [Diagram](ship-and-deploy.svg) |
| 4 · Mystery bugs and refactors | Investigations: reproduce, localize, prove, fix, keep; sweeps: exclusive lease, codemods first, compiler checklist, leftover scan | [Investigations and sweeps](investigations-and-sweeps.md) · [Diagram](investigations-and-sweeps.svg) |
| 5 · Meta-lab | Frozen benchmarks with hidden specs and suites; simulated developers; paired promotion rules; community skills treated as untrusted code; deterministic simulation for the harness itself | [Meta-lab](meta-lab.md) · [Diagram](meta-lab.svg) |
| 6 · Portability and multiple projects | Secret-free per-entity export on an orphan `harness-state` branch; one writer with fenced takeover; one driver plus viewers; global broker with capacity grants and an interactive lane | [Projects, portability and sync](projects-portability-and-sync.md) · [Diagram](projects-portability-and-sync.svg) |
| 7 · “100% info” | Spec expansion by generators and matrices; every cell has a basis; contradictions checked by rules, constraints and cross-matrix checks before a model | [Spec expansion](spec-expansion.md) · [Diagram](spec-expansion.svg) |
| 8 · Knowledge database | Push packet with Must/Should/Could bands, start-and-end ordering; scope predicates bring cross-cutting rules to every task; logged pull tools; pulls teach the compiler | [Knowledge slicing](knowledge-slicing.md) · [Diagram](knowledge-slicing.svg) |
| 9 · Lazy agents | `STATIC_AUDIT` state with deterministic scans; traceability invariants enforced at graph compile, acceptance and feature completion; honest exits for workers | [Completeness gate](completeness-gate.md) · [Diagram](completeness-gate.svg) |
| 10 · End-to-end pipeline | One database from the first answer; sharding rule; upfront only cross-boundary, hard-to-reverse or developer-dependent items; JIT one wave ahead; state machines; merge protocol; contract change requests; 20% paperwork cap; 17 prompt contracts | [Build pipeline](build-pipeline.md) · [Prompt contracts](prompt-contracts.md) · [Diagram](build-pipeline.svg) |

**Open from round 2:** ~~public remote default~~ and ~~container host~~ decided on 17 November (below); whether to reuse Codex's open-source Windows sandbox or build our own (decided by the roadmap spike).

**Deep review (18 November 2026).** A full read of all documents and the schema found 20 problems (storage gaps, two SQL bugs, vocabulary and ownership contradictions, missing runtime rules, stale text). All are fixed; see [architecture deep review](architecture-deep-review.md). The schema suite now has 67 passing scenarios.

**Owner decisions (17 November 2026)**

| Decision | Choice | Updated in |
|---|---|---|
| Pushing `harness-state` to a public remote | Off by default for public remotes (opt-in per project after a warning); private remotes ask once on first push | [Portability](projects-portability-and-sync.md#edge-cases) |
| v1 deploy hosts | **Vercel** and Docker over SSH; managed container hosts later | [Ship and deploy](ship-and-deploy.md#deploying) |
| Worker naming in the Office | **Agent ID plus short task title** (“A0014 · print page”) | [Office view](office-view.md) |
| Office or Board as default | **Animated Office by default**; Board when “reduce motion” is on or under memory pressure; last choice remembered | [Office view](office-view.md) · [App shell](app-shell-and-governor.md#presets-by-phase) |
| Auto-start thresholds (delegated) | Keep 5 tasks, $1, 2%; only without must-ask decisions, breaking contracts, destructive migrations, new dependencies or external effects; daily cap $5 or 10% of a plan window | [Planning and crew](planning-and-crew.md#plan-preview) |
| Claude Code token in wrapped mode (delegated) | **Not used.** Anthropic forbids third-party developers to collect, store or intermediate Claude subscription credentials, and reserves subscription OAuth for Claude Code and its own apps. Claude runs with Console API keys; the Claude plan route is withdrawn from v1 (this replaces the 16 November “off by default” choice) | [Provider connections](provider-connections.md) · [Sandbox](sandbox-and-security.md#foreign-agents-native-tools-or-ours) |

**Running 10–20 workers without lagging the machine (17 November 2026).** Wrapped mode kept a sandboxed process tree per foreign agent even while it only waited on the model. Resolved in [execution capacity](execution-capacity.md): separate thinking slots (wide, cheap) from a warm execution pool (2–4 sandboxes) and service slots; class runtimes by their cost while thinking and cap session-process runtimes below our loop's width; set permissions once on empty worktree slots and keep `node_modules` read-only from the shared store; recommend Dev Drive (Defender performance mode); add disk, antivirus and UI-latency signals to the governor; design remote execution (Tier E) as an interface for later. Defaults are provisional until the capacity benchmark in the sandbox spike.

**Five more database traps (17 November 2026).** Sleep-skewed leases, ID allocation, cross-machine hashing (RFC 8785), negative reads and `turn_log` growth, resolved in [database design](database-design.md#five-more-traps) with two new tables, three statements and three new tests. The other five traps from the same list weren't included in the message; they can be added when shared.

**Database review (17 November 2026, evening).** Two reviews found ten holes in the database design. All are resolved in [database design](database-design.md) with executable schema files under `schema/` and 67 passing scenario tests:

| Problem | Decision |
|---|---|
| Missing DDL; records with two homes | Complete DDL for four files; meaning in versioned `nodes`, runtime in runtime tables, relations in `edges`, coverage tables as views; vocabularies as lookup tables |
| FTS, float budgets, claim | Word index with camelCase splitting plus trigram ID index; integer units with always-succeeding overrun settlement; claim checks holds, dependencies and brief version, with a deferred holder key |
| Cross-database transactions | None: grants are deposited, spent and closed through idempotent messages; unreported grants expire as fully used |
| Edge noise, read sets, history | Per-type edge-set versions; read-set validation in one SQL query; temporal history with as-of queries |
| Group commit, idempotency, WAL | Publishes run alone; post-commit propagation via read sets; request hashes on operations; short readers and checkpoint policy |
| Events and read models | Outbox stays in `state.db` and is never pruned unacknowledged; telemetry in its own file; trigger-maintained rollups with drift checks |
| Shared blobs | Pins in `global.db` (offline projects and backups safe); Windows rename retries; hash verification; seekable zstd logs |
| Migrations and corruption | Additive vs 12-step rebuild; per-project migration with *needs repair*; hourly backups; salvage, restore, replay ladder |
| Export at scale | Incremental export with `git fast-import`; append-only history segments; what travels and what stays local |
| Code index, secrets, bounds | Separate `code-index.db`; full secret purge plus key rotation; explicit query, walk and payload limits |

**Round 3 (17 November 2026): six missing areas and four contradictions.**

| Area | Decision | Design |
|---|---|---|
| Our own worker loop | Native TypeScript loop (OpenCode stays an optional external runtime); checkpoint every step; pinned rule zones; tool output shrunk before history; per-family edit formats with a recovery ladder | [Worker loop](worker-loop.md) |
| Schemas and protocol | Current and history tables, conditional claims and reservations (validated in SQLite), content-addressed store with retention classes, JSON-RPC over the pipe with numbered events and snapshot resync | [Kernel schema and protocol](kernel-schema-and-protocol.md) |
| Knowledge corpus | M2 minimum: 44 questions, 14 rules, 10 seams; skills are downloaded from the most-used public skills rather than written; stage defaults are catalog options and elaborations hang off options; closed touches vocabulary | [v1 knowledge corpus](v1-knowledge-corpus.md) |
| Test environments | Docker optional; shared servers with per-environment databases cloned from small templates; injected ports and URLs; Job Objects; code-generated data | [Test environments](test-environments.md) |
| External intake | Source records with locators; documents rank below live statements; OpenAPI parsed by code; sanitized registered assets; scrubbed symptom cards | [External intake](external-intake.md) |
| App shell and machine | One shell with fixed regions and phase presets; governor with admission control and pressure levels; per-project dictation vocabulary | [App shell and governor](app-shell-and-governor.md) |
| Native tools vs `harness.run` | OS boundary first: wrapped mode keeps native tools inside the sandbox; stripped mode as fallback; per-command Job Objects | [Sandbox and security](sandbox-and-security.md#foreign-agents-native-tools-or-ours) |
| Just in time vs upfront | Upfront locks the skeleton; later waves only add; planned vs projected estimates; per-wave paperwork envelopes; needed-by questions | [Build pipeline](build-pipeline.md#what-must-be-locked-upfront) |
| Binder and audit edge cases | Entry points declared before coding plus contract stubs for red-before-green; copy catalog and match modes; leaf versus feature audit with declared consumers and static data | [Verification for real apps](verification-for-real-apps.md#red-before-green-with-a-post-hoc-binder) · [Completeness gate](completeness-gate.md#two-levels-leaf-and-feature) |
| Pipeline internals | Name registry; post-merge smoke check per leaf; 13 more prompt contracts; research version and context checks; sharded, bounded final audit | [Build pipeline](build-pipeline.md#resource-name-registry) · [Prompt contracts](prompt-contracts.md) |

**Open from round 3:** which Redis-compatible server to standardize on Windows (decided by the spike). ~~Claude Code long-lived token~~ decided on 17 November: not used.

**Knowledge database questions (16 November 2026, evening).** Three open questions were raised about the central SQLite database, plus ten risks for investigations and refactors. All are resolved:

| Question | Decision | Design |
|---|---|---|
| Direct edits to generated Markdown | Views carry section markers (record ID, version, hash); watcher plus manifest scans detect edits; every edit becomes a reviewed change set; three-way merge against the marker's base; deletions never delete records | [Knowledge database §1](knowledge-database.md#1-direct-edits-to-the-generated-markdown) · [Diagram](knowledge-database.svg) |
| Concurrent writers | Coordinator is the only writer; typed idempotent requests with operation IDs and receipts; conditional claims; derived progress; group commit; safe mode | [Knowledge database §2](knowledge-database.md#2-concurrent-writers-and-write-ownership) · [Diagram](knowledge-database.svg) |
| Revisions versus record versions | Hybrid: per-record and edge-set versions, global revision for snapshots only, read sets, change classes, early cutoff, re-verify before rework | [Knowledge database §3](knowledge-database.md#3-versions-revisions-and-change-impact) · [Diagram](knowledge-database.svg) |
| Investigation and refactor risks | Root-cause-bound fixes, flake-aware bisection with skip, reference inventory beyond the compiler, deadlock-free lease rules, truncation guards, characterization tests, drift control, per-attempt resources | [Investigations and sweeps](investigations-and-sweeps.md#risks-and-safeguards) · [Diagram](investigations-and-sweeps.svg) |

**Owner decisions from this round (16 November 2026)**

| Decision | Choice |
|---|---|
| Distribution | **Open-source app that runs locally.** ChatGPT plan usage is self-serve for this model. Running Claude Code inside the product still requires accepting Anthropic's Commercial Terms. [Research](research/provider-subscriptions.md#what-this-means-for-distribution) |
| Claude Code and Gemini CLI plan routes in v1 | **Included, off by default, with a policy warning** on each. *Superseded on 17 November for Claude: the Claude plan route is withdrawn; Gemini CLI stays off by default.* |
| Office art style | **Cozy pixel art.** Isometric may come later as a skin. |

**Still open:** the three owner choices previously listed here (worker naming, Office default, auto-start thresholds) were decided on 17 November 2026; see the table above.

| Topic | What is still worth deciding or measuring? |
|---|---|
| First five and prompt design | Baseline drafted: actor, action and observable result suffice for the opening workflow. Try the [three v1 prompts](opening-prompts.md) on a complete dictation, a vague idea, a correction and a bounded delegation. Which follow-ups changed a build decision, and which merely repeated the user? |
| Model choice | On the same sample interviews, how often does a small reviewer accept an unsupported answer, ask a redundant question, or miss a critical decision? Which failures justify a stronger model's cost? Reserve user preference questions for the user. |
| Question library | **Decided:** v1 packs, entry schema, seam templates and lifecycle in [discovery depth](discovery-depth-and-catalog.md); the first 44 questions for M2 and the growth process in [v1 corpus](v1-knowledge-corpus.md) (scheduled in the [roadmap](roadmap.md)); evaluation on the four frozen benchmarks in the [meta-lab](meta-lab.md#benchmark-suite). |
| Missing library coverage | We allow a criterion-backed local question when the catalog has a gap. How many variants should a project retain? Which independent reviewer and held-out projects should establish that a generic template belongs in the shared library? |
| The next five | Which matters more when they compete: collecting many details, settling one critical decision, or reducing the user's effort? Try sample projects and compare the next five against a human interviewer's picks. |
| Assumptions | The v1 evidence rules separate observations, permissible deductions, bounded delegation and unknowns. On held-out cases how often does the reviewer overextend an exact quote, miss a negation, or treat a suggestion as permission? |
| Coverage and its denominator | The baseline counts distinct applicable decisions including inherited prerequisites; partial and unchosen values do not count. Test whether users understand the current wording “Needed before building 18 of 18 ✓ · Everything we know 18 of 20” ([interactive architecture](interactive-architecture.md#readiness-display)) and a changing denominator. Which cross-cutting cases are still missed? |
| Conversation and token budget | How much source text should a batch retrieve? When do we compact the running record, keep the raw transcript, or look up an older quote? Measure actual input, cached input where available, output tokens, calls and corrections per resolved decision. One visible chat alone does not bound input cost. |
| Live graph during dictation | **Decided:** only on submission; local transcript and confidence highlighting while speaking. Still measure: error rate on dictated numbers and times with local Whisper. |
| “I didn't understand” | The v1 clarifier rephrases the same question and ID with a concrete example. Measure when a catalog explanation suffices and when a rewrite reduces a second clarification without steering the user toward a particular answer. |
| Too many topics at once | How should the app identify several decisions inside one answer, remember a topic the user says they will explain later, and return to the current question without interrupting speech? |
| Correcting the graph | **Decided:** either; a selected box becomes the composer target, with intents ask, correct (misheard), change, add, remove and explain impact ([interactive architecture](interactive-architecture.md)). Still measure: mis-binding rate between selected boxes and focused questions. |
| Discovery, planning and coding | Automatic planning and per-task dispatch have defined gates. Try three cases: a missing shared role definition, a bounded deferred delivery adapter, and a genuinely complete request. Does the dependency model release only independent work? |
| Provider access | **Decided:** subscription plans and installed agent CLIs, see the table above. Still measure: real ChatGPT plan burn per worker-hour, and whether pacing avoids hitting the five-hour window. |
| Agent handoffs and efficiency | Measure retrievals, stale briefs, false escalations and tokens when sending an artifact, contract and source references rather than transcripts. What amount of context keeps a small worker effective? |

## Review items to test next

| Trial | What could change after the trial? |
|---|---|
| Two planners ask for decisions while the developer types “yes”; a later steer retires one question. | Tune the wording of focus and expired-reply messages. The binding must never silently jump to another question. |
| Print might replace email; email is also explicitly paused by the user. | Measure incorrect routing, needless worker pauses and time spent waiting. Hold reasons must be independent. |
| Return an obsolete worker result, time out an external send, and interrupt publication before and after commit. | Tune lease, checkpoint and reconciliation timing. Old authority, mixed revisions and duplicate external effects are failures. |
| Two workers both want an npm dependency and a third changes a migration. | Measure split, isolation and integration costs; determine practical limits for local builds, test services and browser sessions. |
| Run the independent verifier against a missing assertion, zero discovered tests, a check that passes on the unmodified base, a hard-coded visible example output, and a broken UI entry point. | Confirm the baseline red-before-green and held-back rule checks catch no-op bindings and hard-coding, and measure where properties, repeated runs or targeted boundary mutations add detection per unit cost. |
| Compare direct evidence with a plausible unsupported inference; repeat on the pinned benchmark and a new project type. | Calibrate use of stronger models, catalog coverage and cost per supported decision before claiming savings. |

## Example situations to try with a developer

| Situation | Possible behaviors | Proposed starting behavior |
|---|---|---|
| Mid-batch the developer says “Actually, customers only use the website. Staff use the mobile app.” What happens to the current five? | Restart the batch, or retain valid answers and revise just the questions whose audience changed. | Save the correction with its source. Keep unaffected answers, retire obsolete questions, and show which remaining question changed. |
| Question three asks who can edit an order. The answer is “the usual people.” What happens to questions four and five? | Clarify immediately after submission, or let the developer answer the rest before revisiting three. | Accept everything they volunteered. Keep batch three open and ask “After cutoff, do you mean the manager, kitchen staff, or both?” Allow a different answer or deferral. |
| A new steer arrives while a worker builds email delivery. It says “the kitchen wants a printed list.” What happens to that worker? | Pause affected work now, or finish the current step and flag it for review. | Check whether print replaces email or supplements it. Hold definitely affected contracts, quarantine possibly affected results and keep work shared by both interpretations running. |
| A developer says “decide that later” three times. What should progress show? | Keep the item visible as deferred, or let the developer explicitly remove it from the first release. | Allow either choice. Deferral keeps its value open. A bounded explicit deferral behind a verified interface may release independent work; the consumer still waits. Removing the item from release scope changes the overall denominator. |
| The catalog has questions for websites and mobile apps, but this project is a browser extension. What gets asked? | Use shared criteria and one custom question, or ask a model to rerank a short candidate list. | Start with shared criteria and ask one scope-defining question. Compare shortlist reranking and full-category input on real examples before choosing a fallback. |
| The discovery chat moves to a planning model. What does the new model receive? | Full transcript, or a compact brief with links to source turns. | Send the affected workflows, decisions, open issues and evidence IDs. Retrieve more when a specific decision lacks context. |

### Worked batch

Suppose the developer says, “One office manager publishes Friday's menu. Staff use a link on their phones. At 11 the kitchen gets one list grouped by dish.” The scope already includes a weekly ordering workflow.

| Candidate from the library | What this interview can establish |
|---|---|
| Who publishes the menu? | The office manager. Link to the first sentence. |
| Must staff be able to order on a phone? | Yes. The second sentence identifies the device. |
| How should the kitchen's list be organized? | By dish. Link to the last sentence. |
| Who can change an order after 11? | Ask. The handoff time is known. The late-edit rule is open. Offer “staff,” “manager only,” “lock orders,” or “something else.” |
| How does the kitchen receive the list? | Ask. Offer “email,” “kitchen dashboard,” “printout,” or “something else.” |

The next batch can reuse all five results. If the developer chooses email and volunteers “send it to the shift lead,” record the recipient too. A later question can use that fact even though the earlier question only asked for the delivery channel.

## Resume Changer design precedents

- The adaptive interview plan specifies stable question and option IDs, conditional branches, and invalidation of incompatible follow-ups when an earlier answer changes. The assembly notes describe connecting the actual catalog to the import page. [Interview design](https://github.com/AyushGahtori/resume-changer/blob/497831ec5aa7effb354bb1a8d22d2f031b17a4e0/docs/github-context-redesign-implementation-plan.md) · [Integration notes](https://github.com/AyushGahtori/resume-changer/blob/497831ec5aa7effb354bb1a8d22d2f031b17a4e0/docs/github-import-live-assembly.md)
- The project describes versioned prompt modules and structured, validated outputs. Its offline benchmark compares selectors by marginal evidence coverage under a shared budget. Applying that idea to the next five questions is a new proposal for this harness. [Architecture](https://github.com/AyushGahtori/resume-changer/blob/497831ec5aa7effb354bb1a8d22d2f031b17a4e0/docs/architecture.md) · [Benchmark](https://github.com/AyushGahtori/resume-changer/blob/497831ec5aa7effb354bb1a8d22d2f031b17a4e0/docs/github-context-quality-benchmark.md)
