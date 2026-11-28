import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  anthropicConsolePrefix,
  anthropicOauthPrefix,
  anthropicPreviewStem,
  ApiConnectionManager,
  ApiKeyOnboardingError,
  CLAUDE_SUBSCRIPTION_REJECTION,
  geminiPrefix,
  LocalBudgetLedger,
  LocalDpapiSecretsVault,
  LocalGlobalDbConnections,
  OFFLINE_SAVE_MESSAGE,
  openAiProjectPrefix,
  openAiStandardPrefix,
  ZeroTokenApiKeyValidator,
  type ApiConnectionRecord,
  type ApiCostLedgerEntry,
  type ModelListRequest,
  type ModelListResponse,
  type ModelListTransport,
  type ValidationLogger,
} from "../../src/api-keys/index.js";

const BODY = "BODY136UNIQUEORANGE";

function key(prefix: string, tail = "9x2a"): string {
  return `${prefix}${BODY}${tail}`;
}

class MemoryLog implements ValidationLogger {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}

class RecordingTransport implements ModelListTransport {
  readonly calls: ModelListRequest[] = [];
  constructor(private readonly respond: (input: ModelListRequest) => ModelListResponse | Promise<ModelListResponse>) {}
  async request(input: ModelListRequest): Promise<ModelListResponse> {
    this.calls.push(input);
    if (input.method !== "GET" || !new URL(input.url).pathname.endsWith("/models")) {
      throw new Error("paid or non-model endpoint");
    }
    return this.respond(input);
  }
}

interface Harness {
  readonly manager: ApiConnectionManager;
  readonly vault: LocalDpapiSecretsVault;
  readonly connections: LocalGlobalDbConnections;
  readonly ledger: LocalBudgetLedger;
  readonly logger: MemoryLog;
  readonly transport: RecordingTransport;
  cleanup(): void;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }
});

function harness(respond: (input: ModelListRequest) => ModelListResponse): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), "ef136-"));
  const vault = new LocalDpapiSecretsVault(path.join(dir, "vault"));
  const connections = new LocalGlobalDbConnections(path.join(dir, "db"));
  const ledger = new LocalBudgetLedger();
  const logger = new MemoryLog();
  const transport = new RecordingTransport(respond);
  const manager = new ApiConnectionManager({
    vault,
    connections,
    ledger,
    validator: new ZeroTokenApiKeyValidator({ transport, logger }),
    now: () => 1_700_000_000_000,
    createId: (() => {
      let n = 0;
      return () => `conn-${++n}`;
    })(),
  });
  const cleanup = (): void => {
    connections.close();
    rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return { manager, vault, connections, ledger, logger, transport, cleanup };
}

function models(ids: readonly string[]): ModelListResponse {
  return { status: 200, bodyText: JSON.stringify({ data: ids.map((id) => ({ id })) }) };
}

function receipt(connectionId: string): ApiCostLedgerEntry {
  return {
    entryId: `cost-${connectionId}`,
    connectionId,
    modelId: "gpt-5.1",
    priceTableVersion: "2026.11",
    pricingSource: "estimated",
    pricingStatus: "estimated",
    estimated: true,
    label: "Estimated from published rates (price table v2026.11)",
    costMicroUsd: 10n,
    inputTokens: 1n,
    outputTokens: 1n,
    cachedReadTokens: 0n,
    cacheWriteTokens: 0n,
    reasoningTokens: 0n,
  };
}

