# Interactive architecture: dictation, the live canvas and fixing what it misheard

The developer talks or types on the left. The project's architecture lives on the right as a canvas they can click. Selecting a box and chatting about it is the signature feature: the same idea as pointing at an element in a browser preview and saying “change this”, applied to the system design itself. Research: [dictation and canvas](research/dictation-and-interactive-canvas.md).

## Decisions in plain words

1. **Nothing is sent until the developer sends it.** Dictation fills an editable draft. Silence, a two-minute water break or a closed laptop never submits. Enter (or the Send button) is the only commit.
2. **No live model graph while speaking.** Speech becomes text locally, for free. The graph changes once, after Send, with the differences highlighted. This removes the flicker, the wasted calls on every pause and the “actually, scratch that” problem: the resolver reads the whole message, including the retraction.
3. **One visible target at a time.** The composer always says what it is talking to: the focused question, a selected box, a selected screen element, or the project in general. Clicking a box never answers a question, and typing never jumps to another card.
4. **Recommended is preselected, never auto-sent.** A question card highlights the recommended option. Pressing Enter accepts what is highlighted. Nothing is accepted on a timer.
5. **The canvas is a view of the real graph.** Every box is a node in the architecture or runtime graph with a stable ID. Editing a box creates a normal, validated revision. There is no separate “diagram state” to drift.

## Screen layout

