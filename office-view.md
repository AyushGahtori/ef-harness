# Office view: your AI company at work

An optional, animated view of the build. Every agent is an office worker. Juniors, Mids and Seniors sit at desks and type, Managers run their teams from offices, and the developer is the CEO. Workers walk to the records room to fetch their brief, meet their manager when they're stuck, carry finished work to the test lab, and bring the CEO a sheet of paper when a decision is needed. It's the same live state as the [Board](build-cockpit.md), drawn as a place. Research and prior art: [office view prior art](research/office-view-prior-art.md).

## Decisions in plain words

1. **It never lies.** Every animation comes from a real event. If the office looks calm, the build is calm. If a worker is at the coffee machine, it is genuinely waiting (rate limit, allowance window or dependency), and the wall clock shows until when.
2. **It's an alternative view, not a separate system.** Board and Office read the same event stream. A toggle switches between them; the chat, inbox and top bar stay the same.
3. **Rank is visible.** Clothing and props show the level (Junior, Mid, Senior, Manager). The developer is the CEO with their own avatar.
4. **Click anything to get real details.** A character opens its worker panel; the records room opens the graph; the test lab opens verification results; the paper on the CEO's desk opens the question.
5. **Built in stages.** Version 1 is desks, states and paper-to-the-CEO. Walking, meetings and customization come after the basics are proven.

## The cast

| Character | Who it is in the harness | Look (default pixel style) | Signature props |
|---|---|---|---|
| **CEO** (you) | The developer | Custom avatar picked at setup | Big desk, inbox tray, stamp |
| **Manager** | Project planner, integrators | Suit or blazer, clipboard | Office with a whiteboard showing the feature plan |
| **Senior** | Feature planners, tricky tasks | Cardigan or smart jacket, coffee mug | Dual-monitor desk |
| **Mid** | Standard tasks | Shirt, headphones | Single-monitor desk |
| **Junior** | Mechanical tasks | Hoodie with a lanyard | Laptop desk, sticky notes |
| **Helper** | A foreign agent's own sub-agents (Codex, Claude Code, Copilot) | Small, translucent version of its parent | Sits beside the parent's desk |
| **Lab tech** | Clean verifier | Lab coat | Test bench with a red/green lamp |
| **Guard** | Kernel policy (permissions, secrets) | Security uniform | Stands at the vault and the server room door |

Each agent keeps the same character for its lifetime. Its name tag is its **agent ID plus a short title of its current task** (“A0014 · print page”), changing as it takes new tasks; no invented human names. The name tag shows the model and connection on hover (“Luna · medium · ChatGPT plan”). Desk pins in a color per connection make it easy to see which plan a team runs on, without vendor logos.

## Floor plan: rooms are parts of the system

```
┌──────────────┬───────────────────────────────┬───────────────┐
│  CEO office  │        Open-plan floor        │ Manager       │
│  inbox tray  │   pods grouped by feature     │ offices       │
│  ▣ ▣ ▣       │  [F12]  ▢▢▢   [F13]  ▢▢▢▢     │ whiteboards   │
├──────────────┤                               ├───────────────┤
│ Meeting room │                               │  Test lab     │
├──────────────┼──────────┬─────────┬──────────┼───────────────┤
│ Records room │  Break   │ Front   │  Vault   │ Shipping dock │
│ (database)   │  room ☕  │ desk 📦 │  (keys)  │ (merge queue) │
└──────────────┴──────────┴─────────┴──────────┴───────────────┘
```

| Room | System meaning | What happens there |
|---|---|---|
| **CEO office** | The developer's inbox | Papers pile on the tray; the pile height is the inbox count |
| **Open-plan floor** | Active attempts | One desk per worker, grouped in feature pods with a pod sign |
| **Manager offices** | Planners and integrators | Whiteboard mirrors the feature's task list with checkmarks |
| **Records room** | The coordinator's graph and briefs (SQLite) | Workers fetch briefs, contracts and others' results here |
| **Meeting room** | `AskOwner`, `DisputeTest`, planner–planner questions | Worker and manager sit at the table; a speech bubble shows the topic |
| **Test lab** | Clean verifier | Candidate boxes go on the bench; lamp turns green or red |
| **Shipping dock** | Feature and project merge queue | Boxes on a conveyor; a merged feature leaves on a truck |
| **Break room** | Rate limited, waiting for allowance, waiting on a dependency | Coffee machine; the wall clock shows reset time |
| **Front desk** | Human steps (install a tool, create an account) | A parcel labeled with the step waits for the CEO |
| **Vault** | Secrets in the OS vault | Locked; only the guard enters; workers never do |
| **Server room** | Local models (Ollama, LM Studio) | Fans spin when a local model is generating |

