import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_COMPLIANCE_MESSAGE,
  ComplianceLockError,
  CompliancePolicyLocks,
  GEMINI_INVOCATION,
  GEMINI_POLICY_NOTICE,
  SIWC_FORBIDDEN_FIELDS,
  anthropicConsolePrefix,
  anthropicSubscriptionPrefix,
  claudeCredentialsPathMarker,
  claudeSetupTokenMarker,
  forbiddenVendorRouteId,
  geminiCredentialDirectoryMarker,
  isForbiddenVendorName,
} from "../../src/policy/index.js";
import { createEngine, editablePolicy, signPolicy } from "./fixtures.js";

describe("CompliancePolicyLocks", () => {
  const locks = new CompliancePolicyLocks();

  it("accepts Anthropic console keys and rejects subscription tokens, setup tokens, and credential paths", () => {
    const consoleKey = `${anthropicConsolePrefix()}01-sample`;
    const subscriptionKey = `${anthropicSubscriptionPrefix()}01-sample`;
    expect(locks.inspectCredential({ secret: consoleKey }).allowed).toBe(true);
    expect(locks.inspectCredential({ secret: consoleKey }).code).toBe("anthropic_console_api_key");

    const subscription = locks.inspectCredential({ secret: subscriptionKey });
    expect(subscription.allowed).toBe(false);
    expect(subscription.code).toBe("anthropic_subscription_oauth");
    expect(subscription.message).toBe(ANTHROPIC_COMPLIANCE_MESSAGE);

    const setup = locks.inspectCredential({
      command: `claude ${claudeSetupTokenMarker()}`,
      provider: "anthropic",
    });
    expect(setup.allowed).toBe(false);
    expect(setup.code).toBe("anthropic_setup_token");
    expect(setup.message).toBe(ANTHROPIC_COMPLIANCE_MESSAGE);

    const claudePath = locks.inspectCredential({ sourcePath: claudeCredentialsPathMarker() });
    expect(claudePath.allowed).toBe(false);
    expect(claudePath.code).toBe("claude_credentials_path");
    expect(claudePath.message).toBe(ANTHROPIC_COMPLIANCE_MESSAGE);

    const otherAnthropic = locks.inspectCredential({
      provider: "anthropic",
      secret: "not-a-console-key",
    });
    expect(otherAnthropic.allowed).toBe(false);
    expect(otherAnthropic.message).toBe(ANTHROPIC_COMPLIANCE_MESSAGE);
  });

  it("keeps Gemini CLI off by default, requires the policy notice, and never reads its credential directory", () => {
    const off = locks.geminiCli(false);
    expect(off.enabled).toBe(false);
    expect(off.requiresExplicitOptIn).toBe(true);
    expect(off.invocation).toBe(GEMINI_INVOCATION);
    expect(off.notice).toBe(GEMINI_POLICY_NOTICE);
    expect(off.readsCredentialDirectory).toBe(false);
    expect(off.message).toContain(GEMINI_POLICY_NOTICE);

    expect(() =>
      locks.assertGeminiLaunch({
        optedIn: false,
        invocation: GEMINI_INVOCATION,
        readsCredentialDirectory: false,
      }),
    ).toThrow(ComplianceLockError);

    expect(() =>
      locks.assertGeminiLaunch({
        optedIn: true,
        invocation: GEMINI_INVOCATION,
        readsCredentialDirectory: true,
      }),
    ).toThrow(ComplianceLockError);

    const geminiPath = `${geminiCredentialDirectoryMarker()}/oauth_creds.json`;
    const pathDecision = locks.inspectCredential({ sourcePath: geminiPath });
    expect(pathDecision.allowed).toBe(false);
    expect(pathDecision.code).toBe("gemini_credentials_path");
    expect(pathDecision.message).toContain(GEMINI_POLICY_NOTICE);
    expect(() =>
      locks.assertGeminiLaunch({
        optedIn: true,
        invocation: GEMINI_INVOCATION,
        readsCredentialDirectory: false,
        sourcePath: geminiPath,
      }),
    ).toThrow(ComplianceLockError);

    const optedIn = locks.assertGeminiLaunch({
      optedIn: true,
      invocation: GEMINI_INVOCATION,
      readsCredentialDirectory: false,
    });
    expect(optedIn.enabled).toBe(true);
    expect(optedIn.readsCredentialDirectory).toBe(false);
    expect(optedIn.invocation).toBe("gemini --acp");
  });

  it("rejects the forbidden vendor in custom config and keeps it out of the bundled policy", () => {
    expect(() => locks.assertRouteAllowed(forbiddenVendorRouteId())).toThrow(ComplianceLockError);
    expect(() =>
      locks.assertCustomConfig({
        routeId: forbiddenVendorRouteId(),
        provider: "google",
        runtime: "gemini",
      }),
    ).toThrow(ComplianceLockError);
    expect(() => locks.assertCustomConfig({ runtime: `my-${forbiddenVendorRouteId()}-route` })).toThrow(
      ComplianceLockError,
    );
    expect(isForbiddenVendorName(`My ${forbiddenVendorRouteId()} Runtime`)).toBe(true);

    const { engine } = createEngine();
    engine.loadStartup();
    const document = engine.activeDocument();
    expect(document.routes.some((route) => isForbiddenVendorName(route.id))).toBe(false);
    expect(document.routes.some((route) => isForbiddenVendorName(route.provider))).toBe(false);
    const gemini = document.routes.find((route) => route.id === "gemini_cli_acp");
    expect(gemini?.status).toBe("opt_in_with_notice");
    expect(gemini?.defaultEnabled).toBe(false);
    expect(gemini?.invocation).toBe(GEMINI_INVOCATION);
    expect(gemini?.notice).toBe(GEMINI_POLICY_NOTICE);
    expect(gemini?.readsCredentialDirectory).toBe(false);
    const siwc = locks.siwcConstraints();
    expect(siwc.store).toBe(false);
    expect(siwc.stream).toBe(true);
    expect(siwc.persistExtAgentHostId).toBe(true);
    expect(siwc.scope).toBe("chatgpt.tokens.use.direct");
    expect([...siwc.forbiddenRequestFields].sort()).toEqual([...SIWC_FORBIDDEN_FIELDS].sort());
  });

  it("rejects a signed policy that weakens an immutable compliance lock", () => {
    const { engine } = createEngine();
    engine.loadStartup();
    const weakened = editablePolicy();
    weakened.policyVersion += 1;
    weakened.compliance.geminiCliDefaultEnabled = true;
    weakened.compliance.geminiNotice = "notice removed";
    weakened.compliance.siwc.store = true;
    const gemini = weakened.routes.find((route) => route.id === "gemini_cli_acp");
    expect(gemini).toBeTruthy();
    if (gemini) {
      gemini.status = "allowed";
      gemini.defaultEnabled = true;
      gemini.notice = "notice removed";
    }
    const anthropic = weakened.routes.find((route) => route.id === "claude_code");
    if (anthropic) anthropic.consoleKeyOnly = false;
    weakened.routes.push({
      ...weakened.routes[0]!,
      id: forbiddenVendorRouteId(),
      provider: forbiddenVendorRouteId(),
    });
    const result = engine.ingestRemotePolicy(signPolicy(weakened));
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("compliance_lock");
    expect(engine.activeDocument().policyVersion).toBe(2026111701);
    expect(engine.activeDocument().routes.some((route) => route.id === forbiddenVendorRouteId())).toBe(
      false,
    );
    expect(engine.policyHistory()).toHaveLength(1);
  });
});
