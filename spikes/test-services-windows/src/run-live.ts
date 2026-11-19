import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BINARY_COMPONENTS, ensureExtracted, findExecutable } from "./binaries.ts";
import {
  CLONE_TARGET_MS,
  LOOPBACK_HOST,
  MAILPIT_ROUTES,
  POSTGRES_TEMPLATE_CLONE_SQL,
  READINESS_PROBES,
} from "./constants.ts";
import { errorText } from "./errors.ts";
import { WindowsJob } from "./job-object.ts";
import { probeLocalhostCookieIsolation } from "./localhost-cookies.ts";
import { searchMail, sendSmtp } from "./mail-client.ts";
import { canConnect, reserveLoopbackPort, type ReservedPort } from "./ports.ts";
import {
  assertDatabaseIsolation,
  cloneEnvironments,
  dropClones,
  psql,
  seedTemplate,
  startPostgres,
} from "./postgres.ts";
import { readProcessIdentity, sameProcessAlive, terminateProcess, workingSetBytes } from "./process-table.ts";
import { probeRedisBasics } from "./redis-client.ts";
import { delay, waitUntilReady } from "./readiness.ts";
import { renderRedisDecision, renderReportMarkdown, type SpikeReport } from "./report.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MEMURAI_REASON =
  "Memurai Developer is proprietary, its EULA forbids redistribution, and the current build is an installer that would register a Windows service. The spike did not launch it.";

export async function supervise(): Promise<void> {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "EFHarness", "spike-test-services");
  mkdirSync(root, { recursive: true });
  const partialPath = path.join(root, "live-report.json");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--orchestrate", partialPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const holding = await waitForHolding(child, () => stdout, () => stderr);
  const report = JSON.parse(readFileSync(partialPath, "utf8")) as SpikeReport;
  const identities = [];
  for (const pid of holding.pids) {
    const identity = await readProcessIdentity(pid);
    if (identity) identities.push(identity);
  }
  if (child.pid) await terminateProcess(child.pid);
  const orphans: number[] = [];
  for (const identity of identities) {
    const stillThere = await waitUntilQuiet(async () => !(await sameProcessAlive(identity)));
    if (!stillThere) orphans.push(identity.pid);
  }
  let portsReleased = true;
  for (const port of holding.ports) {
    if (await canConnect(LOOPBACK_HOST, port, 400)) portsReleased = false;
  }
  report.jobObject = {
    limit: "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    orchestratorHardKill: "TerminateProcess",
    orphanPids: orphans,
    orphanCount: orphans.length,
    portsReleased,
  };
  writeReports(report);
  if (orphans.length > 0 || !portsReleased) {
    throw new Error(`Hard kill left orphans=${orphans.join(",") || "none"} portsReleased=${portsReleased}`);
  }
}

