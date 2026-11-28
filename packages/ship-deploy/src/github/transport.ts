import type { GitHubHttpRequest, GitHubHttpResponse } from "./types.js";
import type { GitHubTransport } from "./rate-queue.js";

export interface FetchGitHubTransportOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createFetchGitHubTransport(options: FetchGitHubTransportOptions): GitHubTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async send(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
      const url = `${options.baseUrl.replace(/\/$/, "")}${request.path.startsWith("/") ? request.path : `/${request.path}`}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(request.headers ?? {}),
      };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      const init: RequestInit = { method: request.method, headers };
      if (request.body !== undefined) init.body = request.body;
      const response = await fetchImpl(url, init);
      const body = await response.text();
      const responseHeaders = headerRecord(response.headers);
      const etag = responseHeaders.etag;
      return {
        status: response.status,
        headers: responseHeaders,
        body,
        ...(etag ? { etag } : {}),
      };
    },
  };
}