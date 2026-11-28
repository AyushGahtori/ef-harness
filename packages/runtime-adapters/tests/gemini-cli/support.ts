import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GeminiCliRuntimeAdapter,
  GeminiHomeGuard,
  GeminiOptInComplianceGate,
  GeminiVisibleConPtyLoginHelper,
  LocalHarnessRunRecorder,
  LocalPacingClassifier,
  LocalSilentPaidFallbackGuard,
  LocalTierAMxcSandbox,
  complianceNotice,
} from "../../src/gemini-cli/index.js";
import type { GlobalSettingsStore } from "../../src/gemini-cli/ports.js";

export class MemoryGlobalSettingsStore implements GlobalSettingsStore {
  private readonly rows = new Map<string, string>();

  get(key: string): string | null {
    return this.rows.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.rows.set(key, value);
  }
}

export const fakeGeminiPath = fileURLToPath(
  new URL("./fixtures/fake-gemini-acp.mjs", import.meta.url),
);

export function makeWorktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-task-148-"));
  fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "# exclude\n", "utf8");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

export async function removeWorktree(dir: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last;
}

export interface Harness {
  readonly store: MemoryGlobalSettingsStore;
  readonly gate: GeminiOptInComplianceGate;
  readonly guard: GeminiHomeGuard;
  readonly sandbox: LocalTierAMxcSandbox;
  readonly harnessRun: LocalHarnessRunRecorder;
  readonly pacing: LocalPacingClassifier;
  readonly fallback: LocalSilentPaidFallbackGuard;
  readonly runtime: GeminiCliRuntimeAdapter;
}

export function makeHarness(options?: {
  readonly probeEnv?: Readonly<Record<string, string>>;
}): Harness {
  const store = new MemoryGlobalSettingsStore();
  const gate = new GeminiOptInComplianceGate({
    store,
    now: () => "2026-11-23T12:00:00.000Z",
  });
  const guard = new GeminiHomeGuard();
  const sandbox = new LocalTierAMxcSandbox();
  const harnessRun = new LocalHarnessRunRecorder();
  const pacing = new LocalPacingClassifier();
  const fallback = new LocalSilentPaidFallbackGuard();
  const runtime = new GeminiCliRuntimeAdapter({
    command: process.execPath,
    argsPrefix: [fakeGeminiPath],
    gate,
    guard,
    sandbox,
    harnessRun,
    pacing,
    fallback,
    ...(options?.probeEnv ? { probeEnv: options.probeEnv } : {}),
  });
  return { store, gate, guard, sandbox, harnessRun, pacing, fallback, runtime };
}

export function acceptDefaultNotice(gate: GeminiOptInComplianceGate): void {
  gate.acceptNotice(complianceNotice());
}

export function makeLoginHelper(gate: GeminiOptInComplianceGate, worktree: string, guard: GeminiHomeGuard) {
  return new GeminiVisibleConPtyLoginHelper(gate, worktree, {
    command: process.execPath,
    argsPrefix: [fakeGeminiPath],
    loginArgs: ["--login"],
    loginEnv: { GEMINI_FAKE_LOGIN_HOLD: "0" },
    guard,
  });
}
