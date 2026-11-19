# Knowledge slicing: giving each agent exactly what it needs

A finished spec for a mid-sized app can run to tens of thousands of lines across research, architecture and plans. A worker needs perhaps two to six thousand tokens of it. Giving it too much makes it worse: models measurably lose accuracy as input grows and miss facts placed in the middle of long contexts. Giving it too little means a rule buried in another feature's document gets ignored. This document defines how the coordinator compiles the right slice and how agents ask for more. Research: [context slicing](research/context-slicing.md).

## Decisions in plain words

1. **Both push and pull.** The coordinator *pushes* a compiled, self-contained packet with everything the task must obey. The agent can *pull* more through read-only knowledge tools. Every pull is recorded.
2. **Rules reach tasks by what they apply to, not by which document they were written in.** A cross-cutting rule carries a scope (“all endpoints that return personal data”); code matches it against what each task touches.
3. **The packet has three priority bands.** *Must* items are never cut; if they don't fit, the task is split. *Should* items are trimmed. *Could* items stay pull-only.
4. **The exported Markdown files are for humans.** Agents read the database through tools, never the export files.
5. **Pulls teach the compiler.** If workers keep pulling the same kind of item for similar tasks, the compiler starts pushing it.

## The packet

On task claim, the coordinator walks the knowledge graph from the task and compiles a packet. No model is involved.

| Band | Contents | Source edges |
|---|---|---|
| **Must** | Task goal and write scope; contracts consumed and produced (exact versions); spec items implemented; cross-cutting rules in scope; edge cases handled; visible acceptance examples; interaction contract; definition of done | `implements`, `consumes_contract`, `produces_contract`, `handles_edge_case`, `must_pass_check`, `obeys` (computed, below) |
| **Should** | Conventions lines relevant to the files touched; research warnings for libraries used; signatures and module cards of accepted dependencies; design tokens and kit components for UI tasks | `uses_library`, `depends_on`, conventions by path pattern |
| **Could** | Neighboring features' summaries, rationale for decisions, full research notes | Pull only |

**Layout matters.** The most important items (goal, write scope, rules, definition of done) go at the **start**, and a short checklist repeating the rules and checks goes at the **end**, because models use the beginning and end of their input most reliably.

**Size targets** depend on the model level: about 2–3k tokens for a Junior, 4–6k for a Senior. If the Must band alone exceeds the limit, the task goes back to its planner to be split; it is never silently truncated (this rule already exists in [coordinator and recovery](coordinator-and-recovery.md#resource-and-retry-policy)).

## Cross-cutting rules reach every task they apply to

Each cross-cutting rule (authentication, error format, time zones, personal data, rate limits, logging, accessibility) is stored once with a **scope predicate** over typed facts about tasks:

```yaml
id: X-07
title: Personal data is never logged
scope:
  all: [personal_data, logging]     # touches tags from the closed list; entity tags are inherited
applies_as: must
check_ids: [LINT-PII-LOG, AC-X07-1]
```

Every task declares what it touches using the closed list of **touches tags** ([v1 corpus](v1-knowledge-corpus.md#touches-tags-closed-vocabulary)); a task touching an entity inherits that entity's data tags, and code adds tags it detects in the diff. A scope is `any: [tags]` (matches if the task has at least one) and/or `all: [tags]` (matches if it has every one); nothing else is allowed in a scope. The compiler evaluates every rule's scope against the task's tags. A rule that F01's architect wrote while designing sign-up reaches F12's export task automatically if F12 exports user names.

**Rule hoisting.** An architect writing a feature document may write a rule that is really cross-cutting. The architecture consistency gate checks each new rule against cross-cutting categories (auth, time, errors, personal data, money, concurrency). A match must be classified as *local* (with a reason) or moved to the cross-cutting set with a scope predicate.

**Proof the rule was included:** every rule in scope carries check IDs. The [completeness gate](completeness-gate.md) refuses to accept a task unless the checks of all in-scope rules ran and passed. A rule that went missing from a packet is caught at verification.

## Pull tools

Served by the per-attempt harness MCP server ([agent runtime adapters](agent-runtime-adapters.md#talking-back-our-tools-inside-their-agent)):

| Tool | Returns |
|---|---|
| `kb.search(query, filters)` | Ranked node IDs with titles and snippets (SQLite full-text search; optional local embeddings) |
| `kb.get(id)` | One node at its current version: rule, contract, spec item, research fact, decision with quote |
| `kb.neighbors(id, edgeTypes)` | Linked nodes |
| `kb.contract(id@version)` | Full contract schema and examples |
| `kb.why(id)` | The decision chain and source quotes behind an item |
| `kb.code(symbol \| path)` | Signatures and module card of accepted code at the task's base |

Limits per attempt (number of calls and returned tokens) keep pulls from becoming a backdoor to “read everything”. Responses are labeled as data, not instructions.

## The read set

| How an item was obtained | Recorded as | If it changes during the attempt |
|---|---|---|
| Pushed in the packet | Declared dependency | Hold the task at its next boundary; refresh the brief ([routing](routing-design.md#which-work-to-hold)) |
| Pulled with a tool | Observed dependency | Recheck at acceptance: if the change is material to the item's meaning, rerun verification against the new version |

This makes stale reads visible no matter how the agent learned something.

## Learning what to push

The coordinator records which items were pulled, by which task class, and whether the task passed. Weekly, the meta-lab proposes compiler rule changes (“UI tasks in this project almost always pull the page-header template; push it in the Should band”), evaluated like any other change ([meta-lab](meta-lab.md#promotion-rules)).

## Example packet (abridged)

```
T07 · Kitchen print page (UI)                 brief v3 · base harness/f/F12@4c1e
GOAL     Show today's totals on /kitchen with a Print button that prints them.
SCOPE    write: src/app/kitchen/**, tests/kitchen/print.*   read: anything
MUST
  SI-212 When the cutoff passes, the page shall show the locked totals.  (R17@3: cutoff 10:45 Europe/Berlin)
  SI-214 If totals fail to load, then the page shall show “Couldn't load orders · Retry”.
  C kitchen-totals@1 (consume)   C kitchen-list/ui@1 (produce: button “Print”, table “Totals by dish”)
  X-03 Times are shown in the office time zone.   X-11 Errors use the shared ErrorBanner.
  Checks: AC-31, AC-33, UI-12, X03-2 (+1 held back)
SHOULD   Conventions: pages use PageHeader with actions slot; tables use <Table>.
         Dependency T03: toPrintRows(totals) → PrintRow[]   (accepted, src/kitchen/to-print-rows.ts)
DONE WHEN all checks above pass, no TODOs, nothing outside scope changed.
CHECKLIST  cutoff 10:45 Berlin · Print button by name · empty state · error banner · time zone
```

## Edge cases

| Situation | Behavior |
|---|---|
| A task touches something its plan didn't declare | The diff check adds the actual touched facts; new in-scope rules are evaluated and their checks added before acceptance. |
| A rule's scope predicate is too broad and floods packets | The meta-lab flags rules included in most packets with no related check failures; the architect narrows the scope. |
| Search returns nothing for a needed fact | The agent asks its owner (`AskOwner`); a real gap becomes a spec item. |
| Two versions of a contract exist during a revision | The packet pins the version in the task's brief; pulls return that version unless the agent explicitly asks for the newest. |

[Diagram](knowledge-slicing.svg) · [Editable Mermaid](knowledge-slicing.mmd) · [Build pipeline](build-pipeline.md) · [Linked graphs](linked-graphs-design.md) · [Agent handoffs](agent-handoffs.md) · [Research](research/context-slicing.md)
