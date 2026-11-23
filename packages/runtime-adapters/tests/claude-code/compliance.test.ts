import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapterError } from "../../src/claude-code/errors.js";
import { formatBudgetUsd } from "../../src/claude-code/money.js";
import {
  CONSOLE_KEY_REQUIRED_MESSAGE,
  consoleKeyPrefix,
  credentialsFileSuffix,
  oauthTokenEnvName,
  subscriptionOauthPrefix,
  subscriptionSetupMarker,
} from "../../src/claude-code/markers.js";
import { ClaudeConsoleKeyComplianceEnforcer } from "../../src/claude-code/compliance-enforcer.js";
import type { ProcessSpawner } from "../../src/claude-code/ports.js";
import { consoleKey, createHarness, hostEnv, makeLayout, removeLayout, spec, type TempLayout } from "./fixture.js";

const layouts: TempLayout[] = [];

afterEach(async () => {
  while (layouts.length > 0) {
    const layout = layouts.pop();
    if (layout) removeLayout(layout);
  }
});

describe("ClaudeConsoleKeyComplianceEnforcer", () => {
  const enforcer = new ClaudeConsoleKeyComplianceEnforcer();

  it("requires a console key and rejects subscription material without reading personal files", () => {
    const missing = enforcer.evaluate({ secret: null, hostEnv: {}, delivery: "env" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("missing_console_key");
      expect(missing.message).toBe(CONSOLE_KEY_REQUIRED_MESSAGE);
    }

    const allowed = enforcer.evaluate({
      secret: consoleKey(),
      hostEnv: {},
      delivery: "env",
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.secret.startsWith(consoleKeyPrefix())).toBe(true);

    const oat = enforcer.evaluate({
      secret: `${subscriptionOauthPrefix()}01-rejected`,
      hostEnv: {},
      delivery: "env",
    });
    expect(oat.ok).toBe(false);
    if (!oat.ok) expect(oat.code).toBe("subscription_oauth");

    const setup = enforcer.evaluate({
      secret: `user-${subscriptionSetupMarker()}`,
      hostEnv: {},
      delivery: "proxy",
    });
    expect(setup.ok).toBe(false);
    if (!setup.ok) expect(setup.code).toBe("setup_flow");

    const oauthEnv = enforcer.evaluate({
      secret: consoleKey(),
      hostEnv: { [oauthTokenEnvName()]: "present" },
      delivery: "env",
    });
    expect(oauthEnv.ok).toBe(false);
    if (!oauthEnv.ok) expect(oauthEnv.code).toBe("oauth_env");

    const credentials = enforcer.evaluate({
      secret: consoleKey(),
      hostEnv: {},
      sourcePaths: [path.join("C:/Users/dev", credentialsFileSuffix())],
      delivery: "env",
    });
    expect(credentials.ok).toBe(false);
    if (!credentials.ok) expect(credentials.code).toBe("credentials_file");
  });

  it("formats a positive BudgetLedger ceiling as a dollar flag", () => {
    expect(formatBudgetUsd(500_000n)).toBe("0.50");
    expect(() => formatBudgetUsd(0n)).toThrow(/positive/);
  });
});

describe("launch refusal before spawn", () => {
  function refusingSpawner(): ProcessSpawner & { readonly calls: number } {
    const state = { calls: 0 };
    return {
      get calls() {
        return state.calls;
      },
      spawn() {
        state.calls += 1;
        throw new Error("claude must not spawn");
      },
    };
  }

  it("blocks a missing console key before spawning and keeps the personal directory unread", async () => {
    const layout = makeLayout();
    layouts.push(layout);
    const marker = fs.readFileSync(path.join(layout.home, ".claude", ".credentials.json"), "utf8");
    const spawner = refusingSpawner();
    const { adapter } = createHarness(layout, {
      secret: null,
      adapter: { spawner, hostEnv: hostEnv({ OPENAI_API_KEY: "sk-host-should-not-leak" }) },
    });
    await expect(adapter.startSession(spec(layout))).rejects.toMatchObject({
      code: "missing_console_key",
      message: CONSOLE_KEY_REQUIRED_MESSAGE,
    });
    expect(spawner.calls).toBe(0);
    expect(fs.readFileSync(path.join(layout.home, ".claude", ".credentials.json"), "utf8")).toBe(marker);
    const status = adapter.authStatus("conn-1");
    expect(status.state).toBe("missing_console_key");
    expect(status.readsPersonalClaudeHome).toBe(false);
    expect(JSON.stringify(status)).not.toContain(consoleKey());
  });

  it("hard-rejects a subscription prefix and a consumer oauth env var", async () => {
    const layout = makeLayout();
    layouts.push(layout);
    const spawner = refusingSpawner();
    const oat = createHarness(layout, {
      secret: `${subscriptionOauthPrefix()}01-rejected`,
      adapter: { spawner },
    });
    await expect(oat.adapter.startSession(spec(layout))).rejects.toBeInstanceOf(ClaudeCodeAdapterError);
    await expect(oat.adapter.startSession(spec(layout))).rejects.toMatchObject({
      code: "subscription_oauth",
      message: CONSOLE_KEY_REQUIRED_MESSAGE,
    });
    expect(spawner.calls).toBe(0);
    expect(oat.adapter.authStatus("conn-1").state).toBe("rejected_subscription_credential");

    const oauth = createHarness(layout, {
      secret: consoleKey(),
      extraEnv: { [oauthTokenEnvName()]: "present" },
      adapter: { spawner },
    });
    await expect(oauth.adapter.startSession(spec(layout))).rejects.toMatchObject({ code: "oauth_env" });
    expect(spawner.calls).toBe(0);
  });
});
