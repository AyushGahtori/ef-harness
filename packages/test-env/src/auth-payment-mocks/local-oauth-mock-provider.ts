import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { RedirectUriRejectedError, UnknownEnvironmentError } from "./errors.js";
import { createLoopbackServer, listenLoopback, readBody, sendJson, sendRedirect, closeServer } from "./http-util.js";
import { generateRsaSigningKey, signRs256Jwt, verifyRs256Jwt, type RsaPublicJwk, type RsaSigningKey } from "./jwt-rs256.js";
import { assertLoopbackRedirectUri, redirectRejectionReason } from "./loopback.js";
import type { JobTerminationHandle, ProvisionedService, ServiceProvider, ServiceProvisionRequest } from "./service-contracts.js";

export const SEEDED_ROLES = ["admin", "manager", "kitchen_staff", "member", "unauthorized"] as const;
export type SeededRole = (typeof SEEDED_ROLES)[number];

export const AUTH_SCENARIOS = [
  "valid",
  "tampered_state",
  "expired_code",
  "expired_jwt",
  "invalid_signature",
  "forbidden_role",
] as const;
export type AuthScenario = (typeof AUTH_SCENARIOS)[number];

export type IssuerStyle = "loopback" | "env-localhost";

export interface TestIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly role: SeededRole;
}

export interface AuthClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly email: string;
  readonly name: string;
  readonly role: SeededRole;
  readonly roles: readonly [SeededRole];
  readonly scope: string;
  readonly nonce?: string;
}

export interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly ["code"];
  readonly subject_types_supported: readonly ["public"];
  readonly id_token_signing_alg_values_supported: readonly ["RS256"];
  readonly scopes_supported: readonly ["openid", "profile", "email"];
  readonly token_endpoint_auth_methods_supported: readonly ["none", "client_secret_post"];
  readonly grant_types_supported: readonly ["authorization_code"];
  readonly claims_supported: readonly ["sub", "iss", "aud", "exp", "iat", "email", "name", "role", "roles", "nonce"];
}

export interface IssueAuthOptions {
  readonly envId: string;
  readonly redirectUri: string;
  readonly clientId?: string;
  readonly state?: string;
  readonly role?: SeededRole;
  readonly iat?: number;
  readonly exp?: number;
  readonly nonce?: string;
  readonly scope?: string;
}

export interface IssuedAuthResult {
  readonly scenario: AuthScenario;
  readonly envId: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly requestedState: string;
  readonly returnedState: string;
  readonly stateMatches: boolean;
  readonly code: string;
  readonly redirectUrl: string;
  readonly role: SeededRole;
  readonly codeExpiresAtMs: number;
  readonly codeRedeemable: boolean;
  readonly idToken: string | null;
  readonly accessToken: string | null;
  readonly claims: AuthClaims | null;
}

export interface TokenSuccess {
  readonly ok: true;
  readonly status: 200;
  readonly body: {
    readonly access_token: string;
    readonly id_token: string;
    readonly token_type: "Bearer";
    readonly expires_in: number;
    readonly scope: string;
  };
}

export interface TokenFailure {
  readonly ok: false;
  readonly status: 400;
  readonly body: {
    readonly error: "invalid_grant" | "invalid_client" | "invalid_request";
    readonly error_description: string;
  };
}

export type TokenResult = TokenSuccess | TokenFailure;

interface ClientState {
  readonly clientId: string;
  readonly redirectUris: Set<string>;
}

interface CodeState {
  readonly code: string;
  readonly envId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly identity: TestIdentity;
  readonly scenario: AuthScenario;
  readonly scope: string;
  readonly requestedState: string;
  readonly returnedState: string;
  expiresAtMs: number;
  consumed: boolean;
  readonly iat?: number;
  readonly exp?: number;
  readonly nonce?: string;
}

interface EnvState {
  readonly envId: string;
  readonly projectId: string;
  readonly issuerStyle: IssuerStyle;
  readonly clients: Map<string, ClientState>;
  readonly codes: Map<string, CodeState>;
  readonly users: Map<SeededRole, TestIdentity>;
}

