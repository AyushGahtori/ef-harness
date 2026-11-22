import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import net from "node:net";
import { POSTGRES_PROBE_TIMEOUT_MS } from "./types.js";

export class PostgresAuthError extends Error {
  readonly code = "postgres_auth" as const;

  constructor() {
    super("Postgres rejected the credential.");
    this.name = "PostgresAuthError";
  }
}

export class PostgresUnreachableError extends Error {
  readonly code = "postgres_unreachable" as const;

  constructor(message = "Postgres could not be reached.") {
    super(message);
    this.name = "PostgresUnreachableError";
  }
}

interface PgTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export async function probePostgresSelectOne(
  connectionUrl: string,
  timeoutMs: number = POSTGRES_PROBE_TIMEOUT_MS,
): Promise<void> {
  const target = parsePostgresUrl(connectionUrl);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = net.connect({ host: target.host, port: target.port });
    let finish: (error?: Error) => void = () => undefined;
    const timer = setTimeout(() => {
      finish(new PostgresUnreachableError("Postgres probe timed out."));
    }, timeoutMs);
    finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (destroyError) {
        if (!(destroyError instanceof Error)) throw destroyError;
      }
      if (error) reject(error);
      else resolve();
    };
    socket.once("error", () => finish(new PostgresUnreachableError()));
    const session = new PgSession(target, finish);
    socket.once("connect", () => {
      socket.write(startupMessage(target.user, target.database));
    });
    socket.on("data", (chunk) => {
      try {
        for (const reply of session.push(chunk)) socket.write(reply);
      } catch (error) {
        finish(error instanceof Error ? error : new PostgresUnreachableError());
      }
    });
  });
}

export function postgresMd5Password(user: string, password: string, salt: Buffer): string {
  const inner = createHash("md5").update(`${password}${user}`).digest("hex");
  const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
  return `md5${outer}`;
}

export function scramClientProof(input: {
  readonly password: string;
  readonly clientFirstBare: string;
  readonly serverFirst: string;
  readonly clientFinalWithoutProof: string;
}): { readonly proof: string; readonly serverSignature: string } {
  const server = parseServerFirst(input.serverFirst);
  const salted = pbkdf2Sync(input.password, Buffer.from(server.salt, "base64"), server.iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const authMessage = `${input.clientFirstBare},${input.serverFirst},${input.clientFinalWithoutProof}`;
  const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let index = 0; index < clientKey.length; index += 1) {
    proof[index] = (clientKey[index] ?? 0) ^ (clientSignature[index] ?? 0);
  }
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const serverSignature = createHmac("sha256", serverKey).update(authMessage).digest("base64");
  return { proof: proof.toString("base64"), serverSignature };
}

function parsePostgresUrl(connectionUrl: string): PgTarget {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new PostgresUnreachableError("Postgres URL could not be read.");
    throw error;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new PostgresUnreachableError("Postgres URL could not be read.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    host: url.hostname,
    port: url.port.length > 0 ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: database.length > 0 ? database : decodeURIComponent(url.username),
  };
}

function parseServerFirst(serverFirst: string): { salt: string; iterations: number; nonce: string } {
  const fields = new Map<string, string>();
  for (const part of serverFirst.split(",")) {
    const splitAt = part.indexOf("=");
    if (splitAt <= 0) continue;
    fields.set(part.slice(0, splitAt), part.slice(splitAt + 1));
  }
  const salt = fields.get("s");
  const iterations = Number(fields.get("i"));
  const nonce = fields.get("r");
  if (!salt || !nonce || !Number.isInteger(iterations) || iterations <= 0) {
    throw new PostgresAuthError();
  }
  return { salt, iterations, nonce };
}

class PgSession {
  private buffer = Buffer.alloc(0);
  private stage: "auth" | "query" | "done" = "auth";
  private readonly clientNonce = randomBytes(18).toString("base64url");
  private clientFirstBare = "";
  private serverFirst = "";

