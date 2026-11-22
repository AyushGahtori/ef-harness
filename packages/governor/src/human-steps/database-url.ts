import { HumanStepError } from "./errors.js";
import { openProbeStream, type ProbeByteStream } from "./net-probe.js";
import {
  SELECT_1,
  authenticationCleartext,
  commandComplete,
  dataRow,
  errorResponse,
  md5PostgresPassword,
  queryMessage,
  readyForQuery,
  saslContinueResponse,
  saslInitialResponse,
  scramExchange,
  startupMessage,
  passwordMessage,
  MessageBuffer,
  type ServerMessage,
} from "./postgres.js";
import { decodeRedisLine, encodeRedis } from "./redis.js";
import { maskDatabaseUrl, scrubSecrets } from "./redact.js";
import { DB_AUTH_FAILED_DIAGNOSIS, type ProbeResult } from "./types.js";
import type { ProbeLogger, WindowsDpapiSecretsVault } from "./ports.js";

export { authenticationCleartext, commandComplete, dataRow, errorResponse, readyForQuery };

export interface DatabaseTarget {
  readonly engine: "postgres" | "redis";
  readonly username: string;
  readonly password: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly ssl: boolean;
  readonly raw: string;
}

export function parseDatabaseTarget(raw: string, engine: "postgres" | "redis"): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HumanStepError("database_url", "The vault connection URL could not be parsed");
  }
  const protocol = url.protocol.replace(":", "");
  if (engine === "postgres" && protocol !== "postgresql" && protocol !== "postgres") {
    throw new HumanStepError("database_url", "Postgres probes require a postgresql URL");
  }
  if (engine === "redis" && protocol !== "redis" && protocol !== "rediss") {
    throw new HumanStepError("database_url", "Redis probes require a redis URL");
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || username || "postgres";
  const sslMode = url.searchParams.get("sslmode");
  const ssl = protocol === "rediss" || sslMode === "require" || sslMode === "verify-full";
  const port = url.port.length > 0 ? Number(url.port) : engine === "postgres" ? 5432 : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HumanStepError("database_url", "The database port is invalid");
  }
  return {
    engine,
    username,
    password,
    host: url.hostname,
    port,
    database,
    ssl,
    raw,
  };
}

export async function probeDatabaseTarget(input: {
  readonly vault: WindowsDpapiSecretsVault;
  readonly secretId: string;
  readonly engine: "postgres" | "redis";
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly logger: ProbeLogger;
}): Promise<ProbeResult> {
  const started = input.now();
  const secret = await input.vault.readSecret(input.secretId);
  if (secret === null || secret.trim().length === 0) {
    return finish(input.now, started, "fail", "MISSING_SECRET", "No database URL is stored for this step", {
      secretId: input.secretId,
    });
  }
  let target: DatabaseTarget;
  try {
    target = parseDatabaseTarget(secret, input.engine);
  } catch (error) {
    return finish(input.now, started, "fail", "BAD_URL", scrubSecrets(messageOf(error), [secret]), { secretId: input.secretId });
  }
  const secrets = [secret, target.password, target.raw];
  input.logger.write("database_probe", {
    engine: target.engine,
    host: target.host,
    port: target.port,
    readOnly: true,
  });
  let stream: ProbeByteStream | null = null;
  try {
    stream = await openProbeStream(target.host, target.port, input.timeoutMs, input.signal, target.ssl);
    if (target.engine === "postgres") await postgresSelectOne(stream, target, input.timeoutMs);
    else await redisPing(stream, target, input.timeoutMs);
    return finish(input.now, started, "pass", target.engine === "postgres" ? "SELECT_1" : "PONG", "Database accepted a read-only probe", {
      host: target.host,
      port: target.port,
      target: maskDatabaseUrl(target.raw),
    });
  } catch (error) {
    const raw = messageOf(error);
    const code = errorCode(error);
    if (code === "PROBE_TIMEOUT" || code === "ETIMEDOUT") {
      return finish(input.now, started, "timeout", "PROBE_TIMEOUT", timeoutDiagnosis(), evidence(target));
    }
    if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(raw)) {
      return finish(
        input.now,
        started,
        "fail",
        "ECONNREFUSED",
        `Nothing is accepting connections on ${target.host}:${target.port} — start the database and click Check again`,
        evidence(target),
      );
    }
    if (code === "AUTH_FAILED" || /28P01|WRONGPASS|NOAUTH|authentication failed/i.test(raw)) {
      return finish(input.now, started, "fail", "AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS, evidence(target));
    }
    return finish(input.now, started, "fail", "DATABASE_UNREACHABLE", scrubSecrets(raw, secrets), evidence(target));
  } finally {
    stream?.close();
  }
}

