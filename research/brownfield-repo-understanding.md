# Research: understanding an existing repo without burning tokens

Question: how can the harness learn what a real 30k-line repo does today, present it for confirmation, and handle missing, failing or stale tests and docs, within a small token budget? Design that uses this: [brownfield discovery](../brownfield-discovery.md).

## Cheap layers first

| Technique | What it gives | Cost | Source |
|---|---|---|---|
| Manifest and config parsing | Languages, frameworks, scripts, test runner, CI, schema files | Free | — |
| Language detection by extension and heuristics | Language mix | Free | [github-linguist](https://github.com/github-linguist/linguist) |
| Tree-sitter parsing | Symbols: exports, functions, classes, routes, components | Free, local, fast, many languages | [tree-sitter](https://tree-sitter.github.io/tree-sitter/) |
| Repo map ranked by a reference graph | The most important symbols that fit a token budget | Free to compute | Aider builds a repo map with tree-sitter and ranks it with a graph algorithm (PageRank) to fit a token budget. [Aider repo map](https://aider.chat/docs/repomap.html) |
| Git history | Churn hotspots, recent activity, owners | Free | `git log --numstat` |
| Model summaries per module | Purpose, data read and written, tests | Tokens; cache by file content hash | — |

**Caching:** a file's Git blob hash identifies its exact content, so a module summary can be reused across commits until one of its files changes.

## Request-driven focus

Reading only the modules the request touches is the main saving. The request “add team invites” maps to auth, user, team and email modules through names, routes and the reference graph. Other modules stay at the free layers.

## Tests in a legacy codebase

- **Characterization tests** capture what the code does today, so a change can be shown not to break it. This is the standard technique for code without tests. (Michael Feathers, *Working Effectively with Legacy Code*.)
- **Known failing at baseline:** recording pre-existing failures by name and comparing only for *new* failures is how many CI systems quarantine failures.
- **Flaky tests:** re-running a failure a few times and marking disagreeing runs unstable is common practice (e.g. Playwright's `retries` with the “flaky” outcome). [Playwright retries](https://playwright.dev/docs/test-retries)

## Performance work needs a measurement

- “Slow” must become a number at a stated data size. For SQL, `EXPLAIN ANALYZE` shows the actual plan and time. [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)
- Benchmarks need a reproducible dataset (seeded synthetic data at a stated scale) and repeated runs with a tolerance.

## Stale documentation

Deterministic checks catch most staleness: commands in the README that aren't in `package.json` scripts, referenced paths that don't exist, environment variables never read in code, dependencies mentioned but not installed. When docs and code disagree about *current* behavior, code is the evidence.

## Privacy

Before any excerpt goes to a remote model, skip `.env` files and mask anything matching secret patterns. A local-only project uses a local model or skips model summaries.

## To measure

- Tokens spent to reach a confirmed “what your repo does today” card on two real repos.
- How often developers correct medium-confidence claims.
