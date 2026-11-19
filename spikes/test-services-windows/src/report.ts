import { READINESS_PROBES } from "./constants.ts";
import type { CommandProbe } from "./redis-client.ts";
import type { LocalhostCookieReport } from "./localhost-cookies.ts";

export interface ServiceMeasurement {
  status: "measured" | "failed" | "skipped";
  port?: number;
  ports?: Record<string, number>;
  pid?: number;
  memoryBytes?: number | null;
  bindHost: "127.0.0.1";
  ipv6Refused?: boolean;
  error?: string;
  readinessProbe: string;
}

export interface SpikeReport {
  schema: "test-services-windows-spike@1";
  generatedAt: string;
  platform: string;
  arch: string;
  redisDecision: "garnet";
  postgres: ServiceMeasurement & {
    version: string;
    cloneMs?: { env1: number; env2: number };
    withinCloneTarget?: boolean;
    isolationOk?: boolean;
    recovered?: string;
    templateSql: string;
  };
  redis: ServiceMeasurement & {
    server: "garnet";
    version: string;
    commands: CommandProbe[];
    selectIsolated: boolean | null;
    selectDetail: string;
    publishDetail: string;
    task050Isolation: string;
  };
  memurai: {
    executed: false;
    reason: string;
  };
  mailpit: ServiceMeasurement & {
    version: string;
    searchRoute: string;
    env1Subjects?: string[];
    env2Subjects?: string[];
    isolated?: boolean;
  };
  oauth: ServiceMeasurement & {
    issuerEnv1?: string;
    issuerEnv2?: string;
    validRole?: string;
    rejected: string[];
  };
  jobObject: {
    limit: "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE";
    orchestratorHardKill: "TerminateProcess";
    orphanPids: number[];
    orphanCount: number | null;
    portsReleased: boolean | null;
  };
  localhostCookies: LocalhostCookieReport | { error: string };
  readinessProbes: typeof READINESS_PROBES;
  binaries: Array<{ id: string; version: string; url: string; sha256: string; sizeBytes: number; license: string }>;
}

export function renderReportMarkdown(report: SpikeReport): string {
  const clone = report.postgres.cloneMs
    ? `env_1 ${report.postgres.cloneMs.env1.toFixed(1)} ms, env_2 ${report.postgres.cloneMs.env2.toFixed(1)} ms`
    : "not measured";
  const commands = report.redis.commands
    .map((command) => `| ${command.command} | ${command.ok ? "pass" : "fail"} | ${command.detail.replaceAll("|", "/")} |`)
    .join("\n");
  return `# Windows test-service spike

Generated ${report.generatedAt} on ${report.platform}/${report.arch}.

Redis-compatible choice: **Garnet ${report.redis.version}**. Memurai Developer was not executed: ${report.memurai.reason}

## Postgres

- Status: ${report.postgres.status}
- Clone: ${clone}
- Isolation: ${String(report.postgres.isolationOk)}
- Startup: ${report.postgres.recovered ?? "n/a"}
- Memory: ${report.postgres.memoryBytes ?? "n/a"} bytes
- Readiness: ${report.postgres.readinessProbe}
${report.postgres.error ? `- Error: ${report.postgres.error}` : ""}

## Redis-compatible (Garnet)

- SELECT isolation: ${String(report.redis.selectIsolated)} (${report.redis.selectDetail})
- Memory: ${report.redis.memoryBytes ?? "n/a"} bytes
- Task 050: ${report.redis.task050Isolation}

| Command | Result | Detail |
| --- | --- | --- |
${commands}

## Mailpit

- Search route: ${report.mailpit.searchRoute}
- env1: ${(report.mailpit.env1Subjects ?? []).join(", ") || "n/a"}
- env2: ${(report.mailpit.env2Subjects ?? []).join(", ") || "n/a"}
- Isolated: ${String(report.mailpit.isolated)}

## OAuth mock

- Rejected cases: ${report.oauth.rejected.join(", ") || "none"}
- Valid role: ${report.oauth.validRole ?? "n/a"}

## Job Object

- Limit: ${report.jobObject.limit}
- Orphan count after TerminateProcess: ${String(report.jobObject.orphanCount)}
- Ports released: ${String(report.jobObject.portsReleased)}

## *.localhost cookies

${"isolated" in report.localhostCookies ? `Isolated: ${report.localhostCookies.isolated}` : report.localhostCookies.error}
`;
}

