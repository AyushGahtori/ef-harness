import { describe, expect, it } from "vitest";
import {
  GIB,
  InMemoryVramTelemetry,
  InMemoryWhisperPriority,
  JUNIOR_CONTEXT_FLOOR,
  LocalModelCapabilityProber,
  LocalOnlyOfflineMode,
  LocalVramSlotManager,
  PROBE_NONCE,
  PROBE_TOOL_NAME,
  assertExplicitNumCtx,
  buildOllamaChatBody,
  chooseExplicitNumCtx,
  contextTooSmallMessage,
  estimateRequiredVramBytes,
  localTurnReceipt,
  toLocalModelCapabilities,
  type DiscoveredLocalModel,
} from "../../src/openrouter-local/index.js";
import { json, listen, readBody } from "./mock-loopback.js";

function model(overrides: Partial<DiscoveredLocalModel> & Pick<DiscoveredLocalModel, "modelId" | "digest">): DiscoveredLocalModel {
  return {
    server: "ollama",
    family: "qwen2",
    parameterSize: "14B",
    quantization: "Q4_K_M",
    configuredNumCtx: 32768,
    architectureContext: 32768,
    modelBytes: 4 * GIB,
    vramBytes: null,
    loadedInVram: false,
    baseUrl: "http://127.0.0.1:9",
    ...overrides,
  };
}

function capableBody() {
  return {
    message: {
      content: `{"status":"ok","nonce":"${PROBE_NONCE}"}`,
      tool_calls: [{ function: { name: PROBE_TOOL_NAME, arguments: { nonce: PROBE_NONCE } } }],
    },
    eval_count: 20,
    eval_duration: 1_000_000_000,
  };
}

describe("LocalModelCapabilityProber", () => {
  it("disqualifies a 4k model and qualifies a tool-calling coder with tok/s", async () => {
    let calls = 0;
    let numCtx: number | undefined;
    const server = await listen(async (request, response) => {
      calls += 1;
      const body = JSON.parse(await readBody(request)) as { options?: { num_ctx?: number }; tools?: { function: { name: string } }[] };
      numCtx = body.options?.num_ctx;
      expect(body.tools?.[0]?.function.name).toBe(PROBE_TOOL_NAME);
      json(response, 200, capableBody());
    });
    const tiny = model({
      modelId: "llama3.2:3b",
      digest: "sha256:llama-fixture",
      parameterSize: "3B",
      configuredNumCtx: 4096,
      architectureContext: 131072,
      baseUrl: server.origin,
    });
    const coder = model({
      modelId: "qwen2.5-coder:14b",
      digest: "sha256:qwen-fixture",
      baseUrl: server.origin,
    });
    const prober = new LocalModelCapabilityProber({
      vramBudgetBytes: 24 * GIB,
      briefTokens: 20_000,
    });
    try {
      const weak = await prober.probe(tiny);
      expect(weak.role).toBe("chat_or_summary_only");
      expect(weak.supportsTools).toBe(false);
      expect(weak.supportsStructuredJson).toBe(false);
      expect(weak.contextWarning).toBe(contextTooSmallMessage(4096));
      expect(weak.contextWarning).toBe("Context 4k too small for coding tasks (needs >= 16k)");
      expect(calls).toBe(0);

      const strong = await prober.probe(coder);
      expect(strong.role).toBe("coding_worker");
      expect(strong.supportsTools).toBe(true);
      expect(strong.supportsStructuredJson).toBe(true);
      expect(strong.contextTokens).toBe(32768);
      expect(strong.tokensPerSecond).toBe(20);
      expect(strong.numCtxPassed).toBe(32_768);
      expect(numCtx).toBe(32_768);
      expect(calls).toBe(1);

      const again = await prober.probe(coder);
      expect(again.cached).toBe(true);
      expect(again.tokensPerSecond).toBe(20);
      expect(calls).toBe(1);

      const chatOnly = model({
        modelId: "llama3.2:3b",
        digest: "sha256:chat-only",
        configuredNumCtx: 16384,
        baseUrl: server.origin,
      });
      calls = 0;
      const chatServer = await listen((_request, response) => {
        calls += 1;
        json(response, 200, { message: { content: "hello", tool_calls: [] }, eval_count: 4, eval_duration: 500_000_000 });
      });
      try {
        const chat = await new LocalModelCapabilityProber().probe({ ...chatOnly, baseUrl: chatServer.origin });
        expect(chat.role).toBe("chat_or_summary_only");
        expect(chat.supportsTools).toBe(false);
        expect(chat.contextWarning).toBeNull();
        expect(calls).toBe(1);
      } finally {
        await chatServer.close();
      }

      const update = toLocalModelCapabilities({
        source: "ollama",
        connectionId: "ollama-local",
        familyByModel: { "llama3.2:3b": "llama", "qwen2.5-coder:14b": "qwen2" },
        probes: [weak, strong],
      });
      const small = update.models.find((entry) => entry.modelId === "llama3.2:3b");
      const large = update.models.find((entry) => entry.modelId === "qwen2.5-coder:14b");
      expect(small?.supportsTools).toBe(false);
      expect(small?.supportsStructuredJson).toBe(false);
      expect(small?.contextWindow).toBe(4096);
      expect(small?.spendKind).toBe("local");
      expect(small?.inputMicroUsdPer1M).toBe(0n);
      expect(large?.supportsTools).toBe(true);
      expect(large?.tier).toBe("senior");
      expect(large?.contextWindow).toBeGreaterThanOrEqual(JUNIOR_CONTEXT_FLOOR);
    } finally {
      await server.close();
    }
  });
});

