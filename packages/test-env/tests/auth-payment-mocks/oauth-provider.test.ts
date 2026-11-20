import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalOAuthMockProvider,
  RedirectUriRejectedError,
  SEEDED_ROLES,
  UnknownEnvironmentError,
  importRsaPublicJwk,
  verifyRs256Jwt,
} from "../../src/auth-payment-mocks/index.js";

const providers: LocalOAuthMockProvider[] = [];

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

describe("LocalOAuthMockProvider", () => {
  it("serves discovery, JWKS, code exchange, and a valid login with role claims", async () => {
    const provider = track(new LocalOAuthMockProvider());
    const provisioned = await provider.provision({
      projectId: "proj",
      envId: "env1",
      redirectUris: ["http://env1.localhost:41001/api/auth/callback"],
    });
    expect(provisioned.vars.OAUTH_ISSUER.startsWith("http://127.0.0.1:")).toBe(true);
    expect(provisioned.vars.OAUTH_ISSUER.endsWith("/env1")).toBe(true);
    expect(provider.boundAddress()).toBe("127.0.0.1");

    const discovery = await getJson(`${base(provider)}/env1/.well-known/openid-configuration`);
    const issuer = String(discovery.issuer);
    expect(issuer).toBe(provisioned.vars.OAUTH_ISSUER);
    expect(discovery.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(discovery.token_endpoint).toBe(`${issuer}/token`);
    expect(discovery.userinfo_endpoint).toBe(`${issuer}/userinfo`);
    expect(discovery.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(["RS256"]);

    const jwks = await getJson(`${base(provider)}/env1/.well-known/jwks.json`);
    const keys = jwks.keys as Array<{ kid: string; kty: string; n: string; e: string; alg: string; use: string }>;
    expect(keys).toHaveLength(1);
    const jwk = keys[0];
    if (!jwk) throw new Error("missing jwk");
    expect(jwk.kty).toBe("RSA");
    expect(jwk.alg).toBe("RS256");
    expect(jwk.n.length).toBeGreaterThan(100);
    expect(jwk.e).toBe("AQAB");

    const redirectUri = "http://env1.localhost:41001/api/auth/callback";
    const authorize = await rawRequest(
      "GET",
      `${base(provider)}/env1/authorize?response_type=code&client_id=harness-verifier&redirect_uri=${encodeURIComponent(redirectUri)}&state=state-1&scope=openid&role=kitchen_staff`,
    );
    expect(authorize.status).toBe(302);
    const location = authorize.headers.location;
    expect(typeof location).toBe("string");
    const redirected = new URL(String(location));
    expect(redirected.searchParams.get("state")).toBe("state-1");
    const code = redirected.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await rawRequest(
      "POST",
      `${base(provider)}/env1/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        client_id: "harness-verifier",
        redirect_uri: redirectUri,
      }).toString(),
      { "content-type": "application/x-www-form-urlencoded" },
    );
    expect(token.status).toBe(200);
    const tokenBody = JSON.parse(token.body) as { access_token: string; id_token: string; token_type: string };
    expect(tokenBody.token_type).toBe("Bearer");
    const publicKey = importRsaPublicJwk({
      kty: "RSA",
      use: "sig",
      alg: "RS256",
      kid: jwk.kid,
      n: jwk.n,
      e: jwk.e,
    });
    const idToken = verifyRs256Jwt(tokenBody.id_token, publicKey);
    const accessToken = verifyRs256Jwt(tokenBody.access_token, publicKey);
    expect(idToken.header.alg).toBe("RS256");
    expect(idToken.header.kid).toBe(jwk.kid);
    expect(idToken.payload.iss).toBe(issuer);
    expect(idToken.payload.role).toBe("kitchen_staff");
    expect(idToken.payload.roles).toEqual(["kitchen_staff"]);
    expect(accessToken.payload.sub).toBe("env1:kitchen_staff");
    expect(accessToken.payload.email).toBe("kitchen_staff@env.test");

    const userinfo = await rawRequest("GET", `${base(provider)}/env1/userinfo`, undefined, {
      authorization: `Bearer ${tokenBody.access_token}`,
    });
    expect(userinfo.status).toBe(200);
    expect(JSON.parse(userinfo.body)).toMatchObject({ role: "kitchen_staff", sub: "env1:kitchen_staff" });

    const issued = await provider.issueValidLogin({ envId: "env1", redirectUri, state: "ok", role: "manager" });
    expect(issued.stateMatches).toBe(true);
    expect(issued.claims?.role).toBe("manager");
    expect(issued.claims?.iss).toBe(issuer);
    expect(verifyRs256Jwt(issued.idToken ?? "", publicKey).payload.role).toBe("manager");
    expect(provider.listIdentities("env1").map((identity) => identity.role)).toEqual([...SEEDED_ROLES]);
  });

  it("keeps env-localhost issuer strings consistent across discovery and JWTs", async () => {
    const provider = track(new LocalOAuthMockProvider());
    await provider.start();
    provider.registerEnvironment({ projectId: "proj", envId: "9", issuerStyle: "env-localhost" });
    const redirectUri = "http://127.0.0.1:41009/callback";
    provider.registerRedirectUri("9", "harness-verifier", redirectUri);
    const discovery = provider.discoveryDocument("9");
    if (!discovery) throw new Error("missing discovery");
    const issuer = `http://env9.localhost:${provider.port()}/9`;
    expect(discovery.issuer).toBe(issuer);
    expect(discovery.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(discovery.token_endpoint).toBe(`${issuer}/token`);
    expect(discovery.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
    const issued = await provider.issueValidLogin({ envId: "9", redirectUri, role: "admin" });
    expect(issued.claims?.iss).toBe(issuer);
    expect(issued.idToken?.split(".")[1]).toBeTruthy();
  });

  it("rejects tampered state, expired codes, expired JWTs, invalid signatures, and forbidden roles", async () => {
    const provider = track(new LocalOAuthMockProvider());
    const redirectUri = "http://env1.localhost:41001/api/auth/callback";
    await provider.provision({ projectId: "proj", envId: "env1", redirectUris: [redirectUri] });
    const jwk = provider.jwks().keys[0];
    const publicKey = importRsaPublicJwk(jwk);

    const tampered = await rawRequest(
      "GET",
      `${base(provider)}/env1/authorize?response_type=code&client_id=harness-verifier&redirect_uri=${encodeURIComponent(redirectUri)}&state=abc&scenario=tampered_state`,
    );
    expect(tampered.status).toBe(302);
    expect(new URL(String(tampered.headers.location)).searchParams.get("state")).toBe("abc.tampered");
    const tamperedIssue = await provider.issueTamperedState({ envId: "env1", redirectUri, state: "abc" });
    expect(tamperedIssue.stateMatches).toBe(false);
    expect(tamperedIssue.returnedState).toBe("abc.tampered");

    const started = Date.now();
    const expiredCode = await provider.issueExpiredAuthorizationCode({ envId: "env1", redirectUri, state: "exp-code" });
    const expiredJwt = await provider.issueExpiredJwt({ envId: "env1", redirectUri, state: "exp-jwt", iat: 1, exp: 10 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(expiredCode.codeRedeemable).toBe(false);
    expect(expiredCode.idToken).toBeNull();
    const expiredExchange = provider.exchangeAuthorizationCode({
      envId: "env1",
      code: expiredCode.code,
      clientId: "harness-verifier",
      redirectUri,
    });
    expect(expiredExchange.ok).toBe(false);
    if (!expiredExchange.ok) expect(expiredExchange.body.error).toBe("invalid_grant");
    expect(expiredJwt.claims?.exp).toBe(10);
    expect(expiredJwt.claims?.iat).toBe(1);
    expect(verifyRs256Jwt(expiredJwt.accessToken ?? "", publicKey).payload.exp).toBe(10);
    const expiredUserinfo = await rawRequest("GET", `${base(provider)}/env1/userinfo`, undefined, {
      authorization: `Bearer ${expiredJwt.accessToken ?? ""}`,
    });
    expect(expiredUserinfo.status).toBe(401);
    expect(expiredUserinfo.body).toContain("token expired");

    const invalid = await provider.issueInvalidSignature({ envId: "env1", redirectUri, role: "admin" });
    expect(() => verifyRs256Jwt(invalid.idToken ?? "", publicKey)).toThrow(/signature/i);
    const invalidUserinfo = await rawRequest("GET", `${base(provider)}/env1/userinfo`, undefined, {
      authorization: `Bearer ${invalid.accessToken ?? ""}`,
    });
    expect(invalidUserinfo.status).toBe(401);
    expect(invalidUserinfo.body).toContain("invalid signature");

    const forbidden = await provider.issueForbiddenRoleLogin({ envId: "env1", redirectUri, state: "role" });
    expect(forbidden.role).toBe("unauthorized");
    expect(forbidden.claims?.role).toBe("unauthorized");
    expect(verifyRs256Jwt(forbidden.idToken ?? "", publicKey).payload.roles).toEqual(["unauthorized"]);
    const forbiddenHttp = await rawRequest(
      "GET",
      `${base(provider)}/env1/authorize?response_type=code&client_id=harness-verifier&redirect_uri=${encodeURIComponent(redirectUri)}&state=role-http&scenario=forbidden_role`,
    );
    const forbiddenCode = new URL(String(forbiddenHttp.headers.location)).searchParams.get("code") ?? "";
    const forbiddenToken = provider.exchangeAuthorizationCode({
      envId: "env1",
      code: forbiddenCode,
      clientId: "harness-verifier",
      redirectUri,
    });
    expect(forbiddenToken.ok).toBe(true);
    if (forbiddenToken.ok) {
      expect(verifyRs256Jwt(forbiddenToken.body.id_token, publicKey).payload.role).toBe("unauthorized");
    }

    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const nonePayload = Buffer.from(JSON.stringify({ iss: provider.discoveryDocument("env1")?.issuer, exp: 9_999_999_999 })).toString("base64url");
    const noneToken = await rawRequest("GET", `${base(provider)}/env1/userinfo`, undefined, {
      authorization: `Bearer ${noneHeader}.${nonePayload}.`,
    });
    expect(noneToken.status).toBe(401);
    expect(noneToken.body).toContain("invalid signature");
  });

  it("matches redirect URIs exactly and refuses open redirects", async () => {
    const provider = track(new LocalOAuthMockProvider());
    const registered = "http://env1.localhost:41001/api/auth/callback?next=/kitchen";
    await provider.provision({ projectId: "proj", envId: "env1", redirectUris: [registered] });
    expect(() => provider.registerRedirectUri("env1", "harness-verifier", "https://accounts.google.com/callback")).toThrow(RedirectUriRejectedError);
    expect(() => provider.registerRedirectUri("env1", "harness-verifier", "http://evil.example/cb")).toThrow(RedirectUriRejectedError);

    const attacks = [
      "http://env1.localhost:41001/api/auth/callback?next=/kitchen/",
      "http://env1.localhost:41001/api/auth/callback?next=/other",
      "http://env1.localhost:41001/api/auth/callback",
      "http://evil.example/cb",
    ];
    for (const attack of attacks) {
      const response = await rawRequest(
        "GET",
        `${base(provider)}/env1/authorize?response_type=code&client_id=harness-verifier&redirect_uri=${encodeURIComponent(attack)}&state=x`,
      );
      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain("redirect_uri");
    }

    const ok = await rawRequest(
      "GET",
      `${base(provider)}/env1/authorize?response_type=code&client_id=harness-verifier&redirect_uri=${encodeURIComponent(registered)}&state=exact`,
    );
    expect(ok.status).toBe(302);
    expect(new URL(String(ok.headers.location)).searchParams.get("state")).toBe("exact");
    expect(new URL(String(ok.headers.location)).searchParams.get("next")).toBe("/kitchen");
  });

  it("rejects cross-environment code redemption and keeps sibling state after destroy", async () => {
    const provider = track(new LocalOAuthMockProvider());
    const redirect1 = "http://env1.localhost:41001/api/auth/callback";
    const redirect2 = "http://env2.localhost:41002/api/auth/callback";
    await provider.provision({ projectId: "proj", envId: "env1", redirectUris: [redirect1] });
    await provider.provision({ projectId: "proj", envId: "env2", redirectUris: [redirect2] });
    const env1 = await provider.issueValidLogin({ envId: "env1", redirectUri: redirect1, state: "e1" });
    const env2 = await provider.issueValidLogin({ envId: "env2", redirectUri: redirect2, state: "e2", role: "member" });
    const cross = provider.exchangeAuthorizationCode({
      envId: "env2",
      code: env1.code,
      clientId: "harness-verifier",
      redirectUri: redirect2,
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.body.error).toBe("invalid_grant");
      expect(cross.body.error_description).toContain("environment");
    }
    const once = provider.exchangeAuthorizationCode({
      envId: "env2",
      code: env2.code,
      clientId: "harness-verifier",
      redirectUri: redirect2,
    });
    expect(once.ok).toBe(true);
    const twice = provider.exchangeAuthorizationCode({
      envId: "env2",
      code: env2.code,
      clientId: "harness-verifier",
      redirectUri: redirect2,
    });
    expect(twice.ok).toBe(false);

    const fresh = await provider.issueValidLogin({ envId: "env2", redirectUri: redirect2, state: "keep" });
    await provider.destroy("env1");
    const wiped = await rawRequest("GET", `${base(provider)}/env1/.well-known/openid-configuration`);
    expect(wiped.status).toBe(404);
    expect(() => provider.listIdentities("env1")).toThrow(UnknownEnvironmentError);
    const sibling = provider.exchangeAuthorizationCode({
      envId: "env2",
      code: fresh.code,
      clientId: "harness-verifier",
      redirectUri: redirect2,
    });
    expect(sibling.ok).toBe(true);
    if (sibling.ok) expect(verifyRs256Jwt(sibling.body.id_token, importRsaPublicJwk(provider.jwks().keys[0])).payload.iss).toContain("/env2");
    expect(provider.listIdentities("env2")).toHaveLength(SEEDED_ROLES.length);
  });
});

function track(provider: LocalOAuthMockProvider): LocalOAuthMockProvider {
  providers.push(provider);
  return provider;
}

function base(provider: LocalOAuthMockProvider): string {
  return `http://127.0.0.1:${provider.port()}`;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await rawRequest("GET", url);
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as Record<string, unknown>;
}

function rawRequest(
  method: string,
  url: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
