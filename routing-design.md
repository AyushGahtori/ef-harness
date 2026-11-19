# Requirements, ownership and plan revisions

The developer uses one chat throughout discovery and implementation. A small read-only model can propose a route. A planner interprets product intent. The coordinator is a deterministic kernel that validates evidence, permissions and ownership, schedules work, writes authoritative state and records outcomes. The project planner owns cross-feature scope. A feature’s task author owns its contracts and integration through a stable role.

## Submitted messages and ownership

Typing and dictation are drafts until Send or an explicit finish-and-send action. A pause in speech can save a draft. Capture the focused question and selected graph node when input begins. On send, append the immutable turn with its project, chat sequence, message ID, reply target and origin. Retry with the same ID to receive the existing result. When the next message says “no, the other list,” its routing view includes the earlier pending route. Amend that pending action, or issue a real corrective steer if it already committed.

The kernel resolves explicit IDs and searches aliases, active subjects and referenced turns. Give the router a short set of candidate cards with matching reasons. The model proposes intent, target and supporting text per clause. The kernel validates all three, checks current scope, and routes to a durable owner inbox. A busy planner reads it at the next turn boundary. A control command can cancel an active turn. Invalid or repeatedly malformed routing output falls back to the bounded clarification path. Status reads are safe on weak evidence. A mutation needs a positively identified action and subject.

Persist one ordered group of intents per submitted message. Clauses have stable IDs, dependencies, outcomes and separate retry keys. Execute unequivocal pause commands first, then prerequisites, dependent changes and any status reply that refers to them. For “add menu uploads and show them on the kitchen list,” reserve the upload feature before linking the existing list. For “pause email and switch it to print,” the named user pause survives the plan revision until explicitly resumed. A status clause can answer immediately when it has no pending prerequisite. Crashes resume the recorded group at the next unapplied clause.

| Route | Example and handling |
|---|---|
| Read-only question | “Have you pushed?” Read the push receipt or perform a read-only remote check. Return the evidence, timestamp or unknown status in chat. “Did you make it print?” alone changes no task. |
| Existing feature change | “Why is it emailing? I said print.” Route the cited discrepancy to the task-file author, who checks prior decisions before proposing a change. Revert, a bug or screenshot feedback follows this route. A seam spanning owners goes to the project planner. A confirmed bug creates a linked regression case. |
| New feature | “Maybe restaurants could upload menus” enters the current release by default. An explicit v2 goes to the backlog. Check aliases and prior features before allocating an ID and persisting a scoped feature record. If a similar record may mean something different, ask its owner to resolve it. |
| Proposed fourth route, execution control | Pause, resume, stop, reprioritize or change a harness preference. Verify a human-task completion against its expected receipt before unblocking a dependent task. A Stop button and standalone explicit stop command reach the kernel directly. A quoted “stop” in product requirements is ordinary submitted text. |

## One queue for the developer’s questions

All planners submit clarification to one project question queue. Workers use `AskOwner` or `DisputeTest` to reach their task author, who resolves from the record, asks the project planner about shared policy, or submits a named question to the queue. A question has a stable ID, owner role, criterion and scope version, status, subscribers, answer options and blocked work. Deduplicate equivalent questions about the same criterion in the same scope. Notify every subscribed owner when resolved.

How this queue is batched and delivered during a build, so the developer isn't interrupted every few seconds, is in [build cockpit](build-cockpit.md#the-inbox-prioritizing-without-notification-spam); how a selected canvas box coexists with a focused card is in [interactive architecture](interactive-architecture.md#the-composer-target). Show one focused card with individually addressable items, including up to five from a single batch. Other cards show a pending count. Give priority to questions blocking held work, then contradictions, planning blockers, due deferred decisions and ordinary gaps. Use age for ties and surface aging waits. Preserve focus throughout drafting or speech. A click, reply-to or “Q-41” binds directly. A short answer binds only when its item is identifiable from that captured focus. “Both” against two yes/no items warrants one clarification. A longer answer can resolve several compatible criteria when each has evidence. Echo any clear binding to another open card. A reply to a retired question enters the resolver as new evidence and may reopen a decision. It cannot silently resurrect a retired question.

## Which work to hold

Suppose four workers share twelve kitchen tasks. “The kitchen wants a printed list” leaves addition and replacement plausible. The planner checks the actual delivery contract and the submission that may have changed it. For each plausible meaning, compute affected work from typed contract and test dependencies and owned-path evidence. An ambiguous subject gets a target question first. With known kitchen scope, apply the following decision per assignment.

