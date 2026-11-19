# How the harness gives a worker one complete task

The planner owns the big picture. The author of a task is responsible for bringing every decision needed for that task into its file. A reusable skill supplies a method, such as testing a keyboard interaction. The task supplies the product rule, such as which button should receive focus afterward. This gives the smallest capable model enough context without requiring a custom system prompt for every assignment.

## Files and ownership

| File | Author | What it owns |
|---|---|---|
| `plan.md` | Project planner | Outcomes, shared decisions, feature IDs and dependencies |
| `features/F12/feature.md` | Feature planner | One user-facing workflow, interfaces, failure behavior and feature acceptance cases |
| `features/F12/tasks/T03/task.md` | Feature or task planner | One task's requirements and verification, or the integration contract when split into children |
| `features/F12/tasks/T03/T03b/task.md` | Parent task owner | A smaller deliverable with its own scope, inputs, expected result, files and tests |
| `skills/<skill-id>/SKILL.md` | Catalog maintainer | Reusable instructions. The catalog also records the version, applicable stacks, required tools and optional supporting resources. |

These paths are the logical layout of published, revisioned briefs in harness storage. On assignment and resume, the kernel supplies a read-only snapshot or scoped lookup from the active publication. Never use a product worktree's copy to decide the current requirements. The feature planner owns the product contract and expected behavior. The parent task author owns wiring and verifying its children.

