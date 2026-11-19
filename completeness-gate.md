# Completeness gate: no stubs, no silent shortcuts, no dropped requirements

Agents cut corners. They leave `// TODO: handle error`, return a hard-coded list, swallow errors with an empty `catch {}`, wire a button to nothing, or edit the test instead of the code. Research on coding agents given impossible tasks found frontier models passing them by special-casing or modifying tests in roughly half the cases on realistic repositories. This document adds two defenses: a deterministic **static audit** every candidate must pass before verification starts, and a **traceability matrix** that makes it structurally impossible for a planner or worker to drop requirements. Research: [static completeness checks](research/static-completeness-checks.md).

## Decisions in plain words

1. **A new task state, `STATIC_AUDIT`, sits between coding and clean verification.** It runs fast deterministic scans on the diff. Any hard finding rejects the candidate with exact locations.
2. **Every requirement must have a task and a check before the plan can be published.** The database enforces it; the planner can't publish a graph with an uncovered requirement unless the developer approved a waiver.
3. **Every task must prove its checks ran,** including the checks of cross-cutting rules in scope. Missing or skipped counts as failure.
4. **Behavior tests are designed to catch shortcuts:** held-back cases, generated examples and targeted mutations make hard-coding fail.
5. **Workers get an honest exit.** When a task is contradictory or impossible, the worker flags it instead of faking a pass, and that path is cheaper for it than cheating.

## Static audit

