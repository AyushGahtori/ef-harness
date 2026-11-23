import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GeminiHomeAccessError,
  GeminiOptInComplianceGate,
  GeminiOptInRequiredError,
  NOTICE_VERSION,
  SETTINGS_KEY,
  complianceNotice,
  forbiddenVendorToken,
  isUserGeminiPath,
  personalGeminiMarker,
} from "../../src/gemini-cli/index.js";
import {
  acceptDefaultNotice,
  makeHarness,
  makeLoginHelper,
  makeWorktree,
  removeWorktree,
} from "./support.js";

const marker = personalGeminiMarker();
const vendor = forbiddenVendorToken();

describe("Gemini CLI compliance gate", () => {
  it("builds the exact off-by-default policy notice", () => {
    const expected = [
      "Gemini CLI runs unmodified via gemini --acp. ",
      "Verify your Google account terms allow third-party ACP harness use. ",
      "EF Harness never reads ",
      marker,
      ".",
    ].join("");
    expect(complianceNotice()).toBe(expected);
    expect(complianceNotice()).toContain("gemini --acp");
    expect(complianceNotice()).toContain(marker);
  });

  it("stays disabled until the exact notice is persisted", () => {
    const { gate, store } = makeHarness();
    expect(gate.enabled).toBe(false);
    expect(gate.optedIn).toBe(false);
    expect(() => gate.acceptNotice("short notice")).toThrow(GeminiOptInRequiredError);
    expect(gate.enabled).toBe(false);
    const record = gate.acceptNotice(complianceNotice());
    expect(record).toEqual({
      optedInAt: "2026-11-23T12:00:00.000Z",
      noticeVersion: NOTICE_VERSION,
      enabled: true,
      revoked: false,
      revocationNotice: null,
    });
    const raw = store.get(SETTINGS_KEY);
    expect(raw).toContain('"optedInAt":"2026-11-23T12:00:00.000Z"');
    expect(raw).toContain(`"noticeVersion":"${NOTICE_VERSION}"`);
    const restored = new GeminiOptInComplianceGate({
      store,
      now: () => "2026-11-24T00:00:00.000Z",
    });
    expect(restored.enabled).toBe(true);
    expect(restored.snapshot()?.optedInAt).toBe("2026-11-23T12:00:00.000Z");
  });

  it("refuses a fresh startSession before any process is spawned", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    try {
      expect(harness.runtime.autoDiscover()).toEqual({ enabled: false, spawned: false });
      expect(harness.runtime.launches).toHaveLength(0);
      await expect(
        harness.runtime.startSession({ worktree, writeScope: ["src/**"] }),
      ).rejects.toBeInstanceOf(GeminiOptInRequiredError);
      expect(harness.runtime.launches).toHaveLength(0);
      expect(harness.runtime.enabled).toBe(false);
    } finally {
      await harness.runtime.close();
      await removeWorktree(worktree);
    }
  });

  it("source files never contain the forbidden compliance literals", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/gemini-cli");
    const tests = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    const files = [...walk(root), ...walk(tests)];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text.includes(marker), file).toBe(false);
      expect(text.includes(vendor), file).toBe(false);
    }
  });
});

describe("Gemini home isolation", () => {
  it("path spy blocks the personal credential directory before the filesystem", () => {
    const { guard } = makeHarness();
    const restore = guard.installFsSpy();
    try {
      expect(isUserGeminiPath(marker)).toBe(true);
      expect(() => fs.readFileSync(marker)).toThrow(GeminiHomeAccessError);
      expect(guard.forbiddenAttempts).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("audits probe, auth status, start, and login without touching the personal directory", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    const restore = harness.guard.installFsSpy();
    try {
      await harness.runtime.probe();
      const before = await harness.runtime.authStatus();
      expect(before.enabled).toBe(false);
      expect(before.readsCredentialDirectory).toBe(false);
      acceptDefaultNotice(harness.gate);
      const started = await harness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        auth: { mode: "api_key", apiKey: "AIza-test-harness-key" },
        extraEnv: {},
      });
      expect(isUserGeminiPath(started.geminiCliHome)).toBe(false);
      const turn = await harness.runtime.sendTurn(started.sessionId, "hello");
      expect(turn.childSawApiKey).toBe(true);
      expect(turn.childHome).toBe(started.geminiCliHome);
      expect(isUserGeminiPath(turn.childHome ?? "")).toBe(false);
      const helper = makeLoginHelper(harness.gate, worktree, harness.guard);
      const login = await helper.open();
      const deadline = Date.now() + 3_000;
      while (!login.output().includes("Sign in with Google") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(login.output()).toContain("Sign in with Google");
      expect(login.output()).toContain("isolated-home");
      expect(isUserGeminiPath(login.geminiCliHome)).toBe(false);
      const verified = await helper.verifyAuthStatus();
      expect(verified).toEqual({
        ok: true,
        method: "acp_initialize",
        readsCredentialDirectory: false,
      });
      await login.cancel();
      expect(harness.guard.forbiddenAttempts).toBe(0);
    } finally {
      restore();
      await harness.runtime.close();
      await removeWorktree(worktree);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
