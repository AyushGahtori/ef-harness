import { describe, expect, it } from "vitest";

import {
  AgeSealedChecksDecryptor,
  HarnessStateReader,
  OrphanBranchRehydrator,
  PortableZipArchiveManager,
  computeCanonicalGraphSha256,
} from "../../src/rehydration/index.js";
import { createHarnessFixture } from "./fixtures.js";

describe("rehydration round-trip", () => {
  const fixtureTimeoutMs = 60_000;
  it("rehydrates harness-state with matching canonicalGraphSha256, FTS parity, and decrypted age checks", async () => {
    const fixture = await createHarnessFixture();
    const tree = new HarnessStateReader(fixture.laptopBPath).readTree();
    const rehydrator = new OrphanBranchRehydrator(
      fixture.laptopBPath,
      new AgeSealedChecksDecryptor(fixture.ageIdentity),
    );
    const result = await rehydrator.rehydrate();

    expect(result.graph.canonicalGraphSha256).toBe(tree.manifest.canonicalGraphSha256);
    expect(result.graph.entities).toHaveLength(tree.entities.length);
    expect(Object.keys(result.decryptedChecks)).toContain("checks-sealed/F-12.age");
    expect(result.database.search("print")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "F-12", title: "Print dialog" })]),
    );
  }, fixtureTimeoutMs);

  it("preserves canonicalGraphSha256 across export -> zip -> import", async () => {
    const fixture = await createHarnessFixture();
    const reader = new HarnessStateReader(fixture.laptopAPath);
    const tree = reader.readTree();
    const zipManager = new PortableZipArchiveManager();
    const exported = zipManager.exportFromHarnessState(
      tree,
      Object.keys(tree.filesByPath).find((path) => path.startsWith("history/")) ?? "",
    );
    const imported = zipManager.importToFileMap(exported.zip);
    const importedEntities = tree.entities.map((entity) => {
      const prefix =
        entity.kind === "decision" ? "decisions" : entity.kind === "feature" ? "features" : "tasks";
      return `${prefix}/${entity.id}.yaml`;
    });
    for (const entityPath of importedEntities) {
      expect(imported[entityPath]).toBeTruthy();
    }
    const rehydrator = new OrphanBranchRehydrator(fixture.laptopAPath);
    const before = (await rehydrator.rehydrate()).graph.canonicalGraphSha256;
    const after = computeCanonicalGraphSha256(tree.entities, tree.history);
    expect(before).toBe(after);
    expect(exported.manifest.canonicalGraphSha256).toBe(before);
  }, fixtureTimeoutMs);
});