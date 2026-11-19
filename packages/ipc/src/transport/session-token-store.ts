import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SESSION_TOKEN_BYTES, SESSION_TOKEN_FILE, SESSION_TOKEN_LABEL } from "./constants.js";
import { defaultTokenDirectory } from "./paths.js";
import {
  bindLogger,
  createRedactingLogger,
  loadSharedSecretRedactor,
  LocalSecretRedactor,
  registerSessionToken,
  type SecretRedactor,
  type StructuredLogger,
} from "./redaction.js";
import { restrictFileToCurrentUser } from "./windows-security.js";

export function timingSafeTokenEqual(expected: string, candidate: string): boolean {
  const left = crypto.createHash("sha256").update(expected, "utf8").digest();
  const right = crypto.createHash("sha256").update(candidate, "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  const created = await fs.promises.open(temporary, "wx", 0o600);
  await created.close();
  try {
    await restrictFileToCurrentUser(temporary);
    const writing = await fs.promises.open(temporary, "r+");
    try {
      await writing.writeFile(contents, "utf8");
      await writing.sync();
    } finally {
      await writing.close();
    }
    await replaceFile(temporary, filePath);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

async function replaceFile(temporary: string, filePath: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.promises.rename(temporary, filePath);
      return;
    } catch (error) {
      last = error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  await fs.promises.rm(filePath, { force: true });
  try {
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    if (last instanceof Error) throw last;
    throw error;
  }
}

export interface SessionTokenStoreOptions {
  readonly directory?: string;
  readonly redactor?: SecretRedactor;
  readonly logger?: StructuredLogger;
}

/**
 * 256-bit session token created when harnessd starts.
 * The file is replaced with an atomic rename and current-user-only permissions.
 * The active token is registered with a SecretRedactor so it cannot be logged.
 */
export class SessionTokenStore {
  readonly directory: string;
  readonly filePath: string;
  private tokenValue: string | undefined;
  private redactor: SecretRedactor;
  private logger: StructuredLogger;
  private readonly explicitRedactor: boolean;
  private readonly baseLogger: StructuredLogger | undefined;

  constructor(options: SessionTokenStoreOptions = {}) {
    this.directory = options.directory ?? defaultTokenDirectory();
    this.filePath = path.join(this.directory, SESSION_TOKEN_FILE);
    this.explicitRedactor = options.redactor !== undefined;
    this.redactor = options.redactor ?? new LocalSecretRedactor();
    this.baseLogger = options.logger;
    this.logger = bindLogger(options.logger ?? createRedactingLogger(this.redactor), this.redactor);
  }

  get token(): string {
    if (!this.tokenValue) throw new Error("session token store is not started");
    return this.tokenValue;
  }

  async start(): Promise<string> {
    if (this.tokenValue) return this.tokenValue;
    if (!this.explicitRedactor) {
      const shared = await loadSharedSecretRedactor();
      if (shared) this.redactor = shared;
    }
    const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");
    await writePrivateFile(this.filePath, `${token}\n`);
    this.tokenValue = token;
    registerSessionToken(this.redactor, token);
    this.logger = bindLogger(this.baseLogger ?? createRedactingLogger(this.redactor), this.redactor);
    this.logger.info("session token created", { path: this.filePath, label: SESSION_TOKEN_LABEL });
    return token;
  }

  verify(candidate: string): boolean {
    return timingSafeTokenEqual(this.tokenValue ?? "", candidate);
  }

  async readFromDisk(): Promise<string> {
    let text: string;
    try {
      text = await fs.promises.readFile(this.filePath, "utf8");
    } catch {
      throw new Error("unable to read session token");
    }
    const token = text.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("session token file is invalid");
    return token;
  }

  close(): void {
    if (this.tokenValue) this.redactor.forget(SESSION_TOKEN_LABEL);
    this.tokenValue = undefined;
  }
}
