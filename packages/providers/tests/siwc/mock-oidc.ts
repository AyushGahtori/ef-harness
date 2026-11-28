import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { pkceS256 } from "../../src/siwc/pkce.js";
import { signRs256Jwt } from "../../src/siwc/jwt.js";
import { SIWC_DIRECT_SCOPE, SIWC_REQUESTED_SCOPES } from "../../src/siwc/constants.js";

interface PendingCode {
  readonly challenge: string;
  readonly nonce: string;
  readonly redirect: string;
  readonly clientId: string;
}

export class MockOidcServer {
  readonly tokenForms: Array<Record<string, string>> = [];
  readonly revokeForms: Array<Record<string, string>> = [];
  readonly responseBodies: unknown[] = [];
  readonly seenRequestHeaders: Array<Record<string, string | string[] | undefined>> = [];
  refreshStarted = 0;
  aborted = false;
  omitDirectScope = false;
  badNonce = false;
  omitIssuedClient = false;
  deny = false;
  callbackClientIdOverride: string | null = null;
  subject = "acct-user";
  email = "user@example.test";
  refreshMode: "rotate" | "invalid_grant" = "rotate";
  sseMode: "hello" | "loop" | "token_ceiling" | "usage_limit" | "rate_limit" = "hello";
  refreshGate: Promise<void> | null = null;
  private readonly server: Server;
  private readonly privateKey: KeyObject;
  private readonly jwk: { n: string; e: string };
  private readonly kid = "efh-test-key";
  private portNumber = 0;
  private issued = 0;
  private serial = 0;
  private readonly codes = new Map<string, PendingCode>();
  private readonly refreshClients = new Map<string, string>();
  private stopped = false;
  private readonly spentRefresh = new Set<string>();

