# App shell, hardware governor and dictation vocabulary

The app now has more than fifteen screens and modes across the project's life. Two earlier sketches disagreed: [interactive architecture](interactive-architecture.md#screen-layout) showed Chat beside Canvas, and the [build cockpit](build-cockpit.md#layout) showed a Board with an Inbox and Chat at the bottom. This document defines one shell that all of them live in, the hardware governor that keeps a 16 GB laptop responsive, and how dictation learns each project's vocabulary. Research: [shell and hardware](research/shell-and-hardware.md).

## Decisions in plain words

1. **One shell with fixed regions.** The top bar (with Stop), the left rail (Chat and Inbox) and the composer never disappear in any phase. Only the center workspace and its tabs change.
2. **Phases switch presets, not layouts.** Discovery, Plan, Build and Ship are arrangements of the same regions. The app suggests the next preset when the phase changes; it never yanks the layout while the developer is typing.
3. **One project per window.** A second project opens in its own window. Any workspace tab can pop out into a secondary window tied to its project.
4. **A hardware governor admits work only if the machine can take it,** shrinks the crew before Windows starts swapping, and cleans up disk safely.
5. **Dictation is primed with the project's own words** and learns from the developer's corrections.

## The shell

```
┌ ● kitchen-app ▾ │ Discover › Plan › Build › Ship │ $2.14 / $10 · ChatGPT 6% │ ⏸ Pause all  ■ Stop ┐
├──────────────┬───────────────────────────────────────────────────────────────┬────────────────┤
│ Chat │ Inbox 2│ [Canvas] [Spec] [Plan] [Board] [Office] [App] [Diff] [⋯]       │ Inspector      │
│              │                                                               │ (selected item)│
│ left rail    │                    center workspace                           │ collapsible    │
│ collapsible  │                                                               │                │
├──────────────┴───────────────────────────────────────────────────────────────┴────────────────┤
│ Composer · Talking to: Q-41 database ▾                                              🎙   ⏎     │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Always visible? | Contents |
|---|---|---|
| Top bar | Yes | Project switcher, phase stepper, spend meters, Pause all, Stop |
| Left rail | Collapsible to an icon strip, never hidden | Chat history and the Inbox (badge count) |
| Center workspace | Yes | Tabs: Canvas, Spec, Plan, Board, Office, App preview, Diff, Investigations, Ship, Diagnostics (in the ⋯ menu) |
| Inspector | Collapsible | Details of whatever is selected anywhere: box, task, check, question, inbox item |
| Composer | Yes | One input for the whole app; its target chip follows the selection ([composer target](interactive-architecture.md#the-composer-target)) |

### Presets by phase

| Phase | Left rail | Center | Inspector |
|---|---|---|---|
| Discover | Chat open, wide | Canvas | Closed until something is selected |
| Plan | Chat open | Plan preview, Spec | Open on the selected task |
| Build | Inbox open, chat collapsed to recent messages | Office by default (Board if “reduce motion” is on or under memory pressure); the developer's last choice afterwards | Open on the selected worker |
| Ship | Inbox open | Ship (PRs, CI, deploys) | Open on the selected run |

When the phase changes, a small banner offers “Switch to the Build layout?” (Enter accepts). Manual changes are remembered per project and per phase. Earlier sketches in other documents are views of this shell under particular presets.

### Windows and multiple projects

- One project per window; the top-bar switcher opens another project in a new window or switches this one.
- Any center tab can be popped out (App preview on a second monitor, Office on a wall screen). Pop-outs belong to their project and close with it.
- The tray lists all running projects; system notifications name the project.

## Hardware governor

### What it measures (every 2 seconds)

| Signal | Source |
|---|---|
| Free physical memory and commit charge | Windows memory status and the low-memory notification |
| Memory of everything the harness started | Per-Job-Object accounting (each attempt, environment and service has a job) |
| CPU load | System and per job |
| GPU memory budget | Per-adapter video-memory query (matters when Whisper and a local model share a GPU) |
| Disk free | Volumes holding worktrees, data and package store |

### Footprints, learned

At setup, a calibration run (install and build a template app, start a browser, load Whisper) measures typical footprints. Then every attempt updates the per-project profile:

| Consumer | Typical range (learned per machine) |
|---|---|
| Foreign agent CLI process | 0.3–0.6 GB |
| Dev server | 0.3–1 GB |
| Build or full type check | 1–3 GB peak |
| Browser for tests | 0.3–0.5 GB per run |
| Embedded Postgres | 0.1–0.3 GB |
| Whisper (base / small) | ~0.5 / ~1 GB |
| Local model (Ollama) | Model size in VRAM or RAM |

### Admission and shrinking

Before starting anything, the governor checks: free memory − predicted peak − safety margin (the larger of 15% of RAM or 2 GB) ≥ 0. Priority when space is short: dictation and UI > clean verifiers > running workers > new workers > App preview > background work.

| Level | Trigger | Action |
|---|---|---|
| Green | > 25% memory free | Normal |
| Yellow | < 15% free | Admit nothing new except verifiers; pause background work |
| Orange | < 8% free or Windows low-memory signal | Park the lowest-priority workers at their next tool step; stop their dev servers; stop the App preview if not visible |
| Red | < 4% free or commit charge > 95% | Kill restartable processes immediately (builds, dev servers, browsers), park all workers; show why |

Levels change only after the condition holds for 10 seconds (and recover only after 30), so the crew doesn't flap.

**Thinking versus executing.** Workers waiting on a model are cheap; workers running commands are not. Admission therefore manages separate pools (thinking slots, a small warm execution pool, services), described in [execution capacity](execution-capacity.md).

**Heavy lane.** Builds and full type checks run through a semaphore (one or two at a time depending on RAM and cores), because four simultaneous `next build` runs are what usually kills a 16 GB laptop.

**GPU sharing.** While the developer dictates, Whisper has priority: local-model requests queue briefly; if VRAM is insufficient, Whisper runs on CPU instead.

### Disk

| Measure | Detail |
|---|---|
| Shared package store | pnpm's global store with hard links into each worktree; the store must be on the same drive as the worktrees, so a worktree's `node_modules` costs little extra space |
| Worktree slots | Worktrees are reused: a finished attempt's slot is reset (`git checkout` + clean) for the next attempt, keeping installed dependencies warm |
| Dev Drive | Recommended at setup on Windows 11 for worktrees and caches (faster file operations) |
| Thresholds | Warning at 15 GB free; no new dispatch at 5 GB; Pause all at 2 GB |
| Cleanup | Merged attempts' slots are recycled; failed attempts' slots kept 24 h for inspection; artifacts follow retention classes ([kernel storage](kernel-schema-and-protocol.md#content-addressed-store-and-cleanup)) |
| “Free up space” | Shows reclaimable space by category; deletes only harness-owned paths carrying an ownership marker |

**Crew width** in [planning and crew](planning-and-crew.md#choosing-how-many-workers) uses the governor's admission check instead of a fixed number.

## Dictation vocabulary

Whisper accepts an initial prompt of at most 224 tokens and drops the oldest tokens if it's longer, so the most important terms go **last**.

| Source | Example terms | Weight |
|---|---|---|
| The developer's corrections | “NextAuth” (heard “next off”) | Highest |
| Project glossary: product, feature, entity and role names | kitchen totals, LunchOrder, Manager | High |
| Main dependencies | Prisma, Zod, Playwright | Medium |
| Decision and spoken-ID patterns | “cutoff”, “T three b” | Medium |
| Global user vocabulary | Words the developer uses across projects | Low |

- The list is rebuilt when the glossary or dependencies change and capped to fit the token limit, ordered by weight with the highest last. For long dictations the prompt is carried into every decoding window.
- **Correction memory:** when the developer edits a word in the transcript before sending, the pair (heard → corrected) is stored. After two occurrences, a whole-word replacement rule applies automatically, and replaced words are underlined so the developer sees what changed.
- **Spoken IDs** (“T three b”, “R seventeen”) are normalized to IDs (`T03b`, `R17`) only when that ID exists in the project.
- The meta-lab measures word error rate on recorded project phrases with and without the vocabulary ([open design questions](open-design-questions.md)).

## Edge cases

| Situation | Behavior |
|---|---|
| The developer closes the left rail entirely | It collapses to an icon strip with the Inbox badge; it can't be removed. |
| A pop-out window is on a disconnected monitor | It reopens on the main screen. |
| The laptop switches to battery saver | The governor lowers crew width and pauses background work; shown in the top bar. |
| Antivirus scanning slows worktree creation | The calibration notes it; setup suggests excluding the harness data folder (the developer decides). |
| Two projects both want the heavy lane | Shared global semaphore; the foreground project goes first. |

[Build cockpit](build-cockpit.md) · [Interactive architecture](interactive-architecture.md) · [Desktop app](desktop-app.md) · [Research](research/shell-and-hardware.md)
