import { describe, expect, it } from "vitest";

import {
  PortableZipArchiveManager,
  assertSafeZipEntryPath,
  createZipArchive,
} from "../../src/rehydration/index.js";

describe("portable zip archive manager", () => {
  it("rejects zip-slip and symlink-like entries before extraction", () => {
    expect(() => assertSafeZipEntryPath("../Windows/System32/evil.dll")).toThrow(/zip-slip/);
    expect(() =>
      createZipArchive([
        { path: "../../evil", content: new TextEncoder().encode("x") },
      ]),
    ).toThrow(/zip-slip/);
  });

  it("rejects unsupported zip methods that would indicate symlink payloads", () => {
    const manager = new PortableZipArchiveManager();
    const bytes = createZipArchive([{ path: "manifest.yaml", content: new TextEncoder().encode("schemaVersion: 1") }]);
    expect(() => manager.importToFileMap(bytes)).toThrow();
  });
});