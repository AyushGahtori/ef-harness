import { describe, expect, it } from "vitest";
import {
  HonestUsageAnalyticsView,
  REPORTED_BADGE,
  UsageReceiptsCsvExporter,
  estimatedBadge,
  parseRfc4180,
  renderAnalyticsHtml,
  TelemetryReceiptStore,
  type UsageReceipt,
} from "../../src/connections/index.js";

const SECRET = "do-not-leak-sample";
const FORMULA = "=CMD|' /C calc'!A0";

function receipt(overrides: Partial<UsageReceipt> & Pick<UsageReceipt, "timestamp" | "currency">): UsageReceipt {
  return {
    project: "Harbor",
    feature: "billing",
    taskId: `task-${overrides.timestamp}`,
    role: "senior",
    connection: "openai",
    model: "gpt-test",
    phase: "coding",
    inputTokens: 10,
    cachedTokens: 1,
    outputTokens: 4,
    reasoningTokens: 2,
    costMicroUsd: 0,
    windowDeltaPpm: 0,
    premiumRequests: 0,
    tokPerSec: 0,
    gpuMs: 0,
    pricingSource: "estimated",
    priceTableVersion: "7",
    provider: "openai",
    kModel: "",
    windowKind: "5h",
    allowanceUsedPpm: 0,
    resetAt: 0,
    ...overrides,
  };
}

