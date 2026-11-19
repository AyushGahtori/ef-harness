# Build cockpit: watching the build, the inbox and human steps

The cockpit is the screen the developer looks at while workers build. It has to answer three questions at a glance: *is it moving, what does it need from me, and what is it costing*. It never streams raw agent logs by default. There are two ways to look at the same live state: the **Board** (this document) and the animated **Office** ([office view](office-view.md)). Both read the same events, so they always agree.

## Decisions in plain words

1. **Status lines are written by code, not by an AI.** Each card's one-liner comes from the normalized event stream (“Editing `print.tsx` · 3 files changed · 4 min”). It's free, instant and never invents progress.
2. **Raw logs exist, one click deep.** Selecting a worker shows a readable timeline; the raw stream is a tab behind it.
3. **The inbox interrupts rarely.** Questions are checked by their owners first, de-duplicated, grouped by feature and batched. Only critical items interrupt immediately.
4. **Secrets never touch a worktree, a prompt or Git.** They live in the OS vault and are injected into processes at run time. Workers only know a secret's name and whether it's available.
5. **“Done” for a human step is checked, not assumed.** The harness probes for a tool, tests a key or asks for an observable result before unblocking work.

## Layout

This is the Build preset of the single app shell ([app shell](app-shell-and-governor.md#the-shell)); in the shell, the Inbox sits in the left rail and the Selected panel is the Inspector.

```
┌ kitchen-app · Building · F13 ordering ▸ wave 2 ───── $2.14 of $10 ▮▮▯▯ · ChatGPT share 6% · ⏸ Pause all  ■ Stop ┐
├ Board | Office | Graph ───────────────────────────────────────────────────────┬──────── Inbox (2) ─────────────┤
│ Working (4)           Waiting on you (1)   Held (1)     Verifying (1)  Done 9 │ ● Needs you · F12 print         │
│ ┌ T07 · Mid ────────┐ ┌ T11 · Senior ─────┐ ┌ T09 ─────┐ ┌ T05 ──────┐        │   2 questions · 1 secret         │
│ │ Editing print.tsx │ │ Needs STRIPE key  │ │ Rate-    │ │ 14/15     │        │   blocking 3 tasks  [Open]      │
│ │ 3 files · 4 min   │ │ blocks T12, T13   │ │ limited  │ │ checks    │        │ ○ FYI digest (5)                │
│ └───────────────────┘ └───────────────────┘ │ ~2 min   │ └───────────┘        │                                 │
│ ...                                         └──────────┘                      │                                 │
├───────────────────────────────── Selected: T07 ───────────────────────────────┴─────────────────────────────────┤
│ Timeline │ Diff │ Checks │ Brief │ Raw                                                                          │
│ 14:02 read brief v3 · 14:03 edited src/kitchen/print.tsx (+42 −3) · 14:05 ran tests: 6 passed, 1 failed (AC-31) │
├─────────────────────────────────────────────── Chat ─────────────────────────────────────────────────────────────┤
```

### Top bar

Phase and wave, overall progress (tasks done / total), spend meters per currency ([provider connections](provider-connections.md#usage-and-billing)), **Pause all** (checkpoint at the next boundary) and **Stop** (direct kernel path).

### Board lanes

| Lane | Meaning | Card one-liner example |
|---|---|---|
| Queued | Ready or waiting for a dependency | “Waits for T03 (kitchen totals)” |
| Working | Active attempt | “Running tests · 6 passed, 1 failed · attempt 2” |
| Waiting on you | Blocked on an inbox item | “Needs STRIPE_SECRET_KEY · blocks T12, T13” |
| Held | Paused by a hold reason | “Held: cutoff changing (your message 14:01)” |
| Verifying | Clean verifier running | “14 of 15 checks” |
| Integrating | Feature or project merge queue | “Journey test on integration branch” |
| Done | Accepted | “Accepted 13:58 · Mid · $0.11” |

### Health signals (from events, no AI)

| Signal | Rule | Card shows |
|---|---|---|
| Possibly stuck | No events for 5 min during a turn | Amber clock; actions: Nudge, Interrupt, Open |
| Looping | Same tool call or same failing command 3× | “Repeating `npm test` with the same failure” |
| Throttled | Rate-limit event | “Rate-limited · retry in ~40 s” (not a failure) |
| Waiting for allowance | Plan window closed | “Resumes ~14:05” |
| Escalated | Moved up a level or back to its author | “Now Senior after 2 failed attempts” |

**Explain** on any card asks a small model to summarize the last 50 events in two sentences. It runs only when clicked.

## The inbox: prioritizing without notification spam

Everything that needs the developer goes through one inbox, built on the question queue in [routing design](routing-design.md#one-queue-for-the-developers-questions).

**Before anything reaches the inbox**

1. **Owner first.** A worker's question goes to its task author, who answers from the record when it can. Test disputes go to the author too. Most worker questions never reach the developer.
2. **De-duplicate** by criterion and scope. Three workers asking about the same cutoff produce one item with three subscribers.
3. **Group** by feature into one card (“F12 print: 2 questions · 1 secret”).
4. **Keep workers busy.** A worker waiting on an answer takes another ready task if one exists.

**When it reaches the developer**

| Class | Examples | Delivery |
|---|---|---|
| **Interrupt now** | Secret leak detected, destructive or paid action needs approval, budget or allowance exhausted, *all* work blocked | Banner + sound (if enabled), immediately |
| **Batch** | Product questions blocking work, human steps, test disputes that need a product decision | Delivered together when: the batch window closes (default 10 min), *or* blocked work would leave workers idle, *or* a blocked task is on the critical path |
| **Digest** | Task finished, assumption made, minor warnings | Collected in the FYI digest; no alert |

Within a batch, order by: blocked critical-path work, then number of tasks blocked, then age. **Focus mode** (toggle) delivers only Interrupt-now items until turned off. An interruption budget (default: at most one batch alert per 10 minutes) keeps alerts calm.

### Inbox card types

| Type | Content | Done when |
|---|---|---|
| Decision | Focused question card with options and recommendation | Answer validated |
| Secret | Name, why, which tasks need it, where to get it, paste field | Probe succeeds or format check + first successful use |
| Tool install | What's missing, exact command, Install button | Re-probe succeeds |
| Account step | Checklist (e.g. “Create a Stripe test account”, “Enable the Gmail API”) | Probe where possible; otherwise the developer attests |
| Approval | Risky action: new dependency with install scripts, migration on a real database, external send | Approve / Deny |
| Review | Plan preview, design baseline, “I fixed it myself” result | Developer's choice |

## Secrets

**Paste flow.**

```
F12 needs STRIPE_SECRET_KEY
Used by: T11 checkout, T12 webhook test, T13 refund flow
Use a TEST key (starts with sk_test_). Get it at Stripe Dashboard → Developers → API keys.
[ ●●●●●●●●●●●●●●●●●●●●●● ]  Scope: this project · test  [Save and verify]
```

**Where it goes and how it's kept out of everything else**

| Rule | How |
|---|---|
| Stored in the OS vault | Windows Credential Manager (DPAPI); SQLite stores only a reference and the variable name |
| Never written into a worktree | Injected as an environment variable into the verifier, test runner and dev-server processes that need it |
| Workers see the name, not the value | The brief says “`STRIPE_SECRET_KEY` is available in test runs” |
| Never in prompts or logs | The redactor masks exact matches and common encodings (base64, URL-encoded) in every outgoing prompt, log line and event |
| Never in Git | Secret scan on every candidate diff and snapshot; a hit rejects the candidate and raises an Interrupt-now item |
| Live keys are refused for tests | Prefix checks (e.g. `sk_live_`) block use in test runs unless the developer explicitly allows it for a named task |
| Optional local `.env` | “Also write to my `.env` for my own dev server” is off by default; when on, the harness checks `.env` is gitignored first |

**Verification.** For known services, a kernel-owned probe makes a harmless read call (Stripe balance, OpenAI model list, SendGrid scopes) and shows “Verified: Stripe test mode”. For unknown services, a format check now and “verified on first successful use” later.

## Human steps: tools and accounts

| Step | Probe | Install or guide |
|---|---|---|
| Playwright browsers | `npx playwright --version` and a browser launch | **Install** runs `npx playwright install chromium` in a visible terminal after consent |
| Docker | `docker info` | Link to Docker Desktop; re-probe on **I've installed it** |
| Database server (if not containerized) | Connection test with the configured URL | Guide with the exact settings |
| Cloud account setup (e.g. Google Cloud API enabled) | API probe if a key or CLI is present | Checklist; otherwise developer attests, labeled “attested, not verified” |

Only the tasks that need a step wait for it. Everything else keeps running.

## Edge cases

| Situation | Behavior |
|---|---|
| Developer pastes a secret into the chat by mistake | Detected by pattern before sending to any model; message held; offer to move it to the vault and delete it from history. If it was already stored, the secret purge redacts it everywhere and asks the developer to rotate the key ([database design §10](database-design.md#10--code-index-secret-purge-and-query-bounds)). |
| Secret rotated in the provider dashboard | Next probe or use fails → card “STRIPE_SECRET_KEY was rejected · Update”. |
| Developer away for an hour with a batch pending | Workers continue on unblocked work; the batch waits; nothing is auto-answered. |
| 20 workers running | Board groups cards by feature with counts; lanes collapse to summaries. Cards distinguish *thinking* from *waiting for a run slot* and *running*, because only a few workers execute commands at once ([execution capacity](execution-capacity.md)). |
| Developer wants raw logs for everything | Settings → Developer → “Show raw stream by default”. |

[Diagram](cockpit-and-office.svg) · [Editable Mermaid](cockpit-and-office.mmd) · [Office view](office-view.md) · [Routing and holds](routing-design.md) · [Provider connections](provider-connections.md) · [Stops, undo and re-entry](stops-undo-and-reentry.md)
