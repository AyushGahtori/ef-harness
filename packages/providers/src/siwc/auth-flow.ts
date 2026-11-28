import { CALLBACK_TTL_MS, SIWC_DIRECT_SCOPE, SIWC_DYNAMIC_CLIENT_ID, SIWC_PREVIEW_LABEL } from "./constants.js";
import { SiwcError, SiwcRouteRevokedError, SiwcScopeRejectedError } from "./errors.js";
import { parseOAuthTokenResult, parseTokenBundle, postForm, serializeTokenBundle } from "./http.js";
import { siwcTokenSecretName } from "./ids.js";
import { verifyIdToken } from "./jwt.js";
import { openLoopback, type LoopbackCallback, type LoopbackListener } from "./loopback.js";
import { createOAuthEntropy, createPkceVerifier, grantedScopeList, pkceS256 } from "./pkce.js";
import type { FetchLike, SignedProviderPolicyEngine, SiwcPolicyDecision, SiwcSecretsVault, SystemBrowserOpener } from "./ports.js";
import type { SiwcConnectionRecord, SqliteSiwcInstallationStore } from "./store.js";

export interface SignInWithChatGptAuthFlowOptions {
  readonly store: SqliteSiwcInstallationStore;
  readonly vault: SiwcSecretsVault;
  readonly policy: SignedProviderPolicyEngine;
  readonly browser: SystemBrowserOpener;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly callbackTtlMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface SiwcSignInRequest {
  readonly connectionId: string;
  readonly label: string;
  readonly plan?: string | null;
}

export interface SiwcDisconnectResult {
  readonly connectionId: string;
  readonly status: "disconnected";
  readonly remoteRevocationConfirmed: boolean;
  readonly notice: string | null;
}

export class SignInWithChatGptAuthFlow {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly callbackTtlMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private active: LoopbackListener | null = null;

  constructor(private readonly options: SignInWithChatGptAuthFlowOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.callbackTtlMs = options.callbackTtlMs ?? CALLBACK_TTL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }));
  }

  previewLabel(): string {
    return SIWC_PREVIEW_LABEL;
  }

  ensureHostId(): string {
    return this.options.store.ensureHostId();
  }

  cancelActive(): void {
    this.active?.cancel();
  }

  async signIn(request: SiwcSignInRequest): Promise<SiwcConnectionRecord> {
    if (this.active) {
      throw new SiwcError("sign_in_busy", "A ChatGPT sign-in is already in progress.");
    }
    const hostId = this.options.store.ensureHostId();
    const policy = await this.options.policy.readSiwcPolicy();
    if (policy.routeRevoked) throw new SiwcRouteRevokedError(policy.fallbackGuidance);
    const existing = this.options.store.get(request.connectionId);
    const registration = chooseClient(policy, existing);
    const listener = await openLoopback();
    this.active = listener;
    const state = createOAuthEntropy();
    const nonce = createOAuthEntropy();
    const verifier = createPkceVerifier();
    const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
    const hint = await this.readHint(existing);
    const url = buildAuthorizeUrl({
      endpoint: policy.authorizeEndpoint,
      clientId: registration.authorizeClientId,
      redirectUri,
      scopes: policy.requestedScopes,
      state,
      nonce,
      codeChallenge: pkceS256(verifier),
      hostId,
      resource: policy.resource,
      ...(registration.registering ? { agentNameHint: policy.agentNameHint } : {}),
      ...(hint.idToken ? { idTokenHint: hint.idToken } : {}),
      ...(hint.email ? { loginHint: hint.email } : {}),
    });
    const pending = listener.arm(state, this.callbackTtlMs);
    void pending.catch(() => undefined);
    const browserPromise = this.options.browser.openExternal(url);
    try {
      const callback = await pending;
      await browserPromise;
      await listener.close();
      this.active = null;
      return await this.completeSignIn({
        request,
        policy,
        hostId,
        registration,
        existing,
        callback,
        verifier,
        nonce,
        redirectUri,
      });
    } finally {
      void browserPromise.catch(() => undefined);
      this.active = null;
      await listener.close();
    }
  }

  async disconnect(connectionId: string): Promise<SiwcDisconnectResult> {
    const record = this.options.store.get(connectionId);
    if (!record) throw new SiwcError("not_connected", "That ChatGPT connection is not saved.");
    const policy = await this.options.policy.readSiwcPolicy();
    const bundle = await this.readBundle(connectionId);
    let remoteRevocationConfirmed = false;
    if (bundle && record.clientId) {
      remoteRevocationConfirmed = await this.revoke(policy, record.clientId, bundle.refresh_token);
    }
    await this.options.vault.deleteSecret(siwcTokenSecretName(connectionId));
    this.options.store.markDisconnected(connectionId);
    const status = this.options.store.get(connectionId)?.status;
    if (status !== "disconnected") {
      throw new SiwcError("disconnect_failed", "The ChatGPT connection could not be marked disconnected.");
    }
    return {
      connectionId,
      status: "disconnected",
      remoteRevocationConfirmed,
      notice: remoteRevocationConfirmed
        ? null
        : "Remote revocation was not confirmed. Local credentials were removed.",
    };
  }

  private async completeSignIn(input: {
    request: SiwcSignInRequest;
    policy: SiwcPolicyDecision;
    hostId: string;
    registration: ClientChoice;
    existing: SiwcConnectionRecord | null;
    callback: LoopbackCallback;
    verifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<SiwcConnectionRecord> {
    if (input.callback.error) {
      throw new SiwcError("access_denied", "ChatGPT sign-in was cancelled before consent.");
    }
    if (!input.callback.code) {
      throw new SiwcError("missing_code", "The sign-in callback did not include an authorization code.");
    }
    const issuedClientId = issuedClient(input.registration, input.callback.clientId);
    const response = await postForm(this.fetchImpl, input.policy.tokenEndpoint, {
      grant_type: "authorization_code",
      client_id: issuedClientId,
      code: input.callback.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: input.policy.resource,
    });
    const token = parseOAuthTokenResult(response.status, response.text);
    if (token.error || !token.accessToken || !token.refreshToken) {
      throw new SiwcError("token_exchange", "ChatGPT did not complete the authorization code exchange.");
    }
    const verified = await verifyIdToken(token.idToken ?? "", input.policy.jwksUri, {
      issuer: input.policy.issuer,
      audience: issuedClientId,
      nonce: input.nonce,
      nowMs: this.now(),
    }, this.fetchImpl);
    if (input.existing?.subject && verified.sub !== input.existing.subject) {
      throw new SiwcError("identity_mismatch", "The ChatGPT account did not match this connection.");
    }
    const scopes = grantedScopeList(token.scope ?? "");
    if (!scopes.includes(SIWC_DIRECT_SCOPE)) throw new SiwcScopeRejectedError();
    const now = this.now();
    await this.options.vault.storeSecret(siwcTokenSecretName(input.request.connectionId), serializeTokenBundle({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      id_token: token.idToken ?? "",
    }));
    this.options.store.saveConnected({
      id: input.request.connectionId,
      label: input.request.label,
      plan: input.request.plan ?? input.existing?.plan ?? null,
      clientId: issuedClientId,
      subject: verified.sub,
      email: verified.email,
      scopes,
      expiresAtMs: now + token.expiresIn * 1000,
      earliestRefreshAtMs: token.earliestRefreshAtMs,
    }, now);
    const saved = this.options.store.get(input.request.connectionId);
    if (!saved || saved.extAgentHostId !== input.hostId) {
      throw new SiwcError("persist_failed", "The ChatGPT connection could not be saved.");
    }
    return saved;
  }

  private async readHint(existing: SiwcConnectionRecord | null): Promise<{ idToken: string | null; email: string | null }> {
    if (!existing?.clientId) return { idToken: null, email: null };
    const bundle = await this.readBundle(existing.id);
    return { idToken: bundle?.id_token ?? null, email: existing.email };
  }

  private async readBundle(connectionId: string) {
    const raw = await this.options.vault.readPlaintextForKernel(siwcTokenSecretName(connectionId));
    if (!raw) return null;
    return parseTokenBundle(raw);
  }

  private async revoke(policy: SiwcPolicyDecision, clientId: string, refreshToken: string): Promise<boolean> {
    const endpoint = await this.revocationEndpoint(policy);
    if (!endpoint) return false;
    let delay = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (delay > 0) await this.sleep(delay);
      try {
        const response = await postForm(this.fetchImpl, endpoint, {
          token: refreshToken,
          token_type_hint: "refresh_token",
          client_id: clientId,
        });
        if (response.status === 200) return true;
        if (response.status < 500) return false;
        delay = delay === 0 ? 50 : delay * 2;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        delay = delay === 0 ? 50 : delay * 2;
      }
    }
    return false;
  }

  private async revocationEndpoint(policy: SiwcPolicyDecision): Promise<string> {
    if (policy.revocationEndpoint) return policy.revocationEndpoint;
    const response = await this.fetchImpl(policy.discoveryUrl);
    if (!response.ok) return "";
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "";
    const endpoint = (body as { revocation_endpoint?: unknown }).revocation_endpoint;
    return typeof endpoint === "string" ? endpoint : "";
  }
}

