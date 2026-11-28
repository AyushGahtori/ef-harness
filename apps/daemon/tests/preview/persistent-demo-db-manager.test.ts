import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PreviewMigrationRejectedError } from "../../src/preview/errors.js";
import { LocalPortLeaseRepo } from "../../src/preview/local-port-lease.js";
import { LocalTemplateDbSeeder, LocalTestEnvOrchestrator } from "../../src/preview/local-template-seeder.js";
import { PersistentDemoDbManager } from "../../src/preview/persistent-demo-db-manager.js";
import { PREVIEW_PORT_MAX, PREVIEW_PORT_MIN, RESET_DEMO_BUDGET_MS } from "../../src/preview/timings.js";

const roots: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-demo-db-"));
  roots.push(dir);
  return dir;
}

function manager(root: string, engine: "sqlite" | "postgres" = "sqlite"): PersistentDemoDbManager {
  return new PersistentDemoDbManager({
    projectId: "cafe",
    dataDir: root,
    engine,
    templates: new LocalTemplateDbSeeder(root),
    testEnv: new LocalTestEnvOrchestrator(root),
  });
}

function hash(file: string): string {
  return fs.readFileSync(file).toString("base64");
}

async function removeRoot(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}

beforeAll(() => {
  process.env.EF_PREVIEW_PORT_BASE = "44500";
});

afterEach(async () => {
  const pending = roots.splice(0);
  for (const root of pending) await removeRoot(root);
});

describe("PersistentDemoDbManager", { timeout: 60_000 }, () => {
  it("keeps user orders across an additive migration and resets only on Reset Demo Data", () => {
    const root = tempRoot();
    const db = manager(root);
    db.ensureSeeded();
    const snapshot = path.join(root, "seed-snapshots", "cafe", "functional.sqlite");
    const template = path.join(root, "test-templates", "cafe", "tpl_functional.sqlite");
    const snapshotHash = hash(snapshot);
    const templateHash = hash(template);
    db.insertOrder("o1", "soup");
    db.insertOrder("o2", "salad");
    db.insertOrder("o3", "tea");
    const applied = db.applyAdditiveMigrations([
      {
        id: "m-catering-email",
        featureId: "F-CateringEmail",
        sql: "ALTER TABLE orders ADD COLUMN catering_email TEXT",
      },
    ]);
    expect(applied.appliedIds).toEqual(["m-catering-email"]);
    const orders = db.listOrders();
    expect(orders).toHaveLength(3);
    expect(orders.map((row) => row.note)).toEqual(["soup", "salad", "tea"]);
    expect(orders.every((row) => row.catering_email === null)).toBe(true);
    expect(db.applyAdditiveMigrations([
      {
        id: "m-catering-email",
        featureId: "F-CateringEmail",
        sql: "ALTER TABLE orders ADD COLUMN catering_email TEXT",
      },
    ]).appliedIds).toEqual([]);
    expect(() =>
      db.applyAdditiveMigrations([
        { id: "m-drop", featureId: "F-Wipe", sql: "DROP TABLE orders" },
      ]),
    ).toThrow(PreviewMigrationRejectedError);
    expect(db.listOrders()).toHaveLength(3);
    const reset = db.resetDemoData();
    expect(reset.elapsedMs).toBeLessThan(RESET_DEMO_BUDGET_MS);
    expect(db.listOrders()).toEqual([]);
    expect(db.seedMarker()).toBe("functional");
    expect(hash(snapshot)).toBe(snapshotHash);
    expect(hash(template)).toBe(templateHash);
    expect(templateHash).not.toBe(hash(db.databaseFile()));
    db.close();
  });

  it("refuses a demo database that aliases the automated test template", () => {
    const root = tempRoot();
    const templates = new LocalTemplateDbSeeder(root);
    expect(
      () =>
        new PersistentDemoDbManager({
          projectId: "cafe",
          dataDir: root,
          engine: "sqlite",
          templates,
          testEnv: {
            templateDatabasePath: () => path.join(root, "preview", "demo.db"),
            ensureTemplate: () => path.join(root, "preview", "demo.db"),
          },
        }),
    ).toThrow(/separate from automated test template/);
  });

  it("uses a dedicated postgres database name and releases its loopback port", async () => {
    const root = tempRoot();
    const db = manager(root, "postgres");
    expect(db.databaseName()).toBe("cafe_preview");
    expect(path.basename(db.databaseFile())).toBe("cafe_preview");
    db.ensureSeeded();
    db.insertOrder("o1", "soup");
    db.insertOrder("o2", "salad");
    db.insertOrder("o3", "tea");
    db.applyAdditiveMigrations([
      {
        id: "m-catering-email",
        featureId: "F-CateringEmail",
        sql: "ALTER TABLE orders ADD COLUMN catering_email TEXT",
      },
    ]);
    expect(db.listOrders()).toHaveLength(3);
    const ports = new LocalPortLeaseRepo();
    const lease = await ports.lease({ projectId: "cafe", environment: "preview", purpose: "preview-db" });
    expect(lease.port).toBeGreaterThanOrEqual(PREVIEW_PORT_MIN);
    expect(lease.port).toBeLessThanOrEqual(PREVIEW_PORT_MAX);
    await ports.releaseHolder(lease.port);
    await db.startEndpoint(lease.port);
    const body = await ping(lease.port);
    expect(body).toContain('"ok":true');
    const queried = await query(lease.port);
    expect(queried).toContain("soup");
    await db.stopEndpoint();
    await ports.release(lease.port);
    expect(ports.list()).toEqual([]);
    const rebound = await listenBriefly(lease.port);
    expect(rebound).toBe(true);
    db.close();
  });
});

function ping(port: number): Promise<string> {
  return roundTrip(port, '{"op":"ping"}\n');
}

function query(port: number): Promise<string> {
  return roundTrip(port, '{"op":"query","sql":"SELECT id, note FROM orders"}\n');
}

function roundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(payload);
    });
    let data = "";
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.includes("\n")) {
        socket.end();
        resolve(data);
      }
    });
    socket.on("error", reject);
  });
}

function listenBriefly(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
