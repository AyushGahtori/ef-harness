import { describe, expect, it } from "vitest";
import {
  foldAsciiCase,
  isBroadLeafWildcard,
  normalizeWritePattern,
  patternsOverlap,
} from "../../src/graph-compiler/index.js";

describe("Windows glob intersection", () => {
  it("folds ASCII case, slashes, and parent segments", () => {
    expect(foldAsciiCase("Orders.TS")).toBe("orders.ts");
    const windows = normalizeWritePattern("src\\api\\..\\api\\Orders.ts", "windows");
    const posix = normalizeWritePattern("src/api/Orders.ts", "posix");
    expect(windows.posix).toBe("src/api/orders.ts");
    expect(posix.posix).toBe("src/api/Orders.ts");
    expect(patternsOverlap(windows.segments, normalizeWritePattern("src/api/orders.ts", "windows").segments)).toBe(
      true,
    );
    expect(patternsOverlap(posix.segments, normalizeWritePattern("src/api/orders.ts", "posix").segments)).toBe(false);
  });

  it("detects directory globs, single-segment stars, and prefix boundaries", () => {
    const apiTree = normalizeWritePattern("src/api/**", "windows");
    const order = normalizeWritePattern("src/api/orders.ts", "windows");
    const header = normalizeWritePattern("src/ui/Header.tsx", "windows");
    const print = normalizeWritePattern("tests/kitchen/print.*", "windows");
    const printFile = normalizeWritePattern("tests/kitchen/print.ts", "windows");
    const appTree = normalizeWritePattern("src/app/**", "windows");
    const appExtra = normalizeWritePattern("src/app-extra/file.ts", "windows");
    expect(patternsOverlap(apiTree.segments, order.segments)).toBe(true);
    expect(patternsOverlap(apiTree.segments, header.segments)).toBe(false);
    expect(patternsOverlap(print.segments, printFile.segments)).toBe(true);
    expect(patternsOverlap(appTree.segments, appExtra.segments)).toBe(false);
  });

  it("marks broad leaf wildcards", () => {
    expect(isBroadLeafWildcard(normalizeWritePattern("**/*", "windows").segments)).toBe(true);
    expect(isBroadLeafWildcard(normalizeWritePattern("src/**", "windows").segments)).toBe(true);
    expect(isBroadLeafWildcard(normalizeWritePattern("src/api/**", "windows").segments)).toBe(false);
    expect(isBroadLeafWildcard(normalizeWritePattern("*", "windows").segments)).toBe(true);
  });
});