const DEFAULT_CLIENT_ID = "harness-verifier";
const CODE_TTL_MS = 60_000;

export function isSeededRole(value: string): value is SeededRole {
  return (SEEDED_ROLES as readonly string[]).includes(value);
}

export function seededIdentity(envId: string, role: SeededRole): TestIdentity {
  return {
    sub: `${envId}:${role}`,
    email: `${role}@env.test`,
    name: role,
    role,
  };
}

export class LocalOAuthMockProvider implements ServiceProvider {
  readonly serviceName = "oauth";

  private readonly signingKey: RsaSigningKey;
  private readonly decoyKey: RsaSigningKey;
  private readonly clock: () => number;
  private readonly envs = new Map<string, EnvState>();
  private server: Server | undefined;
  private boundPort: number | undefined;
  private startLock: Promise<void> = Promise.resolve();

  constructor(options?: { readonly clock?: () => number }) {
    this.signingKey = generateRsaSigningKey();
    this.decoyKey = generateRsaSigningKey();
    this.clock = options?.clock ?? Date.now;
  }

  boundAddress(): string {
    return "127.0.0.1";
  }

  port(): number | undefined {
    return this.boundPort;
  }

  jwks(): { readonly keys: readonly [RsaPublicJwk] } {
    return { keys: [this.signingKey.jwk] };
  }

  async start(port = 0): Promise<{ readonly port: number; readonly baseUrl: string }> {
    await this.ensureStarted(port);
    const bound = this.boundPort;
    if (bound === undefined) throw new Error("OAuth mock failed to bind");
    return { port: bound, baseUrl: `http://127.0.0.1:${bound}` };
  }

  async provision(request: ServiceProvisionRequest): Promise<ProvisionedService> {
    this.assertEnvId(request.envId);
    await this.ensureStarted(request.port);
    this.registerEnvironment({
      projectId: request.projectId,
      envId: request.envId,
      ...(request.issuerStyle ? { issuerStyle: request.issuerStyle } : {}),
    });
    const clientId = request.clientId ?? DEFAULT_CLIENT_ID;
    for (const redirectUri of request.redirectUris ?? []) {
      this.registerRedirectUri(request.envId, clientId, redirectUri);
    }
    if (request.job) this.watchJob(request.envId, request.job);
    const issuer = this.issuerFor(this.requireEnv(request.envId));
    return {
      serviceName: this.serviceName,
      url: issuer,
      vars: {
        OAUTH_ISSUER: issuer,
        OAUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
        OAUTH_CLIENT_ID: clientId,
      },
    };
  }

  async resetData(envId: string): Promise<void> {
    const env = this.envs.get(envId);
    if (!env) return;
    env.codes.clear();
  }

  async destroy(envId: string): Promise<void> {
    this.destroyEnvironment(envId);
  }

  registerEnvironment(input: { readonly projectId: string; readonly envId: string; readonly issuerStyle?: IssuerStyle }): void {
    this.assertEnvId(input.envId);
    if (this.envs.has(input.envId)) return;
    const users = new Map<SeededRole, TestIdentity>();
    for (const role of SEEDED_ROLES) users.set(role, seededIdentity(input.envId, role));
    this.envs.set(input.envId, {
      envId: input.envId,
      projectId: input.projectId,
      issuerStyle: input.issuerStyle ?? "loopback",
      clients: new Map(),
      codes: new Map(),
      users,
    });
  }

  registerRedirectUri(envId: string, clientId: string, redirectUri: string): void {
    const env = this.requireEnv(envId);
    try {
      assertLoopbackRedirectUri(redirectUri);
    } catch (error) {
      const reason = redirectRejectionReason(error) ?? "rejected";
      throw new RedirectUriRejectedError(redirectUri, reason);
    }
    let client = env.clients.get(clientId);
    if (!client) {
      client = { clientId, redirectUris: new Set() };
      env.clients.set(clientId, client);
    }
    client.redirectUris.add(redirectUri);
  }

  listIdentities(envId: string): readonly TestIdentity[] {
    return [...this.requireEnv(envId).users.values()];
  }

