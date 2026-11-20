import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  MemoryGlobalResearchCache,
  ResearchFactCache,
  quarantineWebDoc,
  type ResearchFact,
} from "../src/public.js";

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "injected-page.html"),
  "utf8",
);

const fact: ResearchFact = {
  claim: "The payment_method field is required for createPaymentIntent.",
  exactQuote: "The payment_method field is required for createPaymentIntent. Pass --confirm and stripe@16.4.",
  sourceUrl: "https://nodejs.org/api/stripe",
  docVersion: "16.4",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  verifiedBy: "quote_matcher",
};

describe("ResearchFactCache", () => {
  it("strips hidden HTML and invisible Unicode before a fact is stored", () => {
    const clean = quarantineWebDoc(html, {
      url: "https://nodejs.org/api/stripe",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      pageVersion: "16.4",
    });
    expect(clean.wrappedDataBlock).toContain('trust="untrusted"');
    expect(clean.wrappedDataBlock).toContain("tools=\"none\"");
    expect(clean.plainText).toContain("payment_method field is required");
    expect(clean.plainText).not.toContain("evil-helper");
    expect(clean.plainText.toLowerCase()).not.toContain("ignore prior rules");

    const cache = new ResearchFactCache(new MemoryGlobalResearchCache());
    const stored = cache.put({
      topicHash: "topic-stripe",
      libraryName: "stripe",
      version: "16.4.0",
      facts: [fact],
      sourceHtml: html,
      fetchedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      projectId: "alpha",
      url: "https://nodejs.org/api/stripe",
      pageVersion: "16.4",
    });
    expect(stored.sourceExcerpt).not.toContain("evil-helper");
    expect(stored.sourceExcerpt.toLowerCase()).not.toContain("ignore prior rules");
    expect(stored.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.schemaRow.packageName).toBe("stripe");
    expect(stored.schemaRow.versionRange).toBe("16.4");
    expect(stored.schemaRow.docUrl).toBe("ef-topic:topic-stripe");
  });

  it("hits across projects for 90 days and misses on day 91 or a version bump", () => {
    const store = new MemoryGlobalResearchCache();
    const cache = new ResearchFactCache(store);
    const fetchedAt = Date.parse("2026-01-01T00:00:00.000Z");
    cache.put({
      topicHash: "zod-parse",
      libraryName: "zod",
      version: "3.24.1",
      facts: [fact],
      sourceHtml: fact.exactQuote,
      fetchedAt,
      projectId: "alpha",
    });
    cache.put({
      topicHash: "playwright-launch",
      libraryName: "playwright",
      version: "1.50.0",
      facts: [fact],
      sourceHtml: fact.exactQuote,
      fetchedAt,
      projectId: "alpha",
    });

    const within = fetchedAt + 90 * DAY_MS - 1;
    for (const projectId of ["alpha", "beta", "gamma"]) {
      const zod = cache.get({
        topicHash: "zod-parse",
        libraryName: "zod",
        version: "3.24.2",
        now: within,
        projectId,
      });
      const playwright = cache.get({
        topicHash: "playwright-launch",
        libraryName: "playwright",
        version: "1.50.3",
        now: within,
        projectId,
      });
      expect(zod.cache_hit).toBe(true);
      expect(zod.tokens).toBe(0);
      expect(zod.status).toBe("fresh");
      expect(playwright.cache_hit).toBe(true);
      expect(playwright.tokens).toBe(0);
    }
    expect(
      cache.get({
        topicHash: "zod-parse",
        libraryName: "zod",
        version: "3.24.2",
        now: within,
        projectId: "gamma",
      }).record?.servedProjects,
    ).toEqual(["alpha", "beta", "gamma"]);

    const day91 = fetchedAt + 91 * DAY_MS;
    expect(
      cache.get({ topicHash: "zod-parse", libraryName: "zod", version: "3.24.1", now: day91 }).status,
    ).toBe("expired");
    expect(
      cache.get({
        topicHash: "zod-parse",
        libraryName: "zod",
        version: "3.24.1",
        now: day91,
        offline: true,
      }).status,
    ).toBe("stale_offline_fallback");

    expect(
      cache.get({ topicHash: "zod-parse", libraryName: "zod", version: "3.25.0", now: within }).cache_hit,
    ).toBe(false);
    expect(
      cache.get({ topicHash: "playwright-launch", libraryName: "playwright", version: "2.0.0", now: within })
        .cache_hit,
    ).toBe(false);

    expect(cache.invalidateUpgrade("zod", "3.24.1", "3.25.0")).toBeGreaterThan(0);
    expect(
      cache.get({ topicHash: "zod-parse", libraryName: "zod", version: "3.24.1", now: within }).status,
    ).toBe("miss");
  });
});
