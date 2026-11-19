import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LOOPBACK_HOST,
  POSTGRES_TEMPLATE_CLONE_SQL,
  POSTGRES_USER,
  TEMPLATE_DATABASE,
} from "./constants.ts";
import { SpikeError, errorText } from "./errors.ts";
import type { WindowsJob } from "./job-object.ts";
import { isProcessAlive } from "./process-table.ts";
import { canConnect } from "./ports.ts";
import { waitUntilReady } from "./readiness.ts";

export function initdbArgs(dataDir: string): string[] {
  return [
    "-D",
    dataDir,
    `--username=${POSTGRES_USER}`,
    "--auth=trust",
    "--encoding=UTF8",
    "--locale=C",
    "--no-instructions",
  ];
}

export function readPostmasterPid(dataDir: string): number | null {
  const file = path.join(dataDir, "postmaster.pid");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim() ?? "";
  const pid = Number(line);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function clearStalePostmasterLock(dataDir: string): "absent" | "cleared" | "live" {
  const pid = readPostmasterPid(dataDir);
  if (pid === null) return "absent";
  if (isProcessAlive(pid)) return "live";
  rmSync(path.join(dataDir, "postmaster.pid"), { force: true });
  return "cleared";
}

export async function runInitdb(initdb: string, dataDir: string): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  const result = await runProcess(initdb, initdbArgs(dataDir), path.dirname(initdb));
  if (result.code !== 0) {
    throw new SpikeError(
      "initdb_failed",
      `initdb failed with ${result.code}. This often means a missing VC++ runtime, antivirus lock, or locale rejection.\n${result.stderr}\n${result.stdout}`,
    );
  }
}