**Task types.** Most work is a *leaf* task with a known write scope. Four other types have their own rules: *Phase 0 recipe* tasks ([planning and crew](planning-and-crew.md#shared-foundations-phase-0)), *wiring* tasks owned by integrators ([build pipeline](build-pipeline.md#leaf--feature)), *investigations* that read everything but write only a reproduction until the cause is proven, and *sweeps* that hold an exclusive lease on many paths for repo-wide changes ([investigations and sweeps](investigations-and-sweeps.md)). Every type passes the same [completeness gate](completeness-gate.md).

Split a task when its children have independently observable outputs. Reuse one published interface and examples for each shared boundary. On publication, the kernel checks the prerequisite graph for cycles, each child for a narrower scope, and the proposed depth and task count against the project limits. Return a cycle or an unhelpful split to the author with the offending chain. A missing product decision reopens its criterion. A step that requires a person becomes a named human task with an observable completion condition. Other ready leaves can run.

## What goes to the worker

How the planners get from settled decisions to these files (architecture synthesis, Phase 0 foundation, feature planning, graph compile, estimates and crew) is in [planning and crew](planning-and-crew.md). The leaf file names its stable ID, owner, base commit, versioned decisions, input contracts and artifact IDs, write scope, behavior, failure cases and implementation steps. It declares the product entry point, examples and check IDs, state and tools it needs, and any shared edits to send to the integrator. Inline small facts. Reference large fixtures, code and UI crops at a pinned, accessible revision. Record the versions of the nodes actually read. A change elsewhere in the project can then leave the assignment valid.

Give workers one stable instruction across assignments. Read the delivered brief, load its pinned skills, use optional skills when their triggers apply, and return a candidate with artifact references and local check results. Report gaps to the task author. Only the deterministic kernel can accept the candidate. Skill text, workspace files and other workers' summaries cannot grant permissions.

## Example leaf file

Illustrative file names and skill IDs for the kitchen project:

```markdown
# T03b · Build printable rows from accepted kitchen totals
Feature F12, task T03b, brief v7. Base commit supplied with the assignment.
Reads rule R31 v2 and kitchen-totals/v1 rev 3. State: none. Write scope: mapper and its unit tests.

Deliver a pure function toPrintRows(totals) in src/kitchen/to-print-rows.ts.
Input: an ordered array of { dishId: string, label: string, quantity: number }.
T02 already grouped orders and removed cancellations. Quantities are nonnegative integers.
Output: an ordered array of { label: string, quantity: number } for positive quantities.
Preserve the incoming order and label. An empty input yields an empty array.
Rendering the print page belongs to T03c.

1. Add the mapper beside the existing kitchen types and reuse the input type.
2. Add development checks in tests/kitchen/to-print-rows.test.ts.
3. Run npm test -- tests/kitchen/to-print-rows.test.ts and return the candidate commit.

Acceptance: Soup × 2, Tea × 0, Rice × 1 becomes Soup × 2, Rice × 1 in that order.
Protected case AC-31 also checks empty input. Under rule R31 each positive input row
survives independently, including two distinct dish IDs sharing the same label.
The planner supplies expected rows. The verifier invokes the real exported mapper.

Required skill: none.
Optional skill: unit-test-design@1, if choosing fixtures for the duplicate-label case.
Handoff: assignment and attempt IDs, changed paths, candidate commit and local test references.
```

In the adjacent print-dialog task, the owner could assign `accessible-ui@2` as required for focus restoration and `browser-testing@1` for the keyboard journey. It would state which control regains focus and which browser action proves it. The worker receives a clear expectation even if the skill is used across fifty projects.

## Skill catalog and loading

Start with roughly 20 slots. An illustrative catalog the team can evaluate is:

| Area | Candidate skill IDs |
|---|---|
| Requirements and architecture | infer-or-ask, task-decomposition, interface-design, dependency-analysis |
| Backend and data | api-implementation, data-modeling, schema-migration, background-jobs |
| User interfaces | component-implementation, accessible-ui, forms-and-validation, responsive-layout |
| Verification | unit-test-design, integration-testing, browser-testing, regression-debugging |
| Delivery and maintenance | observability, performance-profiling, code-review, release-verification |

These are candidate slots, not skills we write. The [infer-or-ask skill](skills/infer-or-ask/SKILL.md) is drafted here, because it encodes this harness's discovery rules. Every other skill is **downloaded** from the most-used public skills that cover that area ([v1 corpus](v1-knowledge-corpus.md#skills-for-m2)), then checked before use. Keep a downloaded skill only when it changes an outcome or saves measurable work. A worker may receive zero skills.

### Skill lifecycle

| Status | Meaning | Who can use it |
|---|---|---|
| `draft` | Written, not yet measured | Trials only |
| `evaluated` | Run on a small fixed set of representative tasks with and without the skill; results recorded | Planners may select it as optional |
| `active` | Changed an outcome or saved measurable work in evaluation, without regressions elsewhere | Planners may select it as required or optional |
| `deprecated` | Superseded or no longer useful | Existing pinned briefs keep working; new briefs can't select it |

Each version is immutable and identified by its content digest. A change creates a new version that starts at `draft` or `evaluated`. Briefs pin the digest, so a skill edit never changes a running task. The same lifecycle governs catalog questions ([discovery depth](discovery-depth-and-catalog.md#who-writes-and-versions-questions)).

Index short descriptions centrally. The author selects a catalog ID, immutable revision or content digest, and trigger. The kernel resolves that version, checks its declared tools against the assignment, and includes only approved resources. A local adapter can mount it read-only. A remote adapter gets a scoped excerpt under the project's data policy. An unavailable required version or an oversized brief returns to the owner before paid dispatch. Optional skills load on demand. Record the digest actually used with the result so a failed trial can be reproduced.

## Verification and changes

Before dispatch, the kernel resolves existing paths, planned creation locations, dependency digests and commands. It checks that the brief plus required guidance fit the model context, an isolated attempt can run the checks, and the budget reservation succeeds. The author checks whether a new worker could derive the result with the parent plans hidden. A task-specific rule takes precedence over a skill's default.

The planner records visible expected results as versioned examples linked to decisions before implementation; `oracle-author@1` adds at least one held-back case on rule-bearing logic tasks ([prompt contracts](prompt-contracts.md#oracle-author1)), and the kernel verifies red-before-green against the base or a trivial stub before locking them. The worker may add unit tests. The kernel independently runs locked acceptance checks at the candidate commit, compares observed results with those examples and verifies all expected IDs ran. If an expectation appears wrong, submit its ID, the requirement and a counterexample to the author. A correction updates the example revision and triggers fresh verification. The worker cannot amend an expected value to make a failure pass.

A steer invalidates only affected inputs. At the next tool boundary, bind the retained session to the new brief, identify retired facts and require acknowledgment of the active input versions before writes resume. Rebuild a session from its checkpoint if its adapter cannot safely resume. Recheck the assignment lease and relevant versions at acceptance.

First trial: give two fresh small-model sessions the same real leaf task with parent plans withheld. Provide the relevant skill in one run. Compare acceptance results, requests for missing facts, context tokens and rework. A worker asking “which role may edit this order?” points to a gap in the task. A worker getting keyboard behavior wrong despite a clear requirement points to the skill or its selection.

[Editable task diagram](task-and-skill-architecture.mmd) · [Verification and state isolation](verification-and-isolation.md) · [Integration ownership](parallel-feature-integration.md)
