import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CasBlobStore, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { BrandAssetSanitizer } from "../../src/assets/brand-asset-sanitizer.js";
import { BugIntakePipeline } from "../../src/bug-scrubber/pipeline.js";
import { FakeModelAdapter } from "../../src/bug-scrubber/fake-model.js";
import type { SymptomCard } from "../../src/bug-scrubber/types.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("brand assets and bug intake on ProjectStateDb", () => {
  it("strips SVG script and onerror, stores the bytes in CasBlobStore, and records an asset node", async () => {
    const opened = await openHarness("brand-svg");
    const malicious = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" onerror="alert(1)"><script>alert(1)</script><path d="M0 0h1"/></svg>`,
    );
    const stored = await new BrandAssetSanitizer().sanitizeAndRegisterAsset({
      bytes: malicious,
      role: "logo_light",
      altText: "Light mark",
      mimeType: "image/svg+xml",
      state: opened.project,
      cas: opened.cas,
      holderId: opened.holderId,
    });
    expect(stored.casSha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = opened.cas.readPlainSync(stored.casSha256);
    const svg = Buffer.from(bytes).toString("utf8");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onerror");
    expect(svg).toContain("<path");
    const node = opened.project.writer.get(
      "SELECT kind, fields ->> '$.recordType' AS record_type, fields ->> '$.casSha256' AS hash FROM nodes WHERE id = ?",
      [stored.assetId],
    );
    expect(node).toMatchObject({ kind: "asset", record_type: "brand_asset", hash: stored.casSha256 });
    const artifact = opened.project.writer.get("SELECT hash, kind FROM artifacts WHERE id = ?", [`ART-${stored.assetId}`]);
    expect(artifact).toMatchObject({ hash: stored.casSha256, kind: "asset" });
  });

  it("scrubs Authorization and Cookie, then getSymptomCard reads the card from ProjectStateDb", async () => {
    const opened = await openHarness("bug-card");
    const secret = ["sk", "_live_", "CANARY_999"].join("");
    const cookie = ["sid=", "CANARY"].join("");
    const card: SymptomCard = {
      title: "Checkout drops the session",
      observedBehavior: "The session is missing after payment",
      expectedBehavior: "The shopper stays signed in",
      reproductionSteps: ["Open /checkout"],
      affectedUrlsOrRoutes: ["/checkout"],
      mappedStackFrames: [],
      failingHttpRequests: [],
      suspectedDomainTags: ["auth"],
      missingReproInfo: [],
      severity: "high",
    };
    const pipeline = new BugIntakePipeline({
      state: opened.project,
      cas: opened.cas,
      holderId: opened.holderId,
      model: new FakeModelAdapter([JSON.stringify(card)]),
    });
    const saved = await pipeline.ingestBugReport({
      bugReport: `Authorization: Bearer ${secret}\nCookie: ${cookie}\nCheckout drops the session`,
      har: {
        log: {
          version: "1.2",
          entries: [
            {
              request: {
                method: "POST",
                url: "https://shop.example/api/orders?access_token=raw-token",
                headers: [
                  { name: "Authorization", value: `Bearer ${secret}` },
                  { name: "Cookie", value: cookie },
                ],
              },
              response: { status: 500, statusText: "Error", headers: [{ name: "Set-Cookie", value: cookie }] },
            },
          ],
        },
      },
    });
    expect(saved.id).toBeTruthy();
    const loaded = pipeline.getSymptomCard(saved.id ?? "");
    expect(loaded?.title).toBe(card.title);
    const dumped = JSON.stringify({ saved, loaded });
    expect(dumped.includes(secret)).toBe(false);
    expect(dumped.includes(cookie)).toBe(false);
    expect(dumped.includes("raw-token")).toBe(false);
    const blobs = opened.globalDb.prepare("SELECT count(*) AS n FROM cas_blobs").get();
    expect(blobs).toMatchObject({ n: 1 });
  });
});

async function openHarness(name: string): Promise<{
  readonly cas: CasBlobStore;
  readonly project: ProjectStateDb;
  readonly holderId: string;
  readonly globalDb: DatabaseSync;
}> {
  const root = mkdtempSync(path.join(tmpdir(), `${name}-`));
  const globalDb = new DatabaseSync(":memory:");
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(readFileSync(fileURLToPath(new URL("../../../../schema/global.sql", import.meta.url)), "utf8"));
  const cas = await CasBlobStore.open({ globalDb, rootDir: path.join(root, "cas"), sleep: async () => {} });
  const project = openProjectStateDb({ projectId: `${name}-${path.basename(root)}`, rootDir: root });
  cleanups.push(() => {
    project.close();
    globalDb.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { cas, project, holderId: project.getMeta("project_id") ?? project.projectId, globalDb };
}
