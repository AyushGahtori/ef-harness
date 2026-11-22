import type { EnvScope } from "./types.js";

/** Stripe live secret prefix. Split so source text does not contain the scanner needle. */
export function stripeLivePrefix(): string {
  return ["sk", "_live_"].join("");
}

export function stripeTestPrefix(): string {
  return ["sk", "_test_"].join("");
}

export function stripeRestrictedLivePrefix(): string {
  return "rk_live_";
}

export function stripePublishableLivePrefix(): string {
  return "pk_live_";
}

export function sendGridProductionPrefix(): string {
  return "SG.";
}

/** AWS access key id prefix. Split so source text does not contain the scanner needle. */
export function awsAccessKeyPrefix(): string {
  return ["AK", "IA"].join("");
}

export function githubPersonalTokenPrefix(): string {
  return ["ghp", "_"].join("");
}

export function anthropicKeyPrefix(): string {
  return ["sk-ant", "-"].join("");
}

export function openAiProjectKeyPrefix(): string {
  return ["sk-proj", "-"].join("");
}

export function stripeLiveRefusalMessage(): string {
  const live = stripeLivePrefix();
  const test = stripeTestPrefix();
  return `Refused to inject Stripe LIVE key (${live}...) into local test environment — please supply a Stripe TEST key (${test}...) or use the built-in local Stripe mock!`;
}

export function isTestLikeScope(scope: EnvScope | "preview" | "worker"): boolean {
  return scope === "test" || scope === "dev" || scope === "preview" || scope === "worker";
}

export function looksLikeProviderCredential(value: string): boolean {
  const prefixes = [
    stripeLivePrefix(),
    stripeTestPrefix(),
    stripeRestrictedLivePrefix(),
    "rk_test_",
    stripePublishableLivePrefix(),
    "pk_test_",
    sendGridProductionPrefix(),
    awsAccessKeyPrefix(),
    githubPersonalTokenPrefix(),
    anthropicKeyPrefix(),
    openAiProjectKeyPrefix(),
    ["sk-or-v1", "-"].join(""),
  ];
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function isUnconditionalLiveSecret(value: string): boolean {
  return (
    value.startsWith(stripeLivePrefix()) ||
    value.startsWith(stripeRestrictedLivePrefix()) ||
    value.startsWith(sendGridProductionPrefix())
  );
}

const PROD_TOKEN = /(?:^|[^A-Za-z0-9])prod(?:uction)?(?=$|[^A-Za-z0-9])/i;

export function containsProdMarker(value: string): boolean {
  return PROD_TOKEN.test(value);
}

export function databaseHostname(value: string): string | null {
  if (!/^(?:postgres|postgresql|mysql|redis|rediss|mongodb|mongodb\+srv):\/\//i.test(value)) {
    return null;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function isDatabaseUrl(value: string): boolean {
  return databaseHostname(value) !== null;
}

export function matchesConfiguredProdHost(value: string, prodHostnames: readonly string[]): boolean {
  const host = databaseHostname(value);
  const lower = value.toLowerCase();
  for (const configured of prodHostnames) {
    const needle = configured.toLowerCase();
    if (needle.length === 0) continue;
    if (host === needle || lower.includes(needle)) return true;
  }
  return false;
}

export function isLiveTwilio(value: string, providerHint: string | undefined, taggedProd: boolean): boolean {
  const hinted = providerHint?.toLowerCase() === "twilio" || /twilio/i.test(providerHint ?? "");
  if (!hinted && !taggedProd) return false;
  if (!hinted) return false;
  if (/test/i.test(value) && !taggedProd) return false;
  if (taggedProd) return true;
  return /^SK[0-9a-f]{32}$/i.test(value) || /^[0-9a-f]{32}$/i.test(value);
}

export function isProdTaggedAwsKey(value: string, taggedProd: boolean, name: string | undefined): boolean {
  if (!value.startsWith(awsAccessKeyPrefix())) return false;
  if (taggedProd) return true;
  return typeof name === "string" && containsProdMarker(name);
}

export function maskLastFour(value: string): string {
  const last = value.slice(-4);
  return `\u2022\u2022\u2022\u2022${last}`;
}

export function assertEnvScope(value: string): EnvScope {
  if (value === "test" || value === "dev" || value === "staging" || value === "prod") return value;
  throw new Error(`Unsupported env scope ${value}.`);
}