describe("LocalVramSlotManager", () => {
  const budget = 12 * GIB;
  const request = {
    modelBytes: 6 * GIB,
    kvCacheBytes: 1 * GIB,
    briefTokens: 20_000,
  };

  function manager(parallel: number, whisper = new InMemoryWhisperPriority()) {
    return {
      whisper,
      slots: new LocalVramSlotManager({
        telemetry: new InMemoryVramTelemetry({
          gpuAvailable: true,
          budgetBytes: budget,
          currentUsageBytes: 0,
          availableForReservationBytes: budget,
          sharedVramBudgetBytes: null,
          metricUnavailable: false,
        }),
        whisper,
        ollamaNumParallel: parallel,
      }),
    };
  }

  it("caps distinct models at one slot on a 12 GB GPU and batches the same weights", async () => {
    const { slots } = manager(1);
    const first = await slots.acquire({ id: "a", modelId: "qwen2.5-coder:14b", ...request });
    const second = await slots.acquire({ id: "b", modelId: "deepseek-r1:14b", ...request });
    const same = await slots.acquire({ id: "a2", modelId: "qwen2.5-coder:14b", ...request });
    expect(first.status).toBe("granted");
    expect(second).toMatchObject({ status: "deferred", reason: "distinct_model_cap" });
    expect(same).toMatchObject({ status: "deferred", reason: "same_model_batched" });
    expect(estimateRequiredVramBytes(1000, 250)).toBe(1500);
  });

  it("allows a second slot only for loaded weights when parallel and headroom allow it", async () => {
    const { slots } = manager(4);
    const first = await slots.acquire({ id: "a", modelId: "qwen2.5-coder:14b", ...request });
    const second = await slots.acquire({ id: "a2", modelId: "qwen2.5-coder:14b", ...request });
    expect(first).toMatchObject({ status: "granted", parallelSlot: 1 });
    expect(second).toMatchObject({ status: "granted", parallelSlot: 2 });
  });

  it("yields the next dispatch when dictation takes the GPU", async () => {
    const { slots, whisper } = manager(1);
    slots.onDictationHotkey();
    const paused = await slots.acquire({ id: "next", modelId: "qwen2.5-coder:14b", ...request });
    expect(paused).toMatchObject({ status: "deferred", reason: "whisper_priority" });
    expect(whisper.queued.map((item) => item.modelId)).toEqual(["qwen2.5-coder:14b"]);
    expect(whisper.dictationActive).toBe(true);
    slots.onDictationFinished();
    const resumed = await slots.acquire({ id: "next", modelId: "qwen2.5-coder:14b", ...request });
    expect(resumed.status).toBe("granted");
  });

  it("passes an explicit 16384 or 32768 num_ctx and records a zero-dollar local receipt", () => {
    expect(
      chooseExplicitNumCtx({
        briefTokens: 20_000,
        budgetBytes: 12 * GIB,
        modelBytes: 10 * GIB,
        baselineUsageBytes: 0,
      }),
    ).toBe(16_384);
    expect(
      chooseExplicitNumCtx({
        briefTokens: 20_000,
        budgetBytes: 24 * GIB,
        modelBytes: 4 * GIB,
        baselineUsageBytes: 0,
      }),
    ).toBe(32_768);
    expect(() => assertExplicitNumCtx(2048)).toThrow(/16384 or 32768/);
    const body = buildOllamaChatBody({ model: "qwen2.5-coder:14b", content: "brief", numCtx: 16_384 });
    expect(body.options.num_ctx).toBe(16_384);
    expect(JSON.stringify(body)).toContain('"num_ctx":16384');
    const receipt = localTurnReceipt({ promptTokens: 100, completionTokens: 50, wallClockMs: 2_000 });
    expect(receipt.costMicroUsd).toBe(0);
    expect(receipt.currency).toBe("local_slots");
    expect(receipt.totalTokens).toBe(150);
    expect(receipt.wallClockSeconds).toBe(2);
    expect(receipt.tokensPerSecond).toBe(75);
  });
});

