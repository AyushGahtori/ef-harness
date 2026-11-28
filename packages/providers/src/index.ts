export const packageName = "@ef-harness/providers" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  ApiConnectionManager,
  ZeroTokenApiKeyValidator,
} from "./api-keys/index.js";
export { SignedProviderPolicyEngine } from "./policy/index.js";
export { SignInWithChatGptAuthFlow } from "./siwc/index.js";
export * as apiKeys from "./api-keys/index.js";
export * as policy from "./policy/index.js";
export * as signInWithChatGpt from "./siwc/index.js";
