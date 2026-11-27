import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CasBlobStore, GlobalBrokerDb, bindKnowledgeGraph, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import {
  BrokerResearchCache,
  FeatureResearchOrchestrator,
  ProjectStateKnowledgeGraph,
  ResearchFactCache,
  casFactBodies,
  type ResearchFact,
} from "../../src/public.js";

const VISIBLE =
  "The payment_method field is required for createPaymentIntent. Pass --confirm and stripe@16.4.";
const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "injected-page.html"),
  "utf8",
);

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const fact: ResearchFact = {
  claim: "The payment_method field is required for createPaymentIntent.",
  exactQuote: VISIBLE,
  sourceUrl: "https://nodejs.org/api/stripe",
  docVersion: "16.4",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  verifiedBy: "quote_matcher",
};

describe("research facts over ProjectStateDb and CasBlobStore", () => {
  it("reloads cached facts after restart with zero network fetches and informs edges", async () => {
    const opened = openHarness("C32Cache");
    const repo = bindKnowledgeGraph(opened.stateDb);
    repo.commitChangeSet({
      origin: "kernel",
      author: "research-engine",
      summary: "seed informed spec",
      nodes: [
        {
          op: "create",
          id: "F-12",
          kind: "spec_item",
          title: "Payments",
          text: "Payments use the installed stripe major.minor.",
          status: "active",
          fields: { basis: "explicit", feature: "payments" },
        },
      ],
    });
    const bodies = casFactBodies(opened.cas);
    const store = new BrokerResearchCache(opened.broker);
    const graph = new ProjectStateKnowledgeGraph(repo);
    const first = new ResearchFactCache(store, { bodies, graph });
    await first.putDurable({
      topicHash: "topic-stripe",
      libraryName: "stripe",
      version: "16.4.0",
      facts: [fact],
      sourceHtml: fact.exactQuote,
      fetchedAt: NOW,
      projectId: "alpha",
      url: "https://nodejs.org/api/stripe",
      pageVersion: "16.4",
      informs: ["F-12"],
    });

    const restarted = new ResearchFactCache(new BrokerResearchCache(opened.broker), {
      bodies: casFactBodies(opened.cas),
      graph: new ProjectStateKnowledgeGraph(bindKnowledgeGraph(opened.stateDb)),
    });
    const hit = await restarted.getDurable({
      topicHash: "topic-stripe",
      libraryName: "stripe",
      version: "16.4.2",
      now: NOW + 1_000,
      projectId: "beta",
    });
    expect(hit.cache_hit).toBe(true);
    expect(hit.tokens).toBe(0);
    expect(hit.status).toBe("fresh");
    expect(hit.record?.facts.map((item) => item.claim)).toEqual([fact.claim]);
    expect(hit.record?.servedProjects).toEqual(["alpha", "beta"]);

    const edges = opened.stateDb.writer
      .prepare("SELECT src, type, dst FROM edges WHERE type = 'informs' AND valid_to_rev IS NULL")
      .all();
    expect(edges).toEqual([expect.objectContaining({ type: "informs", dst: "F-12" })]);
  });

  it("calls fetchCleanDoc once, then serves the restarted cache with zero fetches", async () => {
    const opened = openHarness("C32Fetch");
    const repo = bindKnowledgeGraph(opened.stateDb);
    repo.commitChangeSet({
      origin: "kernel",
      author: "research-engine",
      summary: "seed research targets",
      nodes: [
        {
          op: "create",
          id: "F-12",
          kind: "spec_item",
          title: "Payments",
          text: "Payments use the installed stripe major.minor.",
          status: "active",
          fields: { basis: "explicit", feature: "payments" },
        },
        {
          op: "create",
          id: "D-2",
          kind: "decision",
          title: "Provider",
          text: "Use the installed stripe client.",
          status: "active",
          fields: { basis: "explicit", feature: "payments" },
        },
      ],
    });
    let fetches = 0;
    const fetcher = {
      async fetchCleanDoc(url: string) {
        fetches += 1;
        return {
          ok: true as const,
          result: {
            url,
            finalUrl: url,
            fetchedAt: "2026-01-01T00:00:00.000Z",
            detectedVersion: "16.4.0",
            sha256: "abc",
            truncated: false,
            originalChars: html.length,
            markdown: html,
            wrappedDataBlock: "",
            fromCache: false,
            html,
          },
        };
      },
      async fetchDocs(): Promise<never> {
        throw new Error("research must call fetchCleanDoc");
      },
    };
    const model = {
      async complete() {
        return {
          tokens: 40,
          output: {
            id: "RS-stripe",
            topic: "stripe payment_method",
            claims: [
              {
                id: "RF-031",
                text: VISIBLE,
                source: { url: "https://nodejs.org/api/stripe", fetched: "2026-01-01", quote: VISIBLE },
                confidence: "high",
              },
            ],
            constraints: [],
            edge_cases: [],
            failure_modes: [],
            open_contradictions: [],
          },
        };
      },
    };
    const request = {
      projectId: "alpha",
      stack: [{ name: "stripe", version: "16.4.0" }],
      signals: [
        {
          id: "stripe-docs",
          title: "stripe payment_method",
          libraryName: "stripe",
          toVersion: "16.4.0",
          docUrl: "https://nodejs.org/api/stripe",
          targetNodeIds: ["F-12", "D-2"],
        },
      ],
      budget: { waveTokenBudget: 10_000, tokensPerTopic: 100 },
      network: "enabled" as const,
      now: NOW,
      approvedPackages: ["stripe"],
      specItems: [{ id: "SI-1", text: "Payments use the installed stripe major.minor." }],
    };
    const bodies = casFactBodies(opened.cas);
    const first = new FeatureResearchOrchestrator({
      cache: new ResearchFactCache(new BrokerResearchCache(opened.broker), {
        bodies,
        graph: new ProjectStateKnowledgeGraph(repo),
      }),
      graph: new ProjectStateKnowledgeGraph(repo),
      fetcher,
      model,
    });
    const researched = await first.research(request);
    expect(fetches).toBe(1);
    expect(researched.facts.some((item) => item.claim === VISIBLE)).toBe(true);

    const second = new FeatureResearchOrchestrator({
      cache: new ResearchFactCache(new BrokerResearchCache(opened.broker), {
        bodies: casFactBodies(opened.cas),
        graph: new ProjectStateKnowledgeGraph(bindKnowledgeGraph(opened.stateDb)),
      }),
      graph: new ProjectStateKnowledgeGraph(bindKnowledgeGraph(opened.stateDb)),
      fetcher,
      model: {
        async complete(): Promise<never> {
          throw new Error("restarted cache must not call the model");
        },
      },
    });
    const again = await second.research(request);
    expect(fetches).toBe(1);
    expect(again.tokens).toBe(0);
    expect(again.facts.some((item) => item.cache_hit && item.claim === VISIBLE)).toBe(true);
    const edges = opened.stateDb.writer
      .prepare("SELECT dst FROM edges WHERE type = 'informs' AND valid_to_rev IS NULL ORDER BY dst")
      .all();
    expect(edges).toEqual([{ dst: "D-2" }, { dst: "F-12" }]);
  });
});

function openHarness(projectId: string): {
  stateDb: ProjectStateDb;
  broker: GlobalBrokerDb;
  cas: CasBlobStore;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c32-research-"));
  dirs.push(root);
  const broker = GlobalBrokerDb.open({ root: path.join(root, "broker") });
  const globalDb = new DatabaseSync(broker.filePath);
  globalDb.exec("PRAGMA busy_timeout = 5000");
  const stateDb = openProjectStateDb({ projectId, rootDir: path.join(root, "project") });
  closers.unshift(() => {
    if (!stateDb.isClosed()) stateDb.close();
    globalDb.close();
    broker.close();
  });
  return {
    stateDb,
    broker,
    cas: new CasBlobStore({ globalDb, rootDir: path.join(root, "cas"), sleep: async () => {} }),
  };
}
