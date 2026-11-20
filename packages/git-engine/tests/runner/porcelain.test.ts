import { describe, expect, it } from "vitest";
import { parsePorcelainZ } from "../../src/runner/porcelain.js";

describe("parsePorcelainZ", () => {
  it("counts modified and untracked files and keeps rename originals", () => {
    const parsed = parsePorcelainZ(" M README.md\0?? new file.txt\0R  dest.ts\0src.ts\0UU conflict.txt\0");
    const byPath = new Map(parsed.map((file) => [file.path, file]));
    expect(parsed).toHaveLength(4);
    expect(byPath.get("README.md")).toMatchObject({ code: " M", kind: "modified", originalPath: null });
    expect(byPath.get("new file.txt")).toMatchObject({ code: "??", kind: "untracked", originalPath: null });
    expect(byPath.get("dest.ts")).toMatchObject({ code: "R ", kind: "renamed", originalPath: "src.ts" });
    expect(byPath.get("conflict.txt")).toMatchObject({ code: "UU", kind: "unmerged", originalPath: null });
    expect(parsed.map((file) => file.path)).toEqual(
      [...parsed.map((file) => file.path)].sort((left, right) => left.localeCompare(right)),
    );
  });

  it("returns an empty list for a clean status", () => {
    expect(parsePorcelainZ("")).toEqual([]);
  });
});
