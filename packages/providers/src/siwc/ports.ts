import type { SiwcAllowanceIngest, SiwcAllowanceObservation } from "./allowance.js";

export type SiwcConnectionStatus = "connected" | "disconnected" | "needs_sign_in";

export interface SiwcPolicyDecision {
  readonly routeRevoked: boolean;
  readonly registerDynamicClient: boolean;
  readonly staticClientId: string | null;
  readonly authorizeEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly discoveryUrl: string;
  readonly jwksUri: string;
  readonly issuer: string;
  readonly resource: string;
  readonly responsesEndpoint: string;
  readonly agentNameHint: string;
  readonly requestedScopes: readonly string[];
  readonly fallbackGuidance: string;
}

/**
 * Local port of Task 135 `SignedProviderPolicyEngine`.
 * Swap `readSiwcPolicy` to the signed policy bundle at integration.
 */
export interface SignedProviderPolicyEngine {
  readSiwcPolicy(): SiwcPolicyDecision | Promise<SiwcPolicyDecision>;
}

/**
 * Electron `shell.openExternal`. Providers do not embed a WebView and do not collect passwords.
 */
export interface SystemBrowserOpener {
  openExternal(url: string): Promise<void>;
}

export interface SiwcTokenBundle {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly id_token: string;
}

/**
 * Task 120 `WindowsDpapiSecretsVault`.
 * Values are opaque credential blobs. Callers pass vault names, never write the blob into global.db.
 */
export interface SiwcSecretsVault {
  storeSecret(name: string, value: string): Promise<void>;
  readPlaintextForKernel(name: string): Promise<string | null>;
  deleteSecret(name: string): Promise<void>;
}

export interface SiwcAccessGrant {
  readonly accessToken: string;
  readonly expiresAtMs: number;
  readonly connectionId: string;
}

/**
 * Local port of Task 140 allowance pacing. This task only publishes observations.
 */
export interface AllowancePacingFeed {
  ingest(event: SiwcAllowanceIngest): void;
}

export interface AccountCardEmitter {
  emit(card: { readonly connectionId: string; readonly message: string }): void;
}

export interface ActiveBuildParker {
  park(event: { readonly connectionId: string; readonly reason: string }): void;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export type { SiwcAllowanceObservation };