  constructor() {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    const exported = pair.publicKey.export({ format: "jwk" }) as { n?: string; e?: string };
    if (!exported.n || !exported.e) throw new Error("test jwk export failed");
    this.jwk = { n: exported.n, e: exported.e };
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("mock oidc did not bind");
    this.portNumber = address.port;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  get port(): number {
    return this.portNumber;
  }

  origin(): string {
    return `http://127.0.0.1:${this.portNumber}`;
  }

  endpoints(): {
    authorizeEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string;
    discoveryUrl: string;
    jwksUri: string;
    issuer: string;
    responsesEndpoint: string;
  } {
    const origin = this.origin();
    return {
      authorizeEndpoint: `${origin}/api/accounts/authorize`,
      tokenEndpoint: `${origin}/api/accounts/oauth/token`,
      revocationEndpoint: `${origin}/oauth/revoke`,
      discoveryUrl: `${origin}/.well-known/openid-configuration`,
      jwksUri: `${origin}/.well-known/jwks.json`,
      issuer: origin,
      responsesEndpoint: `${origin}/v1/responses`,
    };
  }

  allowRefresh(token: string, clientId: string): void {
    this.refreshClients.set(token, clientId);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin());
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      json(res, 200, { keys: [{ kty: "RSA", kid: this.kid, use: "sig", alg: "RS256", n: this.jwk.n, e: this.jwk.e }] });
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      const endpoints = this.endpoints();
      json(res, 200, {
        issuer: endpoints.issuer,
        authorization_endpoint: endpoints.authorizeEndpoint,
        token_endpoint: endpoints.tokenEndpoint,
        jwks_uri: endpoints.jwksUri,
        revocation_endpoint: endpoints.revocationEndpoint,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/accounts/authorize") {
      this.authorize(url, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/accounts/oauth/token") {
      await this.token(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/revoke") {
      const form = await readForm(req);
      this.revokeForms.push(form);
      res.writeHead(200, { connection: "close" });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      await this.respond(req, res);
      return;
    }
    res.writeHead(404, { connection: "close" });
    res.end("missing");
  }

  private authorize(url: URL, res: ServerResponse): void {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const method = url.searchParams.get("code_challenge_method");
    const nonce = url.searchParams.get("nonce") ?? "";
    let target: URL;
    try {
      target = new URL(redirect);
    } catch {
      res.writeHead(400, { connection: "close" });
      res.end("bad redirect");
      return;
    }
    if (method !== "S256" || !challenge || target.hostname !== "127.0.0.1" || target.pathname !== "/callback") {
      res.writeHead(400, { connection: "close" });
      res.end("bad authorize");
      return;
    }
    const requestedClient = url.searchParams.get("client_id") ?? "";
    let issued = requestedClient;
    if (requestedClient === "dynamic_agent_client") {
      this.issued += 1;
      issued = `oaiapp_efh_${this.issued}`;
    }
    if (!this.deny) {
      const code = `efh.code.${this.serial}`;
      this.serial += 1;
      this.codes.set(code, { challenge, nonce, redirect, clientId: issued });
      target.searchParams.set("code", code);
    }
    if (this.deny) target.searchParams.set("error", "access_denied");
    target.searchParams.set("state", state);
    const callbackClient = this.omitIssuedClient ? null : (this.callbackClientIdOverride ?? issued);
    if (callbackClient) target.searchParams.set("client_id", callbackClient);
    res.writeHead(302, { location: target.toString(), connection: "close" });
    res.end();
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readForm(req);
    this.tokenForms.push(form);
    if (form["grant_type"] === "refresh_token") {
      this.refreshStarted += 1;
      if (this.refreshGate) await this.refreshGate;
      this.refresh(form, res);
      return;
    }
    const pending = this.codes.get(form["code"] ?? "");
    this.codes.delete(form["code"] ?? "");
    if (!pending || form["client_id"] === "dynamic_agent_client" || form["client_id"] !== pending.clientId) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    if (form["redirect_uri"] !== pending.redirect || pkceS256(form["code_verifier"] ?? "") !== pending.challenge) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    json(res, 200, this.issueTokens(pending.clientId, this.badNonce ? "efh-nonce-mismatch" : pending.nonce));
  }

  private refresh(form: Record<string, string>, res: ServerResponse): void {
    const refresh = form["refresh_token"] ?? "";
    const clientId = this.refreshClients.get(refresh);
    if (this.refreshMode === "invalid_grant" || !clientId || form["client_id"] !== clientId || this.spentRefresh.has(refresh)) {
      this.spentRefresh.add(refresh);
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    this.spentRefresh.add(refresh);
    this.refreshClients.delete(refresh);
    json(res, 200, this.issueTokens(clientId, "efh-refresh-nonce", false));
  }

  private issueTokens(clientId: string, nonce: string, includeId = true): Record<string, unknown> {
    this.serial += 1;
    const access = `efh.access.${this.serial}`;
    const refresh = `efh.refresh.${this.serial}`;
    this.refreshClients.set(refresh, clientId);
    const scopes = this.omitDirectScope
      ? SIWC_REQUESTED_SCOPES.filter((scope) => scope !== SIWC_DIRECT_SCOPE)
      : SIWC_REQUESTED_SCOPES;
    const now = Math.floor(Date.now() / 1000);
    const body: Record<string, unknown> = {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
      scope: scopes.join(" "),
    };
    if (includeId) {
      body["id_token"] = signRs256Jwt(this.privateKey, {
        iss: this.origin(),
        aud: clientId,
        sub: this.subject,
        nonce,
        exp: now + 3600,
        iat: now,
        email: this.email,
      }, this.kid);
    }
    return body;
  }

  private async respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readText(req);
    this.seenRequestHeaders.push(req.headers);
    try {
      this.responseBodies.push(JSON.parse(raw) as unknown);
    } catch {
      this.responseBodies.push(raw);
    }
    if (this.sseMode === "usage_limit") {
      json(res, 429, { error: { code: "usage_limit_reached", reset_at: 1_700_000_000 } }, {
        "retry-after": "8",
        "x-ratelimit-remaining-requests": "0",
      });
      return;
    }
    if (this.sseMode === "rate_limit") {
      json(res, 429, { error: { code: "rate_limit_exceeded", reset_at: 1_700_000_100 } }, {
        "retry-after": "4",
      });
      return;
    }
    if (this.sseMode === "loop") {
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "}\n".repeat(300) })}\n\n`);
      const mark = () => {
        this.aborted = true;
      };
      req.on("close", mark);
      req.on("aborted", mark);
      res.on("close", mark);
      return;
    }
    if (this.sseMode === "token_ceiling") {
      const delta = Array.from({ length: 40 }, (_unused, index) => `tok${index}`).join(" ");
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      res.end(`data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`);
      return;
    }
    const hello = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { usage: { output_tokens: 1 } } })}\n\n`,
    ].join("");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-remaining-requests": "3",
      "x-ratelimit-reset-requests": "12s",
    });
    res.end(hello);
  }
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", connection: "close", ...extra });
  res.end(JSON.stringify(body));
}

function readText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const text = await readText(req);
  const params = new URLSearchParams(text);
  const form: Record<string, string> = {};
  for (const [key, value] of params) form[key] = value;
  return form;
}