async function postgresSelectOne(stream: ProbeByteStream, target: DatabaseTarget, timeoutMs: number): Promise<void> {
  const user = target.username.length > 0 ? target.username : "postgres";
  stream.write(startupMessage(user, target.database));
  const buffer = new MessageBuffer();
  let authenticated = false;
  let sawResult = false;
  let scram: ReturnType<typeof scramExchange> | null = null;
  let serverFirst = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const message = await nextMessage(stream, buffer, timeoutMs);
    if (message.tag === "R") {
      const code = message.payload.readInt32BE(0);
      if (code === 0) {
        authenticated = true;
        continue;
      }
      if (code === 3) {
        stream.write(passwordMessage(target.password));
        continue;
      }
      if (code === 5) {
        stream.write(passwordMessage(md5PostgresPassword(user, target.password, message.payload.subarray(4, 8))));
        continue;
      }
      if (code === 10) {
        scram = scramExchange(user, target.password);
        stream.write(saslInitialResponse("SCRAM-SHA-256", scram.clientFirst));
        continue;
      }
      if (code === 11) {
        if (!scram) throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
        serverFirst = message.payload.subarray(4).toString("utf8");
        stream.write(saslContinueResponse(scram.clientFinal(serverFirst).message));
        continue;
      }
      if (code === 12) {
        if (!scram) throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
        const serverFinal = message.payload.subarray(4).toString("utf8");
        if (!scram.verifyServer(serverFirst, serverFinal)) {
          throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
        }
        authenticated = true;
        continue;
      }
      throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
    }
    if (message.tag === "E") {
      const text = message.payload.toString("utf8");
      if (text.includes("28P01") || /password authentication failed|authentication/i.test(text)) {
        throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
      }
      throw new HumanStepError("DATABASE_UNREACHABLE", "The database rejected the read-only probe");
    }
    if (message.tag === "Z" && authenticated && !sawResult) {
      stream.write(queryMessage(SELECT_1));
      continue;
    }
    if (message.tag === "D" || message.tag === "C") {
      sawResult = true;
      continue;
    }
    if (message.tag === "Z" && sawResult) return;
  }
  throw new HumanStepError("DATABASE_UNREACHABLE", "The database handshake did not finish");
}

async function redisPing(stream: ProbeByteStream, target: DatabaseTarget, timeoutMs: number): Promise<void> {
  if (target.password.length > 0) {
    const auth = target.username.length > 0 ? ["AUTH", target.username, target.password] : ["AUTH", target.password];
    stream.write(encodeRedis(auth));
    const reply = await readRedis(stream, timeoutMs);
    if (reply.startsWith("-")) throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
  }
  stream.write(encodeRedis(["PING"]));
  const reply = await readRedis(stream, timeoutMs);
  if (reply === "+PONG") return;
  if (reply.startsWith("-NOAUTH") || reply.startsWith("-WRONGPASS") || reply.startsWith("-ERR AUTH")) {
    throw new HumanStepError("AUTH_FAILED", DB_AUTH_FAILED_DIAGNOSIS);
  }
  throw new HumanStepError("DATABASE_UNREACHABLE", "Redis did not answer PING");
}

async function readRedis(stream: ProbeByteStream, timeoutMs: number): Promise<string> {
  let pending = Buffer.alloc(0);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const decoded = decodeRedisLine(pending);
    if (decoded) return decoded.line;
    pending = Buffer.concat([pending, await stream.read(timeoutMs)]);
  }
  throw new HumanStepError("DATABASE_UNREACHABLE", "Redis did not answer PING");
}

async function nextMessage(stream: ProbeByteStream, buffer: MessageBuffer, timeoutMs: number): Promise<ServerMessage> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const message = buffer.next();
    if (message) return message;
    buffer.push(await stream.read(timeoutMs));
  }
  throw new HumanStepError("DATABASE_UNREACHABLE", "The database handshake did not finish");
}

function evidence(target: DatabaseTarget): Record<string, string | number | boolean> {
  return { host: target.host, port: target.port, target: maskDatabaseUrl(target.raw), readOnly: true };
}

function finish(
  now: () => number,
  started: number,
  outcome: ProbeResult["outcome"],
  code: string,
  diagnosis: string,
  evidenceFields: Record<string, string | number | boolean>,
): ProbeResult {
  return {
    outcome,
    code,
    diagnosis,
    durationMs: Math.max(0, now() - started),
    checkedAt: now(),
    evidence: evidenceFields,
  };
}

function timeoutDiagnosis(): string {
  return "Probe timed out after 10s — a firewall or offline host may be dropping packets. Check the network and click Check again";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}
