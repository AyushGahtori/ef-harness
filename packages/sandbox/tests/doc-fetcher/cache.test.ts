import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MemoryCasBlobStore,
  RESEARCH_CACHE_TTL_MS,
  SecureDocFetcher,
  SqliteResearchCacheStore,
} from "../../src/doc-fetcher/index.js";
import { listen } from "./http-fixture.js";

const schemaPath = fileURLToPath(new URL("../../../../schema/global.sql", import.meta.url));

describe("90-day research cache", () => {
  it("reuses a fresh entry offline, keeps patch updates, and drops a minor bump", async () => {
    const db = openGlobal();
    const cache = new SqliteResearchCacheStore(db);
    const cas = new MemoryCasBlobStore();
    let offline = false;
    const now = 1_700_000_000_000;
    let connects = 0;
    const fixture = await listen((req, res) => {
      const body = req.url === "/react" ? `${"react-doc ".repeat(30)}marker-react` : `${"next-doc ".repeat(30)}marker-next`;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(body);
    });
    try {
      const fetcher = new SecureDocFetcher({
        cache,
        cas,
        now: () => now,
        testOnlyLoopbackOverride: true,
        testAllowedHosts: ["docs.example.com"],
        resolveHost: async (hostname) => {
          if (offline) throw new Error("offline");
          if (hostname === "docs.example.com") return ["127.0.0.1"];
          throw new Error(`unexpected host ${hostname}`);
        },
        onConnect: () => {
          connects += 1;
        },
      });
      const nextUrl = `http://docs.example.com:${fixture.port}/next`;
      const reactUrl = `http://docs.example.com:${fixture.port}/react`;
      const first = await fetcher.fetchDocs(nextUrl, { packageName: "next", version: "15.4.1" });
      const react = await fetcher.fetchDocs(reactUrl, { packageName: "react", version: "19.0.0" });
      expect(first.markdown).toContain("marker-next");
      expect(first.fromCache).toBe(false);
      expect(react.markdown).toContain("marker-react");
      expect(pins(db)).toHaveLength(2);
      expect(pins(db).every((pin) => pin.holder_kind === "research")).toBe(true);

      offline = true;
      const cached = await fetcher.fetchDocs(nextUrl, { packageName: "next", version: "15.4.1" });
      expect(cached.fromCache).toBe(true);
      expect(cached.sha256).toBe(first.sha256);
      expect(cached.markdown).toBe(first.markdown);
      expect(cached.wrappedDataBlock).toContain('trust="untrusted"');
      expect(connects).toBe(2);

      expect(fetcher.invalidateForLockfileUpdate("next", "15.4.1", "15.4.2")).toBe(0);
      expect(pins(db)).toHaveLength(2);
      expect(fetcher.invalidateForLockfileUpdate("next", "15.4.2", "15.5.0")).toBe(1);
      const remaining = rows(db);
      expect(remaining.map((row) => row.package)).toEqual(["react"]);
      expect(pins(db)).toHaveLength(1);
    } finally {
      await fixture.close();
      db.close();
    }
  });

  it("expires at 90 days and unpins when the laptop is offline", async () => {
    const db = openGlobal();
    const cache = new SqliteResearchCacheStore(db);
    const cas = new MemoryCasBlobStore();
    const start = 1_700_000_000_000;
    let now = start;
    let offline = false;
    const fixture = await listen((_req, res) => {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(`${"cached-doc ".repeat(30)}still-here`);
    });
    try {
      const fetcher = new SecureDocFetcher({
        cache,
        cas,
        now: () => now,
        testOnlyLoopbackOverride: true,
        testAllowedHosts: ["docs.example.com"],
        resolveHost: async () => {
          if (offline) throw new Error("offline");
          return ["127.0.0.1"];
        },
      });
      const url = `http://docs.example.com:${fixture.port}/page`;
      await fetcher.fetchDocs(url, { packageName: "left-pad", version: "1.2.3" });
      expect(pins(db)).toHaveLength(1);
      const stored = rows(db)[0];
      expect(stored?.version_range).toBe("1.2");
      expect(stored?.expires_at).toBe(start + RESEARCH_CACHE_TTL_MS);

      now = start + RESEARCH_CACHE_TTL_MS - 1;
      offline = true;
      const hit = await fetcher.fetchDocs(url, { packageName: "left-pad", version: "1.2.3" });
      expect(hit.fromCache).toBe(true);
      expect(hit.markdown).toContain("still-here");

      now = start + RESEARCH_CACHE_TTL_MS;
      await expect(fetcher.fetchDocs(url, { packageName: "left-pad", version: "1.2.3" })).rejects.toThrow(/offline/);
      expect(rows(db)).toEqual([]);
      expect(pins(db)).toEqual([]);
    } finally {
      await fixture.close();
      db.close();
    }
  });
});

function openGlobal(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(schemaPath, "utf8"));
  return db;
}

function pins(db: DatabaseSync): Array<{ hash: string; holder_kind: string; holder_id: string }> {
  return db
    .prepare("SELECT hash, holder_kind, holder_id FROM cas_pins ORDER BY holder_id")
    .all() as Array<{ hash: string; holder_kind: string; holder_id: string }>;
}

function rows(db: DatabaseSync): Array<{ package: string; version_range: string; expires_at: number }> {
  return db
    .prepare("SELECT package, version_range, expires_at FROM research_cache ORDER BY package")
    .all() as Array<{ package: string; version_range: string; expires_at: number }>;
}
