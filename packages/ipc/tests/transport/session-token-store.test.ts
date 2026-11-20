import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LocalSecretRedactor,
  SessionTokenStore,
  createRedactingLogger,
  currentUserSid,
  readFileAccessSddl,
  sanitizeUserName,
  securityTrustees,
  timingSafeTokenEqual,
  userPipePath,
  warmWindowsSecurity,
} from "../../src/transport/index.js";

const directories: string[] = [];

beforeAll(async () => {
  await warmWindowsSecurity();
}, 30_000);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ef-token-"));
  directories.push(directory);
  return directory;
}

describe("transport SessionTokenStore", () => {
  it("builds the per-user pipe name", () => {
    expect(sanitizeUserName("DOMAIN\\Ayush")).toBe("DOMAIN_Ayush");
    expect(sanitizeUserName("***")).toBe("user");
    const pipe = userPipePath("Ayush");
    expect(pipe.includes("efharness-Ayush")).toBe(true);
    if (process.platform === "win32") expect(pipe.startsWith("\\\\.\\pipe\\")).toBe(true);
  });

  it("writes a 256-bit token with current-user-only permissions and redacts it", async () => {
    const directory = await tempDir();
    const redactor = new LocalSecretRedactor();
    const lines: string[] = [];
    const logger = createRedactingLogger(redactor, (line) => lines.push(line));
    const store = new SessionTokenStore({ directory, redactor, logger });
    const token = await store.start();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.readFromDisk()).toBe(token);
    expect(await store.start()).toBe(token);
    expect(lines.join("\n").includes(token)).toBe(false);
    expect(redactor.redact(`leak ${token}`)).toBe("leak [REDACTED:SESSION_TOKEN]");

    const sddl = await readFileAccessSddl(store.filePath);
    if (process.platform === "win32") {
      const sid = await currentUserSid();
      expect(securityTrustees(sddl)).toEqual([sid]);
    } else {
      expect(sddl).toBe("mode:600");
    }

    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(store.verify(token)).toBe(true);
    expect(store.verify("f".repeat(64))).toBe(false);
    expect(store.verify("short")).toBe(false);
    expect(timingSafeTokenEqual(token, token)).toBe(true);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
    store.close();
  });

  it("replaces the token file when a new daemon starts", async () => {
    const directory = await tempDir();
    const first = new SessionTokenStore({ directory });
    const original = await first.start();
    const second = new SessionTokenStore({ directory });
    const rotated = await second.start();
    expect(rotated).not.toBe(original);
    expect(await second.readFromDisk()).toBe(rotated);
    first.close();
    second.close();
  });
});
