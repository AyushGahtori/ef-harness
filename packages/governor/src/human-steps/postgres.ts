import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export const SELECT_1 = "SELECT 1";

export function startupMessage(user: string, database: string): Buffer {
  const body = Buffer.concat([
    int32(196608),
    cstring("user"),
    cstring(user),
    cstring("database"),
    cstring(database),
    cstring("client_encoding"),
    cstring("UTF8"),
    Buffer.from([0]),
  ]);
  return Buffer.concat([int32(body.length + 4), body]);
}

export function passwordMessage(secret: string): Buffer {
  const text = Buffer.concat([Buffer.from(secret, "utf8"), Buffer.from([0])]);
  return Buffer.concat([Buffer.from("p"), int32(text.length + 4), text]);
}

export function saslInitialResponse(mechanism: string, initial: string): Buffer {
  const body = Buffer.from(initial, "utf8");
  const payload = Buffer.concat([cstring(mechanism), int32(body.length), body]);
  return Buffer.concat([Buffer.from("p"), int32(payload.length + 4), payload]);
}

export function saslContinueResponse(finalMessage: string): Buffer {
  const body = Buffer.from(finalMessage, "utf8");
  return Buffer.concat([Buffer.from("p"), int32(body.length + 4), body]);
}

export function queryMessage(sql: string): Buffer {
  if (sql !== SELECT_1) {
    throw new Error("database probes may only send SELECT 1");
  }
  const text = Buffer.concat([Buffer.from(sql, "utf8"), Buffer.from([0])]);
  return Buffer.concat([Buffer.from("Q"), int32(text.length + 4), text]);
}

export function md5PostgresPassword(user: string, password: string, salt: Buffer): string {
  const inner = createHash("md5").update(`${password}${user}`).digest("hex");
  const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
  return `md5${outer}`;
}

export function authenticationOk(): Buffer {
  return tagged("R", int32(0));
}

export function authenticationCleartext(): Buffer {
  return tagged("R", int32(3));
}

export function authenticationMd5(salt: Buffer): Buffer {
  return tagged("R", Buffer.concat([int32(5), salt]));
}

export function readyForQuery(): Buffer {
  return tagged("Z", Buffer.from("I"));
}

export function errorResponse(code: string, message: string): Buffer {
  const fields = Buffer.concat([Buffer.from("C"), cstring(code), Buffer.from("M"), cstring(message), Buffer.from([0])]);
  return tagged("E", fields);
}

export function dataRow(value: string): Buffer {
  const text = Buffer.from(value, "utf8");
  return tagged("D", Buffer.concat([int16(1), int32(text.length), text]));
}

export function commandComplete(tag: string): Buffer {
  return tagged("C", cstring(tag));
}

export interface ServerMessage {
  readonly tag: string;
  readonly payload: Buffer;
}

export class MessageBuffer {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
  }

  next(): ServerMessage | null {
    if (this.pending.length < 5) return null;
    const length = this.pending.readInt32BE(1);
    if (length < 4) throw new Error("invalid database message length");
    const total = 1 + length;
    if (this.pending.length < total) return null;
    const tag = String.fromCharCode(this.pending[0] ?? 0);
    const payload = this.pending.subarray(5, total);
    this.pending = this.pending.subarray(total);
    return { tag, payload };
  }
}

export interface ScramExchange {
  readonly clientFirst: string;
  readonly clientFirstBare: string;
  readonly clientFinal: (serverFirst: string) => { readonly message: string; readonly proof: string };
  readonly verifyServer: (serverFirst: string, serverFinal: string) => boolean;
}

/** SCRAM-SHA-256 client. ASCII passwords use identity SASLprep. */
export function scramExchange(user: string, password: string, nonce: string = randomBytes(18).toString("base64url")): ScramExchange {
  const clientFirstBare = `n=${saslUser(user)},r=${nonce}`;
  const clientFirst = `n,,${clientFirstBare}`;
  return {
    clientFirst,
    clientFirstBare,
    clientFinal(serverFirst: string): { readonly message: string; readonly proof: string } {
      const proof = clientProof(password, clientFirstBare, serverFirst);
      const withoutProof = clientFinalWithoutProof(serverFirst);
      return { message: `${withoutProof},p=${proof.proof}`, proof: proof.proof };
    },
    verifyServer(serverFirst: string, serverFinal: string): boolean {
      const expected = serverSignature(password, clientFirstBare, serverFirst);
      const presented = serverFinal.replace(/^v=/, "");
      return presented.length > 0 && presented === expected;
    },
  };
}

export function clientProof(
  password: string,
  clientFirstBare: string,
  serverFirst: string,
): { readonly proof: string; readonly server: string } {
  const parsed = parseServerFirst(serverFirst);
  const salted = pbkdf2Sync(password, parsed.salt, parsed.iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const withoutProof = `c=biws,r=${parsed.nonce}`;
  const auth = `${clientFirstBare},${serverFirst},${withoutProof}`;
  const clientSignature = createHmac("sha256", storedKey).update(auth).digest();
  const proof = xor(clientKey, clientSignature);
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const server = createHmac("sha256", serverKey).update(auth).digest("base64");
  return { proof: proof.toString("base64"), server };
}

function serverSignature(password: string, clientFirstBare: string, serverFirst: string): string {
  return clientProof(password, clientFirstBare, serverFirst).server;
}

function clientFinalWithoutProof(serverFirst: string): string {
  return `c=biws,r=${parseServerFirst(serverFirst).nonce}`;
}

function parseServerFirst(serverFirst: string): { readonly nonce: string; readonly salt: Buffer; readonly iterations: number } {
  const nonce = matchField(serverFirst, "r");
  const salt = Buffer.from(matchField(serverFirst, "s"), "base64");
  const iterations = Number(matchField(serverFirst, "i"));
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("invalid SCRAM iteration count");
  return { nonce, salt, iterations };
}

function matchField(source: string, name: string): string {
  const match = new RegExp(`(?:^|,)${name}=([^,]*)`).exec(source);
  const value = match?.[1];
  if (!value) throw new Error(`missing SCRAM field ${name}`);
  return value;
}

function saslUser(user: string): string {
  if (/[^\u0020-\u007e]/.test(user)) {
    throw new Error("this probe only SASLpreps ASCII database user names");
  }
  return user.replaceAll("=", "=3D").replaceAll(",", "=2C");
}

function xor(left: Buffer, right: Buffer): Buffer {
  const out = Buffer.alloc(left.length);
  for (let index = 0; index < left.length; index += 1) {
    out[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return out;
}

function tagged(tag: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(tag), int32(payload.length + 4), payload]);
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function int16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
}
