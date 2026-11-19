# Projects, portability and sync

The knowledge database, plans and checkpoints live in local app storage. This document answers what happens when the developer moves to a second laptop, reinstalls Windows or shares the repo with a teammate, and how two projects running at the same time share one ChatGPT plan and one laptop. Research: [portability and sync](research/portability-and-sync.md).

## Decisions in plain words

1. **The project's knowledge travels with the repo, on its own branch.** A secret-free, text export of the knowledge database is committed to an orphan branch `harness-state` (no shared history with the product code). Any clone of the repo can rehydrate the project's knowledge, with its full revision history and the evidence of accepted work, on another machine. Machine-local runtime (attempts, leases, idempotency records, telemetry) starts fresh.
2. **The product tree stays clean.** Nothing is added to the developer's branches by default. Committing a `.harness/` folder into the main tree is an opt-in for teams who want it visible in code review.
3. **One active writer per project at a time.** Another device or teammate opens the project read-only until they explicitly take over, which fences the old writer.
4. **Two projects share resources through one broker.** Connections, plan windows and laptop capacity are allocated by a global broker with fair shares and a reserved lane for interactive work, so a background build can't starve a live interview.

## What is portable and what isn't

| Content | Exported? | Notes |
|---|---|---|
| Decisions, evidence quotes, criteria, deferrals | Yes | Core of the project |
| Research facts, architecture nodes, contracts, edge cases | Yes | |
| Plans, tasks, acceptance examples (visible) | Yes | |
| Held-back examples | Yes, encrypted with a project key | Workers on any machine must not read them; the key is in the vault and can be shared with a teammate explicitly |
| Verification receipts and feature progress | Yes | Receipts of accepted work include their check results and the accepted attempt's read set |
| Revision history: node versions, edge intervals, change sets, change classes | Yes, as append-only history segments | Lets another machine rebuild audit, undo and as-of views ([database design §9](database-design.md#9--export-to-harness-state-at-scale-and-what-travels)) |
| Idempotency records, unaccepted attempts' read sets, event sequence numbers | No | Machine-local; a new machine starts a new event stream (`stream_epoch`) and windows resync |
| Chat transcripts | Opt-in | May contain sensitive text |
| Secrets, vault references, provider tokens | **Never** | Re-entered per machine |
| Runtime leases, worktree paths, process IDs | No | Machine-local |
| Usage ledger | Summary only | Costs per feature, not per call |
| Checkpoint WIP commits | Optional push of `refs/harness/checkpoints/*` | Lets a parked task resume elsewhere |

### Format

One file per entity, YAML with sorted keys and stable IDs, grouped by type:

```
harness-state branch
├── manifest.yaml               revision, schema version, project ID, exported-at
├── decisions/D-0012.yaml
├── research/F12-print/RF-031.yaml
├── arch/nodes/R17.yaml
├── arch/contracts/kitchen-totals@1.yaml
├── plans/features/F12/tasks/T03.yaml
├── checks/AC-31.yaml           (visible part)
├── checks-sealed/AC-31.age     (held-back part, encrypted)
├── progress/features.yaml
├── history/000215-000260.jsonl  append-only change sets with node versions and edge changes
└── views/                      generated Markdown and Mermaid for humans
```

One file per entity keeps Git diffs readable and makes concurrent changes to different entities merge cleanly. The export runs in the background after 10 seconds of quiet: it renders only the entities changed since the last exported revision (computed from the change log) and writes one commit with `git fast-import` on top of the previous export, so a 3,000-file project costs the same as a 30-file one per revision. History segments are appended, never rewritten. Rehydration replays them into a fresh database and checks the result against the entity files.

## Moving between machines

| Scenario | What happens |
|---|---|
| Clone on a second laptop | Opening the folder finds `harness-state` on the remote; “Import project state (revision 214)?” → rebuilds `state.db`. Runtime starts empty: tasks that were running become **parked**, resumed from pushed checkpoints if present, otherwise restarted from their briefs. |
| Reinstall Windows | Same as above. Local backups (hourly and daily `VACUUM INTO` copies) help only if the data folder was backed up; the state branch is the reliable path. |
| No remote at all | Settings → Export project (a zip of the same files); Import on the other machine. |

### Single writer across devices

The state branch contains a small lease file, `lease.yaml`, written and read by the exporter beside `manifest.yaml`:

```yaml
device_id: 7f3c…            # random per installation, stored in global.db
holder: "DESKTOP-AYUSH"     # display name
epoch: 12                   # increases on every takeover
heartbeat: 2026-11-18T12:04:00Z
revision: 214               # last revision this device exported
```

On import or open, the device compares `epoch` with the `writer_epoch` it holds in its project `meta`: equal and its own `device_id` means it is the writer; anything else opens read-only until a takeover.

- The writing device refreshes the heartbeat when it pushes state.
- Another device that opens the project sees “Active on DESKTOP-AYUSH (last seen 3 min ago) · Open read-only · Take over”.
- **Take over** increments the epoch and pushes the new lease. The old device's next push is rejected because the branch moved (non-fast-forward), it sees the takeover, parks its work and switches to read-only.
- A stale lease (no heartbeat for a configurable time) can be taken over without warning.

## Teammates

v1 supports **one driver and any number of viewers** per project:

| Role | Can |
|---|---|
| Driver | Everything: interview, plan, build, land |
| Viewer | Browse architecture, plans, progress and receipts; comment on nodes (comments sync as entities); make normal Git changes, which the driver's harness treats as developer edits |
| Handover | The driver hands over, or a viewer takes over (epoch increment) |

Two people driving the same project simultaneously is **not supported in v1**. Because the export is per-entity text, a later version can merge concurrent changes to different entities and route same-entity conflicts as proposed steers, without CRDT machinery in the core.

## Running several projects at once

```
                  ┌──────────── harnessd ────────────┐
Project A coord ──┤                                  │
Project B coord ──┤  Resource broker (global.db)     ├── connection pacers (one per connection)
Project C coord ──┤   capacity grants · fair share   ├── machine slots (RAM / CPU / browsers)
                  └──────────────────────────────────┘
```

**Two-level budgets without distributed transactions.** The broker owns connection-level resources (a plan's window, concurrency slots) and machine slots. It hands each project coordinator a short-lived **capacity grant** (“up to 2 concurrent sessions and ~3% of the weekly ChatGPT share for the next 10 minutes”). The project coordinator reserves its own tasks within its grant and its own project budget in its own database. Unused grants return when they expire. Each database keeps its single writer.

**Priority classes**

| Class | Example | Treatment |
|---|---|---|
| Interactive | Replying to the developer in the focused project's discovery chat | One slot per connection always reserved; preempts nothing but always gets the next slot |
| Foreground build | The project in the open window | Weight 2 |
| Background build | Other projects | Weight 1 |
| Batch | Research, meta-lab runs, re-indexing | Uses idle capacity only |

Slots are shared by weighted fair queuing. A plan's burn-rate target ([provider pacing](provider-connections.md#budgeting-with-allowance-instead-of-dollars)) applies to the connection as a whole, so two projects together can't exceed the plan share the developer allowed.

**Machine capacity** (memory for dev servers, browsers and worktrees) is a global slot pool measured at setup. The cockpit's project switcher shows each project's state and its current share.

## Edge cases

| Situation | Behavior |
|---|---|
| State branch was force-pushed by someone | Import detects a revision going backwards; asks which to keep; nothing is overwritten silently. |
| Repo is public | **State push is off by default** for public remotes; the project keeps local backups and can export a zip. The developer can opt in per project after a warning that architecture, plans and evidence quotes become public. Private remotes ask once on the first push (recommended: yes). Held-back checks stay encrypted either way. |
| Project key lost (held-back checks unreadable) | `oracle-author@1` regenerates held-back cases for unfinished tasks; finished ones keep their receipts. |
| Same project open on two devices offline | The second to push loses the lease race and becomes read-only; its parked work stays on its local checkpoint refs and can be offered to the driver. |
| A third project starts while two are building | It gets the batch or background class until focused; the broker never revokes a running attempt's slot, it just stops granting new ones. |

[Diagram](projects-portability-and-sync.svg) · [Editable Mermaid](projects-portability-and-sync.mmd) · [Desktop app](desktop-app.md) · [Workspace and Git](workspace-and-git.md) · [Coordinator and recovery](coordinator-and-recovery.md) · [Research](research/portability-and-sync.md)