  constructor(
    private readonly target: PgTarget,
    private readonly finish: (error?: Error) => void,
  ) {}

  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const outbound: Buffer[] = [];
    let steps = 0;
    while (this.stage !== "done") {
      steps += 1;
      if (steps > 32) throw new PostgresUnreachableError("Postgres probe stopped after too many messages.");
      const message = readMessage(this.buffer);
      if (!message) break;
      this.buffer = Buffer.from(message.rest);
      const reply = this.onMessage(message.type, message.body);
      if (reply) outbound.push(reply);
    }
    return outbound;
  }

  private onMessage(type: string, body: Buffer): Buffer | null {
    if (type === "E") {
      const code = errorField(body, "C");
      this.stage = "done";
      this.finish(code === "28P01" ? new PostgresAuthError() : new PostgresUnreachableError());
      return null;
    }
    if (this.stage === "auth" && type === "R") {
      return this.onAuth(body);
    }
    if (type === "Z" && this.stage === "auth") {
      this.stage = "query";
      return queryMessage("SELECT 1");
    }
    if (type === "C" && this.stage === "query") {
      const tag = body.toString("utf8").replace(/\0+$/, "");
      if (tag.startsWith("SELECT")) {
        this.stage = "done";
        this.finish();
      }
    }
    return null;
  }

  private onAuth(body: Buffer): Buffer | null {
    const code = body.readInt32BE(0);
    if (code === 0) return null;
    if (code === 3) return passwordMessage(Buffer.from(`${this.target.password}\0`));
    if (code === 5) {
      const salt = body.subarray(4, 8);
      const token = postgresMd5Password(this.target.user, this.target.password, salt);
      return passwordMessage(Buffer.from(`${token}\0`));
    }
    if (code === 10) {
      this.clientFirstBare = `n=${escapeSasl(this.target.user)},r=${this.clientNonce}`;
      const clientFirst = `n,,${this.clientFirstBare}`;
      return saslInitial("SCRAM-SHA-256", clientFirst);
    }
    if (code === 11) {
      this.serverFirst = body.toString("utf8");
      const parsed = parseServerFirst(this.serverFirst);
      if (!parsed.nonce.startsWith(this.clientNonce)) throw new PostgresAuthError();
      const clientFinalWithoutProof = `c=biws,r=${parsed.nonce}`;
      const proof = scramClientProof({
        password: this.target.password,
        clientFirstBare: this.clientFirstBare,
        serverFirst: this.serverFirst,
        clientFinalWithoutProof,
      });
      return passwordMessage(Buffer.from(`${clientFinalWithoutProof},p=${proof.proof}`));
    }
    if (code === 12) {
      const serverFinal = body.toString("utf8");
      const proof = scramClientProof({
        password: this.target.password,
        clientFirstBare: this.clientFirstBare,
        serverFirst: this.serverFirst,
        clientFinalWithoutProof: `c=biws,r=${parseServerFirst(this.serverFirst).nonce}`,
      });
      const expected = `v=${proof.serverSignature}`;
      if (serverFinal !== expected) throw new PostgresAuthError();
      return null;
    }
    throw new PostgresAuthError();
  }
}

function startupMessage(user: string, database: string): Buffer {
  const payload = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`, "utf8");
  const length = 4 + 4 + payload.length;
  const message = Buffer.alloc(length);
  message.writeInt32BE(length, 0);
  message.writeInt32BE(196608, 4);
  payload.copy(message, 8);
  return message;
}

function queryMessage(sql: string): Buffer {
  return typedMessage("Q", Buffer.from(`${sql}\0`, "utf8"));
}

function passwordMessage(payload: Buffer): Buffer {
  return typedMessage("p", payload);
}

function saslInitial(mechanism: string, clientFirst: string): Buffer {
  const mech = Buffer.from(`${mechanism}\0`, "utf8");
  const first = Buffer.from(clientFirst, "utf8");
  const length = Buffer.alloc(4);
  length.writeInt32BE(first.length, 0);
  return typedMessage("p", Buffer.concat([mech, length, first]));
}

function typedMessage(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, "ascii");
  header.writeInt32BE(4 + payload.length, 1);
  return Buffer.concat([header, payload]);
}

function readMessage(buffer: Buffer): { type: string; body: Buffer; rest: Buffer } | null {
  if (buffer.length < 5) return null;
  const type = String.fromCharCode(buffer[0] ?? 0);
  const length = buffer.readInt32BE(1);
  if (length < 4 || buffer.length < 1 + length) return null;
  return {
    type,
    body: buffer.subarray(5, 1 + length),
    rest: buffer.subarray(1 + length),
  };
}

function errorField(body: Buffer, field: string): string | null {
  let offset = 0;
  while (offset < body.length) {
    const code = String.fromCharCode(body[offset] ?? 0);
    if (code === "\0") break;
    const end = body.indexOf(0, offset + 1);
    if (end < 0) return null;
    const value = body.subarray(offset + 1, end).toString("utf8");
    if (code === field) return value;
    offset = end + 1;
  }
  return null;
}

function escapeSasl(value: string): string {
  return value.replaceAll("=", "=3D").replaceAll(",", "=2C");
}
