import type { ProviderRotationLinkMap } from "./types.js";

/**
 * Official provider key-rotation pages. The purge never rotates a key itself;
 * the receipt always tells the developer to do it.
 */
export const PROVIDER_ROTATION_URLS: ProviderRotationLinkMap = {
  STRIPE_SECRET_KEY: "https://dashboard.stripe.com/apikeys",
  OPENAI_API_KEY: "https://platform.openai.com/api-keys",
  ANTHROPIC_API_KEY: "https://console.anthropic.com/settings/keys",
  GITHUB_TOKEN: "https://github.com/settings/tokens",
  GOOGLE_API_KEY: "https://console.cloud.google.com/apis/credentials",
  AWS_ACCESS_KEY_ID: "https://console.aws.amazon.com/iam/home#/security_credentials",
  AWS_SECRET_ACCESS_KEY: "https://console.aws.amazon.com/iam/home#/security_credentials",
};

export const ROTATION_GUIDANCE =
  "Rotation is mandatory. SSD wear-leveling cannot guarantee that overwritten pages are erased, and the key may already have reached the provider. Rotate this key at the provider before relying on the purge.";

const PREFIX_RULES: readonly (readonly [readonly string[], string])[] = [
  [["sk", "_live_"], "STRIPE_SECRET_KEY"],
  [["sk", "_test_"], "STRIPE_SECRET_KEY"],
  [["rk", "_live_"], "STRIPE_SECRET_KEY"],
  [["sk", "-ant-"], "ANTHROPIC_API_KEY"],
  [["sk", "-proj-"], "OPENAI_API_KEY"],
  [["sk", "-or-"], "OPENAI_API_KEY"],
  [["sk", "-"], "OPENAI_API_KEY"],
  [["ghp", "_"], "GITHUB_TOKEN"],
  [["gho", "_"], "GITHUB_TOKEN"],
  [["github", "_pat_"], "GITHUB_TOKEN"],
  [["AIza"], "GOOGLE_API_KEY"],
  [["AK", "IA"], "AWS_ACCESS_KEY_ID"],
];

export function detectSecretLabel(secret: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(explicit)) {
      throw new Error("Secret purge label must be a symbolic provider name.");
    }
    return explicit;
  }
  for (const [parts, label] of PREFIX_RULES) {
    if (secret.startsWith(parts.join(""))) return label;
  }
  return "SECRET";
}

export function rotationUrlForLabel(label: string): string | null {
  return PROVIDER_ROTATION_URLS[label] ?? null;
}

export function redactionPlaceholder(label: string): string {
  return `[REDACTED:${label}]`;
}
