import { liveKeyPrefix } from "./live-key.js";
import type { CanaryToken } from "./types.js";

export function createVaultCanaries(nonce: string): readonly CanaryToken[] {
  return [
    { id: "CANARY_DPAPI_ALPHA", value: `CANARY_DPAPI_ALPHA_${nonce}` },
    { id: "CANARY_TEST_BETA", value: `CANARY_TEST_BETA_${nonce}` },
    { id: "CANARY_HAR_GAMMA", value: `CANARY_HAR_GAMMA_${nonce}` },
    { id: "CANARY_LEGACY_DELTA", value: `CANARY_LEGACY_DELTA_${nonce}` },
    { id: "CANARY_LIVE_EPSILON", value: `${liveKeyPrefix()}CANARY_EPSILON_${nonce}` },
  ];
}

export function syntheticSshCanary(nonce: string, name: "canary" | "canary_key"): string {
  return `SYNTHETIC_SSH_${name}_${nonce}`;
}
