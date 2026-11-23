import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  PublicRemotePushGuard,
  PUBLIC_HARNESS_STATE_WARNING,
  PRIVATE_FIRST_PUSH_PROMPT,
  SecretDetectedInPortabilityExportError,
  listTreePaths,
  readBlobAtPath,
} from "../../src/exporter/index.js";
import {
  ageKeys,
  buildExporter,
  decisionEntity,
  featureEntity,
  initBareRepo,
  TestHiddenCheckPool,
} from "./fixtures.js";
import { InMemoryKnowledgeGraphRepo } from "../../src/exporter/in-memory-knowledge-graph.js";

const repos: string[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function workingTreeDirty(repo: string): boolean {
  const out = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8", windowsHide: true });
  return Boolean((out.stdout ?? "").trim());
}

describe("OrphanBranchPortabilityExporter", { timeout: 30_000 }, () => {
  it("writes harness-state via git fast-import without touching the working tree", async () => {
    const repo = initBareRepo();
    repos.push(repo);
    const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
    graph.upsertEntity(decisionEntity("D-001", 1));
    graph.addHistory({
      changeId: "chg-1",
      entityId: "D-001",
      revision: 1,
      at: "2026-11-18T12:04:00Z",
      summary: "seed decision",
    });
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
    const result = await exporter.runExport();
    expect(result?.noop).toBe(false);
    expect(workingTreeDirty(repo)).toBe(false);
    const tree = listTreePaths(repo, "refs/heads/harness-state");
    expect(tree).toContain("manifest.yaml");
    expect(tree).toContain("decisions/D-001.yaml");
    expect(tree).toContain("lease.yaml");
  });

  it("encrypts sealed checks with age and stores zero plaintext assertion bytes", async () => {
    const repo = initBareRepo();
    repos.push(repo);
    const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
    graph.upsertEntity(featureEntity("F-Orders", 1));
    const payload = JSON.stringify({ assertion: "expect(orderTotal).toBe(42)" });
    const hidden = new TestHiddenCheckPool([
      {
        featureId: "F-Orders",
        requirementId: "REQ-1",
        id: "CHK-07",
        contentJson: payload,
      },
    ]);
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, hidden, publicKey);
    await exporter.runExport();
    const sealed = readBlobAtPath(repo, "refs/heads/harness-state", "checks-sealed/F-Orders.age") ?? "";
    expect(sealed).toMatch(/BEGIN AGE ENCRYPTED FILE/);
    const cat = spawnSync(
      "git",
      ["cat-file", "-p", `refs/heads/harness-state:checks-sealed/F-Orders.age`],
      { cwd: repo, encoding: "utf8", windowsHide: true },
    );
    expect((cat.stdout ?? "").includes("expect(orderTotal)")).toBe(false);
  });

  it("aborts export when a secret pattern is detected", async () => {
    const repo = initBareRepo();
    repos.push(repo);
    const skLive = ["sk", "_live_"].join("");
    const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
    graph.upsertEntity(
      decisionEntity("D-leak", 1, { note: `${skLive}abcd1234567890` }),
    );
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
    await expect(exporter.runExport()).rejects.toThrow(SecretDetectedInPortabilityExportError);
  });

  it(
    "emits no commit when canonicalGraphSha256 is unchanged",
    async () => {
      const repo = initBareRepo();
      repos.push(repo);
      const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
      graph.upsertEntity(decisionEntity("D-001", 1));
      const { publicKey } = ageKeys();
      const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
      const first = await exporter.runExport();
      const second = await exporter.runExport();
      expect(first?.noop).toBe(false);
      expect(second?.noop).toBe(true);
      expect(second?.commitSha).toBe(first?.commitSha);
    },
    20_000,
  );

  it(
    "coalesces rapid edits behind a 10 second quiet debounce",
    async () => {
    const repo = initBareRepo();
    repos.push(repo);
    let now = 1_000;
    const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey, 10_000, () => now);
    graph.upsertEntity(decisionEntity("D-1", 1));
    exporter.scheduleExport();
    now += 2_000;
    graph.upsertEntity(decisionEntity("D-2", 1));
    exporter.scheduleExport();
    now += 2_000;
    graph.upsertEntity(decisionEntity("D-3", 1));
    exporter.scheduleExport();
    const early = await exporter.flushExport();
    expect(early).toBeNull();
    now += 10_000;
    const done = await exporter.flushExport();
    expect(done?.noop).toBe(false);
    const tree = listTreePaths(repo, "refs/heads/harness-state");
    expect(tree.filter((p) => p.startsWith("decisions/"))).toHaveLength(3);
    },
    20_000,
  );

  it(
    "exports 300 entities then applies a warm incremental delta",
    async () => {
      const repo = initBareRepo();
      repos.push(repo);
      const graph = new InMemoryKnowledgeGraphRepo("proj-scale", "device-scale01", 4);
      for (let i = 0; i < 300; i += 1) {
        graph.upsertEntity(decisionEntity(`D-${String(i).padStart(4, "0")}`, 1));
      }
      const { publicKey } = ageKeys();
      const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
      const bootstrap = await exporter.runExport();
      expect(bootstrap?.noop).toBe(false);
      graph.upsertEntity(decisionEntity("D-0042", 2));
      const delta = await exporter.runExport();
      expect(delta?.changedPaths).toContain("decisions/D-0042.yaml");
      expect(delta?.changedPaths).toContain("manifest.yaml");
      expect((delta?.changedPaths ?? []).length).toBeLessThan(10);
    },
    180_000,
  );

  it("keeps incremental export ops bounded to changed entities", async () => {
    const repo = initBareRepo();
    repos.push(repo);
    const graph = new InMemoryKnowledgeGraphRepo("proj-scale-small", "device-scale02", 4);
    graph.upsertEntity(decisionEntity("D-01", 1));
    graph.upsertEntity(decisionEntity("D-02", 1));
    graph.upsertEntity(decisionEntity("D-03", 1));
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
    await exporter.runExport();
    graph.upsertEntity(decisionEntity("D-02", 2));
    const delta = await exporter.runExport();
    expect(delta?.changedPaths).toEqual(
      expect.arrayContaining(["manifest.yaml", "decisions/D-02.yaml"]),
    );
    expect(delta?.changedPaths?.filter((p) => p.startsWith("decisions/"))).toHaveLength(1);
  });

  it("produces sorted per-entity YAML with stable keys", async () => {
    const repo = initBareRepo();
    repos.push(repo);
    const graph = new InMemoryKnowledgeGraphRepo("proj-1", "device-aaaabbbbcccc", 3);
    graph.upsertEntity({
      id: "D-sort",
      kind: "decision",
      revision: 1,
      fields: { zebra: 1, alpha: 2, middle: 3 },
    });
    const { publicKey } = ageKeys();
    const exporter = buildExporter(repo, graph, new TestHiddenCheckPool([]), publicKey);
    await exporter.runExport();
    const yaml = readBlobAtPath(repo, "refs/heads/harness-state", "decisions/D-sort.yaml") ?? "";
    expect(yaml.indexOf("alpha")).toBeLessThan(yaml.indexOf("middle"));
    expect(yaml.indexOf("middle")).toBeLessThan(yaml.indexOf("zebra"));
    expect(yaml.endsWith("\n")).toBe(true);
  });
});