export async function orchestrate(partialPath: string): Promise<void> {
  const report = emptyReport();
  const reserved: ReservedPort[] = [];
  const pids: number[] = [];
  const ports: number[] = [];
  let job: WindowsJob | undefined;
  try {
    try {
      report.localhostCookies = await probeLocalhostCookieIsolation();
    } catch (error) {
      report.localhostCookies = { error: errorText(error) };
    }
    job = await WindowsJob.open();
    const pgPort = await takePort(reserved, ports);
    const redisPort = await takePort(reserved, ports);
    const smtpPort = await takePort(reserved, ports);
    const httpPort = await takePort(reserved, ports);
    const pop3Port = await takePort(reserved, ports);
    const oauthPort = await takePort(reserved, ports);
    const root = path.dirname(partialPath);
    const logs = path.join(root, "logs");
    mkdirSync(logs, { recursive: true });
    const binaries = await Promise.all(BINARY_COMPONENTS.map(async (component) => ensureExtracted(component)));
    const postgresHome = binaries[0] ?? "";
    const garnetHome = binaries[1] ?? "";
    const mailHome = binaries[2] ?? "";
    const postgres = await findExecutable(postgresHome, "postgres.exe");
    const initdb = await findExecutable(postgresHome, "initdb.exe");
    const psqlBin = await findExecutable(postgresHome, "psql.exe");
    const garnet = await findExecutable(garnetHome, "GarnetServer.exe");
    const mailpit = await findExecutable(mailHome, "mailpit.exe");
    const started = await startPostgres({
      job,
      postgres,
      initdb,
      psql: psqlBin,
      dataDir: path.join(root, "pgdata"),
      port: pgPort,
      logDir: logs,
    });
    pids.push(started.pid);
    report.postgres = {
      ...report.postgres,
      status: "measured",
      port: pgPort,
      pid: started.pid,
      recovered: started.recovered,
      memoryBytes: await workingSetBytes(started.pid),
      ipv6Refused: !(await canConnect("::1", pgPort, 400)),
    };
    await seedTemplate(psqlBin, pgPort);
    const busy = await templateWasBusy(psqlBin, pgPort);
    const clones = await cloneEnvironments(psqlBin, pgPort);
    const isolated = await assertDatabaseIsolation(psqlBin, pgPort);
    await dropClones(psqlBin, pgPort);
    report.postgres = {
      ...report.postgres,
      recovered: `${started.recovered}; busyTemplateRejected=${busy}`,
      cloneMs: { env1: clones.env1Ms, env2: clones.env2Ms },
      withinCloneTarget: clones.env1Ms < CLONE_TARGET_MS && clones.env2Ms < CLONE_TARGET_MS,
      isolationOk: isolated,
    };
    const redisPid = await job.spawn({
      application: garnet,
      args: [
        "--port",
        String(redisPort),
        "--bind",
        LOOPBACK_HOST,
        "--max-databases",
        "16",
        "--lua",
        "true",
        "--memory",
        "128m",
        "--index",
        "32m",
      ],
      cwd: path.dirname(garnet),
      stdoutPath: path.join(logs, "garnet.stdout.log"),
      stderrPath: path.join(logs, "garnet.stderr.log"),
    });
    pids.push(redisPid);
    await waitUntilReady({
      service: "garnet",
      timeoutMs: 20_000,
      probe: async () => {
        const probed = await probeRedisBasics(redisPort).catch(() => null);
        return probed !== null;
      },
      logs: () => readMaybe(path.join(logs, "garnet.stderr.log")),
    });
    const redisProbe = await probeRedisBasics(redisPort);
    report.redis = {
      ...report.redis,
      status: "measured",
      port: redisPort,
      pid: redisPid,
      memoryBytes: await workingSetBytes(redisPid),
      ipv6Refused: !(await canConnect("::1", redisPort, 400)),
      commands: redisProbe.commands,
      selectIsolated: redisProbe.selectIsolated,
      selectDetail: redisProbe.selectDetail,
      publishDetail: redisProbe.publishDetail,
      task050Isolation: redisProbe.selectIsolated
        ? "One Garnet per project, database indexes 0-15, FLUSHDB per environment. Extra process only above 16 databases."
        : "SELECT did not isolate. Use one small Garnet per environment or Docker/WSL.",
    };
    const mailPid = await job.spawn({
      application: mailpit,
      args: [
        "--listen",
        `${LOOPBACK_HOST}:${httpPort}`,
        "--smtp",
        `${LOOPBACK_HOST}:${smtpPort}`,
        "--pop3",
        `${LOOPBACK_HOST}:${pop3Port}`,
        "--disable-version-check",
        "--quiet",
      ],
      cwd: logs,
      stdoutPath: path.join(logs, "mailpit.stdout.log"),
      stderrPath: path.join(logs, "mailpit.stderr.log"),
    });
    pids.push(mailPid);
    await waitUntilReady({
      service: "mailpit",
      timeoutMs: 15_000,
      probe: async () => (await fetch(`http://${LOOPBACK_HOST}:${httpPort}${MAILPIT_ROUTES.info}`)).ok,
      logs: () => readMaybe(path.join(logs, "mailpit.stderr.log")),
    });
    await sendSmtp({ port: smtpPort, from: "spike@example.test", to: "one@env1.test", subject: "env1", body: "hello env1" });
    await sendSmtp({ port: smtpPort, from: "spike@example.test", to: "two@env2.test", subject: "env2", body: "hello env2" });
    const env1 = await searchMail(httpPort, "to:one@env1.test");
    const env2 = await searchMail(httpPort, "to:two@env2.test");
    report.mailpit = {
      ...report.mailpit,
      status: "measured",
      ports: { smtp: smtpPort, http: httpPort, pop3: pop3Port },
      pid: mailPid,
      memoryBytes: await workingSetBytes(mailPid),
      ipv6Refused: !(await canConnect("::1", httpPort, 400)),
      env1Subjects: env1.messages.map((message) => message.Subject),
      env2Subjects: env2.messages.map((message) => message.Subject),
      isolated:
        env1.messages.every((message) => message.Subject === "env1") &&
        env2.messages.every((message) => message.Subject === "env2") &&
        env1.total > 0 &&
        env2.total > 0,
    };
    const oauthPid = await job.spawn({
      application: process.execPath,
      args: [path.join(here, "oauth-child.ts"), String(oauthPort)],
      stdoutPath: path.join(logs, "oauth.stdout.log"),
      stderrPath: path.join(logs, "oauth.stderr.log"),
    });
    pids.push(oauthPid);
    await waitUntilReady({
      service: "oauth",
      timeoutMs: 15_000,
      probe: async () => (await fetch(`http://${LOOPBACK_HOST}:${oauthPort}/env1/.well-known/openid-configuration`)).ok,
      logs: () => readMaybe(path.join(logs, "oauth.stderr.log")),
    });
    const valid = await liveAuthorization(oauthPort);
    report.oauth = {
      ...report.oauth,
      status: "measured",
      port: oauthPort,
      pid: oauthPid,
      issuerEnv1: `http://${LOOPBACK_HOST}:${oauthPort}/env1`,
      issuerEnv2: `http://${LOOPBACK_HOST}:${oauthPort}/env2`,
      validRole: valid.role,
      rejected: valid.rejected,
      memoryBytes: await workingSetBytes(oauthPid),
      ipv6Refused: !(await canConnect("::1", oauthPort, 400)),
    };
    await job.enrollHolder();
  } catch (error) {
    const message = errorText(error);
    if (report.postgres.status !== "measured") report.postgres = { ...report.postgres, status: "failed", error: message };
    else if (report.redis.status !== "measured") report.redis = { ...report.redis, status: "failed", error: message };
    else if (report.mailpit.status !== "measured") report.mailpit = { ...report.mailpit, status: "failed", error: message };
    else report.oauth = { ...report.oauth, status: "failed", error: message };
  } finally {
    writeFileSync(partialPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify({ holding: true, pids, ports })}\n`);
    await delay(24 * 60 * 60 * 1000);
  }
}

function writeReports(report: SpikeReport): void {
  const dir = path.resolve(here, "..");
  writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(dir, "REPORT.md"), renderReportMarkdown(report));
  writeFileSync(path.join(dir, "REDIS_DECISION.md"), renderRedisDecision(report));
}

async function takePort(reserved: ReservedPort[], ports: number[]): Promise<number> {
  const port = await reserveLoopbackPort();
  reserved.push(port);
  ports.push(port.port);
  await port.unhold();
  return port.port;
}

async function liveAuthorization(port: number): Promise<{ role: string; rejected: string[] }> {
  const redirectUri = `http://${LOOPBACK_HOST}:${port}/callback`;
  const admin = await exchange(port, redirectUri, "live", "admin");
  if (admin.role !== "admin") throw new Error(`expected admin role, received ${admin.role ?? "none"}`);
  const guest = await exchange(port, redirectUri, "guest-state", "guest");
  const missing = await fetch(
    `http://${LOOPBACK_HOST}:${port}/env1/authorize?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`,
  );
  const expiredLocation = await authorize(port, redirectUri, "soon", "admin", "1");
  await delay(40);
  const expired = await token(port, redirectUri, new URL(expiredLocation).searchParams.get("code") ?? "");
  const rejected = [
    missing.status === 400 ? "bad_state" : "",
    guest.role === "guest" ? "wrong_role" : "",
    expired.status === 400 ? "expired_code" : "",
  ].filter((item) => item.length > 0);
  return { role: admin.role ?? "", rejected };
}

async function exchange(port: number, redirectUri: string, state: string, role: string): Promise<{ role?: string }> {
  const location = await authorize(port, redirectUri, state, role);
  const response = await token(port, redirectUri, new URL(location).searchParams.get("code") ?? "");
  return (await response.json()) as { role?: string };
}

async function authorize(port: number, redirectUri: string, state: string, role: string, ttl?: string): Promise<string> {
  const url = new URL(`http://${LOOPBACK_HOST}:${port}/env1/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "spike");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("role", role);
  if (ttl) url.searchParams.set("code_ttl_ms", ttl);
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) throw new Error(await response.text());
  return location;
}

async function token(port: number, redirectUri: string, code: string): Promise<Response> {
  return fetch(`http://${LOOPBACK_HOST}:${port}/env1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
}

async function templateWasBusy(psqlBin: string, port: number): Promise<boolean> {
  const child = spawn(
    psqlBin,
    ["-h", LOOPBACK_HOST, "-p", String(port), "-U", "spike", "-d", "tpl_spike"],
    { windowsHide: true, shell: false, stdio: ["pipe", "ignore", "ignore"] },
  );
  child.stdin.write("SELECT pg_sleep(20);\n");
  await delay(400);
  try {
    await psql(psqlBin, port, "postgres", "CREATE DATABASE env_busy TEMPLATE tpl_spike");
    return false;
  } catch (error) {
    return /being accessed|other users/i.test(errorText(error));
  } finally {
    child.kill();
  }
}

function emptyReport(): SpikeReport {
  const base = {
    bindHost: "127.0.0.1" as const,
    status: "skipped" as const,
  };
  return {
    schema: "test-services-windows-spike@1",
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    redisDecision: "garnet",
    postgres: {
      ...base,
      version: "17.12-1",
      readinessProbe: READINESS_PROBES.postgres,
      templateSql: POSTGRES_TEMPLATE_CLONE_SQL,
    },
    redis: {
      ...base,
      server: "garnet",
      version: "2.2.13",
      readinessProbe: READINESS_PROBES.redis,
      commands: [],
      selectIsolated: null,
      selectDetail: "",
      publishDetail: "",
      task050Isolation: "pending",
    },
    memurai: { executed: false, reason: MEMURAI_REASON },
    mailpit: {
      ...base,
      version: "1.34.0",
      readinessProbe: READINESS_PROBES.mailpit,
      searchRoute: MAILPIT_ROUTES.search,
    },
    oauth: {
      ...base,
      readinessProbe: READINESS_PROBES.oauth,
      rejected: [],
    },
    jobObject: {
      limit: "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
      orchestratorHardKill: "TerminateProcess",
      orphanPids: [],
      orphanCount: null,
      portsReleased: null,
    },
    localhostCookies: { error: "not run" },
    readinessProbes: READINESS_PROBES,
    binaries: BINARY_COMPONENTS.map((component) => ({
      id: component.id,
      version: component.version,
      url: component.url,
      sha256: component.sha256,
      sizeBytes: component.sizeBytes,
      license: component.license,
    })),
  };
}

function readMaybe(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

async function waitUntilQuiet(probe: () => Promise<boolean>): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (await probe()) return true;
    await delay(150);
  }
  return false;
}

async function waitForHolding(
  child: ReturnType<typeof spawn>,
  stdout: () => string,
  stderr: () => string,
): Promise<{ pids: number[]; ports: number[] }> {
  const started = Date.now();
  while (Date.now() - started < 12 * 60 * 1000) {
    const match = stdout().match(/\{[^\n]*"holding":true[^\n]*\}/);
    if (match?.[0]) return JSON.parse(match[0]) as { pids: number[]; ports: number[] };
    if (child.exitCode !== null) {
      throw new Error(`orchestrator exited ${child.exitCode}\n${stderr()}\n${stdout()}`);
    }
    await delay(200);
  }
  throw new Error(`orchestrator timed out\n${stderr()}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--orchestrate")) {
    const partial = process.argv[process.argv.indexOf("--orchestrate") + 1];
    if (!partial) throw new Error("missing report path");
    await orchestrate(partial);
  } else {
    await supervise();
  }
}