Runs on the candidate's changed files and new files, using lint rules, AST queries (ast-grep or Semgrep rules) and the project's type checker. Findings are visible to the worker (they're not hidden tests).

| Check | Hard fail | How it's detected |
|---|---|---|
| Unfinished markers | `TODO`, `FIXME`, `XXX`, `HACK`, “not implemented”, “placeholder”, “lorem ipsum” in owned non-test paths | Text and comment scan. Allowed only as `TODO(DEF-12)` pointing to a deferral the kernel approved |
| Stub bodies | Exported function in a contract returns a constant, empty value or throws “not implemented” | AST: trivial body on a contract-declared symbol, unless the contract says so |
| Swallowed errors | Empty `catch`, `.catch(() => {})`, catch that only logs where the contract requires the error to surface | Lint rule plus a project rule from the error-handling convention |
| Dead controls | `onClick={() => {}}`, `href="#"`, a form with no submit handler | AST queries on UI files |
| Hard-coded data | Array or object literals of more than a few records in non-test, non-seed paths **that aren't declared static data**; fake-data strings (“John Doe”, `example.com`) outside fixtures; mock libraries imported by product code | AST plus import rules |
| Test tampering | Any change to protected tests, test config or snapshots; new `.skip`, `.only`, `xit` | Path protection (existing) plus scan |
| Type escapes and lint bypasses | New `@ts-ignore`, `@ts-expect-error`, `as any`, `eslint-disable` | Scan; allowed only with a reason referencing a task note, counted in the receipt |
| Unreachable code | New exports not reachable from any entry point **and not declared for a planned consumer**; unused files | Dead-code analysis (knip) |
| Unused planned fields | Data-model fields owned by this task, never read or written, **and not assigned to a later task** | Schema usage search |
| Unregistered names | Routes, environment variables, storage keys, tables or indexes not in the [name registry](build-pipeline.md#resource-name-registry) or owned by another feature | Extraction from code |
| Missing assets | References to images, icons or fonts not in the asset module or public folder ([external intake](external-intake.md#brand-assets-and-real-media)) | Path check |

### Two levels: leaf and feature

Some findings are legitimate inside one task but not for the finished feature, so the gate runs at two levels:

| Situation | Leaf audit (task) | Feature audit (before `DONE`) |
|---|---|---|
| T02 exports `groupKitchenOrders()` for T03, which merges later | Passes: the export is declared in T02's `produces` contract with T03 as a planned consumer | Fails if it is still unused once all of the feature's tasks have merged |
| A field T05 creates and T08 will read | Passes: assigned to T08 in the plan | Fails if nothing reads it |
| A 50-item list of currency codes or US states | Passes if the brief declares it as **static data** (with its source, e.g. ISO 4217) and it lives in a declared data path (`src/data/**`) | Same |
| Status enum values | Not data: enums and constant maps of fewer than ~20 entries are always allowed | Same |

Declared consumers and static data come from the plan, not from the worker, so a worker can't exempt its own shortcut.
| Missing contract surface | An operation, route or UI element named in the contract doesn't exist | Route table, OpenAPI diff, exports diff, ARIA snapshot of the screen spec |
| Truncated files | Elision placeholders (`// ... existing code ...`, “rest of file unchanged”) or large deletions the plan didn't call for | Text scan plus deletion ratio per file |
| Out-of-scope edits | Files outside the write scope | Existing diff check |
| Secret in diff | Anything matching secret patterns or vault values | Existing secret scan |

**Soft findings** (shown in the receipt, reviewed on high-risk tasks): diff much smaller than the task's size estimate, a function whose cyclomatic complexity is far below what its rules imply, many branches on literal values that appear in visible examples (special-casing signal).

**Cost:** seconds of CPU, no tokens. A failed static audit returns to the worker immediately and doesn't count as a verification attempt, but repeated identical static failures (same fingerprint three times) escalate like any loop.

## Traceability: every requirement has a task and a check

The knowledge database holds the matrix. Requirements, checks and waivers are nodes; the links are edges, exposed as views, so the matrix can't drift from the graph ([schema](schema/state.sql)):

```
requirements        view: nodes whose kind is spec_item | edge_case | rule | journey
task_requirements   view: task --implements | obeys | handles_edge_case--> requirement
check_requirements  view: check --verifies--> requirement
waivers             view: waiver node --waives--> requirement (reason, approved_by, risk_max)
check_results       table: (check_id, attempt, check_version, status, artifact_digest, receipt)
```

The invariants below are SQL queries that must return no rows (`requirements_without_task`, `requirements_without_check`, `tasks_without_requirement` in [queries.sql](schema/queries.sql)).

| Invariant | Enforced when | If violated |
|---|---|---|
| Every in-scope requirement has ≥ 1 task | Graph compile | Publish refused with the list of uncovered requirements |
| Every in-scope requirement has ≥ 1 check | Graph compile | Same |
| Every task has ≥ 1 requirement | Graph compile | Orphan task refused (no work without a reason) |
| Every rule-bearing requirement has a held-back or generated check | Graph compile | Same |
| A waiver exists only for low-risk requirements, or with developer approval | Waiver creation | Refused |
| A task is accepted only if every check linked to its requirements (including in-scope cross-cutting rules) has `pass` for this artifact | Acceptance | Rejected; missing checks listed |
| A feature is done only if every requirement of the feature has a passing check at current versions | Feature completion | Feature stays open |

So if the architecture produced 400 edge cases and the planner covered 320, graph compile fails and lists the 80. The planner either adds tasks and checks, or asks for waivers, which the developer sees.

**Making sure a linked check really tests its requirement**

1. Visible checks are written by the feature planner, held-back cases and rubrics by `oracle-author@1` (which doesn't see the task split), never by the implementing worker.
2. **Red before green:** every new check must fail against the code before the task (existing rule), so a check that tests nothing is caught.
3. Rule-bearing requirements get a held-back case and, selectively, a targeted mutation (e.g. flip `<` to `<=` at the cutoff): a surviving mutation means the check is too weak.
4. The final project audit samples requirement–check pairs and asks a Manager model whether the check observes what the requirement states; disagreements go to the planner.

## Shaping workers away from shortcuts

| Measure | Why |
|---|---|
| Tests are read-only to workers and run by the clean verifier | Removes the most common cheating method (editing tests) |
| Held-back and generated cases | Hard-coding visible examples fails |
| `harness.flag_blocked(reason)` and `harness.dispute_test(...)` | A legitimate way out of contradictory tasks; in research on agents, an explicit “flag for a human” action cut cheating sharply |
| Prompt states the rule plainly | “If the brief and the tests disagree, stop and dispute. Never special-case inputs or weaken checks.” ([leaf-worker@1](prompt-contracts.md#leaf-worker1)) |
| Bounded feedback | More retry-with-feedback loops tend to increase gaming; the hint ladder caps them ([verification for real apps](verification-for-real-apps.md#when-a-worker-fails-a-hidden-check)) |
| Reviewer pass on high-risk tasks | A Senior model reviews the diff for special-casing and weakened logic; advisory, because such monitors miss a share of cases on complex repos |
| Cheating is recorded | A detected shortcut lowers that model's pass-rate estimate for the task class, so the crew planner uses it less ([planning and crew](planning-and-crew.md#choosing-a-level-per-task)) |

## Task state with the gate

```
DRAFTED → READY → LEASED → CODING → STATIC_AUDIT → CLEAN_VERIFY → ACCEPTED
                              ↑            │               │
                              └── findings ┘   fail (hint ladder) ┘
```

Full state machines including failure states are in the [build pipeline](build-pipeline.md#state-machines).

## Edge cases

| Situation | Behavior |
|---|---|
| A real TODO is legitimate (feature deferred to v2) | Developer or planner creates a deferral record; the TODO references its ID; it appears in the final report. |
| Seed data looks like hard-coded data | Seed and fixture paths are declared in conventions and excluded. |
| Generated code (ORM client, API client) trips the scans | Generated paths are declared and excluded; they're regenerated, never hand-edited. |
| A language without good AST tooling | Text scans and type checks still run; the gate reports reduced coverage for that language. |
| Developer's own fix (“I fixed it myself”) | Same static audit; findings are shown, and the developer may accept with an override ([editor coexistence](editor-coexistence.md#i-fixed-it-myself)). |

[Diagram](completeness-gate.svg) · [Editable Mermaid](completeness-gate.mmd) · [Verification and isolation](verification-and-isolation.md) · [Verification for real apps](verification-for-real-apps.md) · [Build pipeline](build-pipeline.md) · [Research](research/static-completeness-checks.md)
