import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CALLBACK_TTL_MS,
  SIWC_DIRECT_SCOPE,
  SIWC_DYNAMIC_CLIENT_ID,
  SIWC_PREVIEW_LABEL,
  SIWC_ROUTE_REVOKED_GUIDANCE,
  SIWC_SCOPE_REJECTED_MESSAGE,
  SiwcCallbackTimeoutError,
  SiwcCancelledError,
  SiwcError,
  SiwcInvalidStateError,
  SiwcNonceRejectedError,
  SiwcScopeRejectedError,
  SignInWithChatGptAuthFlow,
  SqliteSiwcInstallationStore,
  pkceS256,
  siwcTokenSecretName,
} from "../../src/siwc/index.js";
import { IdleBrowser, authorizeParams, expectPortClosed, openHarness } from "./support.js";

describe("Sign in with ChatGPT PKCE and OIDC", () => {
  it("hashes the RFC 7636 S256 vector", () => {
    expect(pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(CALLBACK_TTL_MS).toBe(120_000);
  });

  it("persists one ext_agent_host_id across restarts and sign-ins", async () => {
    const harness = await openHarness();
    const opened: SqliteSiwcInstallationStore[] = [];
    try {
      const first = harness.flow.ensureHostId();
      expect(first.startsWith("urn:uuid:")).toBe(true);
      harness.store.close();
      const reopened = new SqliteSiwcInstallationStore(harness.dbPath);
      opened.push(reopened);
      expect(reopened.readHostId()).toBe(first);
      reopened.close();
      const again = new SqliteSiwcInstallationStore(harness.dbPath);
      opened.push(again);
      const flow = new SignInWithChatGptAuthFlow({
        store: again,
        vault: harness.vault,
        policy: harness.policy,
        browser: harness.browser,
        sleep: async () => undefined,
      });
      const account = await flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)", plan: "plus" });
      expect(account.extAgentHostId).toBe(first);
      expect(account.previewLabel).toBe(SIWC_PREVIEW_LABEL);
      expect(flow.previewLabel()).toBe(SIWC_PREVIEW_LABEL);
      const params = authorizeParams(harness.browser.urls[0] ?? "");
      expect(params.get("ext_agent_host_id")).toBe(first);
      expect(params.get("client_id")).toBe(SIWC_DYNAMIC_CLIENT_ID);
      expect(params.get("agent_name_hint")).toBe("EF Harness");
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("response_type")).toBe("code");
      expect(params.get("resource")).toBe("https://api.openai.com/v1");
      expect(params.get("scope")).toContain(SIWC_DIRECT_SCOPE);
      expect(params.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const exchange = harness.server.tokenForms[0];
      expect(exchange?.["grant_type"]).toBe("authorization_code");
      expect(exchange?.["client_id"]).not.toBe(SIWC_DYNAMIC_CLIENT_ID);
      expect(exchange?.["client_id"]?.startsWith("oaiapp_efh_")).toBe(true);
      expect(exchange?.["code_verifier"]).toBeTruthy();
      const bundle = JSON.parse((await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))) ?? "{}") as {
        access_token?: string;
      };
      expect(bundle.access_token?.startsWith("efh.access.")).toBe(true);
      expect(JSON.stringify(account)).not.toContain(bundle.access_token);
      expect(readFileSync(harness.dbPath).includes(bundle.access_token ?? "missing-token")).toBe(false);
    } finally {
      for (const store of opened) store.close();
      await harness.close();
    }
  });

  it("reuses the issued client id and the same host id on the next sign-in", async () => {
    const harness = await openHarness();
    try {
      const first = await harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      const issued = first.clientId;
      await harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      const second = authorizeParams(harness.browser.urls[1] ?? "");
      expect(second.get("client_id")).toBe(issued);
      expect(second.get("ext_agent_host_id")).toBe(first.extAgentHostId);
      expect(second.has("agent_name_hint")).toBe(false);
      expect(second.has("id_token_hint")).toBe(true);
      expect(second.get("login_hint")).toBe("user@example.test");
    } finally {
      await harness.close();
    }
  });

  it("rejects a missing direct-use scope before saving the connection", async () => {
    const harness = await openHarness();
    try {
      harness.server.omitDirectScope = true;
      await expect(harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toThrow(new SiwcScopeRejectedError());
      await expect(harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toThrow(SIWC_SCOPE_REJECTED_MESSAGE);
      expect(harness.store.get("chatgpt-personal")).toBeNull();
      expect(await harness.vault.count()).toBe(0);
      expect(harness.store.readHostId()).toMatch(/^urn:uuid:/);
    } finally {
      await harness.close();
    }
  });

  it("rejects a mismatched OIDC nonce and an incomplete registration before saving", async () => {
    const nonce = await openHarness();
    try {
      nonce.server.badNonce = true;
      await expect(nonce.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toBeInstanceOf(SiwcNonceRejectedError);
      expect(nonce.store.get("chatgpt-personal")).toBeNull();
      expect(await nonce.vault.count()).toBe(0);
    } finally {
      await nonce.close();
    }
    const incomplete = await openHarness();
    try {
      incomplete.server.omitIssuedClient = true;
      await expect(incomplete.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toMatchObject({ code: "registration_incomplete" });
      expect(incomplete.server.tokenForms).toHaveLength(0);
      expect(incomplete.store.get("chatgpt-personal")).toBeNull();
    } finally {
      await incomplete.close();
    }
  });

  it("returns 400 Invalid state and does not exchange a forged callback", async () => {
    const browser = new IdleBrowser();
    const harness = await openHarness({ browser });
    try {
      const pending = harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      void pending.catch(() => undefined);
      await browser.started;
      const redirect = new URL(authorizeParams(browser.urls[0] ?? "").get("redirect_uri") ?? "");
      const evil = new URL("/callback", redirect.origin);
      evil.searchParams.set("code", "evil");
      evil.searchParams.set("state", "wrong");
      const response = await fetch(evil);
      const body = await response.text();
      expect(response.status).toBe(400);
      expect(body).toBe("Invalid state");
      await expect(pending).rejects.toBeInstanceOf(SiwcInvalidStateError);
      expect(harness.server.tokenForms).toHaveLength(0);
      await expectPortClosed(Number(redirect.port));
    } finally {
      await harness.close();
    }
  });

  it("closes the loopback listener on cancel and on the callback TTL", async () => {
    const cancelBrowser = new IdleBrowser();
    const cancel = await openHarness({ browser: cancelBrowser });
    try {
      const pending = cancel.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      void pending.catch(() => undefined);
      await cancelBrowser.started;
      const port = Number(new URL(authorizeParams(cancelBrowser.urls[0] ?? "").get("redirect_uri") ?? "").port);
      cancel.flow.cancelActive();
      await expect(pending).rejects.toBeInstanceOf(SiwcCancelledError);
      await expectPortClosed(port);
    } finally {
      await cancel.close();
    }
    const timeoutBrowser = new IdleBrowser();
    const timeout = await openHarness({ browser: timeoutBrowser, callbackTtlMs: 40 });
    try {
      const pending = timeout.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      void pending.catch(() => undefined);
      await timeoutBrowser.started;
      const port = Number(new URL(authorizeParams(timeoutBrowser.urls[0] ?? "").get("redirect_uri") ?? "").port);
      await expect(pending).rejects.toBeInstanceOf(SiwcCallbackTimeoutError);
      await expectPortClosed(port);
    } finally {
      await timeout.close();
    }
  });

  it("keeps personal and work tokens in distinct vault names", async () => {
    const harness = await openHarness();
    try {
      harness.server.subject = "acct-personal";
      harness.server.email = "personal@example.test";
      await harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)", plan: "plus" });
      const personal = await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"));
      harness.server.subject = "acct-work";
      harness.server.email = "work@example.test";
      await harness.flow.signIn({ connectionId: "chatgpt-work", label: "ChatGPT (work)", plan: "team" });
      const work = await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-work"));
      expect(personal).toBeTruthy();
      expect(work).toBeTruthy();
      expect(personal).not.toBe(work);
      expect(harness.store.get("chatgpt-personal")?.subject).toBe("acct-personal");
      expect(harness.store.get("chatgpt-work")?.subject).toBe("acct-work");
      expect(harness.store.get("chatgpt-personal")?.extAgentHostId).toBe(harness.store.get("chatgpt-work")?.extAgentHostId);
    } finally {
      await harness.close();
    }
  });

  it("refuses to replace a saved account when the callback client or subject changes", async () => {
    const mismatch = await openHarness();
    try {
      await mismatch.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      const before = await mismatch.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"));
      mismatch.server.callbackClientIdOverride = "oaiapp_efh_other";
      await expect(mismatch.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toMatchObject({ code: "client_mismatch" });
      expect(await mismatch.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))).toBe(before);
    } finally {
      await mismatch.close();
    }
    const identity = await openHarness();
    try {
      await identity.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      const before = await identity.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"));
      identity.server.subject = "acct-other";
      await expect(identity.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toMatchObject({ code: "identity_mismatch" });
      expect(await identity.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))).toBe(before);
    } finally {
      await identity.close();
    }
  });

  it("revokes the refresh token, wipes the vault, and marks the connection disconnected", async () => {
    const harness = await openHarness({ revocationEndpoint: "" });
    try {
      const account = await harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      const bundle = JSON.parse((await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))) ?? "{}") as {
        refresh_token: string;
        access_token: string;
      };
      const result = await harness.flow.disconnect("chatgpt-personal");
      expect(result).toEqual({
        connectionId: "chatgpt-personal",
        status: "disconnected",
        remoteRevocationConfirmed: true,
        notice: null,
      });
      expect(harness.store.get("chatgpt-personal")?.status).toBe("disconnected");
      expect(harness.store.get("chatgpt-personal")?.enabled).toBe(false);
      expect(await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))).toBeNull();
      expect(harness.server.revokeForms).toHaveLength(1);
      expect(harness.server.revokeForms[0]?.["token"]).toBe(bundle.refresh_token);
      expect(harness.server.revokeForms[0]?.["client_id"]).toBe(account.clientId);
      expect(harness.server.revokeForms[0]?.["token_type_hint"]).toBe("refresh_token");
      expect(readFileSync(harness.dbPath).includes(bundle.access_token)).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("still wipes local credentials when revocation is not confirmed", async () => {
    const harness = await openHarness();
    try {
      await harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" });
      await harness.server.stop();
      const result = await harness.flow.disconnect("chatgpt-personal");
      expect(result.remoteRevocationConfirmed).toBe(false);
      expect(result.notice).toContain("Remote revocation was not confirmed");
      expect(harness.store.get("chatgpt-personal")?.status).toBe("disconnected");
      expect(await harness.vault.readPlaintextForKernel(siwcTokenSecretName("chatgpt-personal"))).toBeNull();
    } finally {
      await harness.close();
    }
  });

  it("stops before the browser when the preview route is revoked", async () => {
    const harness = await openHarness({ routeRevoked: true });
    try {
      await expect(harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toThrow(SIWC_ROUTE_REVOKED_GUIDANCE);
      expect(harness.browser.urls).toHaveLength(0);
      expect(harness.store.readHostId()).toMatch(/^urn:uuid:/);
    } finally {
      await harness.close();
    }
  });

  it("does not exchange a code when consent is denied", async () => {
    const harness = await openHarness();
    try {
      harness.server.deny = true;
      await expect(harness.flow.signIn({ connectionId: "chatgpt-personal", label: "ChatGPT (personal)" }))
        .rejects.toBeInstanceOf(SiwcError);
      expect(harness.server.tokenForms).toHaveLength(0);
      expect(harness.store.get("chatgpt-personal")).toBeNull();
    } finally {
      await harness.close();
    }
  });
});
