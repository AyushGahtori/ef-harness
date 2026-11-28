import http from "node:http";
import { SIWC_FORBIDDEN_WIRE_FIELDS } from "./constants.ts";
import { directAccessScope } from "./markers.ts";

export interface DirectRequestInput {
  readonly model: string;
  readonly text: string;
  readonly threadId: string;
  readonly temperature?: number;
  readonly leakForbidden?: boolean;
}

export function buildDirectRequest(input: DirectRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    store: false,
    stream: true,
    model: input.model,
    input: input.text,
    scope: directAccessScope(),
    thread_id: input.threadId,
  };
  if (input.leakForbidden === true && input.temperature !== undefined) {
    body.temperature = input.temperature;
    body.max_output_tokens = 128;
    body.previous_response_id = "resp_old";
  }
  if (input.leakForbidden === true) return body;
  for (const field of SIWC_FORBIDDEN_WIRE_FIELDS) {
    delete body[field];
  }
  return body;
}

export function wireProblems(body: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (body.store !== false) problems.push("store");
  if (body.stream !== true) problems.push("stream");
  if (body.scope !== directAccessScope()) problems.push("scope");
  for (const field of SIWC_FORBIDDEN_WIRE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) problems.push(field);
  }
  return problems;
}

export class SiwcTokenRefresher {
  async refresh(
    origin: string,
    fail: boolean,
  ): Promise<{ readonly ok: boolean; readonly accessReady: boolean }> {
    if (fail) return { ok: false, accessReady: false };
    const response = await postJson(`${origin}/oauth/token`, { grant_type: "refresh_token" });
    if (response.status !== 200) return { ok: false, accessReady: false };
    return { ok: response.text.includes("access_token"), accessReady: true };
  }
}

export function postJson(url: string, body: unknown): Promise<{ readonly status: number; readonly text: string }> {
  return request(url, "POST", JSON.stringify(body));
}

export function getJson(url: string): Promise<{ readonly status: number; readonly text: string }> {
  return request(url, "GET");
}

function request(url: string, method: string, body?: string): Promise<{ readonly status: number; readonly text: string }> {
  const target = new URL(url);
  const payload = body ?? "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          connection: "close",
          ...(payload.length > 0
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", (error) => {
      reject(new Error(`${method} ${url} failed: ${error.message}`));
    });
    if (payload.length > 0) req.write(payload);
    req.end();
  });
}
