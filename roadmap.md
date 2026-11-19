# Roadmap: building the harness in de-risked stages

The vision stays whole: interview, research, architecture, parallel workers, verification, cockpit and office. The build order puts the riskiest, most central mechanism first and proves it before anything is stacked on top. Each milestone has an exit check measured on frozen benchmarks ([meta-lab](meta-lab.md)).

| Milestone | What gets built | Exit check |
|---|---|---|
| **M0 · Kernel skeleton** | Daemon with SQLite coordinator ([database design](database-design.md), [schema](schema/state.sql), [protocol](kernel-schema-and-protocol.md)), ledger with reservations, leases and epochs, outbox (domain events in `state.db`), `telemetry.db`, window protocol, content-addressed store; fake model adapter; deterministic simulation test harness | 10,000 simulated runs with injected crashes at every transaction boundary: zero lost or duplicated work, zero double-spent budget |
| **M1 · One task, end to end** | Brief → one worker ([own loop](worker-loop.md), API key) in a sandboxed worktree with a [test environment](test-environments.md) → static completeness gate → clean verifier → accepted commit on a harness branch → diff shown in a minimal window | 20 hand-written leaf tasks from the kitchen app: ≥ 85% accepted, zero sandbox escapes in the red-team suite, zero accepted stubs |
| **M2 · Plan to code, sequentially** | Discovery (five prompts + batches) with the [v1 corpus](v1-knowledge-corpus.md), spec expansion, architecture, knowledge database, planning, Phase 0, tasks run one at a time, feature integrator | Kitchen app built from a scripted interview; hidden acceptance suite ≥ 90% passing |
| **M3 · Parallel build** | Crew scheduler, multiple workers, feature branches, project merge queue, Board cockpit, inbox | Same app ≥ 2× faster than M2 with no drop in hidden-suite pass rate |
| **M4 · Plans and foreign agents** | Sign in with ChatGPT, Copilot SDK, Cursor SDK; Claude Code with an API key; Gemini CLI (off by default); allowance pacing; [execution pool](execution-capacity.md) | Kitchen app on one ChatGPT Plus plan without hitting the window before planned finish |
| **M5 · Rich interaction** | Interactive architecture canvas, App preview with point-to-fix, Office view v1, brownfield discovery | Hallway test: 5 developers complete a guided change on resume-changer@497831ec |
| **M6 · Beyond main** | Remote push and CI loop, deploy adapters, investigations and sweeps, multi-project broker, `.harness` portability | Bug-fix and rename benchmarks pass; a CI-only failure (Linux case sensitivity) is repaired automatically |

**Rule:** a milestone's features ship only after its exit check passes. The first user-visible release is M3 (or M4 for plan users).

## Pre-coding checklist

- [x] Architecture documents for all areas (this repository).
- [x] Threat model and sandbox design ([sandbox and security](sandbox-and-security.md)).
- [x] Technology stack ([desktop app](desktop-app.md#technology-stack)).
- [x] Core schemas and state machines ([build pipeline](build-pipeline.md)).
- [ ] Freeze benchmark projects and hidden suites (kitchen app, resume-changer, a CLI, a backend API).
- [ ] Spike: MXC and fallback sandbox on Windows 11 and 10 (one day).
- [ ] Spike: `node:sqlite` inside Electron with WAL, FTS5 and backup (half a day).
- [ ] Spike: drive one task through `codex app-server`, `copilot --acp`, `claude -p` (API key) and `gemini --acp` with the harness MCP server (two days).
- [ ] Spike: sandbox capacity benchmark: tiers A, B, D and our loop at 1, 5, 10 and 20 workers, idle and active, on a 16 GB laptop; sets execution-pool defaults ([execution capacity](execution-capacity.md#benchmark-before-choosing-defaults-part-of-the-sandbox-spike)) (one day, with the MXC spike).
- [x] Complete SQLite schema for all four database files, executable and covered by 67 scenario tests (`node schema/schema-test.js`).
- [x] Worker loop, kernel schema and protocol, v1 corpus scope, test environments, intake, app shell and governor designed.
- [ ] Spike: embedded Postgres, a Redis-compatible server, Mailpit and the OAuth mock started and cleaned up by Job Objects on Windows without Docker (one day).
- [ ] Write the M2 questions, rules and seams (44 questions, 14 rules, 10 seams) and download the 6 skills from the most-used public skills (about two weeks, in parallel with M0–M1).
- [ ] Decide the remaining owner choices in [open design questions](open-design-questions.md).