describe("local-only offline mode", () => {
  it("plans a full local run with zero cloud calls when a model meets the floor", () => {
    const mode = new LocalOnlyOfflineMode();
    const plan = mode.plan([
      {
        modelId: "qwen2.5-coder:14b",
        digest: "sha256:qwen-fixture",
        server: "ollama",
        contextTokens: 32768,
        contextWarning: null,
        seniorWarning: null,
        supportsTools: true,
        supportsStructuredJson: true,
        role: "coding_worker",
        tokensPerSecond: 20,
        cached: false,
        numCtxPassed: 32768,
      },
    ]);
    expect(plan.cloudCalls).toBe(0);
    expect(mode.cloudCalls).toBe(0);
    expect(plan.phases).toEqual(["discover", "plan", "build", "verify", "run"]);
    expect(plan.workerModelId).toBe("qwen2.5-coder:14b");
    expect(plan.blockedReason).toBeNull();
    expect(() => mode.guard("https://openrouter.ai/api/v1/chat/completions")).toThrow(/127\.0\.0\.1/);
    expect(mode.cloudCalls).toBe(0);
  });

  it("stays offline and blocked when every local model is under 16k", () => {
    const mode = new LocalOnlyOfflineMode();
    const plan = mode.plan([
      {
        modelId: "llama3.2:3b",
        digest: "sha256:llama-fixture",
        server: "ollama",
        contextTokens: 4096,
        contextWarning: "Context 4k too small for coding tasks (needs >= 16k)",
        seniorWarning: null,
        supportsTools: false,
        supportsStructuredJson: false,
        role: "chat_or_summary_only",
        tokensPerSecond: 0,
        cached: false,
        numCtxPassed: null,
      },
    ]);
    expect(plan.cloudCalls).toBe(0);
    expect(plan.phases).toEqual(["discover"]);
    expect(plan.blockedReason).toBe("Context 4k too small for coding tasks (needs >= 16k)");
    expect(plan.workerModelId).toBeNull();
  });
});