function panel(html: string, name: string): string {
  const start = html.indexOf(`data-panel="${name}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-panel="', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

describe("HonestUsageAnalyticsView", () => {
  it("keeps API, subscription, and local currencies apart", () => {
    const now = Date.parse("2026-11-01T12:00:00.000Z");
    const store = new TelemetryReceiptStore();
    store.insert([
      receipt({
        timestamp: now - 4_000,
        currency: "micro_usd",
        phase: "coding",
        inputTokens: 80,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costMicroUsd: 800_000,
        project: "Harbor",
        feature: "coding",
        model: "gpt-test",
      }),
      receipt({
        timestamp: now - 3_000,
        currency: "micro_usd",
        phase: "paperwork",
        inputTokens: 20,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costMicroUsd: 50_000,
        pricingSource: "provider_reported",
        provider: "openrouter",
        connection: "openrouter",
        project: "Harbor",
        feature: "notes",
        model: "route-test",
        priceTableVersion: "",
      }),
      receipt({
        timestamp: now - 2_000,
        currency: "allowance_ppm",
        connection: "copilot",
        model: "copilot-test",
        windowKind: "5h",
        allowanceUsedPpm: 180_000,
        windowDeltaPpm: 12_000,
        resetAt: now + 2 * 3_600_000 + 5 * 60_000,
        kModel: "0.00042",
        premiumRequests: 7,
        costMicroUsd: 0,
      }),
      receipt({
        timestamp: now - 1_000,
        currency: "local",
        connection: "ollama",
        model: "local-test",
        provider: "ollama",
        inputTokens: 1000,
        outputTokens: 250,
        tokPerSec: 40,
        gpuMs: 1_200,
        pricingSource: "estimated",
        priceTableVersion: "0",
      }),
    ]);
    const view = new HonestUsageAnalyticsView(store, { nowMs: now, pageSize: 20, viewportRows: 10 });
    const model = view.load();
    expect("blendedMicroUsd" in model).toBe(false);
    expect(model.api.estimated.badge).toBe(estimatedBadge("7"));
    expect(model.api.estimated.microUsd).toBe(800_000);
    expect(model.api.estimated.inputTokens).toBe(80);
    expect(model.api.reported.badge).toBe(REPORTED_BADGE);
    expect(model.api.reported.microUsd).toBe(50_000);
    expect(model.api.phase.codingLabel).toBe("Coding >= 80%");
    expect(model.api.phase.paperworkLabel).toBe("Paperwork <= 20%");
    expect(model.api.phase.codingMeetsTarget).toBe(true);
    expect(model.api.phase.paperworkMeetsTarget).toBe(true);
    expect(model.api.groups.byProject.some((group) => group.key === "Harbor")).toBe(true);
    expect(model.api.groups.byFeature.some((group) => group.key === "coding")).toBe(true);
    expect(model.api.groups.byModel.some((group) => group.key === "gpt-test")).toBe(true);
    expect(model.subscription.premiumRequests).toBe(7);
    expect(model.subscription.windows[0]?.percent).toBe("18.00%");
    expect(model.subscription.windows[0]?.countdown).toBe("resets in 2h 05m");
    expect(model.subscription.windows[0]?.kModel).toBe("0.00042");
    expect(model.local.tokens).toBe(1250);
    expect(model.local.averageTokPerSec).toBe(40);
    expect(model.local.gpuMs).toBe(1_200);
    expect(model.local.cloudSpend).toBe("$0.00");
    expect(model.local.cloudMicroUsd).toBe(0);
    const html = renderAnalyticsHtml(model);
    expect(html).not.toContain("data-blended");
    expect(panel(html, "api")).toContain("Estimated from published rates (table v7)");
    expect(panel(html, "api")).toContain(REPORTED_BADGE);
    expect(panel(html, "subscription")).not.toContain("micro-USD");
    expect(panel(html, "subscription")).toContain("k[copilot-test]=0.00042");
    expect(panel(html, "subscription")).toContain("Premium requests 7");
    expect(panel(html, "local")).toContain("$0.00");
    expect(panel(html, "local")).toContain("40 tok/s");
    expect(panel(html, "local")).not.toContain("800000");
    store.close();
  });

  it("flags a paperwork-heavy API mix", () => {
    const store = new TelemetryReceiptStore();
    store.insert([
      receipt({ timestamp: 1, currency: "micro_usd", phase: "coding", inputTokens: 70, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 }),
      receipt({ timestamp: 2, currency: "micro_usd", phase: "paperwork", inputTokens: 30, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 }),
    ]);
    const model = new HonestUsageAnalyticsView(store, { nowMs: 10 }).load();
    expect(model.api.phase.codingMeetsTarget).toBe(false);
    expect(model.api.phase.paperworkMeetsTarget).toBe(false);
    store.close();
  });

  it("pages 10000 receipts with a virtualized window in under 50 ms", () => {
    const store = new TelemetryReceiptStore();
    const rows: UsageReceipt[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      rows.push(
        receipt({
          timestamp: index + 1,
          currency: "micro_usd",
          taskId: `bulk-${index}`,
          project: index % 2 === 0 ? "Harbor" : "Pier",
          inputTokens: 8,
          cachedTokens: 0,
          outputTokens: 2,
          reasoningTokens: 0,
          costMicroUsd: 10,
        }),
      );
    }
    store.insert(rows);
    const view = new HonestUsageAnalyticsView(store, { nowMs: 20_000, pageSize: 80, viewportRows: 40 });
    const started = performance.now();
    const model = view.load();
    const html = renderAnalyticsHtml(model);
    const elapsed = performance.now() - started;
    expect(model.receipts.total).toBe(10_000);
    expect(model.receipts.rendered).toHaveLength(40);
    expect(html).toContain('data-rendered-rows="40"');
    expect(html.match(/data-task="/g)?.length).toBe(40);
    expect(elapsed).toBeLessThan(50);
    view.setSearch("Pier");
    const filtered = view.load();
    expect(filtered.receipts.total).toBe(5_000);
    expect(filtered.receipts.rendered.every((row) => row.project === "Pier")).toBe(true);
    store.close();
  });
});

describe("UsageReceiptsCsvExporter", () => {
  it("writes RFC 4180 CSV, neutralizes formula triggers, and omits secrets", () => {
    const exporter = new UsageReceiptsCsvExporter();
    const exported = exporter.export(
      [
        {
          timestamp: "2026-11-01T00:00:00.000Z",
          project: FORMULA,
          taskId: "task-1",
          role: "senior",
          connection: "openai",
          model: "gpt-test",
          inputTokens: 3,
          cachedTokens: 1,
          outputTokens: 2,
          costOrWindowDelta: "15",
          pricingSource: estimatedBadge("7"),
        },
        {
          timestamp: "2026-11-01T00:00:01.000Z",
          project: "+cmd",
          taskId: "-cmd",
          role: "@cmd",
          connection: "\tcmd",
          model: "\rcmd",
          inputTokens: 1,
          cachedTokens: 0,
          outputTokens: 1,
          costOrWindowDelta: 'say "hi", friend',
          pricingSource: "Estimated",
        },
      ],
      "2026-11-01",
    );
    expect(exported.filename).toBe("ef-harness-usage-2026-11-01.csv");
    expect(exported.body.endsWith("\r\n")).toBe(true);
    expect(exported.body).not.toContain(SECRET);
    const rows = parseRfc4180(exported.body);
    expect(rows[0]).toEqual([
      "timestamp",
      "project",
      "taskId",
      "role",
      "connection",
      "model",
      "inputTokens",
      "cachedTokens",
      "outputTokens",
      "costOrWindowDelta",
      "pricingSource",
    ]);
    expect(rows[1]?.[1]).toBe(`'${FORMULA}`);
    expect(rows[2]?.[1]).toBe("'+cmd");
    expect(rows[2]?.[2]).toBe("'-cmd");
    expect(rows[2]?.[3]).toBe("'@cmd");
    expect(rows[2]?.[4]).toBe("'\tcmd");
    expect(rows[2]?.[5]).toBe("'\rcmd");
    expect(rows[2]?.[9]).toBe('say "hi", friend');
    const store = new TelemetryReceiptStore();
    store.insert([
      receipt({
        timestamp: 50,
        currency: "micro_usd",
        project: FORMULA,
        rawSecret: SECRET,
        vaultRef: "vault-ref-sample",
      }),
    ]);
    const csv = new HonestUsageAnalyticsView(store, { nowMs: 100 }).exportCsv("2026-11-02");
    expect(csv.filename).toBe("ef-harness-usage-2026-11-02.csv");
    expect(csv.body).not.toContain(SECRET);
    expect(csv.body).not.toContain("vault-ref-sample");
    expect(store.persistedDataIncludes(SECRET)).toBe(false);
    expect(store.persistedDataIncludes("vault-ref-sample")).toBe(false);
    expect(parseRfc4180(csv.body)[1]?.[1]).toBe(`'${FORMULA}`);
    store.close();
  });
});
