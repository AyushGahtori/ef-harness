import { describe, expect, it } from "vitest";
import { LOOPBACK_HOST } from "../src/constants.ts";
import { OauthFlowError, OauthMock, exerciseAuthorizationCode } from "../src/oauth-mock.ts";
import { canConnect, reserveLoopbackPort } from "../src/ports.ts";

describe("OAuth mock", () => {
  it("exchanges a valid code and rejects bad state, expired codes, and the wrong role", async () => {
    const reserved = await reserveLoopbackPort();
    await reserved.unhold();
    const oauth = await OauthMock.start(reserved.port);
    try {
      const valid = await exerciseAuthorizationCode({
        oauth,
        envId: "env1",
        state: "state-ok",
        expectedState: "state-ok",
        expectedRole: "admin",
      });
      expect(valid.role).toBe("admin");
      expect(valid.issuer).toBe(`http://${LOOPBACK_HOST}:${oauth.port}/env1`);
      const discovery = await fetch(`${oauth.issuer("env2")}/.well-known/openid-configuration`);
      const document = (await discovery.json()) as { issuer: string };
      expect(document.issuer).toBe(oauth.issuer("env2"));
      await expect(
        exerciseAuthorizationCode({
          oauth,
          envId: "env1",
          state: "sent",
          expectedState: "expected",
          expectedRole: "admin",
        }),
      ).rejects.toBeInstanceOf(OauthFlowError);
      await expect(
        exerciseAuthorizationCode({
          oauth,
          envId: "env1",
          state: "soon",
          expectedState: "soon",
          expectedRole: "admin",
          codeTtlMs: 1,
        }),
      ).rejects.toMatchObject({ code: "expired_code" });
      await expect(
        exerciseAuthorizationCode({
          oauth,
          envId: "env2",
          state: "role",
          expectedState: "role",
          role: "guest",
          expectedRole: "admin",
        }),
      ).rejects.toMatchObject({ code: "wrong_role" });
      const missingState = await fetch(
        `${oauth.issuer("env1")}/authorize?response_type=code&redirect_uri=http://${LOOPBACK_HOST}:${oauth.port}/callback`,
      );
      expect(missingState.status).toBe(400);
      expect(await canConnect("::1", oauth.port, 300)).toBe(false);
      const address = await canConnect(LOOPBACK_HOST, oauth.port, 300);
      expect(address).toBe(true);
    } finally {
      await oauth.stop();
      await reserved.release();
    }
  });
});
