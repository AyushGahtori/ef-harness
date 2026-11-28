import type { GitHubHttpRequest, GitHubHttpResponse } from "../../src/github/types.js";
import type { GitHubTransport } from "../../src/github/rate-queue.js";
import type { DeviceCodePrompt } from "../../src/github/types.js";
import type { GitHubDeviceOAuthHttp } from "../../src/github/device-oauth.js";

export class MockGitHubApi implements GitHubTransport {
  readonly requests: GitHubHttpRequest[] = [];
  private etagByPath = new Map<string, string>();
  private bodies = new Map<string, { status: number; body: string; headers?: Record<string, string> }>();
  mutationCount = 0;

  route(path: string, response: { status: number; body: unknown; headers?: Record<string, string>; etag?: string }): void {
    const etag = response.etag ?? `W/"${path}-v1"`;
    if (response.etag !== "") this.etagByPath.set(path, etag);
    this.bodies.set(path, {
      status: response.status,
      body: JSON.stringify(response.body),
      headers: { ...(response.headers ?? {}), etag },
    });
  }

  async send(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    this.requests.push(request);
    if (request.mutating || ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      this.mutationCount += 1;
    }
    const path = request.path.split("?")[0] ?? request.path;
    const ifNoneMatch = request.headers?.["If-None-Match"] ?? request.headers?.["if-none-match"];
    const knownEtag = this.etagByPath.get(path);
    if (ifNoneMatch && knownEtag && ifNoneMatch === knownEtag) {
      return { status: 304, headers: { etag: knownEtag }, body: "" };
    }
    const match = [...this.bodies.entries()].find(([key]) => path.startsWith(key) || key.startsWith(path));
    if (!match) {
      return { status: 404, headers: {}, body: '{"message":"Not Found"}' };
    }
    const [, value] = match;
    return {
      status: value.status,
      headers: value.headers ?? {},
      body: value.body,
      etag: value.headers?.etag,
    };
  }
}

export class MockDeviceOAuth implements GitHubDeviceOAuthHttp {
  readonly token = "gho_mock_device_token_alpha";
  prompt: DeviceCodePrompt = {
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    deviceCode: "device_mock_code",
    intervalSec: 0,
    expiresAtMs: Date.now() + 60_000,
  };
  polls = 0;

  async requestDeviceCode(): Promise<DeviceCodePrompt> {
    return this.prompt;
  }

  async pollDeviceToken(): Promise<
    | { readonly kind: "pending" }
    | { readonly kind: "slow_down" }
    | { readonly kind: "success"; readonly accessToken: string; readonly scope: string }
  > {
    this.polls += 1;
    if (this.polls < 2) return { kind: "pending" };
    return { kind: "success", accessToken: this.token, scope: "repo read:org" };
  }
}

export class InMemoryVault {
  readonly store = new Map<string, string>();
  putCount = 0;

  async putGitHubToken(input: {
    readonly projectId: string;
    readonly login: string;
    readonly token: string;
  }): Promise<{ readonly secretId: string }> {
    const secretId = `github-${input.login}`;
    this.store.set(secretId, input.token);
    this.putCount += 1;
    return { secretId };
  }

  async readGitHubToken(secretId: string): Promise<string> {
    const value = this.store.get(secretId);
    if (!value) throw new Error("missing secret");
    return value;
  }
}