---
task_id: "Task-050"
branch: "task/050-native-backing-services"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/test-env/src/services/**"
  - "packages/test-env/tests/services/**"
  - ".agent-handoffs/task-050.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 050 handoff

Native Windows backing-service providers for SQLite, embedded Postgres, Redis-compatible servers, Mailpit, local S3, and offline HTTP record/replay. Commit stays on `task/050-native-backing-services`.

## Exports Provided

Import from `packages/test-env/src/services/index.ts` until the package barrel is wired:

- `SqliteEnvProvider` — copies a pre-seeded SQLite template (and `-wal`/`-shm`/`-journal` sidecars) into the attempt temp dir and returns `file:<path>`. `destroy` deletes only that copy. `resetData` re-copies the template.
- `EmbeddedPostgresProvider` — one shared native cluster per project under `%LOCALAPPDATA%\EFHarness\projects\<id>\envs\pg\`. Per environment: database `env_<id>`, scoped role, and `options=-c statement_timeout=<ms>` (default `30000`). `destroy` runs `REVOKE CONNECT`, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, then `DROP DATABASE IF EXISTS`. Missing extensions (`pgvector`, `postgis`, anything absent from `EMBEDDED_POSTGRES_EXTENSIONS` or `pg_available_extensions`) throw `UnsupportedPostgresExtensionError` with message `Requires Docker (Tier D) for extension <ext>`.
- `RedisCompatibleProvider` — one shared Garnet or Memurai server per project, database indexes `/0`–`/15`, `FLUSHDB` on create/reset/destroy. A second server starts only when the project needs more indexes than 16. `FLUSHALL`, `SHUTDOWN`, and `CONFIG` are renamed away in the server config and rejected by the loopback command guard. `inProcessFake: true` together with `tier: 1` is the only in-process fake path.
- `MailpitProvider` — one Mailpit process per project on `127.0.0.1`. Recipient domain `@env<id>.test` (`env91` and `91` both become `@env91.test`). Verifier helpers: `listMessagesForEnv`, `waitForMessage`, `clearMessagesForEnv` (search `to:@env<id>.test`, delete only those IDs).
- `LocalObjectStorageProvider` — one loopback S3-style HTTP server per project, bucket `env-<id>`, per-env access key. `X-08` rejects oversize bodies, disallowed content types, public-web-root storage, and path escape. `destroy` deletes the bucket.
- `HttpRecordReplayProvider` — record requires `httpApproved: true`. Cassettes are scrubbed with `SecretRedactor` and stored by SHA-256. Replay injects `HTTP_REPLAY_BASE_URL` and throws `UnrecordedHttpRequestError(method, url)` on a miss without calling `fetch`.
- `ServiceStartFailedError` — `hint` is `Offer Docker fallback`, `holdDependentTaskOnly` is true, `failTask` is false, `workerQualityPenalty` is false. Startup stderr is on `logs`.
- `ProjectSharedServerPool` — lazy start, idle grace (default 5000 ms), immediate `close` on project close. A crashed shared server marks active environments `degraded` with `failureScope: "environment"` and `workerQualityPenalty: false`, then restarts on the next `create`.
- `TrackingWindowsJobManager` / `NodeBinaryLauncher` — every spawned child is assigned to a job whose limit is `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`). On Windows the holder is a real Job Object.
- `createBackingServiceRegistry()` — the six providers.
- `resolveRedisServerChoice` — `EF_HARNESS_REDIS_SERVER`, else `Chosen server: Garnet|Memurai` in `spikes/test-services-windows/REDIS_DECISION.md`, else **Garnet** (MIT, redistributable). Binaries resolve from `%LOCALAPPDATA%\EFHarness\components\` and are never committed.

`ServiceProvider` shape used by every provider: `create`, `resetData`, `destroy`, `closeProject`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/test-env/src/index.ts` is outside this task. Re-export `packages/test-env/src/services/index.ts` from that barrel when the integrator wires Task 049's registry.

Task 049 should adapt these providers to `ServiceProviderRegistry`. Pass the orchestrator's `WindowsJobManager` (Task 040) into each provider; the local `TrackingWindowsJobManager` is the default when Task 040 is not on the branch.

Task 052 calls `EmbeddedPostgresProvider.create` with `templateDatabase: "tpl_<hash>"` and `SqliteEnvProvider.create` with `templatePath`.

## Dependency Intents (New Packages Requested)

None. Protocol clients and the local S3 / Mailpit / Redis fakes use Node built-ins only.

## Contract Change Requests

Task 049's `ServiceProvider` should match `create(ServiceCreateRequest) / resetData / destroy / closeProject` as declared in `packages/test-env/src/services/types.ts`. Task 011's `SecretRedactor` should expose `redact`, `redactHeaders`, and `redactBody` so it can replace `DefaultSecretRedactor`. Task 028's CAS can replace `FilesystemCassetteStore` (`put` returns a sha256 key, `get` reads it). Task 040's `WindowsJobManager` can replace `TrackingWindowsJobManager` if it implements `createJob`, `assignProcess`, `queryJobAccounting`, and `terminateJob` and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-050-native-backing-services`:

- `pnpm --filter @ef-harness/test-env test -- services` — pass. 8 files, 28 passed, 3 skipped. Skipped tests are the real Postgres, Mailpit, and Garnet/Memurai launches; no binaries were installed under `%LOCALAPPDATA%\EFHarness\components\`.
- `pnpm --filter @ef-harness/test-env typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/test-env lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 050` — pass (`harmony ok for Task-050`).

Covered by the service tests: two-environment SQLite copy/delete, S3 bucket isolation plus X-08 size/type/public-root rejection, HTTP replay secret scrubbing and offline miss, Postgres SQL order (`REVOKE CONNECT`, `pg_terminate_backend`, `DROP DATABASE`), `statement_timeout`, unsupported-extension Docker error, Redis index allocation past 15, `FLUSHALL`/`SHUTDOWN` rejection with the other database left intact, Mailpit domain isolation for 500 messages across 4 environments and targeted delete, lazy shared-server start, idle-grace shutdown, and immediate project close.

## Known Limitations / Follow-Ups

- Redis server choice is Garnet until Task 005 writes `spikes/test-services-windows/REDIS_DECISION.md` or `EF_HARNESS_REDIS_SERVER` is set to `memurai`.
- Real binary integration tests skip cleanly when the component binaries are absent. They launch the installed binary when present.
- SQLite, S3, and HTTP replay run in-process on `127.0.0.1`. Postgres, Redis, and Mailpit child processes are assigned to the project service job. The in-process Redis fake is only for explicit Tier 1.
- Recorded HTTP responses are scrubbed before CAS write. The live recording response returned to the caller is the upstream body; replay serves the scrubbed cassette.
- `packages/test-env/src/index.ts` does not re-export this module yet.
