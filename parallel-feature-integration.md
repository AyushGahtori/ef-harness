# Parallel feature work and integration ownership

The author of the task file owns the feature's combined outcome. In the kitchen example, four interchangeable workers can start twelve tasks from self-contained briefs. Four and twelve are only an example: the crew size and each task's model level are computed per wave ([planning and crew](planning-and-crew.md#crew-composition)), and shared foundations are built in Phase 0 before any feature wave starts. The author supplies the common base, settled decisions, machine-readable contracts, examples, path ownership and a real user journey up front. Workers confirm their pieces. The author brings those pieces together. The user's estimate of 70% integration and 30% review describes their experience and helps explain why the integration task deserves its own brief.

## Schedule independent tasks

The kernel validates the prerequisite graph on publication, reports any cycle to its author, and places runnable leaves in a ready queue. It prioritizes ready tasks whose transitive decision closure relies only on `explicit` user facts ahead of tasks that consume `derived` or `delegated` choices, so the first worker turns run on stated requirements while the user sees the change summary. Four free workers can each claim one ready task. For equally sized independent work this can yield the familiar 1–3, 4–6, 7–9 and 10–12 grouping. If task 2 runs long, a free worker may take task 3. Prefer an already-warm worker when it has compatible skills, isolation and free capacity. The kernel atomically claims a task and leases an attempt so that two workers cannot publish it. A true artifact dependency becomes ready only when an accepted version is available.

For the kitchen feature, both the totals producer and print consumer get the same versioned schema for dish ID, label and integer quantity. At dispatch the kernel verifies the sample against the schema. Producer verification validates actual output. Consumer verification exercises real consumer code with a validated sample. Both sides can start together. A combined test later passes the producer's actual output directly into the consumer.

## Integrate at each boundary

| Boundary | Responsible role | What happens |
|---|---|---|
| Child to parent task | Parent task-file author | Assemble accepted children on the pinned base, check the parent contract and isolate any mismatch. |
| Task to feature | Original feature task-file author, holding the **feature integrator** role (it acts through `feature-integrator@1`; the role passes to a successor by lease) | Integrate accepted results incrementally in a private feature branch. Workers' wiring needs collect in one wiring task, which the integrator executes ([build pipeline](build-pipeline.md#leaf--feature)). The author may delegate the mechanical wiring and remains accountable for the combined feature. |
| Feature to product | Project integrator, a role the project planner can hold | A single project merge queue tests the candidate on the latest target with its real entry-point journey, related feature regressions and a project smoke check. Advance the target only if its head still matches the tested base. On movement, refresh and rerun affected checks. |

The feature branch can accumulate passing pieces while work continues. Publication requires all required leaves and the wiring journey to pass on the integrated candidate. Each integration lease has a holder and increasing epoch. If the author is unavailable, the kernel transfers the role, latest integration commit, outstanding intents and evidence to the successor. An older owner returning later can contribute its draft for inspection. The kernel fences its writes.

When two workers need new dependencies, each submits a dependency intent with package, version constraints and reason. The integrator reconciles compatible intents and updates the manifest and lockfile together once. A conflicting range goes to the author. The same owner orders migrations and applies shared route, export and registry changes. Assign an explicit shared-file or schema task when the shared change is itself the deliverable. Verify both producer and consumer again if their contract changes.

## When the pieces pass and the feature fails

Give the project two soup orders before cutoff. Start at the actual kitchen URL as a kitchen staff member, invoke Print, and verify the observed output contains one soup row with quantity two. Going directly to an unmounted print component would miss a wiring defect. For an API, CLI or background feature, use its published endpoint, command or delivered event.

| Observation | Owner and action |
|---|---|
| Producer emits a string where the contract requires an integer | Reopen the producer task and invalidate dependent acceptance evidence. Allow independent work to continue. |
| Producer and consumer satisfy the schema but the production route never invokes them | Integrator fixes the wiring task and reruns the journey. |
| The expected behavior for duplicate dish labels was never settled | Feature planner reopens the criterion, revises the contract and examples, then redispatches only affected tasks. |
| A clean replay disagrees with the first run | Record both runs, seeds and environment. Give the unstable test to its owner. Keep the affected acceptance check unresolved until there is reproducible evidence. |

Track the source of defects, rework at each boundary, integration queue time, and context spent by the author. Use those results to adjust task size, shared contracts, or the degree of parallelism.

[Diagram](parallel-feature-integration.svg) · [Editable Mermaid](parallel-feature-integration.mmd) · [Task and skill design](task-and-skill-architecture.md) · [Verification and isolation](verification-and-isolation.md)
