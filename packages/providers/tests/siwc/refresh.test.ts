import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REFRESH_LEAD_MS,
  SIWC_REQUESTED_SCOPES,
  SIWC_SIGN_IN_EXPIRED_MESSAGE,
  SiwcSignInExpiredError,
  SiwcTokenRefresher,
  siwcTokenSecretName,
  type AccountCardEmitter,
  type ActiveBuildParker,
} from "../../src/siwc/index.js";
import { openHarness, waitFor } from "./support.js";

describe("SiwcTokenRefresher single-flight rotation", () => {
  it.each([10, 12])("runs exactly one refresh for %i concurrent workers", async (workers) => {
    const harness = await openHarness();
    let release = () => undefined;
    harness.server.refreshGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const now = 1_700_000_000_000;
      await seed(harness, now + 30_000);
      const refresher = refresherFor(harness, () => now, () => undefined, () => undefined);
      const pending = Promise.all(Array.from({ length: workers }, () => refresher.ensureFresh("chatgpt-personal")));
      await waitFor(() => harness.server.refreshStarted === 1, "one refresh");
      expect(harness.server.tokenForms.filter((form) => form["grant_type"] === "refresh_token")).toHaveLength(1);
      release();
      const grants = await pending;
      expect(new Set(grants.map((grant) => grant.accessToken)).size).toBe(1);
      expect(harness.server.tokenForms.filter((form) => form["grant_type"] === "refresh_token")).toHaveLength(1);
      const form = harness.server.tokenForms.find((entry) => entry["grant_type"] === "refresh_token");
      expect(form?.["client_id"]).toBe("oaiapp_efh_seed");
      expect(form?.["scope"]).toBeUndefined();
      expect(form?.["resource"]).toBe("https://api.openai.com/v1");
      const stored = JSON.parse((await harness.vault.get(siwcTokenSecretName("chatgpt-personal"))) ?? "{}") as {
        access_token: string;
        refresh_token: string;
      };
      expect(stored.access_token).toBe(grants[0]?.accessToken);
      expect(stored.refresh_token).not.toBe("efh.refresh.seed");
      expect(readFileSync(harness.dbPath).includes(stored.access_token)).toBe(false);
      expect(harness.store.readHostId()).toBe(harness.store.get("chatgpt-personal")?.extAgentHostId);
    } finally {
      release();
      await harness.close();
    }
  });

  it("refreshes only inside the 120 second lead", async () => {
    const harness = await openHarness();
    try {
      expect(REFRESH_LEAD_MS).toBe(120_000);
      const now = 1_700_000_000_000;
      await seed(harness, now + REFRESH_LEAD_MS);
      const refresher = refresherFor(harness, () => now, () => undefined, () => undefined);
      const fresh = await refresher.ensureFresh("chatgpt-personal");
      expect(fresh.accessToken).toBe("efh.access.seed");
      expect(harness.server.refreshStarted).toBe(0);
      harness.store.updateExpiry("chatgpt-personal", now + REFRESH_LEAD_MS - 1, null, null);
      const record = harness.store.get("chatgpt-personal");
      expect({
        expiresAtMs: record?.expiresAtMs,
        earliest: record?.earliestRefreshAtMs,
        delta: (record?.expiresAtMs ?? 0) - now,
      }).toEqual({
        expiresAtMs: now + REFRESH_LEAD_MS - 1,
        earliest: null,
        delta: REFRESH_LEAD_MS - 1,
      });
      const rotated = await refresher.ensureFresh("chatgpt-personal");
      expect(harness.server.refreshStarted).toBe(1);
      expect(rotated.accessToken.startsWith("efh.access.")).toBe(true);
      expect(rotated.accessToken).not.toBe("efh.access.seed");
    } finally {
      await harness.close();
    }
  });

  it("parks once and emits one expired card on invalid_grant without a paid fallback", async () => {
    const harness = await openHarness();
    const effects: string[] = [];
    try {
      const now = 1_700_000_000_000;
      await seed(harness, now + 1_000);
      harness.server.refreshMode = "invalid_grant";
      const refresher = refresherFor(
        harness,
        () => now,
        () => effects.push("park"),
        () => effects.push("card"),
      );
      const pending = Promise.all(Array.from({ length: 10 }, () => refresher.ensureFresh("chatgpt-personal")));
      await expect(pending).rejects.toThrow(SIWC_SIGN_IN_EXPIRED_MESSAGE);
      await expect(refresher.ensureFresh("chatgpt-personal")).rejects.toBeInstanceOf(SiwcSignInExpiredError);
      expect(effects).toEqual(["park", "card"]);
      expect(harness.server.refreshStarted).toBe(1);
      expect(harness.store.get("chatgpt-personal")?.status).toBe("needs_sign_in");
      expect(await harness.vault.get(siwcTokenSecretName("chatgpt-personal"))).toBeNull();
      expect(effects.join(" ")).not.toContain("fallback");
    } finally {
      await harness.close();
    }
  });
});

async function seed(harness: Awaited<ReturnType<typeof openHarness>>, expiresAtMs: number): Promise<void> {
  harness.store.ensureHostId();
  const now = 1_700_000_000_000;
  harness.store.saveConnected({
    id: "chatgpt-personal",
    label: "ChatGPT (personal)",
    plan: "plus",
    clientId: "oaiapp_efh_seed",
    subject: "acct-seed",
    email: "seed@example.test",
    scopes: SIWC_REQUESTED_SCOPES,
    expiresAtMs,
    earliestRefreshAtMs: null,
  }, now);
  await harness.vault.put(siwcTokenSecretName("chatgpt-personal"), JSON.stringify({
    access_token: "efh.access.seed",
    refresh_token: "efh.refresh.seed",
    id_token: "efh.id.seed",
  }));
  harness.server.allowRefresh("efh.refresh.seed", "oaiapp_efh_seed");
}

function refresherFor(
  harness: Awaited<ReturnType<typeof openHarness>>,
  now: () => number,
  park: () => void,
  card: () => void,
): SiwcTokenRefresher {
  const parker: ActiveBuildParker = { park };
  const cards: AccountCardEmitter = {
    emit(event) {
      expect(event.message).toBe(SIWC_SIGN_IN_EXPIRED_MESSAGE);
      card();
    },
  };
  return new SiwcTokenRefresher({
    store: harness.store,
    vault: harness.vault,
    policy: harness.policy,
    parker,
    cards,
    now,
  });
}
