import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import { VersionedModelRoster } from "@ef-harness/planner";
import { afterEach, describe, expect, it } from "vitest";
import { LocalGlobalDbConnections, LocalWindowsDpapiSecretsVault } from "../../src/copilot-cursor-auth/index.js";
import { BrokerOpenRouterConnections } from "../../src/openrouter-local/index.js";
import {
  AllowancePacingController,
  BrokerGlobalConnectionWindowRepo,
  PacingAllowanceWindow,
  RecordingAllowanceWeightSink,
  RecordingBoardHealth,
  RecordingBudgetLedger,
  RecordingWindDown,
  applyAllowanceWeights,
} from "../../src/pacing/index.js";
import { MemoryMaterialStore } from "../memory-material.js";
import { chatGptRegistration } from "./harness.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("provider windows, weights, and DPAPI survive one global.db", () => {
  it("reopens connection_windows and k[model] weights", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-c54-pacing-"));
    dirs.push(root);
    const global = GlobalBrokerDb.open({ root });
    const repo = new BrokerGlobalConnectionWindowRepo(root, global);
    const windDown = new RecordingWindDown();
    const controller = new AllowancePacingController({
      projectId: "proj",
      repo,
      windDown,
      board: new RecordingBoardHealth(),
      ledger: new RecordingBudgetLedger(),
      weightSink: new RecordingAllowanceWeightSink(),
      preflight: {
        connectionHealthy: () => true,
        pendingConflicts: () => 0,
        pendingHolds: () => 0,
        diskFreeBytes: () => 20 * 1024 * 1024 * 1024,
      },
      now: () => 1_700_000_000_000,
      random: () => 0,
    });
    await controller.registerConnection(chatGptRegistration(1_700_000_000_000));
    const learned = await controller.observeQuotaDelta({
      connectionId: "chatgpt-plus",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 2_000,
      deltaPpm: 4_000,
      source: "rateLimits/read",
    });
    await controller.observeAuthoritativeUsage({
      connectionId: "chatgpt-plus",
      windowKind: "5h",
      usedPpm: 125_000,
      source: "rateLimits/read",
    });
    const window = new PacingAllowanceWindow(repo);
    expect(window.remainingPpm("chatgpt-plus")).toBe(800_000 - 125_000);
    global.close();

    const reopened = GlobalBrokerDb.open({ root });
    try {
      const windows = reopened.writer.all(
        "SELECT window_kind, estimated_units FROM connection_windows WHERE connection = ?",
        ["chatgpt-plus"],
      );
      const windowRow = windows[0] as { window_kind?: unknown; estimated_units?: unknown };
      expect(windowRow.window_kind).toBe("5h");
      expect(Number(windowRow.estimated_units)).toBe(125_000);
      const weights = reopened.writer.all(
        "SELECT model_id, snapshot_json FROM model_weights WHERE connection_id = ?",
        ["chatgpt-plus"],
      );
      expect(weights).toHaveLength(1);
      const snapshot = weights[0] as { model_id: string; snapshot_json: string };
      expect(snapshot.model_id).toBe("gpt-5.x-mini");
      const parsed = JSON.parse(snapshot.snapshot_json) as { ppmPer1k: number };
      expect(parsed.ppmPer1k).toBe(learned.ppmPer1k);
      const again = new BrokerGlobalConnectionWindowRepo(root, reopened);
      const restored = new AllowancePacingController({
        projectId: "proj",
        repo: again,
        windDown: new RecordingWindDown(),
        board: new RecordingBoardHealth(),
        ledger: new RecordingBudgetLedger(),
        weightSink: new RecordingAllowanceWeightSink(),
        preflight: {
          connectionHealthy: () => true,
          pendingConflicts: () => 0,
          pendingHolds: () => 0,
          diskFreeBytes: () => 20 * 1024 * 1024 * 1024,
        },
        now: () => 1_700_000_000_000,
        random: () => 0,
      });
      const view = await restored.weight("chatgpt-plus", "gpt-5.x-mini");
      expect(view.ppmPer1k).toBe(learned.ppmPer1k);
      expect(new PacingAllowanceWindow(again).remainingPpm("chatgpt-plus")).toBe(800_000 - 125_000);
      const roster = applyAllowanceWeights(
        VersionedModelRoster.seed([
          {
            modelId: "gpt-5.x-mini",
            family: "openai",
            provider: "openai",
            connectionId: "chatgpt-plus",
            tier: "Mid",
            contextWindow: 200_000,
            supportsTools: true,
            supportsStructuredJson: true,
            supportsVision: true,
            spendKind: "subscription",
            inputMicroUsdPer1M: 0n,
            outputMicroUsdPer1M: 0n,
            cachedInputMicroUsdPer1M: 0n,
            allowancePpmPer1M: 0n,
            defaultPassPriors: { trivial: 0.9, standard: 0.8, complex: 0.5, critical: 0.2 },
            deprecatedAfter: null,
            pinned: false,
          },
        ]),
        await restored.learnedFeeds("chatgpt-plus"),
      );
      expect(roster.entries[0]?.allowancePpmPer1M).toBeGreaterThan(0n);
      expect(roster.source).toBe("subscription-weights");
    } finally {
      reopened.close();
    }
  });

  it("stores a Copilot token only in WindowsDpapiSecretsVault and keeps routes side by side", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-c54-auth-"));
    dirs.push(root);
    const material = new MemoryMaterialStore();
    const token = "fixture-copilot-user-token-alpha";
    const vaultDir = path.join(root, "vault");
    const brokerRoot = path.join(root, "broker");
    const vault = new LocalWindowsDpapiSecretsVault(vaultDir, { materialStore: material });
    const global = GlobalBrokerDb.open({ root: brokerRoot });
    const copilot = new LocalGlobalDbConnections(brokerRoot, global);
    const openrouter = new BrokerOpenRouterConnections(brokerRoot, global);
    const secretId = "vault:gitHubToken:copilot-octocat:1";
    const written = await vault.writeSecret({
      secretId,
      name: "gitHubToken",
      plaintext: token,
      providerHint: "github_copilot",
    });
    copilot.upsert({
      id: "copilot-octocat",
      provider: "github_copilot",
      route: "copilot_sdk",
      plan: "individual",
      vaultRef: written.secretId,
      currency: "allowance:copilot-octocat",
      scale: 1,
      enabled: 1,
      createdAt: 1,
      metadata: {
        kind: "copilot",
        authMode: "github_device_flow",
        billingMode: "copilot_subscription",
        accountLogin: "octocat",
        allowedModels: ["included-fast"],
        orgPolicyMessage: null,
        maskedPreview: "••••lpha",
        verifiedAt: 1,
        status: "active",
        overageApprovedForReset: null,
      },
    });
    await openrouter.insert({
      id: "ollama-local",
      provider: "ollama",
      route: "local",
      plan: null,
      vaultRef: null,
      currency: "local_slots",
      scale: 1,
      enabled: true,
      createdAt: 2,
    });
    expect(vault.exportAtRest().includes(token)).toBe(false);
    expect(copilot.exportSnapshot().includes(token)).toBe(false);
    expect(copilot.exportSnapshot().includes("metadata_json")).toBe(false);
    expect(global.listConnections().map((row) => row.route).sort()).toEqual(["copilot_sdk", "local"]);
    await vault.close();
    global.close();

    const again = new LocalWindowsDpapiSecretsVault(vaultDir, { materialStore: material });
    const broker = GlobalBrokerDb.open({ root: brokerRoot });
    try {
      expect(await again.readSecret(secretId)).toBe(token);
      expect(broker.getConnection("copilot-octocat")?.route).toBe("copilot_sdk");
      expect(broker.getConnection("ollama-local")?.route).toBe("local");
      const columns = broker.writer.all("PRAGMA table_info(connections)");
      const names = columns.map((row) => String((row as { name?: unknown }).name));
      expect(names.includes("metadata_json")).toBe(false);
    } finally {
      await again.close();
      broker.close();
    }
  });
});
