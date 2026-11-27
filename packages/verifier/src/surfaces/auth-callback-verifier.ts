import { appropriateSessionSameSite, appUrl, joinUrl, parseSetCookie, requestJson } from "./http.js";
import { InProcessOAuthMockProvider } from "./ports/oauth-mock.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { AuthCallbackCheckSchema, type AuthCallbackCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export interface AuthCallbackDependencies {
  readonly oauth?: InProcessOAuthMockProvider;
}

interface LoginMaterial {
  readonly stateCookie: string;
  readonly authorizeUrl: string;
}

export class AuthCallbackVerifier implements SurfaceCheckVerifier {
  readonly id = "auth-callback";
  readonly surface = "auth";

  constructor(private readonly dependencies: AuthCallbackDependencies = {}) {}

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(AuthCallbackCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    let owned: InProcessOAuthMockProvider | undefined;
    const oauth = this.dependencies.oauth ?? (owned = new InProcessOAuthMockProvider());
    try {
      if (owned) await owned.start();
      const base = appUrl(context.env.vars());
      return [
        await this.validLogin(base, check, oauth, context),
        await this.rejected(base, check, oauth, context, "tampered_state", `${check.checkId}:tampered-state`),
        await this.rejected(base, check, oauth, context, "expired_code", `${check.checkId}:expired-code`),
        await this.rejected(base, check, oauth, context, "invalid_signature", `${check.checkId}:invalid-signature`),
        await this.wrongRole(base, check, oauth, context),
      ];
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    } finally {
      if (owned) await owned.stop();
    }
  }

  private async begin(base: string, check: AuthCallbackCheck, role: string): Promise<LoginMaterial> {
    const redirectUri = joinUrl(base, check.callbackPath);
    const login = await requestJson(
      `${joinUrl(base, check.loginPath)}?${new URLSearchParams({ role, redirect_uri: redirectUri }).toString()}`,
      { redirect: "manual" },
    );
    const setCookie = login.setCookies.find((cookie) => cookie.toLowerCase().startsWith("oauth_state="));
    const location = login.headers.location;
    if (!setCookie || !location) {
      throw new Error("login route did not return oauth_state and an authorize redirect");
    }
    return { stateCookie: setCookie.split(";")[0]?.trim() ?? setCookie, authorizeUrl: location };
  }

  private async exchange(
    material: LoginMaterial,
    scenario: string,
    mutateState: boolean,
  ): Promise<{ status: number; location: string | undefined; setCookies: readonly string[] }> {
    const authorize = new URL(material.authorizeUrl);
    authorize.searchParams.set("scenario", scenario);
    const issued = await requestJson(authorize.toString(), { redirect: "manual" });
    const callback = issued.headers.location;
    if (!callback) throw new Error("authorize redirect did not return a callback location");
    const callbackUrl = new URL(callback);
    if (mutateState) callbackUrl.searchParams.set("state", `${callbackUrl.searchParams.get("state") ?? ""}-tampered`);
    const response = await requestJson(callbackUrl.toString(), {
      redirect: "manual",
      headers: { cookie: material.stateCookie },
    });
    return { status: response.status, location: response.headers.location, setCookies: response.setCookies };
  }

  private async validLogin(
    base: string,
    check: AuthCallbackCheck,
    oauth: InProcessOAuthMockProvider,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:valid-login`;
    const material = await this.begin(base, check, check.allowedRole);
    const response = await this.exchange(material, "valid", false);
    const cookie = response.setCookies
      .map(parseSetCookie)
      .find((item) => item.name === (check.sessionCookie ?? "session"));
    const problems: string[] = [];
    if (response.status !== 302 && response.status !== 303) problems.push(`status ${response.status} is not a redirect`);
    if (!response.location || new URL(response.location, base).pathname !== check.successRedirect) {
      problems.push(`redirect ${response.location ?? "missing"} !== ${check.successRedirect}`);
    }
    if (!cookie) problems.push("session cookie is missing");
    if (cookie && !cookie.httpOnly) problems.push("session cookie is not HttpOnly");
    if (cookie && !appropriateSessionSameSite(cookie)) problems.push("session cookie SameSite is not appropriate");
    if (cookie) {
      const verified = oauth.verifyIdToken(cookie.value);
      if (!verified.ok || verified.role !== check.allowedRole) {
        problems.push(`role claim ${verified.role ?? verified.reason ?? "missing"} !== ${check.allowedRole}`);
      }
    }
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), { scenario: "valid" });
    }
    return passing(checkId, context, "valid login redirects and sets an HttpOnly session cookie with the role claim", {
      scenario: "valid",
      role: check.allowedRole,
    });
  }

  private async rejected(
    base: string,
    check: AuthCallbackCheck,
    oauth: InProcessOAuthMockProvider,
    context: SurfaceVerifierContext,
    scenario: "tampered_state" | "expired_code" | "invalid_signature",
    checkId: string,
  ): Promise<SurfaceCheckResult> {
    const material = await this.begin(base, check, check.allowedRole);
    const response = await this.exchange(material, scenario, scenario === "tampered_state");
    const session = response.setCookies.map(parseSetCookie).find((item) => item.name === (check.sessionCookie ?? "session"));
    const denied = response.status === 400 || response.status === 401 || response.status === 403;
    if (!denied || session) {
      return implementationFailure(
        checkId,
        context,
        `${scenario} was accepted with status ${response.status}`,
        { scenario },
      );
    }
    void oauth;
    return passing(checkId, context, `${scenario} was rejected`, { scenario, status: response.status });
  }

  private async wrongRole(
    base: string,
    check: AuthCallbackCheck,
    oauth: InProcessOAuthMockProvider,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:wrong-role`;
    const material = await this.begin(base, check, check.deniedRole);
    const response = await this.exchange(material, "wrong_role", false);
    const cookie = response.setCookies.map(parseSetCookie).find((item) => item.name === (check.sessionCookie ?? "session"));
    if (response.status === 401 || response.status === 403) {
      return passing(checkId, context, "wrong-role login was denied", { scenario: "wrong_role", status: response.status });
    }
    if (!cookie) {
      return implementationFailure(checkId, context, "wrong-role login neither denied access nor established a session", {
        scenario: "wrong_role",
      });
    }
    const verified = oauth.verifyIdToken(cookie.value);
    if (!verified.ok || verified.role !== check.deniedRole) {
      return implementationFailure(checkId, context, "wrong-role session does not carry the denied role claim", {
        scenario: "wrong_role",
      });
    }
    const protectedResponse = await requestJson(joinUrl(base, check.protectedPath), {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    if (protectedResponse.status !== 403 && protectedResponse.status !== 401) {
      return implementationFailure(
        checkId,
        context,
        `wrong role ${check.deniedRole} reached ${check.protectedPath} with status ${protectedResponse.status}`,
        { scenario: "wrong_role" },
      );
    }
    return passing(checkId, context, "wrong-role access was denied", {
      scenario: "wrong_role",
      status: protectedResponse.status,
    });
  }
}