function publicText(records: readonly ApiConnectionRecord[]): string {
  return JSON.stringify(records, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
}

function assertSecretAbsent(parts: readonly string[], secret: string): void {
  const blob = parts.join("\n");
  expect(blob.includes(secret)).toBe(false);
  expect(blob.includes(BODY)).toBe(false);
}

describe("ApiConnectionManager", () => {
  it("stores multiple labeled accounts with a masked preview and zero plaintext at rest", async () => {
    const openaiKey = key(openAiProjectPrefix);
    const anthropicKey = key(anthropicConsolePrefix);
    const env = harness(() => models(["gpt-5.1", "claude-sonnet"]));
    const personal = await env.manager.savePastedKey({
      rawKey: `  "${openaiKey}\n"`,
      label: "Personal OpenAI",
      userMonthlyCapMicroUsd: 5_000_000n,
    });
    const work = await env.manager.savePastedKey({ rawKey: anthropicKey, label: "Work Anthropic" });
    expect(personal.outcome).toBe("saved");
    expect(work.outcome).toBe("saved");
    if (personal.outcome !== "saved" || work.outcome !== "saved") return;
    expect(personal.connection).toMatchObject({
      connectionId: "conn-1",
      provider: "openai",
      label: "Personal OpenAI",
      authMode: "api_key",
      status: "verified",
      verifiedAt: 1_700_000_000_000,
      userMonthlyCapMicroUsd: 5_000_000n,
      maskedKeyPreview: `${openAiProjectPrefix}...9x2a`,
      discoveredModels: ["claude-sonnet", "gpt-5.1"],
      enabled: true,
    });
    expect(work.connection.maskedKeyPreview).toBe(`${anthropicPreviewStem}...9x2a`);
    expect(work.connection.provider).toBe("anthropic");
    expect(env.vault.getPlaintext(personal.connection.vaultRef)).toBe(openaiKey);
    expect(env.manager.list().map((row) => row.label)).toEqual(["Personal OpenAI", "Work Anthropic"]);
    assertSecretAbsent(
      [
        env.connections.metadataText(),
        Buffer.from(env.connections.readAtRestBytes()).toString("latin1"),
        Buffer.from(env.vault.readAtRestBytes()).toString("latin1"),
        env.logger.lines.join("\n"),
        publicText(env.manager.list()),
      ],
      openaiKey,
    );
    expect(env.transport.calls.every((call) => call.method === "GET" && !call.url.includes("key=") && !call.url.includes(BODY))).toBe(true);
  });

  it("rejects a subscription token without storing it or calling the network", async () => {
    const env = harness(() => {
      throw new Error("network should not be called");
    });
    const result = await env.manager.savePastedKey({
      rawKey: key(anthropicOauthPrefix),
      label: "Rejected",
      providerOverride: "anthropic",
    });
    expect(result).toEqual({ outcome: "rejected", message: CLAUDE_SUBSCRIPTION_REJECTION });
    expect(env.transport.calls).toHaveLength(0);
    expect(env.manager.list()).toEqual([]);
    expect(Buffer.from(env.vault.readAtRestBytes()).toString("utf8").includes(BODY)).toBe(false);
  });

  it("does not store a 401 and does store billing guidance for quota and credit failures", async () => {
    const invalid = harness(() => ({ status: 401, bodyText: "{\"error\":{\"code\":\"invalid_api_key\"}}" }));
    const rejected = await invalid.manager.savePastedKey({ rawKey: key(openAiStandardPrefix), label: "Bad" });
    expect(rejected.outcome).toBe("invalid_key");
    expect(invalid.manager.list()).toEqual([]);
    expect(invalid.vault.readAtRestBytes().toString().includes(BODY)).toBe(false);

    const quota = harness(() => ({ status: 429, bodyText: "{\"error\":{\"code\":\"insufficient_quota\"}}" }));
    const saved = await quota.manager.savePastedKey({ rawKey: key(openAiStandardPrefix, "1c3d"), label: "Needs billing" });
    expect(saved).toMatchObject({
      outcome: "saved",
      message: expect.stringContaining("billing or credit setup") as unknown,
    });
    if (saved.outcome !== "saved") return;
    expect(saved.connection.status).toBe("insufficient_quota");
    expect(saved.connection.verifiedAt).toBeNull();
  });

  it("saves an offline key unverified instead of dropping the form or marking it verified", async () => {
    const env = harness(() => {
      throw new Error("offline");
    });
    const explicit = await env.manager.savePastedKey({
      rawKey: key(geminiPrefix),
      label: "Gemini offline",
      offline: true,
    });
    expect(explicit).toMatchObject({
      outcome: "saved",
      message: OFFLINE_SAVE_MESSAGE,
    });
    if (explicit.outcome !== "saved") return;
    expect(explicit.connection.status).toBe("unverified_offline");
    expect(explicit.connection.verifiedAt).toBeNull();
    expect(env.transport.calls).toHaveLength(0);

    const dropped = await env.manager.savePastedKey({ rawKey: key(geminiPrefix, "aa11"), label: "Gemini later" });
    expect(dropped).toMatchObject({ outcome: "saved", message: OFFLINE_SAVE_MESSAGE });
    if (dropped.outcome !== "saved") return;
    expect(dropped.connection.status).toBe("unverified_offline");
    expect(dropped.connection.verifiedAt).toBeNull();
  });

  it("rotates in place, disables without deleting history, and purges the vault on delete", async () => {
    const original = key(openAiProjectPrefix, "9x2a");
    const rotatedKey = key(openAiProjectPrefix, "1c3d");
    const env = harness(() => models(["gpt-5.1"]));
    const saved = await env.manager.savePastedKey({ rawKey: original, label: "Personal OpenAI" });
    if (saved.outcome !== "saved") throw new Error("expected save");
    env.ledger.record(receipt(saved.connection.connectionId));
    const rotated = await env.manager.rotateKey(saved.connection.connectionId, { rawKey: rotatedKey });
    expect(rotated).toMatchObject({ outcome: "saved" });
    if (rotated.outcome !== "saved") return;
    expect(rotated.connection.connectionId).toBe(saved.connection.connectionId);
    expect(rotated.connection.maskedKeyPreview.endsWith("1c3d")).toBe(true);
    expect(env.vault.getPlaintext(rotated.connection.vaultRef)).toBe(rotatedKey);
    expect(env.manager.usageReceipts(saved.connection.connectionId)).toHaveLength(1);

    const oat = await env.manager.rotateKey(saved.connection.connectionId, { rawKey: key(anthropicOauthPrefix) });
    expect(oat.outcome).toBe("rejected");
    expect(env.vault.getPlaintext(rotated.connection.vaultRef)).toBe(rotatedKey);

    const disabled = env.manager.disable(saved.connection.connectionId);
    expect(disabled).toMatchObject({ enabled: false, status: "disabled" });
    expect(env.vault.has(disabled.vaultRef)).toBe(true);
    expect(env.manager.usageReceipts(saved.connection.connectionId)).toHaveLength(1);
    expect(env.manager.get(saved.connection.connectionId)?.discoveredModels).toEqual(["gpt-5.1"]);
    expect(env.manager.enable(saved.connection.connectionId).status).toBe("verified");

    env.manager.delete(saved.connection.connectionId);
    expect(env.vault.has(saved.connection.vaultRef)).toBe(false);
    expect(env.manager.get(saved.connection.connectionId)).toBeUndefined();
    expect(env.manager.usageReceipts(saved.connection.connectionId)).toHaveLength(1);
    expect(Buffer.from(env.vault.readAtRestBytes()).toString("latin1").includes(BODY)).toBe(false);
    expect(env.connections.metadataText().includes(BODY)).toBe(false);
  });

  it("requires HTTPS for custom endpoints except loopback and prompts on an unknown prefix", async () => {
    const env = harness((input) => models([input.url]));
    const unknown = `corp-${BODY}-token`;
    const needs = await env.manager.savePastedKey({ rawKey: unknown, label: "Unknown" });
    expect(needs.outcome).toBe("needs_selection");
    expect(env.transport.calls).toHaveLength(0);

    const http = await env.manager.savePastedKey({
      rawKey: unknown,
      label: "LAN",
      providerOverride: "custom",
      customBaseUrl: "http://10.0.0.8/v1",
    });
    expect(http.outcome).toBe("rejected");
    expect(env.transport.calls).toHaveLength(0);

    const loopback = await env.manager.savePastedKey({
      rawKey: unknown,
      label: "vLLM",
      providerOverride: "custom",
      customBaseUrl: "http://127.0.0.1:8000/v1",
      customRates: {
        inputMicroUsdPer1M: 0n,
        outputMicroUsdPer1M: 0n,
        cachedInputReadMicroUsdPer1M: 0n,
        cacheWriteMicroUsdPer1M: 0n,
        reasoningTokenMicroUsdPer1M: 0n,
      },
    });
    expect(loopback).toMatchObject({ outcome: "saved" });
    if (loopback.outcome !== "saved") return;
    expect(loopback.connection.provider).toBe("custom");
    expect(loopback.connection.authMode).toBe("api_key");
    expect(env.transport.calls[0]?.url).toBe("http://127.0.0.1:8000/v1/models");
    expect(env.transport.calls[0]?.url.includes("key=")).toBe(false);
    expect(env.transport.calls[0]?.url.includes(unknown)).toBe(false);

    const conflict = await env.manager.savePastedKey({
      rawKey: key(openAiStandardPrefix),
      label: "Wrong override",
      providerOverride: "anthropic",
    });
    expect(conflict.outcome).toBe("rejected");
  });

  it("keeps a verified connection unchanged when a retest cannot reach the network", async () => {
    let online = true;
    const env = harness(() => {
      if (!online) throw new Error(`proxy blocked Authorization: Bearer ${key(geminiPrefix)}`);
      return { status: 200, bodyText: JSON.stringify({ models: [{ name: "models/gemini-2.5-pro" }] }) };
    });
    const saved = await env.manager.savePastedKey({ rawKey: key(geminiPrefix), label: "Gemini" });
    if (saved.outcome !== "saved") throw new Error("expected save");
    online = false;
    const retest = await env.manager.retest(saved.connection.connectionId);
    expect(retest.validation).toMatchObject({ ok: false, failureClass: "network_or_proxy_blocked" });
    expect(retest.connection.status).toBe("verified");
    expect(env.logger.lines.join("\n").includes(BODY)).toBe(false);
    expect(() => env.manager.disable("missing")).toThrow(ApiKeyOnboardingError);
  });
});
