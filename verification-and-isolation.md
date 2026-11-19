# How the harness verifies work and isolates parallel attempts

Each leaf has an agreed observable result. The harness tests the exact candidate against the decisions and inputs its worker received. A feature requires a second check at its real entry point after wiring.

## Independent acceptance

1. **Set the expected result before implementation.** The task or feature planner derives versioned examples from settled decision IDs, including their source or delegated decision record. Record the input, setup, entry point, expected observation and matcher. An unclear expected result goes back to its decision owner. For a cutoff rule, record the zone and behavior before, exactly at and after the cutoff. A test writer cannot choose those semantics.
2. **Bind examples to the product.** A trusted runner executes the example at the declared function, API, CLI, event or browser entry. If code is needed to adapt a fixture, a separate binder receives inputs and produces observations without seeing the expected values. The trusted runner compares observations with protected expectations outside the candidate process and records a receipt keyed by example ID. For any new or changed behavior, verify **red-before-green** before locking the check: the bound check must fail against the unmodified base commit or a trivial empty/constant stub for the target export. A check that already passes before the behavior exists is a binding defect and goes back to its author, unless the check is explicitly marked as a preservation regression.
3. **Protect the evidence and hold back rule checks.** Fingerprint expected data, runner, command, relevant configuration and binding at dispatch. Materialize them from harness storage for verification. The implementer can read illustrative cases and add development tests. For any leaf task that implements a general rule over variable inputs (filtering, aggregation, validation, state transitions or time boundaries), `oracle-author@1` writes at least one **held-back case** derived from the same disclosed rule that runs only in the clean verifier. On a first held-back failure, report the violated rule ID rather than the raw hidden input so a small worker fixes the logic instead of hard-coding a branch for the test input. Later failures follow the [hint ladder](verification-for-real-apps.md#when-a-worker-fails-a-hidden-check): failure type, then a fresh disclosed example from the same rule, then a stronger level or the author. If the implementer disputes an expectation, it sends the rule ID, source and counterexample to the author. An accepted correction creates a new version. The kernel validates changed paths and detects omitted cases, disabled checks and runner tampering. Suspicious general-purpose lint patterns are review signals. An authorized verification/configuration change receives its own scope and independent review.
4. **Run from clean inputs.** Check out the candidate by immutable commit, attach the declared dependencies, provision fresh synthetic state and execute the pinned command. Capture the run environment, actual observation, required IDs collected and their pass, fail or skip status. A passing exit code with zero expected checks observed cannot accept a task. The verifier's comparison and report channel are outside the worker's write surface.
5. **Accept within the current lease.** Recheck the owner's epoch, input read set, example versions, artifact digest and any hold in the transaction that accepts the result. Archive a superseded attempt and reuse still-applicable evidence by explicit revalidation. Only accepted results release dependent work.

For example, the planner can publish this small case for the kitchen mapper. The binder calls the real export with the input rows. The verifier owns the comparison. An output of Soup × 2 followed by Tea × 0 returns a failure for AC-31.

```yaml
id: AC-31
decision: R31@2
entry: toPrintRows
input:
  - {dishId: "s", label: "Soup", quantity: 2}
  - {dishId: "t", label: "Tea", quantity: 0}
expect:
  orderedRows:
    - {label: "Soup", quantity: 2}
```

| Check tier and trigger | How the verifier applies it |
|---|---|
| **Baseline · new or changed behavioral leaf** | Run the bound check against the pre-change base or a trivial empty/constant stub before locking it. Require the expected behavioral failure (`red-before-green`) unless the case is an explicit preservation check. |
| **Baseline · rule over variable inputs** | Evaluate at least one held-back example derived from a disclosed rule in the clean verifier. Report the violated rule ID first so the worker fixes the rule rather than branching on literal test inputs. |
| **Selective · invariant across a domain** | Add a property check (e.g. conservation of totals, idempotence, ordering) with planner-specified input bounds and a saved seed. |
| **Selective · high-impact boundary rule** | Probe a targeted mutation, such as flipping an inclusive cutoff comparison (`<=` vs `<`) or dropping a role check. Investigate a surviving mutant as a gap in the examples. |
| **Mandatory at feature integration · wiring risk** | Drive the real registered entry point. In Resume Changer, switching libraries must clear the prior selection on the actual editor route. A component test alone cannot establish that the route mounts that component. |
| **Selective · time, network or order sensitivity** | Fix the clock and random seed, then rerun in fresh state to diagnose. Record a disagreeing run as unstable. Keep required evidence unresolved while the test or environment owner checks whether the product itself is nondeterministic. |

Keep red-before-green and at least one held-back example as the default baseline for rule-bearing tasks because they cost seconds of CPU and close the two commonest false greens (a no-op binding and literal example hard-coding). Calibrate additional held-back cases, property generators, targeted mutation probes and stateful replays with escaped defects, verifier time, model costs and developer corrections. Integration checks use the production path and product-owned adapters. At external boundaries use a declared substitute or emulator and record differences from the live service. A separately authorized live check can cover that remaining gap.

## Choose state for one attempt

The brief declares which semantics matter, how many processes or connections need to share state, whether schema changes are involved and which resources the commands will open. Choose the least expensive environment that exercises those semantics.

| Tier | Provisioning | Example |
|---|---|---|
| 0 · stateless | Pure function, immutable fixture or an in-memory fake | The kitchen print-row mapper accepts totals as an argument. |
| 1 · in-process | Fresh local engine or temporary file scoped to one test. Use a transaction only where every participant observes the same transaction. | Repository filtering using the product's supported SQL dialect. If locking or extension behavior matters, select a matching engine. |
| 2 · isolated namespace | One managed test engine, with an attempt-specific database, project, queue, storage prefix or directory. Restrict credentials to that namespace where supported. | Browser and server share one seeded kitchen data set. The separate verifier gets another. |
| 3 · private schema environment | Disposable database from a small synthetic template, or a separate engine if instance-level behavior needs it | Apply and validate a migration against its real predecessor. The integrator orders accepted migrations and publishes the next schema base. |

Start only the resources a runnable task needs. Seed from small, named examples. Allocate ports, temporary files, browser profiles, queues, cache write paths and build outputs per attempt. Share an immutable cache only when the tool supports it. Cap concurrent builds and stateful journeys independently of the number of model workers. If an existing application hard-codes a port or storage path, serialize affected runs until the adapter can isolate them. Stateless assignments remain runnable. Verify namespace isolation with two attempts before sharing an emulator. If one attempt can read or clear the other's data, use separate processes or serialize those runs.

For a Windows desktop runner, give each attempt a short workspace path outside the product checkout and attach the process tree to an attempt-owned Job Object. Record exact managed paths, namespace IDs and child processes in the lease. On expiry or restart, reconcile live owners, fence stale writers, terminate only their managed processes and reclaim only their recorded resources. Keep candidate commits and receipts according to retention policy. A worktree separates Git files; a Job Object limits processes but not files or network. The OS sandbox that enforces the filesystem, network and credential boundaries is specified in [sandbox and security](sandbox-and-security.md). Before clean verification, every candidate passes the deterministic [static audit](completeness-gate.md#static-audit).

## Fencing, external effects and cost

Every assignment, integration role and write target has one current holder and a monotonically increasing epoch. Granting a successor advances the epoch. Validate the epoch and operation in the same transaction as state changes. A stale process may leave an isolated candidate. It cannot advance a shared branch, publish an accepted result, or request a live action using its expired authority.

Workers receive synthetic environment settings and local test credentials. Live calls, pushes, deployments, destructive shared-state changes and paid external actions go through the kernel's execution policy. An allowed external effect records scope, authorization, a stable operation key, intent and receipt. Submit with the same provider-side idempotency key where supported. A crash or timeout after sending leaves the outcome unknown. Query the provider, remote target or receipt before retry. Where the destination cannot deduplicate or reconcile, hold that operation for a human decision. A local SQLite transaction cannot guarantee exactly-once effects in an external system.

Before each model call, atomically reserve a capped spend and token estimate against the task and its ancestor budgets. Settle actual use from a receipt and release the remainder. Keep a reservation for uncertain billing until reconciled. If the next call cannot fit, pause that scope, show spend and the last actionable failure, and keep unrelated funded work available. Rate limits use backoff within a deadline. Each repair, clarification and integration loop records its reason, prior evidence and configurable cap. Repeating the same normalized failing check without new information routes the case to its owner. A stronger model is an option for an implementation failure with a clear brief and remaining budget.

| Recorded outcome | Next action |
|---|---|
| Candidate fails a valid acceptance example | Give the worker the failing rule and observation. Bound repair attempts, then escalate to a capable worker or the author. |
| Binding or expected result is disputed | Owner compares the example to its source. Reopen discovery if the product choice is missing. If the binding was weak, repair it independently and rerun. |
| Dependency or brief changed | Mark evidence superseded for the affected inputs. Refresh the brief and resume from its checkpoint. |
| Lease lost, duplicate submission or coordinator restart | Reconcile the existing attempt, event and receipt. Reject stale writes and replay durable notifications idempotently. |
| Environment failure, nondeterministic test or pending external receipt | Route to the environment, test, or effect owner. Keep evidence pending and exclude it from worker-quality scoring. |
| Integration journey fails | Trace the actual producer, consumer and wiring path. Reopen only the defective seam and its dependents. |

## Acceptance trials for the harness

| Injected condition | Observable result required |
|---|---|
| Worker changes a protected example or skips its only collected case | Verifier returns an integrity failure or missing case with its ID. Candidate stays unpublished. |
| Two jobs use identical fixture keys and start servers concurrently | Each observes only its own data and ports. Stopping one leaves the other healthy. Clean verification is independent of both. |
| Two workers request overlapping dependencies or migrations | The integrator reconciles intents once against the common base. A conflicting range or migration order reaches its owner. |
| A late worker submits after role transfer while the current worker finishes | Only the current epoch can publish. The late result stays inspectable. |
| Coordinator stops after sending a paid call but before recording success | On restart, expose the pending operation, reconcile once, and prevent blind replay. |
| Two workers reserve the last remaining budget at the same time | The transaction admits only requests that fit the remaining balance. |

[Task and skill design](task-and-skill-architecture.md) · [Parallel integration](parallel-feature-integration.md) · [Handoffs](agent-handoffs.md) · [Verification for real apps](verification-for-real-apps.md)
