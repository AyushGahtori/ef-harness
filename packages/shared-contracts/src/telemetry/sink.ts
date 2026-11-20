import fs from "node:fs";
import path from "node:path";
import { defaultLogDirectory, utcDay } from "./paths.js";
import type { SecretRedactor } from "./redactor.js";
import type { DiskWarning, LogSink } from "./types.js";
import { errorCode, errorMessage, escapeRegExp } from "./util.js";

export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LOG_RETENTION_DAYS = 14;
export const DEFAULT_LOG_PREFIX = "efharness";
const FLUSH_THRESHOLD_BYTES = 64 * 1024;
const MAX_QUEUED_LINES = 1000;
const DEFAULT_STDERR_NOTICES = 32;

export interface RotatingJsonlSinkOptions {
  directory?: string;
  prefix?: string;
  maxBytes?: number;
  retentionDays?: number;
  redactor: SecretRedactor;
  clock?: () => Date;
  onDiskWarning?: (warning: DiskWarning) => void;
  stderr?: { write(chunk: string | Uint8Array): void };
  maxStderrNotices?: number;
  renameImpl?: (from: string, to: string) => void;
  writeImpl?: (file: string, data: string) => void;
  mkdirImpl?: (directory: string) => void;
  unlinkImpl?: (file: string) => void;
  bindShutdown?: boolean;
}

export class RotatingJsonlSink implements LogSink {
  private readonly directory: string;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly retentionDays: number;
  private readonly redactor: SecretRedactor;
  private readonly clock: () => Date;
  private readonly onDiskWarning?: (warning: DiskWarning) => void;
  private readonly stderrStream: { write(chunk: string | Uint8Array): void };
  private readonly maxStderrNotices: number;
  private readonly renameImpl: (from: string, to: string) => void;
  private readonly writeImpl?: (file: string, data: string) => void;
  private readonly mkdirImpl: (directory: string) => void;
  private readonly unlinkImpl: (file: string) => void;
  private readonly namePattern: RegExp;
  private readonly datedPattern: RegExp;
  private queue: string[] = [];
  private queuedBytes = 0;
  private timer: NodeJS.Immediate | undefined;
  private fd: number | undefined;
  private opened = false;
  private activePath: string | undefined;
  private activeDay: string | undefined;
  private activeSize = 0;
  private stderrNotices = 0;
  private closed = false;
  private hooked = false;
  private readonly onShutdown = (): void => {
    try {
      this.flush();
    } catch (error) {
      this.warn("flush", error, this.activePath);
    }
  };

  constructor(options: RotatingJsonlSinkOptions) {
    this.directory = options.directory ?? defaultLogDirectory();
    this.prefix = options.prefix ?? DEFAULT_LOG_PREFIX;
    if (!/^[A-Za-z0-9._-]+$/.test(this.prefix)) {
      throw new Error("log file prefix contains unsupported characters");
    }
    this.maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS;
    this.redactor = options.redactor;
    this.clock = options.clock ?? (() => new Date());
    this.stderrStream = options.stderr ?? process.stderr;
    this.maxStderrNotices = options.maxStderrNotices ?? DEFAULT_STDERR_NOTICES;
    this.renameImpl = options.renameImpl ?? ((from, to) => fs.renameSync(from, to));
    this.mkdirImpl = options.mkdirImpl ?? ((directory) => fs.mkdirSync(directory, { recursive: true }));
    this.unlinkImpl = options.unlinkImpl ?? ((file) => fs.unlinkSync(file));
    if (options.writeImpl) this.writeImpl = options.writeImpl;
    if (options.onDiskWarning) this.onDiskWarning = options.onDiskWarning;
    const escaped = escapeRegExp(this.prefix);
    this.namePattern = new RegExp(`^${escaped}-.*\\.jsonl$`);
    this.datedPattern = new RegExp(`^${escaped}-(\\d{4}-\\d{2}-\\d{2})(?:\\..*)?\\.jsonl$`);
    if (options.bindShutdown) this.enableShutdownHook();
  }

  activeFile(): string | undefined {
    return this.activePath;
  }

  write(line: string, immediate = false): void {
    if (this.closed) {
      this.warn("write", new Error("log sink is closed"), this.activePath);
      return;
    }
    let redacted: string;
    try {
      const normalized = line.endsWith("\n") ? line : `${line}\n`;
      redacted = this.redactor.redact(normalized);
      if (!redacted.endsWith("\n")) redacted += "\n";
    } catch (error) {
      this.warn("write", error, this.activePath);
      return;
    }
    this.queue.push(redacted);
    this.queuedBytes += Buffer.byteLength(redacted);
    if (this.queue.length > MAX_QUEUED_LINES) {
      const dropped = this.queue.shift();
      if (dropped) this.queuedBytes -= Buffer.byteLength(dropped);
      this.warn("write", new Error("log buffer overflow"), this.activePath);
    }
    if (immediate || this.queuedBytes >= FLUSH_THRESHOLD_BYTES) {
      this.flush();
      return;
    }
    this.schedule();
  }

