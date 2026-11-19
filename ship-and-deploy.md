# Ship and deploy: remote Git, CI, migrations and production

Until now the design stopped at landing on the developer's local branch. This document continues: pushing to GitHub, opening pull requests, reading CI failures and repairing them, deploying to hosting, running real database migrations, checking production health and rolling back. Every step that changes something outside the laptop goes through the kernel's effect ledger with approval rules. Research: [CI and deployment](research/ci-and-deployment.md).

## Decisions in plain words

1. **Nothing leaves the laptop without a rule saying it may.** Push, PR, deploy, migration, environment-variable sync and DNS or webhook changes are *effects* with intent, approval, idempotency key and receipt.
2. **The harness pushes its own branches and opens PRs; it never pushes to `main` directly** unless the developer turns that on for a repo without branch protection.
3. **CI is part of verification.** A red CI run becomes a repair task with the failing log as visible evidence, in a bounded loop.
4. **Production changes need explicit approval each time** by default: production deploy, live migration, DNS. Previews and staging can be automatic.
5. **Migrations are expand-then-contract.** The app can always roll back to the previous version because the database change it depends on is backward compatible. Destructive steps run later, separately approved, after a backup.
6. **GitHub calls go through one queue that respects GitHub's limits.**

## Connecting a remote

| Step | What happens |
|---|---|
| Detect | Existing `origin` remote and host (GitHub first; GitLab and others later) |
| Authenticate | GitHub OAuth device flow (or reuse an existing `gh` login), stored in the vault. Scopes: repo contents, pull requests, actions read. |
| Check rules | Read branch protection and required checks for the default branch; record them |
| Choose mode | **PR mode** (default): push `harness/*` branches and open PRs. **Direct mode**: push to a branch the developer names. |

## Push and pull request loop

```
feature reaches DONE ─▶ push harness/f/F12 ─▶ open draft PR (description + receipts)
                                      │
                         CI runs on GitHub Actions
                    ┌─────────────────┴─────────────────┐
                 green                                  red
                    │                                   │
        mark PR ready; land per settings      triage → repair task → push → (loop, max 3)
```

**PR description** is generated from the graph: features and requirements covered, acceptance checks with results, migrations, new dependencies, assumptions chosen for the developer, and links to the plan. No AI is needed for the structure; a short summary paragraph is optional.

**CI triage** reads the failing jobs' logs (`gh run view --log-failed` or the API) and classifies the failure by deterministic patterns first, then a small model if none match:

| Class | Typical signal | Next step |
|---|---|---|
| Platform difference | Module not found only on Linux (filename case), path separator, line endings, missing native package | Repair task with the log excerpt; reproduce locally in the Tier D container if available |
| Missing secret or variable | `undefined` env var, auth failure in CI | Human step: add the repository secret (guided), never pasted into code |
| Flaky | Passes on re-run of the same commit | Re-run once; record as unstable and route to the test owner |
| Real regression | A test that passes locally fails in CI with the same environment | Repair task to the owning feature |
| Infrastructure | Runner outage, quota | Wait and retry later; no repair task |

CI logs aren't hidden test data, so the repair worker sees the failing lines. The loop is bounded (default 3 pushes per PR per failure fingerprint) and then goes to the developer.

**State.** Each PR, CI run, deployment and live migration is a row in `ship_runs` (repository, PR number, head commit, run ID, environment, status, failure fingerprint, repair generation), linked to its effect in the ledger, so the loop's bound (“3 pushes per fingerprint”) and “waiting for CI” survive restarts ([schema](schema/state.sql)).

**Prevention.** Phase 0 generates a CI workflow that runs the same gates as the local verifier on Linux and Windows, so most platform differences are caught locally (Tier D container) before any push.

## Respecting GitHub's limits

All GitHub API calls go through one queue per account:

- Content-creating requests (push events, PR creation, comments, labels) are serialized and kept well below GitHub's documented 80 per minute and 500 per hour.
- Polling uses conditional requests and backs off; CI status is read by webhook-free polling at increasing intervals (30 s → 5 min).
- `retry-after` and `x-ratelimit-reset` headers are obeyed exactly; repeated secondary-limit hits pause the queue and show it in the cockpit.
- Pushes use Git over HTTPS (not the REST API); one push per feature, not per task.

