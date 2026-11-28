import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryCreditWindDown,
  InMemoryDpapiSecretsVault,
  InMemoryGlobalConnections,
  OpenRouterCreditBalanceGuard,
  OpenRouterOAuthCancelledError,
  OpenRouterPkceOAuthFlow,
  codeChallengeS256,
  createPkcePair,
  ingestOpenRouterUsageCost,
  isPkceVerifier,
} from "../../src/openrouter-local/index.js";
import { json, listen, readBody } from "./mock-loopback.js";

const MINTED = "fixture-openrouter-mint-7c2e";

describe("OpenRouter PKCE S256", () => {
  it("builds a verifier and a base64url SHA-256 challenge", () => {
    const pair = createPkcePair();
    expect(pair.method).toBe("S256");
    expect(isPkceVerifier(pair.verifier)).toBe(true);
    expect(pair.challenge).toBe(codeChallengeS256(pair.verifier));
    expect(pair.challenge).toBe(createHash("sha256").update(pair.verifier).digest("base64url"));
    expect(pair.challenge.includes("=")).toBe(false);
  });

  it("mints a credit-capped key through the loopback callback and stores it only in the vault", async () => {
    const exchanges: { verifier?: string; method?: string }[] = [];
    const authorizations: string[] = [];
    const api = await listen(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/v1/auth/keys") {
        const body = JSON.parse(await readBody(request)) as { code_verifier?: string; code_challenge_method?: string };
        exchanges.push({
          ...(body.code_verifier ? { verifier: body.code_verifier } : {}),
          ...(body.code_challenge_method ? { method: body.code_challenge_method } : {}),
        });
        json(response, 200, { key: MINTED });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/auth/key") {
        authorizations.push(request.headers.authorization ?? "");
        json(response, 200, { data: { limit: 5, usage: 0, limit_remaining: 5 } });
        return;
      }
      json(response, 404, { error: "missing" });
    });
    const vault = new InMemoryDpapiSecretsVault();
    const connections = new InMemoryGlobalConnections();
    const windDown = new InMemoryCreditWindDown();
    const flow = new OpenRouterPkceOAuthFlow({
      vault,
      connections,
      windDown,
      projectId: "project-local",
      apiOrigin: api.origin,
      authOrigin: api.origin,
      creditLimitUsd: 5,
      browser: {
        async openExternal(url) {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
          expect(parsed.searchParams.get("limit")).toBe("5");
          const callback = parsed.searchParams.get("callback_url");
          expect(callback).toBeTruthy();
          const callbackUrl = new URL(callback ?? "");
          expect(callbackUrl.hostname).toBe("127.0.0.1");
          expect(callbackUrl.pathname).toBe("/callback");
          const challenge = parsed.searchParams.get("code_challenge");
          const landed = await fetch(`${callbackUrl.toString()}?code=fixture-auth-code`);
          expect(landed.status).toBe(200);
          expect(challenge).toBeTruthy();
        },
      },
    });
    try {
      const result = await flow.start();
      const verifier = exchanges[0]?.verifier ?? "";
      expect(exchanges[0]?.method).toBe("S256");
      expect(codeChallengeS256(verifier)).toBe(new URL(result.authorizeUrl).searchParams.get("code_challenge"));
      expect(authorizations).toEqual([`Bearer ${MINTED}`]);
      expect(result.display).toBe("$5.00 remaining on OpenRouter key");
      expect(result.binding.limitMicroUsd).toBe(5_000_000);
      expect(result.binding.remainingMicroUsd).toBe(5_000_000);
      expect(result.binding.windDownStartsAtMicroUsd).toBe(4_500_000);
      expect(result.binding.exhausted).toBe(false);
      expect(result.connection.provider).toBe("openrouter");
      expect(result.connection.route).toBe("api_key");
      expect(result.connection.currency).toBe("usd");
      expect(result.connection.scale).toBe(1_000_000);
      expect(result.storageRow.vault_ref).toBe(result.connection.vaultRef);
      expect(JSON.stringify(result.storageRow)).not.toContain(MINTED);
      expect(JSON.stringify(result.connection)).not.toContain(MINTED);
      expect(JSON.stringify(vault.metadataWithoutSecrets())).not.toContain(MINTED);
      const ref = result.connection.vaultRef;
      expect(ref).toEqual(expect.any(String));
      if (ref === null) throw new Error("vault ref missing");
      expect((await vault.readSecret(ref))?.value).toBe(MINTED);
      expect(windDown.latest(result.connection.id)?.display).toBe("$5.00 remaining on OpenRouter key");
    } finally {
      await api.close();
    }
  });

  it("cancels a denied consent without writing a connection", async () => {
    const api = await listen((_request, response) => {
      json(response, 500, { error: "should not exchange" });
    });
    const vault = new InMemoryDpapiSecretsVault();
    const connections = new InMemoryGlobalConnections();
    const flow = new OpenRouterPkceOAuthFlow({
      vault,
      connections,
      windDown: new InMemoryCreditWindDown(),
      projectId: "project-local",
      apiOrigin: api.origin,
      authOrigin: api.origin,
      browser: {
        async openExternal(url) {
          const callback = new URL(url).searchParams.get("callback_url");
          await fetch(`${callback ?? ""}?error=access_denied`);
        },
      },
    });
    try {
      await expect(flow.start()).rejects.toBeInstanceOf(OpenRouterOAuthCancelledError);
      expect(await connections.list()).toEqual([]);
      expect(vault.metadataWithoutSecrets()).toEqual([]);
    } finally {
      await api.close();
    }
  });

  it("closes the listener when the developer cancels before consent", async () => {
    const vault = new InMemoryDpapiSecretsVault();
    const connections = new InMemoryGlobalConnections();
    const flow = new OpenRouterPkceOAuthFlow({
      vault,
      connections,
      windDown: new InMemoryCreditWindDown(),
      projectId: "project-local",
      apiOrigin: "http://127.0.0.1:9",
      authOrigin: "http://127.0.0.1:9",
      browser: {
        async openExternal() {
          flow.cancel();
        },
      },
    });
    await expect(flow.start()).rejects.toBeInstanceOf(OpenRouterOAuthCancelledError);
    expect(await connections.list()).toEqual([]);
    expect(vault.metadataWithoutSecrets()).toEqual([]);
  });

  it("rolls the vault entry back when the connection insert fails", async () => {
    const api = await listen(async (request, response) => {
      if (request.method === "POST") {
        json(response, 200, { key: MINTED });
        return;
      }
      json(response, 200, { data: { limit: 5, usage: 0, limit_remaining: 5 } });
    });
    const vault = new InMemoryDpapiSecretsVault();
    const flow = new OpenRouterPkceOAuthFlow({
      vault,
      connections: {
        async insert() {
          throw new Error("db down");
        },
        async get() {
          return null;
        },
        async list() {
          return [];
        },
        async delete() {
          return undefined;
        },
      },
      windDown: new InMemoryCreditWindDown(),
      projectId: "project-local",
      apiOrigin: api.origin,
      authOrigin: api.origin,
      browser: {
        async openExternal(url) {
          const callback = new URL(url).searchParams.get("callback_url");
          await fetch(`${callback ?? ""}?code=fixture-auth-code`);
        },
      },
    });
    try {
      await expect(flow.start()).rejects.toThrow(/db down/);
      expect(vault.metadataWithoutSecrets()).toEqual([]);
    } finally {
      await api.close();
    }
  });

  it("ingests provider-reported usage.cost as micro-USD", () => {
    const receipt = ingestOpenRouterUsageCost({
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001234 },
    });
    expect(receipt.reported).toBe(true);
    expect(receipt.currency).toBe("usd");
    expect(receipt.costMicroUsd).toBe(1234);
    expect(receipt.totalTokens).toBe(140);
    expect(() => ingestOpenRouterUsageCost({ usage: { prompt_tokens: 1 } })).toThrow(/usage\.cost/);
  });

  it("polls the key balance on build start, every 10 turns, and after 402", async () => {
    let hits = 0;
    const api = await listen((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/api/v1/auth/key") {
        json(response, 404, {});
        return;
      }
      hits += 1;
      if (hits >= 4) {
        json(response, 500, { error: "down" });
        return;
      }
      json(response, 200, { data: { limit: 5, usage: hits === 3 ? 5 : 0.5, limit_remaining: hits === 3 ? 0 : 4.5 } });
    });
    const vault = new InMemoryDpapiSecretsVault();
    const handle = await vault.put({
      projectId: "project-local",
      envScope: "dev",
      name: "OPENROUTER_API_KEY",
      value: MINTED,
      providerHint: "openrouter",
    });
    const connections = new InMemoryGlobalConnections();
    await connections.insert({
      id: "openrouter-1",
      provider: "openrouter",
      route: "api_key",
      plan: null,
      vaultRef: handle.secretId,
      currency: "usd",
      scale: 1_000_000,
      enabled: true,
      createdAt: 1,
    });
    const windDown = new InMemoryCreditWindDown();
    const guard = new OpenRouterCreditBalanceGuard({
      vault,
      connections,
      windDown,
      apiOrigin: api.origin,
    });
    try {
      const started = await guard.onBuildStart("openrouter-1");
      expect(started.reason).toBe("build_start");
      expect(started.display).toBe("$4.50 remaining on OpenRouter key");
      expect(hits).toBe(1);
      for (let turn = 0; turn < 9; turn += 1) {
        expect(await guard.afterTurn("openrouter-1")).toBeNull();
      }
      expect(hits).toBe(1);
      const tenth = await guard.afterTurn("openrouter-1");
      expect(tenth?.reason).toBe("turn_interval");
      expect(hits).toBe(2);
      expect(await guard.afterHttpStatus("openrouter-1", 401)).toBeNull();
      expect(hits).toBe(2);
      const blocked = await guard.afterHttpStatus("openrouter-1", 402);
      expect(blocked?.exhausted).toBe(true);
      expect(blocked?.remainingMicroUsd).toBe(0);
      expect(hits).toBe(3);
      const failed = await guard.afterHttpStatus("openrouter-1", 402);
      expect(failed?.exhausted).toBe(true);
      expect(failed?.display).toBe("$0.00 remaining on OpenRouter key");
      expect(windDown.latest("openrouter-1")?.pastWindDown).toBe(true);
    } finally {
      await api.close();
    }
  });
});
