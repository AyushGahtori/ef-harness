import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  InMemoryGlobalConnections,
  LocalModelAutoDiscoverer,
  NO_LOCAL_SERVERS_MESSAGE,
  OLLAMA_STOPPED_MESSAGE,
  architectureContextFromInfo,
  assertDiscoveryUrl,
  configuredNumCtxFromParameters,
  diagnosisForStoppedServer,
  rememberDiscoveredServers,
} from "../../src/openrouter-local/index.js";
import { closedPort, json, listen, readBody } from "./mock-loopback.js";

describe("LocalModelAutoDiscoverer", () => {
  it("reads Ollama tags, show, and ps plus LM Studio model lists", async () => {
    const ollama = await listen(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/tags") {
        json(response, 200, {
          models: [
            {
              name: "qwen2.5-coder:14b",
              size: 9_000_000_000,
              digest: "sha256:qwen-fixture",
              details: { parameter_size: "14B", quantization_level: "Q4_K_M", family: "qwen2" },
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/show") {
        const body = JSON.parse(await readBody(request)) as { name?: string };
        expect(body.name).toBe("qwen2.5-coder:14b");
        json(response, 200, {
          parameters: "num_ctx                        32768\n",
          details: { parameter_size: "14B", quantization_level: "Q4_K_M", family: "qwen2" },
          model_info: { "qwen2.context_length": 32768 },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ps") {
        json(response, 200, { models: [{ name: "qwen2.5-coder:14b", size_vram: 8_000_000_000 }] });
        return;
      }
      json(response, 404, {});
    });
    const lm = await listen((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/v1/models") {
        json(response, 200, { data: [{ id: "local-coder", object: "model" }] });
        return;
      }
      if (url.pathname === "/api/v0/models") {
        json(response, 200, {
          data: [
            {
              id: "local-coder",
              max_context_length: 16384,
              quantization: "Q8_0",
              state: "loaded",
              architecture: "qwen2",
              params: "7B",
            },
          ],
        });
        return;
      }
      json(response, 404, {});
    });
    try {
      const report = await new LocalModelAutoDiscoverer({
        ollamaOrigin: ollama.origin,
        lmStudioOrigin: lm.origin,
      }).discover();
      expect(report.cloudCalls).toBe(0);
      expect(report.ollama).toEqual({ status: "ok", modelCount: 1 });
      expect(report.lmStudio).toEqual({ status: "ok", modelCount: 1 });
      const qwen = report.models.find((model) => model.modelId === "qwen2.5-coder:14b");
      expect(qwen?.parameterSize).toBe("14B");
      expect(qwen?.quantization).toBe("Q4_K_M");
      expect(qwen?.configuredNumCtx).toBe(32768);
      expect(qwen?.architectureContext).toBe(32768);
      expect(qwen?.loadedInVram).toBe(true);
      expect(qwen?.vramBytes).toBe(8_000_000_000);
      const studio = report.models.find((model) => model.modelId === "local-coder");
      expect(studio?.quantization).toBe("Q8_0");
      expect(studio?.configuredNumCtx).toBe(16384);
      expect(studio?.parameterSize).toBe("7B");
      expect(studio?.loadedInVram).toBe(true);
      const connections = new InMemoryGlobalConnections();
      const rows = await rememberDiscoveredServers(connections, report, 10);
      expect(rows.map((row) => row.currency)).toEqual(["local_slots", "local_slots"]);
      expect(rows.every((row) => row.route === "local" && row.vaultRef === null)).toBe(true);
    } finally {
      await ollama.close();
      await lm.close();
    }
  });

  it("finishes both refused probes quickly and without console errors", async () => {
    const ollamaPort = await closedPort();
    const lmPort = await closedPort();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const started = Date.now();
      const report = await new LocalModelAutoDiscoverer({
        ollamaOrigin: `http://127.0.0.1:${ollamaPort}`,
        lmStudioOrigin: `http://127.0.0.1:${lmPort}`,
      }).discover();
      expect(Date.now() - started).toBeLessThan(300);
      expect(report.elapsedMs).toBeLessThan(300);
      expect(report.models).toEqual([]);
      expect(report.ollama).toEqual({ status: "down", refused: true });
      expect(report.lmStudio).toEqual({ status: "down", refused: true });
      expect(report.emptyMessage).toBe(NO_LOCAL_SERVERS_MESSAGE);
      expect(report.diagnoses).toEqual([]);
      expect(report.cloudCalls).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });

  it("pauses with the Ollama retry message when a configured server is refused", async () => {
    const port = await closedPort();
    const report = await new LocalModelAutoDiscoverer({
      ollamaOrigin: `http://127.0.0.1:${port}`,
      lmStudioOrigin: `http://127.0.0.1:${await closedPort()}`,
      configured: { ollama: true },
    }).discover();
    expect(report.diagnoses).toEqual([diagnosisForStoppedServer("ollama")]);
    expect(report.diagnoses[0]?.message).toBe(OLLAMA_STOPPED_MESSAGE);
    expect(report.emptyMessage).toBeNull();
  });

  it("rejects non-loopback auto scans before any fetch", async () => {
    let called = false;
    const discoverer = new LocalModelAutoDiscoverer({
      ollamaOrigin: "http://10.0.0.8:11434",
      fetchImpl: async () => {
        called = true;
        throw new Error("fetched");
      },
    });
    await expect(discoverer.discover()).rejects.toMatchObject({ code: "loopback-required" });
    expect(called).toBe(false);
    expect(() => assertDiscoveryUrl("http://192.168.1.20:11434", false)).toThrow(/127\.0\.0\.1/);
    expect(assertDiscoveryUrl("http://192.168.1.20:11434", true).loopback).toBe(false);
    expect(assertDiscoveryUrl("http://localhost:11434", false).host).toBe("localhost");
  });

  it("aborts a hung pair of probes inside the 1500 ms cap", async () => {
    const hang = (close: () => void) =>
      createServer(() => {
        void close;
      });
    const left = hang(() => undefined);
    const right = hang(() => undefined);
    const port = async (server: ReturnType<typeof createServer>) => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      return address.port;
    };
    const leftPort = await port(left);
    const rightPort = await port(right);
    try {
      const started = Date.now();
      const report = await new LocalModelAutoDiscoverer({
        ollamaOrigin: `http://127.0.0.1:${leftPort}`,
        lmStudioOrigin: `http://127.0.0.1:${rightPort}`,
      }).discover();
      expect(Date.now() - started).toBeLessThan(2_200);
      expect(report.ollama.status).toBe("down");
      expect(report.lmStudio.status).toBe("down");
      expect(report.emptyMessage).toBe(NO_LOCAL_SERVERS_MESSAGE);
    } finally {
      left.closeAllConnections();
      right.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => left.close(() => resolve())),
        new Promise<void>((resolve) => right.close(() => resolve())),
      ]);
    }
  });

  it("parses configured num_ctx separately from architecture context", () => {
    expect(configuredNumCtxFromParameters("temperature 0.7\nnum_ctx                        4096\n")).toBe(4096);
    expect(configuredNumCtxFromParameters("temperature 0.2")).toBeNull();
    expect(architectureContextFromInfo({ "llama.context_length": 131072, "general.context_length": 8192 })).toBe(
      131072,
    );
  });
});
