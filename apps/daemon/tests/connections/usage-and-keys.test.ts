import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalBrokerDb, TelemetryDb, openProjectStateDb } from "@ef-harness/db";
import { ANTHROPIC_COMPLIANCE_MESSAGE } from "@ef-harness/providers";
import {
  insertUsageReceipts,
  loadUsageLedger,
  saveConnectionKey,
  type ConnectionKeyContext,
} from "../../src/connections/usage-and-keys.js";
import type { UsageReceiptInput } from "@ef-harness/shared-contracts";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function consoleKey(): string {
  return `${["sk", "-ant", "-api"].join("")}sample8841`;
}

function subscriptionToken(): string {
  return `${["sk", "-ant", "-oat"].join("")}01sample8841`;
}

function receipt(secret: string): UsageReceiptInput {
  return {
    timestamp: Date.now(),
    project: "Harbor",
    feature: "billing",
    taskId: "task-50",
    role: "senior",
    connection: "anthropic",
    model: "claude-test",
    phase: "coding",
    currency: "micro_usd",
    inputTokens: 8,
    cachedTokens: 0,
    outputTokens: 2,
    reasoningTokens: 0,
    costMicroUsd: 10,
    windowDeltaPpm: 0,
    premiumRequests: 0,
    tokPerSec: 0,
    gpuMs: 0,
    pricingSource: "estimated",
    priceTableVersion: "7",
    provider: "anthropic",
    kModel: "",
    windowKind: "5h",
    allowanceUsedPpm: 0,
    resetAt: 0,
    rawSecret: secret,
    vaultRef: "vault-ref-sample",
  };
}

describe("connections IPC", () => {
  it("rejects a subscription oauth paste before opening the vault", async () => {
    const rejected = await saveConnectionKey({} as ConnectionKeyContext, {
      projectId: "harbor",
      label: "Anthropic",
      rawKey: subscriptionToken(),
      provider: "anthropic",
    });
    expect(rejected).toEqual({ outcome: "rejected", message: ANTHROPIC_COMPLIANCE_MESSAGE });
  });

  it("uses the Windows vault for a console key", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c55-key-"));
    dirs.push(rootDir);
    const broker = GlobalBrokerDb.open({ root: path.join(rootDir, "global") });
    const project = openProjectStateDb({
      projectId: `c55-${process.pid}`,
      rootDir: path.join(rootDir, "state"),
      appVersion: "0.0.0",
    });
    closers.push(() => {
      project.close();
      broker.close();
    });
    await expect(
      saveConnectionKey(
        { broker, project, profileDir: rootDir },
        { projectId: "harbor", label: "Anthropic", rawKey: consoleKey(), provider: "anthropic" },
      ),
    ).rejects.toThrow(/Windows DPAPI/);
  });

  it("stores public usage rows in telemetry.db and leaves the secret out", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c55-usage-"));
    dirs.push(rootDir);
    const telemetry = TelemetryDb.open({ filePath: path.join(rootDir, "telemetry.db") });
    closers.push(() => {
      telemetry.close();
    });
    const secret = "do-not-leak-sample";
    const filePath = path.join(rootDir, "telemetry.db");
    insertUsageReceipts(telemetry, [receipt(secret)]);
    telemetry.close();
    const reopened = TelemetryDb.open({ filePath });
    closers.push(() => reopened.close());
    const ledger = loadUsageLedger(reopened);
    expect(ledger.count({ currency: "micro_usd", search: "" })).toBe(1);
    expect(ledger.persistedDataIncludes(secret)).toBe(false);
    expect(ledger.persistedDataIncludes("vault-ref-sample")).toBe(false);
    expect(ledger.apiAggregates().some((row) => row.key === "Harbor" && row.microUsd === 10)).toBe(true);
    const stored = reopened.readPage({ limit: 20 });
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(stored)).toContain("usage-receipt@1");
  });
});
