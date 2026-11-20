import { describe, expect, it } from "vitest";
import { AuthCallbackVerifier } from "../../src/surfaces/auth-callback-verifier.js";
import { InProcessOAuthMockProvider } from "../../src/surfaces/ports/oauth-mock.js";
import { listen, sendJson, verifierContext } from "./support.js";

const spec = {
  checkId: "auth.callback",
  loginPath: "/auth/login",
  callbackPath: "/auth/callback",
  protectedPath: "/api/kitchen",
  successRedirect: "/kitchen",
  allowedRole: "kitchen_staff",
  deniedRole: "member",
};

type Flaw = "httponly" | "tampered" | "expired" | "signature" | "wrong-role";

async function startAuth(issuer: string, flaws: ReadonlySet<Flaw>) {
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/auth/login") {
      const state = "state-1";
      const authorize = new URL("/authorize", issuer);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("role", url.searchParams.get("role") ?? "member");
      authorize.searchParams.set("redirect_uri", url.searchParams.get("redirect_uri") ?? "");
      authorize.searchParams.set("client_id", "ef-harness-verifier");
      response.writeHead(302, {
        location: authorize.toString(),
        "set-cookie": `oauth_state=${state}; Path=/`,
      });
      response.end();
      return;
    }
    if (url.pathname === "/auth/callback") {
      const stateCookie = /oauth_state=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
      if (stateCookie !== url.searchParams.get("state") && !flaws.has("tampered")) {
        sendJson(response, 403, { error: "state" });
        return;
      }
      const tokenResponse = await fetch(new URL("/token", issuer), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: url.searchParams.get("code") ?? "" }),
      });
      const tokenBody = (await tokenResponse.json()) as { error?: string; id_token?: string };
      const allowedFlaw =
        (flaws.has("expired") && tokenBody.error === "expired_code") ||
        (flaws.has("signature") && tokenBody.error === "invalid_signature");
      if (!tokenResponse.ok && !allowedFlaw) {
        sendJson(response, 401, { error: tokenBody.error ?? "denied" });
        return;
      }
      const flags = flaws.has("httponly") ? "SameSite=Lax" : "HttpOnly; SameSite=Lax";
      response.writeHead(302, {
        location: "/kitchen",
        "set-cookie": `session=${tokenBody.id_token ?? "forged-session"}; ${flags}; Path=/`,
      });
      response.end();
      return;
    }
    if (url.pathname === "/api/kitchen") {
      const token = /session=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
      if (!token) {
        sendJson(response, 401, { error: "anonymous" });
        return;
      }
      if (flaws.has("wrong-role")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      const payload = token.split(".")[0] ?? "";
      let role = "";
      try {
        role = String((JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: string }).role ?? "");
      } catch {
        role = "";
      }
      if (role !== "kitchen_staff" && role !== "admin" && role !== "manager") {
        sendJson(response, 403, { error: "role" });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

async function run(flaws: readonly Flaw[]) {
  const oauth = new InProcessOAuthMockProvider();
  await oauth.start();
  const server = await startAuth(oauth.issuerUrl, new Set(flaws));
  try {
    return await new AuthCallbackVerifier({ oauth }).verify(spec, verifierContext(server.url));
  } finally {
    await server.close();
    await oauth.stop();
  }
}

describe("AuthCallbackVerifier", () => {
  it("accepts a valid login and rejects tampered state, expired codes, bad signatures, and the wrong role", async () => {
    const results = await run([]);
    expect(results.map((result) => [result.check_id, result.status, result.message])).toEqual([
      ["auth.callback:valid-login", "pass", expect.any(String)],
      ["auth.callback:tampered-state", "pass", expect.any(String)],
      ["auth.callback:expired-code", "pass", expect.any(String)],
      ["auth.callback:invalid-signature", "pass", expect.any(String)],
      ["auth.callback:wrong-role", "pass", expect.any(String)],
    ]);
  });

  it("catches a session cookie that is not HttpOnly", async () => {
    const results = await run(["httponly"]);
    expect(results.find((result) => result.check_id === "auth.callback:valid-login")?.status).toBe("fail");
  });

  it("catches acceptance of a tampered state, an expired code, and an invalid signature", async () => {
    const tampered = await run(["tampered"]);
    const expired = await run(["expired"]);
    const signature = await run(["signature"]);
    expect(tampered.find((result) => result.check_id === "auth.callback:tampered-state")?.status).toBe("fail");
    expect(expired.find((result) => result.check_id === "auth.callback:expired-code")?.status).toBe("fail");
    expect(signature.find((result) => result.check_id === "auth.callback:invalid-signature")?.status).toBe("fail");
  });

  it("catches wrong-role access that is allowed through", async () => {
    const results = await run(["wrong-role"]);
    expect(results.find((result) => result.check_id === "auth.callback:wrong-role")?.status).toBe("fail");
  });
});
