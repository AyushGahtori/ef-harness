import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_NOTICE,
  ConnectionsManagementScreen,
  DARK_THEME,
  LIGHT_THEME,
  NO_CONNECTIONS_BANNER,
  ORACLE_FAMILY_NOTE,
  PRIMARY_CARDS,
  auditConnectionsHtml,
  containsForbiddenProvider,
  detectPastedKeyProvider,
  layoutForWidth,
  renderConnectionsHtml,
  themeContrastFailures,
  type ScreenConnection,
} from "../../src/connections/index.js";

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/connections");

function dayMs(days: number): number {
  return days * 86_400_000;
}

function row(overrides: Partial<ScreenConnection> & Pick<ScreenConnection, "id" | "billingTypeBadge">): ScreenConnection {
  return {
    label: overrides.label ?? overrides.id,
    provider: overrides.provider ?? overrides.id,
    family: overrides.family ?? "openai",
    authMode: overrides.authMode ?? "api_key",
    maskedKeyOrEmail: overrides.maskedKeyOrEmail ?? "a•••@example.com",
    statusBadge: overrides.statusBadge ?? "Healthy",
    allowanceLabel: overrides.allowanceLabel ?? "18% of weekly share",
    allowanceRatio: overrides.allowanceRatio ?? 0.18,
    activeCwnd: overrides.activeCwnd ?? 3,
    expiresAtMs: overrides.expiresAtMs ?? null,
    conformanceStatus: overrides.conformanceStatus ?? null,
    monthlySoftMicroUsd: overrides.monthlySoftMicroUsd ?? null,
    monthlyHardMicroUsd: overrides.monthlyHardMicroUsd ?? null,
    ...overrides,
  };
}