The building grows with the crew: more pods appear as more workers start, and an empty floor has dimmed desks.

## Event → animation mapping

All mappings start from the normalized events in [agent runtime adapters](agent-runtime-adapters.md#normalized-events) and the kernel's own events.

| Event | Animation |
|---|---|
| `session.started` (new attempt) | Worker walks in from the elevator to a free desk in its feature pod |
| Brief or contract read (`harness.get_brief`, `read_result`) | Walks to the records room, pulls a folder, walks back |
| `plan.updated` | Opens a notebook; sticky notes appear on the monitor (one per step) |
| `tool.requested(read/search)` | Leans in, reading; monitor shows scrolling text |
| `tool.requested(edit)` / `file.changed` | Types; monitor shows a green/red diff pattern |
| `tool.requested(shell)` running tests | Monitor shows a progress bar; worker taps the desk |
| `permission.requested` denied by policy | Guard appears briefly with a “not allowed” sign; logged |
| `AskOwner` | Worker walks to the meeting room; its manager joins; speech bubble with the topic |
| Owner answers from the record | Short meeting; both return to work |
| Owner escalates to the developer | **Manager walks to the CEO office holding a paper** (see below) |
| `subagent.started` | A helper appears at the desk |
| `submit_candidate` | Worker carries a box to the test lab |
| Verification pass | Lamp turns green; box moves to the shipping dock; worker gets a small checkmark |
| Verification fail | Lamp turns red; box returns; worker scratches its head. After repeated failures it walks to its manager's office (escalation) |
| Escalated to a higher level | A Senior walks over and takes the desk; the Junior moves to another ready task |
| Rate-limited | Walks to the break room; clock shows “~40 s” |
| Plan window closed | Several workers in the break room; wall clock shows reset time; lights dim on their desks |
| Hold (requirement change) | Worker pauses and looks at the manager's whiteboard while it updates |
| User pause | Everyone puts down their pens; a “Paused” sign hangs on the door |
| Budget exhausted | Office lights go to evening mode; workers file their work in folders (checkpoints) and sit idle |
| Feature merged | Truck leaves the shipping dock; small confetti over that pod |
| Looping or stuck | A thought bubble with “…” then “?”; an amber marker on the desk |
| `session.ended` | Worker tidies the desk and leaves, or moves to a new desk with its next task |

### The paper-to-the-CEO flow

1. A question reaches the developer's inbox (after owner checks and batching, see [build cockpit](build-cockpit.md#the-inbox-prioritizing-without-notification-spam)).
2. The owning **Manager** picks up a sheet, walks to the CEO office and places it on the tray. The sheet's color shows priority: red for Interrupt-now, yellow for blocking, white for FYI.
3. The pile on the tray matches the inbox count. A batch arrives as a stapled stack.
4. Clicking the tray opens the inbox. Answering stamps the sheet; the Manager picks it up, walks back, and the waiting worker returns to its desk.

A secret request or tool install arrives as a **parcel at the front desk** instead, so “decide something” and “do something” look different.

## Interaction

| Action | Result |
|---|---|
| Hover a character | Tooltip: name, level, model, task, elapsed time, tokens used |
| Click a character | Opens the same worker panel as the Board (timeline, diff, checks, brief, raw) |
| Double-click a character | Camera zooms into its monitor: live timeline and diff fill the screen. Esc zooms out |
| Right-click a character | Pause · Stop · Message its manager · Change level · Fix it myself |
| Click a manager's whiteboard | Opens that feature's plan |
| Click the records room | Opens the Architecture canvas |
| Click the test lab | Opens recent verification results |
| Click the shipping dock | Opens the merge queue |
| Click the CEO tray or front desk | Opens the inbox |
| Drag the camera / scroll | Pan and zoom; double-click empty floor to reset |

The top status ribbon (progress, spend, inbox count) is always visible over the office, so nothing important is only shown as animation.

## Keeping animations truthful: the animation director

Agents can emit dozens of events per second. Animations take time. A small **animation director** sits between the event stream and the characters:

- **One queue per character.** Events become intents (“go to records”, “type”, “go to lab”).
- **Collapse bursts.** Forty edit events become one continuous typing loop.
- **State beats motion.** If a worker's state changes (e.g. to waiting) while it's mid-walk, the new state wins.
- **Maximum lag of about two seconds.** If a character falls behind, it fades and reappears at the right place instead of walking.
- **Minimum dwell time** (about one second) so states don't flicker.
- **Status first.** Icons above heads (⏳, ❓, ✓, ✗) update instantly, even while the animation catches up.

## Art and technology

| Part | Choice | Why |
|---|---|---|
| Renderer | PixiJS (WebGL/WebGPU) inside the desktop app's renderer | Fast 2D sprites; AI Town uses it for the same kind of scene |
| Map | Tile map made in Tiled (JSON export) | Free editor; rooms are named areas the code can look up |
| Characters | Sprite sheets from Aseprite, layered (body, hair, clothes, props) so rank outfits and custom avatars are combinations | Many characters from few drawings |
| Movement | A* pathfinding on the tile grid, with precomputed routes between rooms | Cheap and predictable |
| Character logic | One small state machine per character, driven by the director | Easy to test without rendering |
| Style | 16-px pixel art by default; a cleaner isometric skin later | Pixel art is cheap to produce and reads well small |
| Assets | Commissioned or properly licensed packs; verify the license before shipping | Avoid reuse problems |

Performance targets: 60 fps, under 5% CPU on a mid laptop when idle, rendering paused when the view is hidden. Up to about 30 characters animate fully; beyond that, extra workers sit at “hot desks” as a counter (“+12 working”).

## Accessibility and preferences

- **Reduced motion:** characters stay at desks; state shows as icons and labels only.
- Every state has a text label and an icon shape, not only a color.
- Keyboard: Tab cycles characters in a logical order; Enter opens the panel.
- A screen-reader list mirrors the office (“Priya, Mid, T07, typing, 4 minutes”).
- Sound off by default; optional soft chimes for paper arrival and merges.

## Delivery stages

| Stage | Scope | Exit check |
|---|---|---|
| **v1 · Seated office** | Desks, rank outfits, states as poses and icons, CEO tray with papers, click-through panels | Developers find the waiting task faster than on the Board in a hallway test |
| **v2 · Moving office** | Walking between rooms, meetings, test lab, shipping dock, break room | Animation lag stays under 2 s with 10 workers |
| **v3 · Your office** | Avatar and character editor, office layout editor, naming | — |
| **v4 · Extras** | Day/night following real time, end-of-day recap scene, celebrations, optional ambient sound | — |

## Edge cases

| Situation | Behavior |
|---|---|
| Worker changes task instantly | Skips the walk; desk sign updates. |
| Event stream disconnects | Characters freeze with a “reconnecting” sign; the ribbon shows the last known time. |
| 50 papers in the inbox | Tray shows a tall stack with a number. |
| A foreign agent spawns many helpers | Up to three helper sprites per desk, then “+N”. |
| Developer resizes to a small window | Camera zooms to fit the busiest pod; a mini-map shows the rest. |
| App is in the background | Rendering stops; on return, characters jump to their current state. |

## Owner decisions

- **Decided (16 November 2026):** cozy pixel art, 16-px style. An isometric skin may come later.
- Decided (17 November 2026): workers are labeled by agent ID plus short task title.
- Decided: the **Office is the default view** during builds for new users; the Board is one click away and remembered once chosen. If Windows “reduce motion” is on, or the hardware governor is at orange pressure or worse, the Board is shown instead and the Office pauses its animation.

[Diagram](cockpit-and-office.svg) · [Editable Mermaid](cockpit-and-office.mmd) · [Build cockpit](build-cockpit.md) · [Agent runtime adapters](agent-runtime-adapters.md) · [Planning and crew](planning-and-crew.md) · [Research](research/office-view-prior-art.md)
