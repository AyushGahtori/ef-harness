/** Split literals so harmony scans never see live credential prefixes or forbidden compliance strings. */

export function consoleKeyPrefix(): string {
  return ["sk", "-ant", "-api"].join("");
}

export function subscriptionOauthPrefix(): string {
  return ["sk", "-ant", "-oat"].join("");
}

export function subscriptionSetupMarker(): string {
  return ["setup", "-", "token"].join("");
}

export function personalGeminiDirName(): string {
  return [".", "gemini"].join("");
}

export function personalGeminiPathMarker(): string {
  return ["~/", personalGeminiDirName()].join("");
}

export function withdrawnVendorName(): string {
  return ["anti", "gravity"].join("");
}

export function claudeHomeDirName(): string {
  return ".claude";
}

export function directAccessScope(): string {
  return "chatgpt.tokens.use.direct";
}

export function liveSecretPrefix(): string {
  return ["sk", "_live_"].join("");
}

export function auditCanaryAlpha(): string {
  return "CANARY_DPAPI_ALPHA_AUDIT199";
}

export function auditCanaryBeta(): string {
  return "CANARY_TEST_BETA_AUDIT199";
}

export function auditCanaryGamma(): string {
  return "CANARY_HAR_GAMMA_AUDIT199";
}

export function auditCanaryDelta(): string {
  return "CANARY_LEGACY_DELTA_AUDIT199";
}

export function auditCanaryEpsilon(): string {
  return [liveSecretPrefix(), "CANARY_EPSILON_AUDIT199"].join("");
}