This is the Discover preset of the single app shell ([app shell](app-shell-and-governor.md#the-shell)); the top bar with Stop and the Inbox stay available.

```
┌────────────────────────── Chat ──────────────────────────┬─────────── Canvas ────────────┐
│ conversation history                                      │ [Architecture] Plan  Tasks    │
│                                                           │  App  Diff        🔍 filter   │
│ ┌ Focused question · Q-41 ───────────────────────────┐    │                               │
│ │ Which database should the demo use?                │    │   [Staff]──orders──▶[Order    │
│ │ ● SQLite (recommended)  ○ Postgres  ○ Other…       │    │                     page]     │
│ └────────────────────────────────────────────────────┘    │        │                      │
│ ┌ Composer ──────────────────────────────────────────┐    │   [Rule R17 · Cutoff 11:00]⚠  │
│ │ Talking to: Q-41 database ▾                 🎙  ⏎  │    │        │                      │
│ └────────────────────────────────────────────────────┘    │   [Kitchen list]              │
└───────────────────────────────────────────────────────────┴───────────────────────────────┘
```

The divider is draggable. The canvas can pop out to a second monitor. Tabs: **Architecture** (the graph), **Plan** (feature and task tree with estimates), **Tasks** (runtime graph: who works on what), **App** (running preview, see [UI design system](ui-design-system.md#preview-and-point-to-fix)), **Diff** (code changes per task or feature).

## Dictation flow

| Moment | What the developer sees | What runs |
|---|---|---|
| Presses the mic | Recording dot; transcript appears in the composer, grey while unstable, black when the recognizer finalizes a phrase. | Local speech-to-text (OS recognizer or bundled Whisper). Zero model tokens. |
| Pauses for 3 seconds | Nothing changes except a “Paused · still listening” hint. | Nothing. |
| Pauses for 60 seconds | Mic stops itself; draft stays. “Mic off · your draft is saved.” | Draft autosaved to local storage. |
| Says “10:45” and recognizer is unsure | The token is underlined amber. Hover shows alternatives (“10:45 · 10:40 · 11:45”). | Local check: numbers, times, money, names and negations get the recognizer's confidence; low ones are flagged. |
| Says “actually, scratch that” | Text stays as spoken. Optional: a strike-through suggestion on the previous sentence that the developer can accept with one click. | Local phrase match only. The resolver handles retractions authoritatively after Send. |
| Edits the text by hand | Normal text editing. | — |
| Presses Enter | Message posts. Canvas shows “Reading your message…” then highlights what changed. | One opening-review or batch-resolve call over the whole message. |

**After Send, echo risky values.** Times, amounts, counts and names that change behavior come back in the change summary in bold (“Cutoff **10:45**, staff can edit until then”). This is the moment to catch a mishearing that slipped through.

## Readiness display

The old “Ready to plan 18/18 · Overall 18/20” is correct but cryptic. Use counts with words and explain every change to the denominator.

```
Needed before building   18 of 18 ✓
Everything we know       18 of 20   · 2 can wait until their tasks (email provider, print size)
                         +4 since your last message: you added email delivery
```

- Counts, never a lone percentage (a rounded 100% can lie).
- When the total goes up, say why in one line, with a link to the four new items.
- When the total goes down (scope removed), say that too.
- Hover on any number lists the items.

## The composer target

The target chip above the composer has four kinds. Exactly one is active.

| Target | How it becomes active | What Enter does |
|---|---|---|
| **Question** (Q-41) | Default when a question card is focused; clicking a card | Answers that question (selected option or typed text) |
| **Box** (Rule R17 · Cutoff) | Clicking a box on the canvas, or typing `@R17` | Sends a message *about that box* (see intents below) |
| **Element** (KitchenCard) | Point-and-select in the App tab | Visual change request for that element |
| **General** | Pressing Esc, or clicking “General” | Normal chat routing |

Rules that keep it from jumping around:

- **Selection never answers.** Clicking R17 while Q-41 is focused switches the target to R17. The Q-41 card stays exactly where it was, dimmed, with “Paused: you're talking about Cutoff”. Its selected option is kept.
- **Each target has its own draft.** Switching back to Q-41 restores its half-typed text.
- **Focus is captured when typing starts.** If a planner adds Q-42 while the developer types, Q-42 joins the queue below; the focused card does not change.
- **Type mismatch is caught.** If the target is the Cutoff box (a time) and the message is “Postgres”, the kernel can't map that to a time. It asks once: “Did you mean this as the answer to Q-41 (database)?” with **Yes, answer Q-41** and **No, keep it on Cutoff**.
- **After a box message is handled**, the target returns to the focused question automatically, with a small toast “Back to Q-41”.

## What can be selected

| Box type | Example | Popover shows | Quick actions |
|---|---|---|---|
| Actor | Staff, Kitchen, Manager | Description, permissions, workflows they appear in | Rename · Edit permissions · Show workflows |
| Feature | F12 Kitchen print | Status, readiness counts, tasks, owner planner | Open plan · Defer · Remove from release |
| Workflow step | “Staff submits order” | Actor, action, result, acceptance example | Edit · Add step after · Add failure case |
| Rule / decision | R17 Cutoff 11:00 | Value, basis (*you said* / *inferred* / *chosen for you*), source quote, dependents | Edit value · Why? · Show impact · Revert to earlier value |
| Data entity / field | Order.quantity | Type, constraints, who reads and writes it | Edit · Add field · Show migrations |
| Interface / contract | kitchen-totals/v1 | Schema, producer, consumers, version | View schema · Propose change |
| External service | Email provider | Chosen service, secret needed, status | Choose · Defer to task |
| Screen | Kitchen page | Wireframe, states, owner task, preview link | Open in App tab · Edit layout |
| Open question | ? Late edits after cutoff | The question card | Answer here (becomes its focused card) |
| Assumption | ⚑ Phone-only access (inferred) | Why it was inferred, the rule used | Confirm · Correct |
| Deferred item | ⏸ Print size | Due before which task | Decide now |
| Today module (existing repo) | `src/auth` | Module card from [brownfield discovery](brownfield-discovery.md) | Plan a change here · Confirm description |
| Task (Tasks tab) | T03 · Worker A0014 | Live status, diff, checks | Open worker · Pause · Fix it myself |
| Edge | Order page → Kitchen list | Relationship type and contract | Show contract · Remove relationship |

Lasso or Ctrl+click selects several boxes. The target chip then reads “3 boxes”, and the message is split into one clause per box when the planner applies it.

## What happens when the developer chats about a box

The router already knows four routes ([routing design](routing-design.md)). A selected box narrows the subject, so the remaining question is the intent:

| Intent | Example with R17 selected | Handling |
|---|---|---|
| **Ask** | “Why 11?” | Read-only. Answer from the source quote and basis. No state change. |
| **Correct (misheard)** | “It's 10:45, not 11” where the original came from dictation | Replaces the *interpretation* of the original evidence. History shows “corrected transcription”, not “changed mind”. Dependents update as for any change. |
| **Change (new decision)** | “Move it to 10:30” | New user fact supersedes the old one. Impact preview, then revision. |
| **Add** | “Also lock edits at cutoff” | New rule linked to R17. May open a question. |
| **Remove / defer** | “We don't need a cutoff yet” | Removes or defers the decision; shows what loses its prerequisite. |
| **Explain impact** | “What breaks if I change this?” | Read-only traversal of dependents. |

When an edit to a dictated value is ambiguous between *correct* and *change*, the inline editor offers a two-way toggle preset by a simple rule: if the value came from speech and no task has consumed it yet, preset **I said this, it was misheard**; otherwise **I changed my mind**. Either way the downstream effect is the same; only the history label differs.

### Impact preview before applying

Inline edits and change messages show what moves before anything is applied:

```
Cutoff 11:00 → 10:45
  Affects: 2 tasks (T05 order page · running → pauses at next step; T07 boundary tests · not started)
           1 screen label · 3 acceptance examples
  Unaffected: 9 tasks keep running
[Apply ⏎]  [Cancel]
```

The preview is a graph traversal, so it costs no tokens. Applying it creates the revision through the planner and kernel exactly as [linked revisions](linked-architecture-revisions.md) describe.

### By project stage

| Stage | What a box change does |
|---|---|
| Discovery (no plan yet) | Updates the decision and readiness counts. Cheapest time to change things. |
| Plan preview (tasks exist, nothing running) | Replans affected tasks; the estimate updates. |
| Building | Hard or soft holds per [routing design](routing-design.md#which-work-to-hold); unaffected work continues. |
| Merged | Creates a forward revision with change or removal tasks. |

## Edge cases

| Situation | Behavior |
|---|---|
| The box changes (another revision) while the developer types about it | On Enter, show “Cutoff changed to 10:30 while you were typing. Apply your edit to the new value?” with both values. |
| The box is deleted while selected | Target falls back to General; draft kept; notice shows what was removed and why. |
| Developer selects a **Today** box in an existing repo and says “change this” | Today boxes describe current code and can't be edited directly. The message becomes a planned change linked to that module. |
| Developer selects a running task and types “fix the import” | Routed as a message to that task's owner, not to the worker directly; the owner decides whether it changes the brief. |
| Developer selects two boxes and says “make these the same” | Ask which value wins if they differ. |
| Message mentions a different box by name than the selected one | Prefer the named box if it matches exactly; echo the binding (“Applied to R18, not the selected R17”). |
| Developer presses Ctrl+Z after applying | Undo of an applied change is a forward revision with its own preview, not a silent rollback. Before Enter, Ctrl+Z is ordinary text undo. |
| Model unavailable (allowance used up) | Ask and Explain-impact still work (they're graph reads). Changes queue as drafts until a model is available. |
| Large graph (200+ nodes) | Collapsed by feature, semantic zoom (system → features → rules → tasks), search, and filters: open questions, assumptions, affected by last change. |

## Implementation notes

- Canvas: React Flow with ELK.js for automatic layered layout; positions the developer drags are saved per view and survive relayout where possible.
- Mermaid export stays as the shareable text view; the canvas is not generated from Mermaid.
- Each box carries its node ID and version; the popover reads through the coordinator like any other client.
- Per-box conversation history is shown in the popover, but every message also stays in the main chat stream, tagged with its target, so there is one history.

[Diagram](dictation-and-canvas.svg) · [Editable Mermaid](dictation-and-canvas.mmd) · [Discovery depth](discovery-depth-and-catalog.md) · [Routing](routing-design.md) · [Build cockpit](build-cockpit.md) · [Research](research/dictation-and-interactive-canvas.md)