describe("PublicRemotePushGuard", () => {
  const auth = {
    async remoteVisibility(owner: string, repo: string) {
      if (repo === "open-tool") {
        return { owner, repo, private: false, visibility: "public" as const };
      }
      return { owner, repo, private: true, visibility: "private" as const };
    },
  };

  it("keeps public remotes off by default until explicit opt-in", async () => {
    const guard = new PublicRemotePushGuard(auth);
    const blocked = await guard.evaluatePush("origin", "user", "open-tool", {});
    expect(blocked.allow).toBe(false);
    expect(blocked.warning).toBe(PUBLIC_HARNESS_STATE_WARNING);
    const allowed = await guard.evaluatePush("origin", "user", "open-tool", { explicitOptIn: true });
    expect(allowed.allow).toBe(true);
  });

  it("asks once on first push for private remotes", async () => {
    const guard = new PublicRemotePushGuard(auth);
    const first = await guard.evaluatePush("origin", "user", "private-tool", { explicitOptIn: true });
    expect(first.prompted).toBe(true);
    expect(first.warning).toBe(PRIVATE_FIRST_PUSH_PROMPT);
    const second = await guard.evaluatePush("origin", "user", "private-tool", { explicitOptIn: true });
    expect(second.prompted).toBe(false);
    expect(second.allow).toBe(true);
  });
});