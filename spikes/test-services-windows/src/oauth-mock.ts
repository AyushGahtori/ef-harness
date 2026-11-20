import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { LOOPBACK_HOST } from "./constants.ts";
import { SpikeError } from "./errors.ts";
import { assertLoopbackHost, assertPortInRange } from "./ports.ts";

interface AuthCode {
  code: string;
  envId: string;
  state: string;
  role: string;
  redirectUri: string;
  expiresAt: number;
}

export class OauthMock {
  readonly host = LOOPBACK_HOST;
  private readonly server: Server;
  private readonly secret = randomBytes(32);
  private readonly codes = new Map<string, AuthCode>();

  readonly port: number;

  private constructor(server: Server, port: number) {
    this.server = server;
    this.port = port;
  }

  static async start(port: number): Promise<OauthMock> {
    assertPortInRange(port);
    assertLoopbackHost(LOOPBACK_HOST);
    const server = createServer();
    const oauth = new OauthMock(server, port);
    server.on("request", (request, response) => {
      void oauth.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, LOOPBACK_HOST, () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string" || address.address !== LOOPBACK_HOST) {
          reject(new SpikeError("non_loopback_bind", "OAuth mock failed the loopback bind check."));
          return;
        }
        resolve();
      });
    });
    return oauth;
  }

  issuer(envId: string): string {
    return `http://${LOOPBACK_HOST}:${this.port}/${envId}`;
  }

  readClaims(token: string): Record<string, string | number> {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) throw new OauthFlowError("token_failed", "malformed id_token");
    const expected = base64Url(createHmac("sha256", this.secret).update(`${header}.${payload}`).digest());
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new OauthFlowError("token_failed", "id_token signature mismatch");
    }
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, string | number>;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  issueCode(input: {
    envId: string;
    state: string;
    role: string;
    redirectUri: string;
    ttlMs: number;
  }): string {
    const code = randomBytes(16).toString("hex");
    this.codes.set(code, {
      code,
      envId: input.envId,
      state: input.state,
      role: input.role,
      redirectUri: input.redirectUri,
      expiresAt: Date.now() + input.ttlMs,
    });
    return code;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", this.issuer(""));
      const parts = url.pathname.split("/").filter((part) => part.length > 0);
      const envId = parts[0] ?? "";
      const route = parts[1] ?? "";
      if (!envId) {
        send(response, 404, { error: "missing environment issuer" });
        return;
      }
      if (route === ".well-known" && parts[2] === "openid-configuration") {
        send(response, 200, this.discovery(envId));
        return;
      }
      if (route === "authorize" && request.method === "GET") {
        this.authorize(envId, url, response);
        return;
      }
      if (route === "token" && request.method === "POST") {
        const body = await readBody(request);
        this.token(envId, new URLSearchParams(body), response);
        return;
      }
      send(response, 404, { error: "unknown oauth route" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 400, { error: message });
    }
  }

  private discovery(envId: string) {
    const issuer = this.issuer(envId);
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      claims_supported: ["sub", "role", "iss"],
    };
  }

  private authorize(envId: string, url: URL, response: ServerResponse): void {
    const state = url.searchParams.get("state");
    const redirectUri = url.searchParams.get("redirect_uri");
    const responseType = url.searchParams.get("response_type");
    if (!state) {
      send(response, 400, { error: "invalid_request", error_description: "state is required" });
      return;
    }
    if (!redirectUri || responseType !== "code") {
      send(response, 400, { error: "invalid_request" });
      return;
    }
    const role = url.searchParams.get("role") ?? "admin";
    const ttlMs = Number(url.searchParams.get("code_ttl_ms") ?? "60000");
    const code = this.issueCode({ envId, state, role, redirectUri, ttlMs });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    response.writeHead(302, { location: target.toString() });
    response.end();
  }

  private token(envId: string, body: URLSearchParams, response: ServerResponse): void {
    const code = body.get("code") ?? "";
    const record = this.codes.get(code);
    if (!record || record.envId !== envId) {
      send(response, 400, { error: "invalid_grant", error_description: "unknown code" });
      return;
    }
    this.codes.delete(code);
    if (record.expiresAt <= Date.now()) {
      send(response, 400, { error: "invalid_grant", error_description: "expired code" });
      return;
    }
    if ((body.get("redirect_uri") ?? "") !== record.redirectUri) {
      send(response, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
      return;
    }
    const idToken = signToken(this.secret, {
      iss: this.issuer(envId),
      sub: `${envId}-user`,
      role: record.role,
      state: record.state,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    send(response, 200, {
      access_token: idToken,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 300,
      role: record.role,
    });
  }
}

export class OauthFlowError extends SpikeError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "OauthFlowError";
  }
}

export async function exerciseAuthorizationCode(options: {
  oauth: OauthMock;
  envId: string;
  state: string;
  expectedState: string;
  role?: string;
  expectedRole: string;
  codeTtlMs?: number;
}): Promise<{ role: string; issuer: string }> {
  if (options.state !== options.expectedState) {
    throw new OauthFlowError("bad_state", `state ${options.state} did not match ${options.expectedState}`);
  }
  const redirectUri = `http://${LOOPBACK_HOST}:${options.oauth.port}/callback`;
  const authorize = new URL(`${options.oauth.issuer(options.envId)}/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", "spike");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", options.state);
  authorize.searchParams.set("role", options.role ?? options.expectedRole);
  if (options.codeTtlMs !== undefined) authorize.searchParams.set("code_ttl_ms", String(options.codeTtlMs));
  const response = await fetch(authorize, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) {
    const text = await response.text();
    throw new OauthFlowError("authorize_failed", text);
  }
  const redirected = new URL(location);
  const returnedState = redirected.searchParams.get("state") ?? "";
  if (returnedState !== options.expectedState) {
    throw new OauthFlowError("bad_state", `redirect state ${returnedState} did not match ${options.expectedState}`);
  }
  const code = redirected.searchParams.get("code") ?? "";
  if (options.codeTtlMs !== undefined && options.codeTtlMs <= 20) {
    await new Promise((resolve) => setTimeout(resolve, options.codeTtlMs + 30));
  }
  const tokenResponse = await fetch(`${options.oauth.issuer(options.envId)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = (await tokenResponse.json()) as { error?: string; error_description?: string; id_token?: string; role?: string };
  if (!tokenResponse.ok) {
    const description = token.error_description ?? token.error ?? "token failed";
    if (description.includes("expired")) throw new OauthFlowError("expired_code", description);
    throw new OauthFlowError("token_failed", description);
  }
  const claims = options.oauth.readClaims(token.id_token ?? "");
  if (claims.role !== options.expectedRole) {
    throw new OauthFlowError("wrong_role", `claim role ${claims.role} did not match ${options.expectedRole}`);
  }
  return { role: claims.role, issuer: String(claims.iss) };
}

function signToken(secret: Buffer, claims: Record<string, string | number>): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = base64Url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
