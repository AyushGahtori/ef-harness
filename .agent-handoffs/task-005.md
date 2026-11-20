---
task_id: "Task-005"
branch: "task/005-spike-test-services-windows"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - spikes/test-services-windows/**
  - .agent-handoffs/task-005.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 005 handoff

Native Windows test services were proved without Docker. The binding Redis-compatible choice is Microsoft Garnet 2.2.13. Postgres template clones, Mailpit recipient isolation, the OAuth mock, and Job Object kill-on-close were measured on this machine.

## Exports Provided

For Tasks 049-052 and Task 132, read these files rather than importing the spike into a package barrel:

- Redis decision: `spikes/test-services-windows/REDIS_DECISION.md`. Choice is Garnet. Do not ship Memurai.
- Postgres template clone SQL, in order, from `POSTGRES_TEMPLATE_CLONE_SQL` in `spikes/test-services-windows/src/constants.ts`:
  - `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'tpl_spike' AND pid <> pg_backend_pid()`
  - `UPDATE pg_database SET datallowconn = false WHERE datname = 'tpl_spike'`
  - terminate again
  - `CREATE DATABASE env_1 TEMPLATE tpl_spike`
  - `CREATE DATABASE env_2 TEMPLATE tpl_spike`
- initdb flags that succeeded: `--username=spike --auth=trust --encoding=UTF8 --locale=C --no-instructions`, data directory under `%LOCALAPPDATA%`, `listen_addresses = '127.0.0.1'`.
- Mailpit routes: `GET /api/v1/info` for readiness, `GET /api/v1/search?query=to:user@env1.test` for isolation. Launch with `--listen 127.0.0.1:<http>`, `--smtp 127.0.0.1:<smtp>`, and `--pop3 127.0.0.1:<pop3>`. The default POP3 bind is `[::]:1110`.
- Garnet launch that passed the command matrix: `--bind 127.0.0.1 --port <port> --max-databases 16 --lua true --memory 128m --index 32m`. Do not pass `--cluster`. Lua is off unless `--lua true` is set. The default `--memory` is 16g and the default `--bind` is every interface.
- OAuth issuers: `http://127.0.0.1:<port>/env1` and `/env2`, with `/.well-known/openid-configuration`, `/authorize`, and `/token`.
- Readiness probes are `READINESS_PROBES` in `src/constants.ts`.
- Binary pins for Task 132 are `BINARY_COMPONENTS` and `PIN_STRATEGY` in `src/binaries.ts`. Archives live in `%LOCALAPPDATA%\EFHarness\components\test-services-windows` and are not committed.
  - Postgres 17.12-1 zip, 386263884 bytes, sha256 `a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c`, URL `https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip`
  - Garnet 2.2.13 `win-x64-based-readytorun.zip`, 26495420 bytes, sha256 `cc8212d7c7a671c490e5c87967fc43025a22215922bdbdad5eccff00915c7b82`
  - Mailpit 1.34.0 `mailpit-windows-amd64.zip`, 11288840 bytes, sha256 `8f080d41374bf22686606374a0a483c8563c1bf29ae078179792392ff8c911d7`
- Job Object helper: `src/job-holder.ps1` plus `WindowsJob` in `src/job-object.ts`. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is set, the parent process holds the only durable handle, and the holder exits when that parent dies.

## Shared Wiring Needs (Root / Index Barrels)

No `src/index.ts` barrel edit. The spike is not a package export.

`spikes/vitest.config.ts` is frozen by Task 001 and its `include` is only `tests/**/*.test.ts`. Add `test-services-windows/tests/**/*.test.ts` to that include so `pnpm --filter @ef-harness/spikes test -- test-services-windows` discovers this suite. Do not do that edit on this branch.

## Dependency Intents (New Packages Requested)

None. The spike uses Node built-ins plus the root `playwright` package through `createRequire`. No new dependency should be added to `spikes/package.json`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-005-spike-test-services-windows`:

- `node spikes/test-services-windows/run-unit-tests.mjs` — 4 files, 11 tests passed (OAuth mock, `*.localhost` cookie isolation, Job Object kill-on-close, service wrappers including the in-process Redis and Mailpit fakes, stale `postmaster.pid`, port retry, and SHA-256 mismatch refusal).
- `node spikes/test-services-windows/src/run-live.ts` — exit 0. `report.json` records Postgres 17.12 clone times 997.5 ms and 814.4 ms (both under 1 s), isolation true, busy-template rejection true, stale postmaster recovery `cleared`, Garnet SELECT isolation true, every probed command passed, Mailpit `to:env1` / `to:env2` isolation true, OAuth valid role `admin` plus `bad_state`, `wrong_role`, and `expired_code`, cookie isolation true, and Job Object orphan count 0 with ports released.
- `pnpm exec eslint spikes/test-services-windows --max-warnings 0` — exit 0.
- `pnpm --filter @ef-harness/spikes test -- test-services-windows` — exit 1, `No test files found`, because the frozen include is `tests/**/*.test.ts`. The same tests pass through `run-unit-tests.mjs`.

## Known Limitations / Follow-Ups

- Memurai Developer was not started. Its EULA forbids redistribution, and the current build is an installer that would register a Windows service. The Garnet command matrix was measured. Memurai command compatibility was not.
- Garnet's measured working set (65585152 bytes) is for `--memory 128m`, not the 16g default.
- The Postgres working set (24485888 bytes) is the `postgres.exe` process sampled after clone, not a sum of every backend.
- HSET and ZADD integer replies of 0 in `report.json` mean the field or member already existed after the readiness probe. HGET still returned the stored value.
- Task 050 should keep the in-process fake for offline unit tests and must pass `--bind 127.0.0.1` and `--lua true`.
