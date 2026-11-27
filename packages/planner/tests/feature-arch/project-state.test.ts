import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { FeatureArchitectureSynthesizer } from "../../src/feature-arch/project-state.js";
import type { FeatureInput, SynthesisRequest } from "../../src/feature-arch/types.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const SEQUENCE = [
  "sequenceDiagram",
  "  participant Client",
  "  participant API",
  "  Client->>API: Call",
  "  API-->>Client: Result",
].join("\n");

const STATE = ["stateDiagram-v2", "  [*] --> Idle", "  Idle --> Done: finish", "  Done --> [*]"].join("\n");

describe("feature architecture over ProjectStateDb", () => {
  it("persists fields.names and rejects a locked breaking change and a duplicate name", async () => {
    const stateDb = openState("C32Arch");
    const synthesizer = new FeatureArchitectureSynthesizer(stateDb);
    const saved = await synthesizer.synthesize(waveRequest([apiFeature("F-Menu", "menu", ["src/menu/index.ts"])]));
    expect(saved.drafted.status).toBe("accepted");
    expect(saved.persisted).toBe(true);
    expect(saved.blocked).toEqual([]);
    expect(saved.nameCount).toBeGreaterThan(0);
    const names = nameRows(stateDb);
    expect(names).toContainEqual({ kind: "http_route", value: "POST /api/menu", owner_node: "F-Menu" });

    const breaking = await synthesizer.synthesize(
      waveRequest([
        {
          ...apiFeature("F-Orders", "orders", ["src/orders/index.ts"]),
          schemaDeltas: [
            { op: "add_column", table: "orders", column: { name: "must_note", type: "TEXT", nullable: false } },
          ],
        },
      ]),
    );
    expect(breaking.persisted).toBe(false);
    expect(breaking.blocked.some((decision) => decision.classification === "breaking" && decision.allowed === false)).toBe(
      true,
    );
    expect(nameRows(stateDb).some((row) => row.value === "orders.must_note")).toBe(false);

    const duplicate = await synthesizer.synthesize(
      waveRequest([
        {
          ...apiFeature("F-Menu-2", "menu-next", ["src/menu/next.ts"]),
          endpoints: [
            {
              id: "C-menu-next",
              method: "POST",
              path: "/api/menu",
              request: "{ id: string }",
              response: "{ ok: true }",
              errors: ["400"],
            },
          ],
        },
      ]),
    );
    expect(duplicate.persisted).toBe(false);
    expect(nameRows(stateDb).filter((row) => row.kind === "http_route" && row.value === "POST /api/menu")).toEqual([
      { kind: "http_route", value: "POST /api/menu", owner_node: "F-Menu" },
    ]);
  });
});

function openState(projectId: string): ProjectStateDb {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c32-arch-"));
  dirs.push(root);
  const stateDb = openProjectStateDb({ projectId, rootDir: root });
  closers.unshift(() => {
    if (!stateDb.isClosed()) stateDb.close();
  });
  return stateDb;
}

function nameRows(stateDb: ProjectStateDb): { kind: string; value: string; owner_node: string }[] {
  const rows = stateDb.writer.prepare("SELECT kind, value, owner_node FROM names ORDER BY kind, value, owner_node").all();
  const names: { kind: string; value: string; owner_node: string }[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.kind !== "string" || typeof row.value !== "string" || typeof row.owner_node !== "string") {
      continue;
    }
    names.push({ kind: row.kind, value: row.value, owner_node: row.owner_node });
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lockedSkeleton() {
  return {
    locked: true,
    tables: [
      {
        name: "orders",
        locked: true,
        columns: [
          { name: "id", type: "TEXT", nullable: false },
          { name: "total_cents", type: "INTEGER", nullable: false },
        ],
      },
    ],
  };
}

function apiFeature(id: string, slug: string, writePaths: string[]): FeatureInput {
  return {
    id,
    slug,
    title: slug,
    surface: "api",
    requirements: [`REQ-${slug}`],
    specItems: [{ id: `SI-${slug}`, text: `${slug} spec item.` }],
    edgeCases: [{ id: `EC-${slug}`, text: `${slug} edge case.` }],
    writePaths,
    schemaDeltas: [],
    endpoints: [
      {
        id: `C-${slug}`,
        method: "POST",
        path: `/api/${slug}`,
        request: "{ id: string }",
        response: "{ ok: true }",
        errors: ["400", "500"],
      },
    ],
    cliCommands: [],
    seams: [{ templateId: "S-02", sharedName: `POST /api/${slug}`, peer: "phase0-api" }],
    transitions: [{ from: "Idle", to: "Done", event: "finish" }],
    failureModes: ["Upstream timeout"],
    journey: [`Call /api/${slug}`],
    screens: [],
    tags: ["route"],
    dependsOn: [],
    references: [],
    sequenceMermaid: SEQUENCE,
    stateMermaid: STATE,
    rules: [],
  };
}

function waveRequest(features: FeatureInput[]): SynthesisRequest {
  return {
    mergedWave: 0,
    targetWave: 1,
    waveTokenBudget: 200_000,
    features,
    skeleton: lockedSkeleton(),
    requirements: features.flatMap((feature) => feature.requirements.map((id) => ({ id, text: `${id} is required.` }))),
  };
}