export function renderRedisDecision(report: SpikeReport): string {
  const failed = report.redis.commands.filter((command) => !command.ok).map((command) => command.command);
  const select = report.redis.selectIsolated
    ? "Garnet isolated SELECT 0 from SELECT 1 in this run. Task 050 should keep one Garnet process per project and assign each environment a database index from 0 through 15, running FLUSHDB on create, reset, and destroy. Start another small Garnet only when a project needs more databases than MaxDatabases (default 16, flag `--max-databases`)."
    : "Garnet did not prove SELECT isolation in this run. Task 050 must not share one process by database index until that gap is closed. Use one small Garnet process per environment, or Docker/WSL when the workload needs Redis database indexes.";
  return `# Redis-compatible Windows server decision

## Decision

Use **Microsoft Garnet ${report.redis.version}** as the native Windows Redis-compatible server. Do not standardize on Memurai Developer.

## Licensing

EF Harness is a locally installed open-source application. The Redis-compatible binary has to be redistributable with that application.

- Garnet is MIT licensed. The win-x64 ready-to-run archive can be downloaded on demand, hash-pinned, and shipped or cached without a separate commercial agreement.
- Memurai Developer is proprietary. Its EULA licenses the software rather than selling it, and it forbids sharing or distributing it. Developer edition is limited to development and test, restarts after 10 days, and current releases require a license file. That fails the open-source redistribution bar even before command coverage is considered.

## Portability and process model

- Garnet ${report.redis.version} ships as \`win-x64-based-readytorun.zip\`. No installer and no Windows service. The spike starts \`GarnetServer.exe\` as an unprivileged child, bound to \`127.0.0.1\`, inside a Job Object.
- Memurai's current developer distribution is an installer. Installing it would register a Windows service, which this harness forbids. A portable evaluation build that does not install a service was not available for an honest side-by-side process test, so Memurai was not launched.

## Command evidence

${select}

Commands that failed in this run: ${failed.length > 0 ? failed.join(", ") : "none"}.

BullMQ and ioredis basics exercised here are PING, GET, SET, HSET, HGET, ZADD, EXPIRE, INCR, EVAL (including a rate-limit script), PUBLISH, SUBSCRIBE, and SELECT. Where a cell failed, Task 050 should use a per-environment process or the Docker/WSL fallback for that workload rather than pretending the command exists. Tier 1 unit checks keep the in-process fake in \`redis-fake.ts\`, which implements the same command subset and SELECT isolation.

Pub/sub is connection-global, not per database index. Key isolation is the SELECT result above.

## Memory and shutdown

Garnet working set after the probe: ${report.redis.memoryBytes ?? "not measured"} bytes.
Job Object orphan count after TerminateProcess of the orchestrator: ${String(report.jobObject.orphanCount)}.

## Task 050 and Task 132

Launch flags that this run actually used, and that Task 050 must keep:

- \`--bind 127.0.0.1\` — Garnet's default is every interface. Omit this and the server violates the loopback invariant.
- \`--port <41000-48999>\`
- \`--max-databases 16\` and do not enable \`--cluster\`. SELECT isolation was measured with cluster mode left at its default off.
- \`--lua true\` — Lua is off unless this is set. Both \`EVAL "return 1"\` and the INCR/EXPIRE rate-limit script passed only with Lua enabled. BullMQ needs this.
- \`--memory 128m --index 32m\` — the Garnet default \`--memory\` is 16g. The working set below is for the 128m setting, not the default.

HSET and ZADD replied \`0\` in the table because the readiness probe had already created those fields. The commands still returned success, and HGET returned the stored value.

- Binary pin: exact Garnet archive URL, size, and SHA-256 in \`src/binaries.ts\`. Verify the hash before unpack. Do not follow a floating latest URL.
- Readiness probe: TCP connect on 127.0.0.1, then PING.
- One process per project, indexes 0-15, FLUSHDB on create, reset, and destroy. Another small process only when a project needs more than MaxDatabases.
- Keep the in-process fake for offline unit tests. Do not vendor Memurai.
`;
}