export async function psql(psqlPath: string, port: number, database: string, sql: string): Promise<string> {
  const result = await runProcess(
    psqlPath,
    ["-h", LOOPBACK_HOST, "-p", String(port), "-U", POSTGRES_USER, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql],
    path.dirname(psqlPath),
  );
  if (result.code !== 0) {
    throw new SpikeError("psql_failed", `${sql}\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

export async function startPostgres(options: {
  job: WindowsJob;
  postgres: string;
  initdb: string;
  psql: string;
  dataDir: string;
  port: number;
  logDir: string;
}): Promise<{ pid: number; recovered: "absent" | "cleared" | "reinitialized" }> {
  mkdirSync(options.logDir, { recursive: true });
  let recovered: "absent" | "cleared" | "reinitialized" = clearStalePostmasterLock(options.dataDir);
  if (recovered === "live") {
    throw new SpikeError("postgres_already_running", `A live postmaster still owns ${options.dataDir}.`);
  }
  if (!existsSync(path.join(options.dataDir, "PG_VERSION"))) {
    await runInitdb(options.initdb, options.dataDir);
    if (recovered === "cleared") recovered = "reinitialized";
  }
  configureCluster(options.dataDir, options.port);
  const stderrPath = path.join(options.logDir, "postgres.stderr.log");
  const stdoutPath = path.join(options.logDir, "postgres.stdout.log");
  const pid = await options.job.spawn({
    application: options.postgres,
    args: ["-D", options.dataDir],
    cwd: path.dirname(options.postgres),
    stdoutPath,
    stderrPath,
  });
  try {
    await waitForPostgres(options.psql, options.port, stdoutPath, stderrPath);
  } catch (error) {
    const stale = clearStalePostmasterLock(options.dataDir);
    if (stale === "live") throw error;
    rmSync(options.dataDir, { recursive: true, force: true });
    await runInitdb(options.initdb, options.dataDir);
    configureCluster(options.dataDir, options.port);
    const retryPid = await options.job.spawn({
      application: options.postgres,
      args: ["-D", options.dataDir],
      cwd: path.dirname(options.postgres),
      stdoutPath,
      stderrPath,
    });
    try {
      await waitForPostgres(options.psql, options.port, stdoutPath, stderrPath);
    } catch (retryError) {
      throw new SpikeError(
        "postgres_start_failed",
        `Postgres failed after stale-lock re-init.\n${errorText(error)}\n${errorText(retryError)}\n${readLog(stderrPath)}`,
      );
    }
    return { pid: retryPid, recovered: "reinitialized" };
  }
  return { pid, recovered };
}

async function waitForPostgres(psqlPath: string, port: number, stdoutPath: string, stderrPath: string): Promise<void> {
  await waitUntilReady({
    service: "postgres",
    timeoutMs: 30_000,
    probe: async () => {
      if (!(await canConnect(LOOPBACK_HOST, port, 200))) return false;
      await psql(psqlPath, port, "postgres", "SELECT 1");
      return true;
    },
    logs: () => readLog(stderrPath) + readLog(stdoutPath),
  });
}

export async function seedTemplate(psqlPath: string, port: number): Promise<void> {
  await psql(psqlPath, port, "postgres", "UPDATE pg_database SET datallowconn = true WHERE datname IN ('tpl_spike', 'env_1', 'env_2', 'env_busy')");
  await psql(
    psqlPath,
    port,
    "postgres",
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('tpl_spike', 'env_1', 'env_2', 'env_busy') AND pid <> pg_backend_pid()",
  );
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS env_busy");
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS env_1");
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS env_2");
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS tpl_spike");
  await psql(psqlPath, port, "postgres", `CREATE DATABASE ${TEMPLATE_DATABASE}`);
  await psql(
    psqlPath,
    port,
    TEMPLATE_DATABASE,
    "CREATE TABLE spike_marker(id integer primary key, note text); INSERT INTO spike_marker(id, note) VALUES (1, 'template')",
  );
}

export async function cloneEnvironments(psqlPath: string, port: number): Promise<{ env1Ms: number; env2Ms: number }> {
  const statements = POSTGRES_TEMPLATE_CLONE_SQL.split(";\n").map((statement) => statement.trim()).filter(Boolean);
  let env1Ms = 0;
  let env2Ms = 0;
  for (const statement of statements) {
    const started = performance.now();
    await psql(psqlPath, port, "postgres", statement);
    const elapsed = performance.now() - started;
    if (statement.includes("env_1")) env1Ms = elapsed;
    if (statement.includes("env_2")) env2Ms = elapsed;
  }
  return { env1Ms, env2Ms };
}

export async function assertDatabaseIsolation(psqlPath: string, port: number): Promise<boolean> {
  await psql(psqlPath, port, "env_1", "INSERT INTO spike_marker(id, note) VALUES (2, 'env_1_only')");
  const env2 = await psql(psqlPath, port, "env_2", "SELECT count(*) FROM spike_marker WHERE note = 'env_1_only'");
  const env1 = await psql(psqlPath, port, "env_1", "SELECT count(*) FROM spike_marker WHERE note = 'env_1_only'");
  return env2.includes("0") && env1.includes("1");
}

export async function dropClones(psqlPath: string, port: number): Promise<void> {
  await psql(
    psqlPath,
    port,
    "postgres",
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('env_1', 'env_2') AND pid <> pg_backend_pid()",
  );
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS env_1");
  await psql(psqlPath, port, "postgres", "DROP DATABASE IF EXISTS env_2");
}

function configureCluster(dataDir: string, port: number): void {
  const conf = path.join(dataDir, "postgresql.conf");
  const extra = [
    "",
    `listen_addresses = '${LOOPBACK_HOST}'`,
    `port = ${port}`,
    "logging_collector = off",
  ].join("\n");
  writeFileSync(conf, `${readFileSync(conf, "utf8")}\n${extra}\n`);
  const hba = path.join(dataDir, "pg_hba.conf");
  const kept = readFileSync(hba, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.includes("::1"));
  if (!kept.some((line) => line.includes("127.0.0.1/32") && line.includes("trust"))) {
    kept.push("host all all 127.0.0.1/32 trust");
  }
  writeFileSync(hba, `${kept.join("\n")}\n`);
}

function readLog(file: string): string {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8");
}

function runProcess(file: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false });
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
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
