# Windows test-service spike

Generated 2026-11-19T12:25:23.816Z on win32/x64.

Redis-compatible choice: **Garnet 2.2.13**. Memurai Developer was not executed: Memurai Developer is proprietary, its EULA forbids redistribution, and the current build is an installer that would register a Windows service. The spike did not launch it.

## Postgres

- Status: measured
- Clone: env_1 997.5 ms, env_2 814.4 ms
- Isolation: true
- Startup: cleared; busyTemplateRejected=true
- Memory: 24485888 bytes
- Readiness: TCP 127.0.0.1:<port> then SELECT 1 via psql


## Redis-compatible (Garnet)

- SELECT isolation: true (db0="db0" db1="db1")
- Memory: 65585152 bytes
- Task 050: One Garnet per project, database indexes 0-15, FLUSHDB per environment. Extra process only above 16 databases.

| Command | Result | Detail |
| --- | --- | --- |
| PING | pass | "PONG" |
| SET | pass | "OK" |
| GET | pass | "alpha" |
| HSET | pass | 0 |
| HGET | pass | "value" |
| ZADD | pass | 0 |
| EXPIRE | pass | 1 |
| INCR | pass | 2 |
| EVAL | pass | 1 |
| EVAL | pass | 2 |
| SELECT | pass | db0="db0" db1="db1" |
| PUBLISH | pass | receivers=1 payload=hello |
| SUBSCRIBE | pass | spike:events |

## Mailpit

- Search route: /api/v1/search
- env1: env1
- env2: env2
- Isolated: true

## OAuth mock

- Rejected cases: bad_state, wrong_role, expired_code
- Valid role: admin

## Job Object

- Limit: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
- Orphan count after TerminateProcess: 0
- Ports released: true

## *.localhost cookies

Isolated: true