| If the task’s contract changes under | Kernel action |
|---|---|
| Every plausible meaning | Hard hold. Fence new tool calls or publish actions, let already granted operations settle or cancel safely, and checkpoint at the boundary. |
| Some meanings | Soft hold. Finish the current bounded step in its isolated worktree. Start no new step. Quarantine the result pending resolution. |
| None | Continue. For example, compatible dish-total calculations can run under either delivery policy. |

Record each independent hold reason, e.g. user pause, steering change or budget. Resumption requires all applicable reasons to clear. Show the count and reason when many tasks pause. Save WIP ref, assignment and epoch, contract versions, session reference and action receipts. Keeping the old chat lets the user inspect it. An additive clarification may resume that session. A contradiction starts a fresh worker session with the updated brief and the old WIP diff labelled with its original version. Recheck the diff against the revised acceptance cases. A session expiring does not lose the task. A persistent hold gets an aged reminder through the same queue.

External actions go through the kernel with scoped authorization, a stable operation key, recorded intent and a confirmed receipt where available. On restart an uncertain “email sent” or “push completed” reconciles against the provider before retry. An unqueryable effect without provider idempotency stays unknown for its owner to resolve. [Worker and owner graph](agent-graph-routing.md)

## The scoped interview

The five opening questions establish project scope. A feature inherits applicable project facts. Select general questions by the new decision criteria they cover, then specialize their wording. For small additions, ask two or three in a round. “What should happen when the same action is submitted twice?” can become “If two managers send Friday’s order, which copy should the kitchen use?” Keep that wording locally. Promotion of a generic entry depends on consequential decisions uncovered in held-out projects, duplication and interview burden.

After explicit submission the planner checks conflicts against existing rules. “Orders close at 11” and “the kitchen needs final numbers at 10:45” could coexist if later edits are handled separately. Ask about that interval. If the user says “I don’t know,” recommend a concrete choice with its consequence. A recommendation needs acceptance or an authorized delegated resolution. Internal rounds can answer five catalog items, five more, then a genuine locally generated question from submitted evidence. Ask zero user questions if all prerequisites for the scoped work are met. Stop repeated internal rounds that produce no distinct progress. [Discovery design](project-discovery.md)

## From 100% to code

At full scoped build readiness, show what will change and an acceptance example, then publish. The first build of a project waits for **Start build** on the [plan preview](planning-and-crew.md#plan-preview); later revisions under the developer's auto-start threshold start eligible work automatically. New scope can add criteria. Show deferred decisions and their dependent tasks distinctly. A decision needed for this implementation, an unresolved inherited project contract, a material contradiction or an unsupported high-impact inference keeps the dependent work open.

1. Record the interpreted delta, source turn and affected stable IDs. Show the human an optional graph diff. For a confirmed replacement, “The kitchen gets a printed list. Scheduled email is removed. The cutoff stays at 11. Two soup orders appear as two soups on the list.”
2. Follow requirement IDs into architecture sections, master and feature plans, brief versions, interface contracts, UI steps and test specs. Retire superseded IDs explicitly and create removal tasks for merged behavior.
3. Publish through the kernel’s per-node and edge-set version check, commit brief changes and outbox events together, and export the human views at their named revision. When the read set changes, recompute the affected delta. Compare overlapping decisions by meaning before applying them. [Revision and crash handling](linked-architecture-revisions.md)
4. Resume or dispatch current leased assignments. Run locked checks against their applicable contract versions and integrate through the author’s feature journey. Unrelated revision increments alone do not invalidate verified work.

## Resume Changer as the first benchmark

The reproducible baseline is committed Git data at `497831ec5aa7effb354bb1a8d22d2f031b17a4e0`. The manifest inventories 73 Markdown files under `docs/`. Seventeen filenames include “plan” or “task” and contain 4,906 physical lines including blanks. A previous local working-tree inventory counted 78 Markdown documents and a 20-file, 5,775-line plan/task subset. It included untracked material and describes a separate local snapshot. Use the committed files and hashes for repeatable evaluation. [Pinned benchmark manifest](resume-changer-benchmark.json)

Define the scope with the baseline plans, then hold out their review findings when evaluating a generated interview. Track distinct consequential decisions, linkage to tasks and acceptance cases, unsupported inventions, duplicates and repeated questions. Three project cases illustrate the level of detail:

- Switching between demo and personal libraries must define which selection, analysis and output state clear, and which saved draft can be restored.
- After a paid request times out, the interface must distinguish a known failure from an unknown outcome and handle a retry that could duplicate paid work.
- Two independent UI work packages can pass alone. A feature journey must show that the actual entry point mounts the new component and uses the real catalog adapter.

Evaluate the “20% more detail” goal against a deduplicated baseline for the chosen workflow. Count extra testable decisions accepted by the reviewer, independently of output length.