interface ClientChoice {
  readonly authorizeClientId: string;
  readonly registering: boolean;
}

function chooseClient(policy: SiwcPolicyDecision, existing: SiwcConnectionRecord | null): ClientChoice {
  if (existing?.clientId) return { authorizeClientId: existing.clientId, registering: false };
  if (policy.registerDynamicClient) return { authorizeClientId: SIWC_DYNAMIC_CLIENT_ID, registering: true };
  if (policy.staticClientId) return { authorizeClientId: policy.staticClientId, registering: false };
  throw new SiwcError("client_registration_required", "Policy requires a client id before sign-in.");
}

function issuedClient(registration: ClientChoice, callbackClientId: string | null): string {
  if (registration.registering) {
    if (!callbackClientId || callbackClientId === SIWC_DYNAMIC_CLIENT_ID) {
      throw new SiwcError("registration_incomplete", "Registration did not return an issued client id.");
    }
    return callbackClientId;
  }
  if (callbackClientId && callbackClientId !== registration.authorizeClientId) {
    throw new SiwcError("client_mismatch", "The callback returned a different client id for this account.");
  }
  return registration.authorizeClientId;
}

function buildAuthorizeUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  hostId: string;
  resource: string;
  agentNameHint?: string;
  idTokenHint?: string;
  loginHint?: string;
}): string {
  const url = new URL(input.endpoint);
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", input.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("scope", input.scopes.join(" "));
  params.set("resource", input.resource);
  params.set("state", input.state);
  params.set("nonce", input.nonce);
  params.set("code_challenge_method", "S256");
  params.set("code_challenge", input.codeChallenge);
  params.set("ext_agent_host_id", input.hostId);
  if (input.agentNameHint) params.set("agent_name_hint", input.agentNameHint);
  if (input.idTokenHint) params.set("id_token_hint", input.idTokenHint);
  if (input.loginHint) params.set("login_hint", input.loginHint);
  url.search = params.toString();
  return url.toString();
}
