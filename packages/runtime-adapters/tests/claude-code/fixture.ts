import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeRuntimeAdapter, type ClaudeCodeRuntimeAdapterOptions } from "../../src/claude-code/adapter.js";
import { NormalizedRuntimeEventBus } from "../../src/claude-code/event-bus.js";
import { HOST_ENV_ALLOWLIST } from "../../src/claude-code/launch-plan.js";
import { consoleKeyPrefix } from "../../src/claude-code/markers.js";
import {
  LocalApiConnectionManager,
  LocalAttemptCheckpoints,
  LocalBudgetLedger,
  LocalPriceTable,
  LocalWindowsDpapiSecretsVault,
  type MicroUsdRateCard,
} from "../../src/claude-code/ports.js";
import type { ClaudeSessionSpec, NormalizedRuntimeEvent } from "../../src/claude-code/types.js";

export const fakeClaudePath = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));

export function consoleKey(): string {
  return `${consoleKeyPrefix()}01-fixture-value`;
}

export function hostEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

export interface TempLayout {
  readonly root: string;
  readonly home: string;
  readonly outside: string;
  readonly receiptPath: string;
  readonly decisionsPath: string;
  readonly messagesPath: string;
}

export function makeLayout(): TempLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-claude-wt-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ef-claude-home-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ef-claude-out-"));
  fs.mkdirSync(path.join(root, "src", "api"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const wip = true;\n");
  fs.writeFileSync(path.join(root, "src", "api", "orders.ts"), "export const orders = true;\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "DO NOT TOUCH CLAUDE MD\n");
  fs.writeFileSync(path.join(root, "README.md"), "readme\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside-secret\n");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "PERSONAL_CLAUDE_CREDENTIAL_MARKER\n");
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    `${JSON.stringify({ mcpServers: { personal: { command: "personal-mcp-should-not-load" } } })}\n`,
  );
  return {
    root,
    home,
    outside,
    receiptPath: path.join(root, "receipt.json"),
    decisionsPath: path.join(root, "decisions.jsonl"),
    messagesPath: path.join(root, "messages.txt"),
  };
}

export function removeLayout(layout: TempLayout): void {
  fs.rmSync(layout.root, { recursive: true, force: true });
  fs.rmSync(layout.home, { recursive: true, force: true });
  fs.rmSync(layout.outside, { recursive: true, force: true });
}

export interface HarnessParts {
  readonly adapter: ClaudeCodeRuntimeAdapter;
  readonly bus: NormalizedRuntimeEventBus;
  readonly ledger: LocalBudgetLedger;
  readonly checkpoints: LocalAttemptCheckpoints;
  readonly vault: LocalWindowsDpapiSecretsVault;
  readonly secret: string;
}

export function createHarness(
  layout: TempLayout,
  options: {
    readonly secret?: string | null;
    readonly extraEnv?: Record<string, string>;
    readonly overlay?: Record<string, string>;
    readonly rates?: readonly MicroUsdRateCard[];
    readonly adapter?: Partial<ClaudeCodeRuntimeAdapterOptions>;
  } = {},
): HarnessParts {
  const secret = options.secret === undefined ? consoleKey() : options.secret;
  const vault = new LocalWindowsDpapiSecretsVault(secret === null ? new Map() : new Map([["secret-1", secret]]));
  const connections = new LocalApiConnectionManager(vault, new Map([["conn-1", "secret-1"]]));
  const bus = new NormalizedRuntimeEventBus();
  const ledger = new LocalBudgetLedger();
  const checkpoints = new LocalAttemptCheckpoints();
  const adapter = new ClaudeCodeRuntimeAdapter({
    command: process.execPath,
    commandPrefix: [fakeClaudePath],
    connections,
    vault,
    bus,
    ledger,
    checkpoints,
    prices: new LocalPriceTable(options.rates ?? []),
    hostEnv: hostEnv(options.extraEnv),
    homeDir: layout.home,
    defaultConnectionId: "conn-1",
    authorizedEnvOverlay: {
      EF_FAKE_CLAUDE_RECEIPT: layout.receiptPath,
      EF_FAKE_CLAUDE_DECISIONS: layout.decisionsPath,
      EF_FAKE_CLAUDE_MESSAGES: layout.messagesPath,
      ...(options.overlay ?? {}),
    },
    ...options.adapter,
  });
  return { adapter, bus, ledger, checkpoints, vault, secret: secret ?? "" };
}

export function spec(layout: TempLayout, patch: Partial<ClaudeSessionSpec> = {}): ClaudeSessionSpec {
  return {
    attemptId: "attempt-1",
    connectionId: "conn-1",
    worktreeRoot: layout.root,
    writeScope: ["src/app.ts", "src/api/orders.ts"],
    budgetMicroUsd: 500_000n,
    modelId: "claude-sonnet",
    ...patch,
  };
}

export function readReceipt(layout: TempLayout): { argv: string[]; env: Record<string, string>; cwd: string } {
  return JSON.parse(fs.readFileSync(layout.receiptPath, "utf8")) as {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
}

export async function waitForEvent(
  bus: NormalizedRuntimeEventBus,
  sessionId: string,
  type: NormalizedRuntimeEvent["type"],
): Promise<NormalizedRuntimeEvent> {
  const started = Date.now();
  for (;;) {
    const found = bus.historyOf(sessionId).find((event) => event.type === type);
    if (found) return found;
    if (Date.now() - started > 4_000) throw new Error(`timed out waiting for ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}
