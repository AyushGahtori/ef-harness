import type { DeviceCodePrompt } from "./types.js";
import { GITHUB_DEVICE_VERIFICATION_URL } from "./types.js";

export interface GitHubDeviceOAuthHttp {
  requestDeviceCode(clientId: string, scope: string): Promise<DeviceCodePrompt>;
  pollDeviceToken(clientId: string, deviceCode: string): Promise<
    | { readonly kind: "pending" }
    | { readonly kind: "slow_down" }
    | { readonly kind: "success"; readonly accessToken: string; readonly scope: string }
    | { readonly kind: "error"; readonly error: string; readonly description?: string }
  >;
}

export interface GitHubDeviceOAuthOptions {
  readonly clientId: string;
  readonly defaultScopes: readonly string[];
  readonly http: GitHubDeviceOAuthHttp;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DeviceAuthorizationResult {
  readonly accessToken: string;
  readonly scopes: readonly string[];
}

export class GitHubDeviceOAuthFlow {
  constructor(private readonly options: GitHubDeviceOAuthOptions) {}

  async authorize(extraScopes: readonly string[] = []): Promise<DeviceAuthorizationResult> {
    const scope = dedupeScopes([...this.options.defaultScopes, ...extraScopes]).join(" ");
    const prompt = await this.options.http.requestDeviceCode(this.options.clientId, scope);
    const sleep = this.options.sleep ?? delay;
    let interval = prompt.intervalSec * 1_000;
    while (Date.now() < prompt.expiresAtMs) {
      const poll = await this.options.http.pollDeviceToken(this.options.clientId, prompt.deviceCode);
      if (poll.kind === "success") {
        return {
          accessToken: poll.accessToken,
          scopes: poll.scope.split(/[,\s]+/).filter(Boolean),
        };
      }
      if (poll.kind === "slow_down") interval += 5_000;
      if (poll.kind === "error") {
        throw new Error(poll.description ?? poll.error);
      }
      await sleep(interval);
    }
    throw new Error("GitHub device authorization expired before completion");
  }

  buildVerificationPrompt(prompt: DeviceCodePrompt): { readonly url: string; readonly userCode: string } {
    return { url: GITHUB_DEVICE_VERIFICATION_URL, userCode: prompt.userCode };
  }
}

function dedupeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.filter(Boolean))];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}