describe("ConnectionsManagementScreen", () => {
  it("offers the onboarding cards, keeps Gemini off, and never shows the withdrawn provider", () => {
    const screen = new ConnectionsManagementScreen();
    const html = renderConnectionsHtml(screen.snapshot());
    for (const card of PRIMARY_CARDS) {
      expect(html).toContain(card.title);
    }
    expect(html).toContain('data-card="gemini-cli"');
    expect(html).toContain('data-enabled="false"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain(CLAUDE_CODE_NOTICE);
    expect(html).toContain('data-auth="console_api_key"');
    expect(html).not.toContain("plan login");
    expect(containsForbiddenProvider(html)).toBe(false);
    expect(screen.setGeminiEnabled(true)).toEqual({
      ok: false,
      reason: "Gemini CLI stays off until the policy notice is accepted.",
    });
    expect(screen.snapshot().geminiEnabled).toBe(false);
    screen.setGeminiNoticeAccepted(true);
    expect(screen.setGeminiEnabled(true).ok).toBe(true);
    expect(renderConnectionsHtml(screen.snapshot())).toContain('data-enabled="true"');
    const sources = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(10);
    for (const name of sources) {
      const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
      expect(containsForbiddenProvider(text)).toBe(false);
    }
  });

  it("detects pasted keys, masks the field, and drops the raw value on save", () => {
    const anthropic = `${"sk-ant"}${"-"}sample8841`;
    const openai = `${"sk-proj"}${"-"}sample8841`;
    const openrouter = `${"sk-or-v1"}${"-"}sample8841`;
    const gemini = "AIzaSample8841";
    expect(detectPastedKeyProvider(anthropic)).toBe("anthropic_console");
    expect(detectPastedKeyProvider(openai)).toBe("openai");
    expect(detectPastedKeyProvider(openrouter)).toBe("openrouter");
    expect(detectPastedKeyProvider(gemini)).toBe("gemini");
    const screen = new ConnectionsManagementScreen();
    expect(screen.beginPaste(anthropic).provider).toBe("Anthropic Console");
    expect(screen.secretHeld()).toBe(anthropic);
    expect(renderConnectionsHtml(screen.snapshot())).not.toContain(anthropic);
    expect(renderConnectionsHtml(screen.snapshot())).toContain('type="password"');
    expect(renderConnectionsHtml(screen.snapshot())).toContain('autocomplete="off"');
    const saved = screen.savePaste({ put: () => "vault-ref-sample" });
    expect(saved.masked).toBe("••••8841");
    expect(saved.masked).not.toBe(anthropic);
    expect(screen.secretHeld()).toBeNull();
    const html = renderConnectionsHtml(screen.snapshot());
    expect(html).not.toContain(anthropic);
    expect(html).not.toContain("vault-ref-sample");
    expect(html).toContain("••••8841");
  });

  it("shows live health, reserve, caps, cursor expiry, and the test drawer", async () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    const screen = new ConnectionsManagementScreen({
      nowMs: now,
      connections: [
        row({
          id: "chatgpt",
          label: "ChatGPT Plus",
          provider: "chatgpt",
          billingTypeBadge: "Subscription",
          authMode: "siwc",
          maskedKeyOrEmail: "a•••@example.com",
          allowanceLabel: "18% of weekly share",
          activeCwnd: 3,
        }),
        row({
          id: "cursor",
          label: "Cursor",
          provider: "cursor",
          family: "cursor",
          billingTypeBadge: "Subscription",
          authMode: "browser",
          expiresAtMs: now + dayMs(5),
          maskedKeyOrEmail: "cursor•••",
        }),
        row({
          id: "gemini-cli",
          label: "Gemini CLI",
          provider: "gemini_cli",
          family: "google",
          billingTypeBadge: "Subscription",
          authMode: "cli",
          conformanceStatus: "not_run",
        }),
        row({
          id: "console",
          label: "Anthropic Console",
          provider: "anthropic",
          family: "anthropic",
          billingTypeBadge: "Pay-per-token",
          maskedKeyOrEmail: "••••8841",
        }),
      ],
      probe: {
        probe: async () => ({ latencyMs: 12, discoveredModelCount: 4, diagnostic: "model list ok" }),
      },
    });
    screen.setReserve("chatgpt", 35);
    screen.setSpendCaps("console", 2_000_000, 5_000_000);
    let html = renderConnectionsHtml(screen.snapshot());
    expect(html).toContain("ChatGPT Plus");
    expect(html).toContain("Subscription");
    expect(html).toContain("Pay-per-token");
    expect(html).toContain("siwc");
    expect(html).toContain("a•••@example.com");
    expect(html).toContain("Healthy");
    expect(html).toContain("18% of weekly share");
    expect(html).toContain('data-field="allowance-bar"');
    expect(html).toContain("cwnd 3");
    expect(html).toContain("Keep 35% reserve for personal chats");
    expect(html).toContain("Soft cap $2.00");
    expect(html).toContain("Hard cap $5.00");
    expect(html).toContain("Cursor key expires in 5 days");
    expect(html).toContain("not_run");
    expect(html).toContain(">Test<");
    expect(html).toContain(">Refresh<");
    expect(html).toContain(">Pause<");
    expect(html).toContain(">Remove<");
    await screen.testConnection("gemini-cli");
    html = renderConnectionsHtml(screen.snapshot());
    expect(html).toContain("CLI conformance check");
    expect(html).toContain("12 ms");
    expect(html).toContain("4 models");
    expect(html).toContain("model list ok");
    await screen.testConnection("console");
    expect(renderConnectionsHtml(screen.snapshot())).toContain("Zero-token probe");
  });

  it("warns before removing the last connection during a paused build", () => {
    const screen = new ConnectionsManagementScreen({
      buildPaused: true,
      connections: [row({ id: "only", billingTypeBadge: "Local Free", provider: "ollama", family: "local" })],
    });
    screen.remove("only");
    const model = screen.snapshot();
    expect(model.banner).toBe(NO_CONNECTIONS_BANNER);
    expect(model.activeConnectionId).toBeNull();
    expect(model.resumeBlocked).toBe(true);
    expect(model.danglingConnectionIds).toEqual([]);
    expect(model.rows).toEqual([]);
    expect(renderConnectionsHtml(model)).toContain(NO_CONNECTIONS_BANNER);
  });

  it("keeps an oracle pin and notes when it shares a family with coding", () => {
    const screen = new ConnectionsManagementScreen({
      connections: [
        row({ id: "gpt", label: "ChatGPT Plus", family: "openai", billingTypeBadge: "Subscription" }),
        row({ id: "claude", label: "Anthropic Console", family: "anthropic", billingTypeBadge: "Pay-per-token" }),
      ],
    });
    screen.assignRole("seniorCoding", "gpt");
    screen.assignRole("oracleReview", "gpt");
    const model = screen.snapshot();
    expect(model.oracleNote).toBe(ORACLE_FAMILY_NOTE);
    expect(model.roles.find((role) => role.id === "oracleReview")?.connectionId).toBe("gpt");
    const html = renderConnectionsHtml(model);
    expect(html).toContain(ORACLE_FAMILY_NOTE);
    expect(html).toContain("Oracle Author");
    expect(html).toContain('data-role-matrix="true"');
    expect(html).toContain('data-pinned="true"');
    screen.assignRole("oracleReview", "claude");
    expect(screen.snapshot().oracleNote).toBeNull();
  });

  it("defaults ask-first on and shows a loud warning when automatic fallback is enabled", () => {
    const screen = new ConnectionsManagementScreen();
    expect(screen.snapshot().neverFallbackWithoutAsking).toBe(true);
    expect(screen.snapshot().loudWarning).toBeNull();
    screen.setNeverFallbackWithoutAsking(false);
    screen.setFallbackRule({ fromConnectionId: "chatgpt", toConnectionId: "openrouter", capMicroUsd: 2_000_000 });
    const model = screen.snapshot();
    expect(model.loudWarning).toContain("hard dollar cap");
    expect(screen.fallbackPolicy()).toEqual({
      neverFallbackWithoutAsking: false,
      explicitFallbackOrder: [
        { fromConnectionId: "chatgpt", toConnectionId: "openrouter", capMicroUsd: 2_000_000 },
      ],
    });
    expect(renderConnectionsHtml(model)).toContain('data-loud-warning="true"');
  });

  it("parks a blocked switch on the checkpoint card until one-click consent", () => {
    const screen = new ConnectionsManagementScreen({
      connections: [
        row({ id: "chatgpt", billingTypeBadge: "Subscription", label: "ChatGPT Plus" }),
        row({ id: "anthropic", billingTypeBadge: "Pay-per-token", label: "Anthropic Console", family: "anthropic" }),
      ],
      guard: {
        evaluate: (input) =>
          input.userConsent
            ? { outcome: "allow", message: "approved", costEstimate: "$0.02", parked: false }
            : {
                outcome: "block",
                message: "ChatGPT Plus is paused. Switch Connection only with explicit approval.",
                costEstimate: "About $0.02 per 1K output tokens (estimated, table v4)",
                parked: true,
              },
      },
    });
    screen.previewSwitch("anthropic", "window_exhausted");
    expect(screen.snapshot().activeConnectionId).toBe("chatgpt");
    const blocked = renderConnectionsHtml(screen.snapshot());
    expect(blocked).toContain("Checkpoint stop");
    expect(blocked).toContain("Switch Connection");
    expect(blocked).toContain("explicit approval");
    expect(blocked).toContain("estimated, table v4");
    screen.consentSwitch("anthropic", "window_exhausted");
    expect(screen.snapshot().activeConnectionId).toBe("anthropic");
    expect(screen.snapshot().stopCard).toBeNull();
  });

  it("forwards the explicit dollar cap into the guard and keeps policy-revoked Gemini off", () => {
    let seen: {
      neverFallbackWithoutAsking: boolean;
      spentMicroUsd: number;
      incomingMicroUsd: number;
      userConsent: boolean;
      explicitFallbackOrder: readonly { fromConnectionId: string; toConnectionId: string; capMicroUsd: number }[];
    } | null = null;
    const screen = new ConnectionsManagementScreen({
      geminiCompliance: "route_revoked",
      connections: [
        row({ id: "chatgpt", billingTypeBadge: "Subscription", label: "ChatGPT Plus" }),
        row({ id: "openrouter", billingTypeBadge: "Pay-per-token", label: "OpenRouter", family: "openrouter" }),
      ],
      guard: {
        evaluate: (input) => {
          seen = input;
          return { outcome: "block", message: "cap check", costEstimate: "$2.00", parked: true };
        },
      },
    });
    screen.setGeminiNoticeAccepted(true);
    expect(screen.setGeminiEnabled(true)).toEqual({
      ok: false,
      reason: "Gemini CLI is disabled by signed provider policy.",
    });
    expect(screen.snapshot().geminiEnabled).toBe(false);
    expect(screen.snapshot().geminiInvocation).toBe("gemini --acp");
    screen.setNeverFallbackWithoutAsking(false);
    screen.setFallbackRule({ fromConnectionId: "chatgpt", toConnectionId: "openrouter", capMicroUsd: 2_000_000 });
    screen.previewSwitch("openrouter", "window_exhausted", 100, 50);
    expect(seen).toEqual({
      activeId: "chatgpt",
      candidateId: "openrouter",
      reason: "window_exhausted",
      neverFallbackWithoutAsking: false,
      explicitFallbackOrder: [
        { fromConnectionId: "chatgpt", toConnectionId: "openrouter", capMicroUsd: 2_000_000 },
      ],
      spentMicroUsd: 100,
      incomingMicroUsd: 50,
      userConsent: false,
    });
  });

  it("navigates every control from the keyboard and meets WCAG AA in both themes", () => {
    expect(themeContrastFailures(LIGHT_THEME)).toEqual([]);
    expect(themeContrastFailures(DARK_THEME)).toEqual([]);
    const screen = new ConnectionsManagementScreen({
      theme: "light",
      width: 1280,
      connections: [
        row({ id: "one", billingTypeBadge: "Subscription" }),
        row({ id: "two", billingTypeBadge: "Local Free", family: "local", provider: "ollama" }),
      ],
    });
    expect(screen.snapshot().layout).toBe("split");
    screen.setWidth(600);
    expect(screen.snapshot().layout).toBe("stacked");
    expect(layoutForWidth(600)).toBe("stacked");
    expect(screen.snapshot().focusId).toBe("card:siwc");
    screen.handleKey({ key: "Tab", shiftKey: false });
    expect(screen.snapshot().focusId).toBe("card:paste-api-key");
    screen.handleKey({ key: "Tab", shiftKey: true });
    expect(screen.snapshot().focusId).toBe("card:siwc");
    for (let step = 0; step < 40 && !screen.snapshot().focusId.startsWith("row:"); step += 1) {
      screen.handleKey({ key: "Tab", shiftKey: false });
    }
    expect(screen.snapshot().focusId).toBe("row:one:test");
    screen.handleKey({ key: "ArrowDown", shiftKey: false });
    expect(screen.snapshot().focusId).toBe("row:two:test");
    screen.handleKey({ key: "Enter", shiftKey: false });
    for (let step = 0; step < 40 && screen.snapshot().focusId !== "policy:never-fallback"; step += 1) {
      screen.handleKey({ key: "Tab", shiftKey: false });
    }
    expect(screen.snapshot().focusId).toBe("policy:never-fallback");
    screen.handleKey({ key: "Enter", shiftKey: false });
    expect(screen.snapshot().neverFallbackWithoutAsking).toBe(false);
    const order = screen.snapshot().focusOrder;
    expect(order).toContain("role:oracleReview");
    expect(order).toContain("card:claude-code");
    expect(order).toContain("gemini:notice");
    const light = renderConnectionsHtml(screen.snapshot());
    expect(light).toContain("tabular-nums");
    expect(auditConnectionsHtml(light, "light")).toEqual([]);
    screen.setTheme("dark");
    expect(auditConnectionsHtml(renderConnectionsHtml(screen.snapshot()), "dark")).toEqual([]);
  });
});
