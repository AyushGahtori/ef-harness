import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_LEAD_MS, SIWC_DIRECT_SCOPE, TERMINAL_REFRESH_ERRORS } from "./constants.js";
import { SiwcError, SiwcRouteRevokedError, SiwcScopeRejectedError, SiwcSignInExpiredError } from "./errors.js";
import { parseOAuthTokenResult, parseTokenBundle, postForm, serializeTokenBundle } from "./http.js";
import { siwcTokenSecretName } from "./ids.js";
import { verifyIdToken } from "./jwt.js";
import { grantedScopeList } from "./pkce.js";
import type {
  AccountCardEmitter,
  ActiveBuildParker,
  FetchLike,
  SiwcAccessGrant,
  SignedProviderPolicyEngine,
  SiwcSecretsVault,
} from "./ports.js";
import type { SqliteSiwcInstallationStore } from "./store.js";

const TERMINAL = new Set<string>(TERMINAL_REFRESH_ERRORS);

export interface SiwcTokenRefresherOptions {
  readonly store: SqliteSiwcInstallationStore;
  readonly vault: SiwcSecretsVault;
  readonly policy: SignedProviderPolicyEngine;
  readonly cards: AccountCardEmitter;
  readonly parker: ActiveBuildParker;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * One in-flight refresh per connection. Concurrent workers share that promise
 * so a rotating refresh token is presented to the token endpoint once.
 */
export class SiwcTokenRefresher {
  private readonly flights = new Map<string, Promise<SiwcAccessGrant>>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: SiwcTokenRefresherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  ensureFresh(connectionId: string): Promise<SiwcAccessGrant> {
    const existing = this.flights.get(connectionId);
    if (existing) return existing;
    const deferred = createDeferred<SiwcAccessGrant>();
    this.flights.set(connectionId, deferred.promise);
    void this.fly(connectionId).then(
      (value) => {
        this.clearFlight(connectionId, deferred.promise);
        deferred.resolve(value);
      },
      (error: unknown) => {
        this.clearFlight(connectionId, deferred.promise);
        deferred.reject(error);
      },
    );
    return deferred.promise;
  }

  private clearFlight(connectionId: string, flight: Promise<SiwcAccessGrant>): void {
    if (this.flights.get(connectionId) === flight) this.flights.delete(connectionId);
  }

  private async fly(connectionId: string): Promise<SiwcAccessGrant> {
    const policy = await this.options.policy.readSiwcPolicy();
    if (policy.routeRevoked) throw new SiwcRouteRevokedError(policy.fallbackGuidance);
    const record = this.options.store.get(connectionId);
    if (!record || !record.clientId) {
      throw new SiwcError("not_connected", "Sign in with ChatGPT before using this connection.");
    }
    const bundle = await this.readBundle(connectionId);
    const now = this.now();
    if (bundle && record.expiresAtMs !== null && !needsRefresh(record.expiresAtMs, record.earliestRefreshAtMs, now)) {
      return { accessToken: bundle.access_token, expiresAtMs: record.expiresAtMs, connectionId };
    }
    if (!bundle) return this.expire(connectionId);
    const response = await postForm(this.fetchImpl, policy.tokenEndpoint, {
      grant_type: "refresh_token",
      client_id: record.clientId,
      refresh_token: bundle.refresh_token,
      resource: policy.resource,
    });
    const token = parseOAuthTokenResult(response.status, response.text);
    if (token.error && TERMINAL.has(token.error)) return this.expire(connectionId);
    if (token.error || !token.accessToken || !token.refreshToken) {
      throw new SiwcError("refresh_failed", "ChatGPT could not refresh this sign-in. Try again.");
    }
    let idToken = bundle.id_token;
    if (token.idToken) {
      const verified = await verifyIdToken(token.idToken, policy.jwksUri, {
        issuer: policy.issuer,
        audience: record.clientId,
        nonce: null,
        nowMs: now,
      }, this.fetchImpl);
      if (record.subject && verified.sub !== record.subject) {
        throw new SiwcError("identity_mismatch", "The refreshed ChatGPT account did not match this connection.");
      }
      idToken = token.idToken;
    }
    const scopes = token.scope === null ? record.scopes : grantedScopeList(token.scope);
    if (!scopes.includes(SIWC_DIRECT_SCOPE)) {
      await this.options.vault.delete(siwcTokenSecretName(connectionId));
      this.options.store.markNeedsSignIn(connectionId);
      throw new SiwcScopeRejectedError();
    }
    const expiresAtMs = now + (token.expiresIn || ACCESS_TOKEN_TTL_SECONDS) * 1000;
    await this.options.vault.put(siwcTokenSecretName(connectionId), serializeTokenBundle({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      id_token: idToken,
    }));
    this.options.store.updateExpiry(connectionId, expiresAtMs, token.earliestRefreshAtMs, scopes);
    return { accessToken: token.accessToken, expiresAtMs, connectionId };
  }

  private async readBundle(connectionId: string) {
    const raw = await this.options.vault.get(siwcTokenSecretName(connectionId));
    if (!raw) return null;
    return parseTokenBundle(raw);
  }

  private async expire(connectionId: string): Promise<never> {
    await this.options.vault.delete(siwcTokenSecretName(connectionId));
    const record = this.options.store.get(connectionId);
    if (!record?.expiryNotified) {
      this.options.parker.park({ connectionId, reason: "refresh_invalid_grant" });
      this.options.cards.emit({ connectionId, message: new SiwcSignInExpiredError().message });
      this.options.store.markNeedsSignIn(connectionId);
    }
    throw new SiwcSignInExpiredError();
  }
}

function needsRefresh(expiresAtMs: number, earliestRefreshAtMs: number | null, now: number): boolean {
  if (expiresAtMs <= now) return true;
  if (expiresAtMs - now >= REFRESH_LEAD_MS) return false;
  if (earliestRefreshAtMs !== null && now < earliestRefreshAtMs) return false;
  return true;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
