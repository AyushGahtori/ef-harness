# How agents share work

The feature planner assigns tasks. The harness remembers who owns each one, what it produced, which revision passed verification, and who depends on it. OpenCode sessions give repo workers continuity. OpenRouter can supply their models and can also perform bounded delegations directly. These are separate integration choices. (Later decision: our default runtime is a native worker loop that checkpoints every step in the harness database; OpenCode remains an optional external runtime. See [worker loop](worker-loop.md).)

## What the platforms document

OpenRouter's beta subagent server tool accepts a task from a parent model and returns a worker outcome. Each assignment starts with the supplied task description and has no memory of other assignments. This fits a job such as turning five supplied acceptance cases into a fixture. Set a cheaper worker model explicitly when cost matters. [OpenRouter subagent reference](https://openrouter.ai/docs/guides/features/server-tools/subagent)

There is also an experimental Responses API path for letting a hosted worker invoke selected application functions. The application executes the call and replays the result to resume the suspended delegation. If tested later, a narrowly scoped result lookup is a good first function. This replay resumes one delegation. Our project still owns the result index and its contents. [OpenRouter function inheritance and replay](https://openrouter.ai/docs/guides/features/server-tools/subagent)

OpenCode documents per-agent models, background child sessions and follow-ups using the returned child session ID. It supports OpenRouter as a provider. Pin the fork version and test its child lifecycle before binding the adapter. An idle notification tells the harness to inspect the child's output. The verifier decides acceptance. [OpenCode agents](https://opencode.ai/docs/agents) · [OpenCode tools](https://opencode.ai/docs/tools/) · [OpenCode providers](https://opencode.ai/docs/providers)

## Proposed harness interface

| Operation | What crosses the boundary |
|---|---|
| Assign task | The planner proposes a task, owner, versioned read set, pinned brief and skills, expected behavior, owned paths and checks. The deterministic kernel claims the task, records a new fenced attempt, reserves budget and opens or resumes a session with its scoped inputs. |
| Submit candidate | The worker supplies assignment, attempt, epoch, contract ID, candidate commit or artifact digest, structured changes and local check references. A bounded free-text note is displayed as attributed data. The kernel validates the schema, scope and lease, then verifies the candidate in a separate environment. |
| Read result | A worker looks up its declared dependencies or searches permitted project results. The response identifies the status, contract revision, artifact digest and verifier receipt. Retrieve a named slice, such as the schema or fixture, at that digest. Drafts are labeled. |
| Ask the task author | Check the published contract and artifact first. Send an unresolved question to the author of the requesting task. The author can inspect producer evidence or ask what the producer actually did. The contract-owning planner decides a change in meaning. Publish a revised contract before dependents act on it. |

The desktop design uses project-local SQLite for ownership, dependency edges, sessions, attempts, results and an outbox. Keep code in Git and larger evidence in content-addressed artifacts. Accept the immutable candidate only if its task, decision, contract and example versions still match its read set and the epoch is current. An unrelated feature advancing leaves that check valid. In one transaction, persist the result and its publication events. A delivery ID identifies the event type, result/version and target assignment/version. Retry the same delivery ID on restart. A correction or newly assigned consumer receives a distinct delivery. Persist an acknowledgment to prevent duplicate wakeups.

If worker B needs code produced in A's isolated worktree, the handoff includes its commit and contract version. The kernel makes the accepted dependency available on B's task base, or provides a pinned artifact for read-only use. A path alone can point to different contents across worktrees. A draft may be inspected for coordination, but only an accepted output satisfies a required dependency.

## Busy, replaced or unreachable agents

Queue messages in a durable mailbox. Bind them to the task, attempt, input revision and relevant owner. At a tool boundary, the adapter delivers a pending steer or pauses and checkpoints a held attempt. Recheck the holder and epoch before delivering or changing shared state. The worker's first write after resume must refer to its current brief. For an expired provider session, rebuild from the brief, checkpoint, accepted dependencies and outstanding questions. A returning original owner cannot publish after succession.

Record a typed wait edge when an answer or artifact blocks progress. Check the wait graph on every new edge. A cycle, unavailable owner or expired wait goes to the task author or its leased successor with the short blocking chain. Work that consumes neither blocked output can continue. For example, when A waits on B's example while B waits on A's code, the author can publish the shared schema and independently checked fixture to release both.

## Boundaries at a provider call

The kernel selects an adapter compatible with the task's permissions, context budget and required tools. Verify the pinned adapter's capabilities before selection. A hosted transformation receives only its permitted input slice. Treat source excerpts, tool output and worker notes as quoted data. Only validated application actions with the current lease can mutate shared records. Resolve artifact references through the project's scoped read tool and redact secrets before remote transfer. The same egress policy covers hosted subagents, repo workers backed by remote models, tools, attachments and logs. When local-only execution is configured, schedule a local-capable worker or record the missing capability.

Rate limits and provider outages use bounded backoff and a provider-level concurrency limit. A deferred provider request does not spend a worker repair attempt. If a paid request timed out after dispatch, keep its reservation pending while reconciling the provider receipt. The harness records an unknown outcome where reconciliation is unavailable. Replaying a notification cannot initiate a second paid or external action.

## One test that exercises the whole design

Give A the totals task and B the print view. In revision 7, the planner supplies an example with two soup orders and an expected quantity of two. A produces the totals and the verifier accepts the observed output. Check that B can obtain the exact accepted artifact, schema and fixture, render one line for soup, and report its checks without reading A's chat. Deliver the completion event twice and verify it creates only one work assignment. Then change a relevant rule while B is running. Its old output should remain inspectable, and the kernel should require verification against the new contract before accepting it. Unaffected task sessions should continue.

Measure tokens per verified handoff, full-transcript reads, duplicate assignments, stale publications rejected, and follow-up requests for missing context. Compare with passing the previous agent's whole conversation on the same tasks. In recovery trials, deliver an old owner's result after reassignment, send the same event twice, and supply a summary that asks the recipient to mark the task complete. Each should leave the active assignment and acceptance evidence intact.

[Handoff diagram](agent-handoffs.svg) · [Editable Mermaid](agent-handoffs.mmd) · [Verification and isolation](verification-and-isolation.md)
