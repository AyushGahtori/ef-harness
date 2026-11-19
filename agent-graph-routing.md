# Finding the right agent from a submitted message

“Make that list printable too” may mean the customer’s order history or the kitchen’s daily list. A selected diagram node, a reply to an earlier turn, or a focused question can identify the intended list. A kitchen worker reporting progress a moment ago is weak evidence. If both targets still fit, the planner asks “Which list should print, the kitchen’s daily list or the customer’s order history?” Both teams continue until there is evidence that a contract may change.

## What the router sees

The proposed TypeScript coordinator keeps the typed graph in SQLite. Each key includes project, graph namespace and stable entity ID. Code allocates a project-local agent number such as A0014, then indexes delegation, task authorship, role holder, current assignment, session and checkpoint separately. A new worker gets a new number. Reassigning its role or task preserves the historical links. Changing an agent heartbeat updates the runtime graph alone.

1. At input start, capture the focused question and selected node. On explicit submission, store the immutable text, source, chat sequence, reply-to ID and a client message ID for retries. Pauses in dictation save the draft. The Stop control has a separate direct path to the kernel.
2. Check live question IDs and explicit project-local targets first. For free text, search indexed titles, aliases and referenced turns. Include earlier pending routes when the user says “no, the other list.” Supply compact cards with candidate ID, entity kind, feature, reason for matching, source turn and current owner role. Start evaluation with up to five cards. Expand a relevant typed neighborhood once, then ask if ambiguity remains.
3. The small routing model returns a proposed intent per clause, candidate IDs, evidence and unresolved reference. Code validates the schema, allowed intent, project membership, current ownership and dependencies between clauses. Its read-only capabilities keep classifications separate from execution. A plain status question reads the evidence directly. A correction phrased as a question goes to the owner for interpretation.
4. Resolve the architecture ID through an ownership edge to the planner role. Queue delivery to the role. Validate the lease at receipt and publication because a successor can take over while the model is thinking. An unowned feature or cross-feature bug goes to the project planner. A named task status request reads the assignment’s timestamped receipts.

Use composite indexes in both directions, e.g. `(project, namespace, node_id)`, `(project, source_namespace, source_id, edge_type)` and the equivalent target tuple. Dependency traversal uses a queue, an edge-type filter and a visited set. If traversal reaches its safety bound, report unresolved reachability to the owner before dispatching potentially affected work. Language tags narrow the shortlist. They cannot establish ownership.

## Test the routing decision

Replay labeled cases for “did you print it?”, “why is it still emailing? I said print”, a topic switch, a late reply to a retired question, and an owner replacement between lookup and delivery. Count correct shortlist recall and dispatch separately. Measure false mutations, unnecessary pauses, needless clarification, missed corrections, latency and tokens. Include a case in which asking is the correct result. A read-only path must produce zero task-state or revision mutations.

[Diagram](agent-graph-routing.svg) · [Editable Mermaid](agent-graph-routing.mmd) · [Graph storage and traversal](linked-graphs-design.md) · [Chat ordering and question ownership](routing-design.md)
