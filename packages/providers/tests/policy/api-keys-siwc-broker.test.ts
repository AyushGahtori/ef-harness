import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_KEY_AUTH_MODE,
  LocalDpapiSecretsVault,
  LocalGlobalDbConnections,
  MICRO_USD_SCALE,
  type ApiConnectionRecord,
} from "../../src/api-keys/index.js";
import { SqliteSiwcInstallationStore } from "../../src/siwc/index.js";
import { MemoryMaterialStore } from "../memory-material.js";
import { createEngine } from "./fixtures.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("shared global.db for api keys and Sign in with ChatGPT", () => {
  it("stores api_key and siwc connections side by side and reopens them", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-c53-broker-"));
    dirs.push(root);
    const global = GlobalBrokerDb.open({ root });
    const api = new LocalGlobalDbConnections(root, global);
    const siwc = new SqliteSiwcInstallationStore(path.join(root, "global.db"), global);
    api.insert(apiRecord());
    siwc.ensureHostId();
    siwc.saveConnected(
      {
        id: "chatgpt-personal",
        label: "ChatGPT (personal)",
        plan: "plus",
        clientId: "client-1",
        subject: "subject-1",
        email: null,
        scopes: ["openid"],
        expiresAtMs: 5_000,
        earliestRefreshAtMs: null,
      },
      1_700,
    );
    expect(global.listConnections().map((row) => row.route).sort()).toEqual(["api_key", "siwc"]);
    global.close();

    const reopened = GlobalBrokerDb.open({ root });
    try {
      const routes = reopened.listConnections().map((row) => row.route).sort();
      expect(routes).toEqual(["api_key", "siwc"]);
      const siwcRow = reopened.getConnection("chatgpt-personal");
      expect(siwcRow?.route).toBe("siwc");
      expect(siwcRow?.currency).toBe("allowance:chatgpt-personal");
      const apiRow = reopened.getConnection("conn-1");
      expect(apiRow?.route).toBe("api_key");
      expect(apiRow?.currency).toBe("usd");
    } finally {
      reopened.close();
    }
  });

  it("round-trips a secret across WindowsDpapiSecretsVault reopen", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ef-c53-vault-"));
    dirs.push(dir);
    const material = new MemoryMaterialStore();
    const secret = "CANARY_DPAPI_REOPEN_1234";
    const first = new LocalDpapiSecretsVault(dir, { materialStore: material });
    await first.storeSecret({
      secretId: "api-key:reopen",
      plaintext: secret,
      name: "label",
      providerHint: "openai",
      envScope: "prod",
    });
    expect(Buffer.from(first.readAtRestBytes()).toString("latin1").includes(secret)).toBe(false);
    await first.close();
    const second = new LocalDpapiSecretsVault(dir, { materialStore: material });
    try {
      expect(await second.readPlaintextForKernel("api-key:reopen")).toBe(secret);
    } finally {
      await second.close();
    }
  });

  it("constructs WindowsDpapiSecretsVault without a local cipher", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ef-c53-dpapi-"));
    dirs.push(dir);
    if (process.platform !== "win32") {
      expect(() => new LocalDpapiSecretsVault(dir)).toThrow(/Windows DPAPI/);
      return;
    }
    const secret = "CANARY_DPAPI_WIN32_1234";
    const first = new LocalDpapiSecretsVault(dir);
    await first.storeSecret({
      secretId: "api-key:win32",
      plaintext: secret,
      name: "label",
      providerHint: "openai",
      envScope: "prod",
    });
    await first.close();
    const second = new LocalDpapiSecretsVault(dir);
    try {
      expect(await second.readPlaintextForKernel("api-key:win32")).toBe(secret);
    } finally {
      await second.close();
    }
  });

  it("publishes price, siwc, and copilot slices from the signed policy", () => {
    const { engine, close } = createEngine();
    engine.loadStartup();
    try {
      expect(engine.currentPriceTable()?.models.length).toBeGreaterThan(0);
      expect(engine.readSiwcPolicy().routeRevoked).toBe(false);
      expect(engine.readSiwcPolicy().requestedScopes).toContain("chatgpt.tokens.use.direct");
      expect(engine.copilotPremiumMultipliers().some((row) => row.multiplier === 3)).toBe(true);
      expect(engine.plannerRoster()?.version).toBeGreaterThan(0);
    } finally {
      close();
    }
  });
});

function apiRecord(): ApiConnectionRecord {
  return {
    connectionId: "conn-1",
    provider: "openai",
    label: "Personal OpenAI",
    authMode: API_KEY_AUTH_MODE,
    maskedKeyPreview: "proj-...1234",
    discoveredModels: ["gpt-5.1"],
    userMonthlyCapMicroUsd: null,
    verifiedAt: 1_700,
    status: "verified",
    resumeStatus: null,
    enabled: true,
    keyFamily: "openai_project",
    customBaseUrl: null,
    customRates: null,
    vaultRef: "api-key:conn-1",
    createdAt: 1_700,
    currency: "usd",
    scale: MICRO_USD_SCALE,
  };
}
