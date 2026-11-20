import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Local port of Task 051 `LocalOAuthMockProvider`.
 * Issues the five verifier scenarios without a live identity provider.
 * Swap this class for the test-env provider when Task 051 is integrated.
 */

export type OAuthScenario =
  | "valid"
  | "tampered_state"
  | "expired_code"
  | "invalid_signature"
  | "wrong_role";

export interface IdTokenClaims {
  readonly role: string;
  readonly exp: number;
  readonly iss: string;
}

interface CodeRecord {
  readonly state: string;
  readonly role: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
  readonly signatureValid: boolean;
}

export interface TokenVerification {
  readonly ok: boolean;
  readonly role?: string;
  readonly reason?: string;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export class InProcessOAuthMockProvider {
  private server: Server | null = null;
  private readonly secret = randomBytes(32);
  private readonly codes = new Map<string, CodeRecord>();
  private port = 0;

  get issuerUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("OAuth mock failed to bind");
    }
    this.port = address.port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.codes.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  verifyIdToken(token: string): TokenVerification {
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed token" };
    const payloadPart = parts[0] ?? "";
    const signaturePart = parts[1] ?? "";
    const expected = this.sign(payloadPart);
    const actual = Buffer.from(signaturePart);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      return { ok: false, reason: "invalid signature" };
    }
    let claims: IdTokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as IdTokenClaims;
    } catch {
      return { ok: false, reason: "malformed claims" };
    }
    if (typeof claims.role !== "string" || claims.role.length === 0) {
      return { ok: false, reason: "missing role claim" };
    }
    return { ok: true, role: claims.role };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private issueToken(role: string): string {
    const payload = base64Url(
      JSON.stringify({
        role,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: this.issuerUrl,
      } satisfies IdTokenClaims),
    );
    return `${payload}.${this.sign(payload)}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.issuerUrl);
    if (request.method === "GET" && url.pathname === "/authorize") {
      const state = url.searchParams.get("state") ?? "";
      const role = url.searchParams.get("role") ?? "member";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const scenario = (url.searchParams.get("scenario") ?? "valid") as OAuthScenario;
      const code = randomBytes(16).toString("hex");
      this.codes.set(code, {
        state,
        role,
        redirectUri,
        expiresAt: scenario === "expired_code" ? Date.now() - 1000 : Date.now() + 60_000,
        signatureValid: scenario !== "invalid_signature",
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
      response.writeHead(302, { location: target.toString() });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const body = await readBody(request);
      const params = new URLSearchParams(body);
      const code = params.get("code") ?? "";
      const record = this.codes.get(code);
      if (!record) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      if (record.expiresAt < Date.now()) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "expired_code" }));
        return;
      }
      if (!record.signatureValid) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_signature" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id_token: this.issueToken(record.role),
          access_token: this.issueToken(record.role),
          role: record.role,
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  }
}