## Deploying

Deploy adapters share one interface, like the agent runtime adapters:

| Operation | Purpose |
|---|---|
| `probe()` | CLI installed, logged in, project linked |
| `plan(env, build)` | What will change: build, env vars (names only), migrations, domains |
| `deploy(env, build)` | Start deployment; returns a deployment ID |
| `status(id)` / `logs(id)` | Progress and logs |
| `promote(id)` / `rollback(env)` | Switch traffic to a deployment or back to the previous one |
| `syncEnv(env, names)` | Push vault values to the host's environment settings |

v1 adapters: **Vercel** (web and Next.js) and generic **Docker over SSH** to a VPS (decided 17 November 2026). A managed container host (Railway, Fly.io or Render), AWS and others come later.

### Environments

| Environment | Default policy |
|---|---|
| Preview (per PR) | Automatic; uses test secrets and a disposable or branched database |
| Staging | Automatic after the PR is ready, if configured |
| Production | **Explicit approval** each time, with the plan shown |

### Environment variables

- The developer's vault holds values per environment (test, staging, production).
- `syncEnv` shows a diff of **names only** (“will add `STRIPE_WEBHOOK_SECRET`, will change `DATABASE_URL`”) and requires approval for production.
- Production values are never pulled back to the laptop for tests.

### Live database migrations

| Phase | What runs | Approval |
|---|---|---|
| 0 · Rehearse | Apply the migration to a copy: a branched database where the host supports it, or a restored backup on staging; run the app's smoke checks against it | Automatic |
| 1 · Backup | Confirm point-in-time recovery or take a snapshot; record its ID | Automatic, must succeed |
| 2 · Expand | Additive changes only (new tables, nullable columns, new indexes created concurrently) before the app deploy | Approval for production |
| 3 · Deploy app | New version reads both old and new structures as needed | Approval for production |
| 4 · Backfill | Batched data copy with progress and a pause button | Approval |
| 5 · Contract | Drop or rename old structures, in a later release | Separate approval, with data export offered |

A migration that the [migration verifier](verification-for-real-apps.md#database-migrations-preserving-data) marked destructive cannot skip phases 0–1.

### Post-deploy checks and rollback

After each deployment the harness runs:

1. Health endpoint and version check (the deployed build ID matches).
2. Smoke journeys: a short Playwright suite against the deployed URL, using a dedicated test account.
3. Error watch for an observation window (default 10 minutes): error rate from host logs or the error tracker, if connected.

| Result | Action |
|---|---|
| All good | Mark released; tag the commit; release notes from the graph |
| Smoke fails or error rate rises | **Automatic app rollback** for preview and staging; for production, rollback is offered immediately and automatic only if the developer enabled it. Database stays (expand-only changes are compatible). A repair task is opened with the evidence. |
| Deploy itself fails | Nothing switched; logs attached; repair task |

### External registrations

Webhooks, OAuth redirect URLs, DNS records and similar are effects with receipts. Where an API exists (e.g. creating a webhook endpoint), the harness does it with approval and stores the returned ID so it can be removed by an undo. Where it doesn't, it becomes a guided human step with a probe (e.g. DNS lookup) to confirm.

## Edge cases

| Situation | Behavior |
|---|---|
| Repo has required reviewers | PR waits for review; the cockpit shows “waiting for reviewer”; the harness never bypasses. |
| CI takes an hour | Polling backs off; the feature is “waiting for CI”; other work continues. |
| Developer pushed new commits to the same branch | Treated like any developer change ([editor coexistence](editor-coexistence.md)); the harness merges, never force-pushes. |
| Deployment token expired | Human step to reconnect; deployment parked. |
| Migration rehearsal finds a long table lock | Plan switches to an online strategy (batched backfill, concurrent index) or asks for a maintenance window. |
| The developer has no hosting yet | Deploy is a discovery question with recommended defaults per stack; nothing is created without approval. |

[Diagram](ship-and-deploy.svg) · [Editable Mermaid](ship-and-deploy.mmd) · [Stops, undo and re-entry](stops-undo-and-reentry.md) · [Sandbox and security](sandbox-and-security.md) · [Verification for real apps](verification-for-real-apps.md) · [Research](research/ci-and-deployment.md)
