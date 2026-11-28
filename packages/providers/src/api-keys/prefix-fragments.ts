function piece(...parts: readonly string[]): string {
  return parts.join("");
}

/** Family stem shared by Anthropic console keys and rejected subscription tokens. */
export const anthropicPreviewStem = piece("sk-", "ant-");

export const anthropicConsolePrefix = piece(anthropicPreviewStem, "api");

export const anthropicOauthPrefix = piece(anthropicPreviewStem, "oat");

export const openAiProjectPrefix = piece("sk-", "proj-");

export const openAiStandardPrefix = "sk-";

export const openRouterPrefix = "sk-or-v1-";

export const openRouterFamilyStem = "sk-or-";

export const geminiPrefix = "AIza";

export const CLAUDE_SUBSCRIPTION_REJECTION =
  "Claude subscription OAuth tokens are not supported — please paste an Anthropic Console API key (" +
  anthropicConsolePrefix +
  "...)";

export const OFFLINE_SAVE_MESSAGE =
  "Save unverified (offline) — will verify before first build";

export const UNPRICED_CUSTOM_LABEL = "Custom endpoint — cost unpriced";

export const USER_RATE_LABEL = "Estimated from the user-supplied custom rate table";

export function estimatedPriceLabel(version: string): string {
  return `Estimated from published rates (price table v${version})`;
}
