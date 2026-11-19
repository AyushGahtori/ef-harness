# Research: remote Git, CI loops and safe deployment

Question: how can an automated harness push work, react to CI failures and deploy to hosting without hitting API limits, breaking production or losing data? Design: [ship and deploy](../ship-and-deploy.md).

## GitHub limits

- Primary limits per credential (e.g. 5,000 requests per hour for a personal or OAuth user token). Secondary limits: at most 100 concurrent requests, and in general no more than **80 content-generating requests per minute and 500 per hour**, including actions through the web interface. Obey `retry-after`; otherwise wait until `x-ratelimit-reset`; repeated violations can get an integration banned. [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- Conditional requests that return `304 Not Modified` are recommended for polling to save rate limit. [Best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- `gh run view --log-failed` prints only the logs of failed steps, which keeps CI triage small. [gh run view](https://cli.github.com/manual/gh_run_view)

**Consequence:** one serialized queue per account for content-creating calls, and one push per feature, not per task.

## Platform differences between Windows and CI

GitHub's Linux runners use case-sensitive file systems; Windows is case-insensitive by default, so an import whose case differs from the file name works locally and fails in CI. Path separators, line endings and native modules cause similar splits. Running a Linux container locally (or a CI matrix with Windows and Linux) catches these before pushing.

## Deployments and rollback

- Hosts such as Vercel keep previous deployments and can switch production back instantly (`vercel rollback`, `vercel promote`). [Vercel rollback](https://vercel.com/docs/cli/rollback)
- Preview deployments per pull request are standard on modern hosts.
- Database branching (e.g. Neon) creates a copy-on-write copy of a production database for rehearsing migrations. [Neon branching](https://neon.com/docs/introduction/branching)

## Migrations without downtime

- **Expand and contract (parallel change):** add new structures, migrate, switch readers, remove old ones later; keeps the application rollback-safe. [ParallelChange](https://martinfowler.com/bliki/ParallelChange.html)
- PostgreSQL `CREATE INDEX CONCURRENTLY` builds indexes without blocking writes. [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)
- Backfills in batches avoid long locks and allow pausing.

## Post-deploy verification

Smoke tests against the deployed URL plus a short observation window of error rates is common practice (often called a canary or bake period). Automatic rollback on failed health checks is standard on container platforms.

## To measure

- CI repair loop: share of CI-only failures fixed automatically within 3 pushes.
- Time from feature done to green PR.
- Migration rehearsal coverage of real production issues (locks, data errors).
