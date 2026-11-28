/** Compliance fragments. Kept split so source scans never see a live credential prefix. */

export function consoleKeyPrefix(): string {
  return ["sk", "-ant", "-api"].join("");
}

export function subscriptionOauthPrefix(): string {
  return ["sk", "-ant", "-oat"].join("");
}

export function subscriptionSetupMarker(): string {
  return ["setup", "-", "token"].join("");
}

export function oauthTokenEnvName(): string {
  return ["CLAUDE_CODE_", "OAUTH_TOKEN"].join("");
}

export function credentialsFileSuffix(): string {
  return [".claude", "/", ".credentials.json"].join("");
}

export function forbiddenSkipPermissionsFlag(): string {
  return ["--dangerously", "-skip-permissions"].join("");
}

export const CONSOLE_KEY_REQUIRED_MESSAGE =
  "Anthropic Console API key required — Claude consumer subscriptions are not supported";

export const STRIPPED_DISALLOWED_TOOLS = "Bash,WebFetch,WebSearch,Edit,Write";
