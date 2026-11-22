import {
  SIWC_AGENT_NAME_HINT,
  SIWC_AUTHORIZE_ENDPOINT,
  SIWC_DISCOVERY_URL,
  SIWC_ISSUER,
  SIWC_JWKS_URL,
  SIWC_REQUESTED_SCOPES,
  SIWC_RESOURCE,
  SIWC_RESPONSES_ENDPOINT,
  SIWC_ROUTE_REVOKED_GUIDANCE,
  SIWC_TOKEN_ENDPOINT,
} from "./constants.js";
import type { SiwcPolicyDecision, SignedProviderPolicyEngine } from "./ports.js";

export interface SiwcPolicyOverrides {
  readonly routeRevoked?: boolean;
  readonly registerDynamicClient?: boolean;
  readonly staticClientId?: string | null;
  readonly authorizeEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly revocationEndpoint?: string;
  readonly discoveryUrl?: string;
  readonly jwksUri?: string;
  readonly issuer?: string;
  readonly resource?: string;
  readonly responsesEndpoint?: string;
  readonly agentNameHint?: string;
  readonly requestedScopes?: readonly string[];
  readonly fallbackGuidance?: string;
}

/**
 * Local stand-in for Task 135. Defaults match the public Sign in with ChatGPT endpoints.
 * An empty revocationEndpoint tells disconnect to read revocation_endpoint from discovery.
 */
export class LocalSignedProviderPolicyEngine implements SignedProviderPolicyEngine {
  constructor(private readonly overrides: SiwcPolicyOverrides = {}) {}

  readSiwcPolicy(): SiwcPolicyDecision {
    return {
      routeRevoked: this.overrides.routeRevoked ?? false,
      registerDynamicClient: this.overrides.registerDynamicClient ?? true,
      staticClientId: this.overrides.staticClientId ?? null,
      authorizeEndpoint: this.overrides.authorizeEndpoint ?? SIWC_AUTHORIZE_ENDPOINT,
      tokenEndpoint: this.overrides.tokenEndpoint ?? SIWC_TOKEN_ENDPOINT,
      revocationEndpoint: this.overrides.revocationEndpoint ?? "",
      discoveryUrl: this.overrides.discoveryUrl ?? SIWC_DISCOVERY_URL,
      jwksUri: this.overrides.jwksUri ?? SIWC_JWKS_URL,
      issuer: this.overrides.issuer ?? SIWC_ISSUER,
      resource: this.overrides.resource ?? SIWC_RESOURCE,
      responsesEndpoint: this.overrides.responsesEndpoint ?? SIWC_RESPONSES_ENDPOINT,
      agentNameHint: this.overrides.agentNameHint ?? SIWC_AGENT_NAME_HINT,
      requestedScopes: this.overrides.requestedScopes ?? SIWC_REQUESTED_SCOPES,
      fallbackGuidance: this.overrides.fallbackGuidance ?? SIWC_ROUTE_REVOKED_GUIDANCE,
    };
  }
}