  flush(): void {
    if (this.timer) {
      clearImmediate(this.timer);
      this.timer = undefined;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.join("");
    this.queue = [];
    this.queuedBytes = 0;
    try {
      this.ensureActive(Buffer.byteLength(batch));
      this.writeToActive(batch);
    } catch (error) {
      this.warn("flush", error, this.activePath);
      this.writeStderr(batch);
    }
  }

  prune(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      this.warn("prune", error, this.directory);
      return;
    }
    const now = this.clock().getTime();
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    for (const name of names) {
      if (!this.namePattern.test(name)) continue;
      const full = path.join(this.directory, name);
      if (this.activePath && path.resolve(full) === path.resolve(this.activePath)) continue;
      const stamp = this.fileStamp(name) ?? this.safeMtime(full);
      if (stamp === undefined) continue;
      if (now - stamp <= maxAgeMs) continue;
      try {
        this.unlinkImpl(full);
      } catch (error) {
        this.warn("prune", error, full);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearImmediate(this.timer);
      this.timer = undefined;
    }
    this.flush();
    this.prune();
    this.closeActive();
    this.activePath = undefined;
    this.removeShutdownHook();
  }

  enableShutdownHook(): void {
    if (this.hooked) return;
    this.hooked = true;
    process.on("beforeExit", this.onShutdown);
    process.on("exit", this.onShutdown);
  }

  private schedule(): void {
    if (this.timer || this.closed) return;
    this.timer = setImmediate(() => {
      this.timer = undefined;
      this.flush();
    });
    this.timer.unref();
  }

  private ensureActive(incomingBytes: number): void {
    const day = utcDay(this.clock());
    if (!this.opened || this.activeDay !== day) {
      this.rotateForDay(day);
    }
    if (this.activePath && this.activeSize > 0 && this.activeSize + incomingBytes > this.maxBytes) {
      this.rotateForSize(day);
    }
  }

  private rotateForDay(day: string): void {
    this.closeActive();
    this.openActive(this.datedFile(day), day);
    this.prune();
  }

  private rotateForSize(day: string): void {
    const current = this.activePath;
    this.closeActive();
    if (current) {
      const archived = this.nextArchivePath(current);
      if (!this.tryRename(current, archived)) {
        this.openActive(current, day);
        return;
      }
    }
    this.openActive(this.datedFile(day), day);
    this.prune();
  }

  private tryRename(from: string, to: string): boolean {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.renameImpl(from, to);
        return true;
      } catch (error) {
        last = error;
        const code = errorCode(error);
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      }
    }
    this.warn("rotate", last, from);
    return false;
  }

  private openActive(file: string, day: string): void {
    try {
      this.mkdirImpl(this.directory);
      if (!this.writeImpl) this.fd = fs.openSync(file, "a");
      this.activePath = file;
      this.activeDay = day;
      this.activeSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
      this.opened = true;
    } catch (error) {
      this.fd = undefined;
      this.opened = false;
      this.warn("open", error, file);
      throw error;
    }
  }

  private writeToActive(data: string): void {
    if (!this.activePath) {
      throw Object.assign(new Error("log file is not open"), { code: "ENOSPC" });
    }
    if (this.writeImpl) {
      this.writeImpl(this.activePath, data);
      this.activeSize += Buffer.byteLength(data);
      return;
    }
    if (this.fd === undefined) {
      throw Object.assign(new Error("log file is not open"), { code: "ENOSPC" });
    }
    const buffer = Buffer.from(data);
    let offset = 0;
    while (offset < buffer.length) {
      const wrote = fs.writeSync(this.fd, buffer, offset);
      if (wrote <= 0) throw Object.assign(new Error("short log write"), { code: "EIO" });
      offset += wrote;
    }
    this.activeSize += buffer.length;
  }

  private closeActive(): void {
    this.opened = false;
    if (this.fd === undefined) return;
    try {
      fs.closeSync(this.fd);
    } catch (error) {
      this.warn("flush", error, this.activePath);
    }
    this.fd = undefined;
  }

  private datedFile(day: string): string {
    return path.join(this.directory, `${this.prefix}-${day}.jsonl`);
  }

  private nextArchivePath(current: string): string {
    const parsed = path.parse(current);
    for (let sequence = 1; sequence < 10_000; sequence += 1) {
      const candidate = path.join(parsed.dir, `${parsed.name}.${sequence}${parsed.ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(parsed.dir, `${parsed.name}.${this.clock().getTime()}${parsed.ext}`);
  }

  private fileStamp(name: string): number | undefined {
    const match = this.datedPattern.exec(name);
    const day = match?.[1];
    if (!day) return undefined;
    const parsed = Date.parse(`${day}T00:00:00.000Z`);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private safeMtime(file: string): number | undefined {
    try {
      return fs.statSync(file).mtimeMs;
    } catch (error) {
      this.warn("prune", error, file);
      return undefined;
    }
  }

  private warn(operation: DiskWarning["operation"], error: unknown, file: string | undefined): void {
    const warning: DiskWarning = {
      code: errorCode(error),
      message: this.safeRedact(errorMessage(error)),
      operation,
    };
    if (file !== undefined) warning.path = file;
    this.onDiskWarning?.(warning);
    this.writeStderr(`[disk-warning] ${warning.code} ${warning.operation} ${warning.message}\n`);
  }

  private safeRedact(text: string): string {
    try {
      return this.redactor.redact(text);
    } catch {
      return "redaction failed";
    }
  }

  private writeStderr(line: string): void {
    if (this.stderrNotices >= this.maxStderrNotices) return;
    this.stderrNotices += 1;
    try {
      const redacted = this.safeRedact(line);
      this.stderrStream.write(redacted.endsWith("\n") ? redacted : `${redacted}\n`);
    } catch {
      this.stderrNotices = this.maxStderrNotices;
    }
  }

  private removeShutdownHook(): void {
    if (!this.hooked) return;
    process.off("beforeExit", this.onShutdown);
    process.off("exit", this.onShutdown);
    this.hooked = false;
  }
}