  destroyEnvironment(envId: string): void {
    this.envs.delete(envId);
    if (this.envs.size === 0 && this.server) {
      const server = this.server;
      this.server = undefined;
      this.boundPort = undefined;
      void closeServer(server).catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
      });
    }
  }

  environmentCount(): number {
    return this.envs.size;
  }

  async issueValidLogin(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("valid", options);
  }

  async issueTamperedState(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("tampered_state", options);
  }

  async issueExpiredAuthorizationCode(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("expired_code", options);
  }

  async issueExpiredJwt(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("expired_jwt", options);
  }

  async issueInvalidSignature(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("invalid_signature", options);
  }

  async issueForbiddenRoleLogin(options: IssueAuthOptions): Promise<IssuedAuthResult> {
    return this.issue("forbidden_role", options);
  }

  exchangeAuthorizationCode(input: {
    readonly envId: string;
    readonly code: string;
    readonly clientId: string;
    readonly redirectUri: string;
  }): TokenResult {
    return this.redeem(input.envId, input.code, input.clientId, input.redirectUri);
  }

  discoveryDocument(envId: string): OidcDiscoveryDocument | undefined {
    const env = this.envs.get(envId);
    if (!env || this.boundPort === undefined) return undefined;
    return discoveryFor(this.issuerFor(env));
  }

  async close(): Promise<void> {
    this.envs.clear();
    const server = this.server;
    this.server = undefined;
    this.boundPort = undefined;
    if (server) await closeServer(server);
  }

  private async issue(scenario: AuthScenario, options: IssueAuthOptions): Promise<IssuedAuthResult> {
    await this.ensureStarted(0);
    this.assertEnvId(options.envId);
    if (!this.envs.has(options.envId)) {
      this.registerEnvironment({ projectId: "local", envId: options.envId });
    }
    const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
    this.registerRedirectUri(options.envId, clientId, options.redirectUri);
    const state = options.state ?? randomBytes(8).toString("hex");
    const created = this.createAuthorization(this.requireEnv(options.envId), {
      clientId,
      redirectUri: options.redirectUri,
      state,
      scenario,
      ...(options.role ? { role: options.role } : {}),
      ...(options.iat !== undefined ? { iat: options.iat } : {}),
      ...(options.exp !== undefined ? { exp: options.exp } : {}),
      ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
    });
    const minted = scenario === "expired_code" ? null : this.mint(created.codeState);
    return {
      scenario,
      envId: options.envId,
      issuer: created.issuer,
      clientId,
      redirectUri: options.redirectUri,
      requestedState: state,
      returnedState: created.codeState.returnedState,
      stateMatches: created.codeState.returnedState === state,
      code: created.codeState.code,
      redirectUrl: created.redirectUrl,
      role: created.codeState.identity.role,
      codeExpiresAtMs: created.codeState.expiresAtMs,
      codeRedeemable: created.codeRedeemable,
      idToken: minted?.idToken ?? null,
      accessToken: minted?.accessToken ?? null,
      claims: minted?.claims ?? null,
    };
  }

  private async ensureStarted(port: number | undefined): Promise<void> {
    const run = this.startLock.then(() => this.ensureStartedUnlocked(port));
    this.startLock = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  private async ensureStartedUnlocked(port: number | undefined): Promise<void> {
    if (this.server && this.boundPort !== undefined) {
      if (port !== undefined && port !== 0 && port !== this.boundPort) {
        throw new Error(
          `OAuth mock is already bound to 127.0.0.1:${this.boundPort} and cannot also bind ${port}`,
        );
      }
      return;
    }
    const server = createLoopbackServer();
    server.on("request", (req, res) => {
      void this.handle(req, res);
    });
    const bound = await listenLoopback(server, port ?? 0);
    this.server = server;
    this.boundPort = bound;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const parts = url.pathname.split("/").filter((part) => part.length > 0);
      const envId = parts[0];
      const rest = parts.slice(1).join("/");
      if (!envId || !this.envs.has(envId)) {
        sendJson(res, 404, { error: "invalid_request", error_description: "unknown environment" });
        return;
      }
      if (req.method === "GET" && rest === ".well-known/openid-configuration") {
        const document = this.discoveryDocument(envId);
        sendJson(res, 200, document);
        return;
      }
      if (req.method === "GET" && rest === ".well-known/jwks.json") {
        sendJson(res, 200, this.jwks());
        return;
      }
      if (req.method === "GET" && rest === "authorize") {
        this.handleAuthorize(envId, url.searchParams, res);
        return;
      }
      if (req.method === "POST" && rest === "token") {
        const body = await readBody(req);
        this.handleToken(envId, new URLSearchParams(body), res);
        return;
      }
      if (req.method === "GET" && rest === "userinfo") {
        this.handleUserinfo(envId, req.headers.authorization, res);
        return;
      }
      if (req.method === "POST" && rest === "clients") {
        const body = await readBody(req);
        this.handleRegister(envId, body, res);
        return;
      }
      sendJson(res, 404, { error: "invalid_request", error_description: "unknown route" });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "server_error", error_description: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private handleAuthorize(envId: string, query: URLSearchParams, res: ServerResponse): void {
    const env = this.requireEnv(envId);
    const redirectUri = query.get("redirect_uri");
    const clientId = query.get("client_id") ?? "";
    const client = env.clients.get(clientId);
    if (!redirectUri || !client || !client.redirectUris.has(redirectUri)) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "redirect_uri is not registered for this client and environment",
      });
      return;
    }
    const responseType = query.get("response_type");
    const state = query.get("state");
    if (!state) {
      sendRedirect(res, appendQuery(redirectUri, { error: "invalid_request", error_description: "state is required" }));
      return;
    }
    if (responseType !== "code") {
      sendRedirect(res, appendQuery(redirectUri, { error: "unsupported_response_type", state }));
      return;
    }
    const scenario = parseScenario(query.get("scenario"));
    if (scenario === null) {
      sendRedirect(res, appendQuery(redirectUri, { error: "invalid_request", error_description: "unknown scenario", state }));
      return;
    }
    const roleParam = query.get("role");
    const iat = parseOptionalInt(query.get("iat"));
    const exp = parseOptionalInt(query.get("exp"));
    const nonce = query.get("nonce");
    const scope = query.get("scope");
    const created = this.createAuthorization(env, {
      clientId,
      redirectUri,
      state,
      scenario,
      ...(roleParam && isSeededRole(roleParam) ? { role: roleParam } : {}),
      ...(iat !== undefined ? { iat } : {}),
      ...(exp !== undefined ? { exp } : {}),
      ...(nonce ? { nonce } : {}),
      ...(scope ? { scope } : {}),
    });
    sendRedirect(res, created.redirectUrl);
  }

  private handleToken(envId: string, body: URLSearchParams, res: ServerResponse): void {
    const grant = body.get("grant_type");
    if (grant !== "authorization_code") {
      sendJson(res, 400, { error: "unsupported_grant_type", error_description: "only authorization_code is supported" });
      return;
    }
    const code = body.get("code") ?? "";
    const clientId = body.get("client_id") ?? "";
    const redirectUri = body.get("redirect_uri") ?? "";
    const result = this.redeem(envId, code, clientId, redirectUri);
    sendJson(res, result.status, result.body);
  }

  private handleUserinfo(envId: string, authorization: string | undefined, res: ServerResponse): void {
    const token = bearer(authorization);
    if (!token) {
      sendJson(res, 401, { error: "invalid_token", error_description: "missing bearer token" });
      return;
    }
    const parts = token.split(".");
    const headerSegment = parts[0];
    if (!headerSegment) {
      sendJson(res, 401, { error: "invalid_token", error_description: "invalid signature" });
      return;
    }
    let header: { alg?: unknown };
    try {
      header = JSON.parse(Buffer.from(headerSegment, "base64url").toString("utf8")) as { alg?: unknown };
    } catch (error) {
      sendJson(res, 401, { error: "invalid_token", error_description: `invalid signature: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (header.alg !== "RS256") {
      sendJson(res, 401, { error: "invalid_token", error_description: "invalid signature" });
      return;
    }
    let verified: ReturnType<typeof verifyRs256Jwt>;
    try {
      verified = verifyRs256Jwt(token, this.signingKey.publicKey);
    } catch (error) {
      sendJson(res, 401, { error: "invalid_token", error_description: `invalid signature: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const env = this.requireEnv(envId);
    const issuer = this.issuerFor(env);
    if (verified.payload.iss !== issuer) {
      sendJson(res, 401, { error: "invalid_token", error_description: "issuer mismatch" });
      return;
    }
    const exp = verified.payload.exp;
    if (typeof exp !== "number" || exp * 1000 <= this.clock()) {
      sendJson(res, 401, { error: "invalid_token", error_description: "token expired" });
      return;
    }
    sendJson(res, 200, {
      sub: verified.payload.sub,
      email: verified.payload.email,
      name: verified.payload.name,
      role: verified.payload.role,
      roles: verified.payload.roles,
    });
  }

  private handleRegister(envId: string, raw: string, res: ServerResponse): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      sendJson(res, 400, { error: "invalid_request", error_description: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      sendJson(res, 400, { error: "invalid_request", error_description: "JSON object required" });
      return;
    }
    const body = parsed as { client_id?: unknown; redirect_uris?: unknown };
    if (typeof body.client_id !== "string" || !Array.isArray(body.redirect_uris)) {
      sendJson(res, 400, { error: "invalid_request", error_description: "client_id and redirect_uris are required" });
      return;
    }
    try {
      for (const redirectUri of body.redirect_uris) {
        if (typeof redirectUri !== "string") throw new RedirectUriRejectedError(String(redirectUri), "not-a-string");
        this.registerRedirectUri(envId, body.client_id, redirectUri);
      }
    } catch (error) {
      if (error instanceof RedirectUriRejectedError) {
        sendJson(res, 400, { error: "invalid_redirect_uri", error_description: error.message });
        return;
      }
      throw error;
    }
    sendJson(res, 201, { client_id: body.client_id, redirect_uris: body.redirect_uris });
  }

  private createAuthorization(
    env: EnvState,
    input: {
      readonly clientId: string;
      readonly redirectUri: string;
      readonly state: string;
      readonly scenario: AuthScenario;
      readonly role?: SeededRole;
      readonly iat?: number;
      readonly exp?: number;
      readonly nonce?: string;
      readonly scope?: string;
    },
  ): { readonly codeState: CodeState; readonly redirectUrl: string; readonly issuer: string; readonly codeRedeemable: boolean } {
    const role = input.scenario === "forbidden_role" ? (input.role ?? "unauthorized") : (input.role ?? "admin");
    const identity = env.users.get(role);
    if (!identity) throw new Error(`role ${role} is not seeded`);
    const nowMs = this.clock();
    const nowSeconds = Math.floor(nowMs / 1000);
    const scope = input.scope ?? "openid profile email";
    const returnedState = input.scenario === "tampered_state" ? `${input.state}.tampered` : input.state;
    const expiredCode = input.scenario === "expired_code";
    let iat = input.iat;
    let exp = input.exp;
    if (input.scenario === "expired_jwt") {
      if (exp === undefined) exp = nowSeconds - 30;
      if (iat === undefined) iat = exp - 60;
    }
    const code = `code_${randomBytes(24).toString("base64url")}`;
    const codeState: CodeState = {
      code,
      envId: env.envId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      identity,
      scenario: input.scenario,
      scope,
      requestedState: input.state,
      returnedState,
      expiresAtMs: expiredCode ? nowMs - 1000 : nowMs + CODE_TTL_MS,
      consumed: false,
      ...(iat !== undefined ? { iat } : {}),
      ...(exp !== undefined ? { exp } : {}),
      ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
    };
    env.codes.set(code, codeState);
    const redirectUrl = appendQuery(input.redirectUri, { code, state: returnedState });
    return { codeState, redirectUrl, issuer: this.issuerFor(env), codeRedeemable: !expiredCode };
  }

  private redeem(envId: string, code: string, clientId: string, redirectUri: string): TokenResult {
    const env = this.envs.get(envId);
    if (!env) {
      return failure("invalid_grant", "authorization code was not issued for this environment");
    }
    const record = env.codes.get(code);
    if (!record) {
      return failure("invalid_grant", "authorization code was not issued for this environment");
    }
    if (record.consumed) return failure("invalid_grant", "authorization code already used");
    if (record.clientId !== clientId) return failure("invalid_grant", "client mismatch");
    if (record.redirectUri !== redirectUri) return failure("invalid_grant", "redirect_uri mismatch");
    if (record.expiresAtMs <= this.clock()) return failure("invalid_grant", "authorization code expired");
    record.consumed = true;
    const minted = this.mint(record);
    const nowSeconds = Math.floor(this.clock() / 1000);
    return {
      ok: true,
      status: 200,
      body: {
        access_token: minted.accessToken,
        id_token: minted.idToken,
        token_type: "Bearer",
        expires_in: Math.max(0, minted.claims.exp - nowSeconds),
        scope: record.scope,
      },
    };
  }

  private mint(record: CodeState): { readonly idToken: string; readonly accessToken: string; readonly claims: AuthClaims } {
    const env = this.requireEnv(record.envId);
    const nowSeconds = Math.floor(this.clock() / 1000);
    const iat = record.iat ?? nowSeconds;
    const exp = record.exp ?? iat + 3600;
    const claims: AuthClaims = {
      iss: this.issuerFor(env),
      sub: record.identity.sub,
      aud: record.clientId,
      iat,
      exp,
      email: record.identity.email,
      name: record.identity.name,
      role: record.identity.role,
      roles: [record.identity.role],
      scope: record.scope,
      ...(record.nonce !== undefined ? { nonce: record.nonce } : {}),
    };
    const key = record.scenario === "invalid_signature"
      ? { kid: this.signingKey.kid, privateKey: this.decoyKey.privateKey }
      : this.signingKey;
    const payload = claimsPayload(claims);
    return {
      idToken: signRs256Jwt(payload, key),
      accessToken: signRs256Jwt(payload, key),
      claims,
    };
  }

  private issuerFor(env: EnvState): string {
    const port = this.boundPort;
    if (port === undefined) throw new Error("OAuth mock is not listening");
    if (env.issuerStyle === "env-localhost") {
      return `http://env${env.envId}.localhost:${port}/${env.envId}`;
    }
    return `http://127.0.0.1:${port}/${env.envId}`;
  }

  private requireEnv(envId: string): EnvState {
    const env = this.envs.get(envId);
    if (!env) throw new UnknownEnvironmentError(envId);
    return env;
  }

  private assertEnvId(envId: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(envId)) {
      throw new Error(`envId ${envId} must match [A-Za-z0-9_-]+`);
    }
  }

  private watchJob(envId: string, job: JobTerminationHandle): void {
    if (job.terminated === true) {
      this.destroyEnvironment(envId);
      return;
    }
    const unsubscribe = job.onTerminate(() => {
      unsubscribe();
      this.destroyEnvironment(envId);
    });
  }
}

function discoveryFor(issuer: string): OidcDiscoveryDocument {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    grant_types_supported: ["authorization_code"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "name", "role", "roles", "nonce"],
  };
}

function claimsPayload(claims: AuthClaims): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    iss: claims.iss,
    sub: claims.sub,
    aud: claims.aud,
    iat: claims.iat,
    exp: claims.exp,
    email: claims.email,
    name: claims.name,
    role: claims.role,
    roles: [...claims.roles],
    scope: claims.scope,
  };
  if (claims.nonce !== undefined) payload.nonce = claims.nonce;
  return payload;
}

function appendQuery(redirectUri: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value);
  return url.toString();
}

function failure(error: TokenFailure["body"]["error"], errorDescription: string): TokenFailure {
  return { ok: false, status: 400, body: { error, error_description: errorDescription } };
}

function parseScenario(value: string | null): AuthScenario | null {
  if (value === null || value === "") return "valid";
  return (AUTH_SCENARIOS as readonly string[]).includes(value) ? (value as AuthScenario) : null;
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}
