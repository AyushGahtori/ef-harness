import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceMapStackMapper } from "../../src/bug-scrubber/index.js";

interface Generator {
  addMapping(mapping: {
    generated: { line: number; column: number };
    original: { line: number; column: number };
    source: string;
    name: string;
  }): void;
  toString(): string;
}

function generator(): Generator {
  const require = createRequire(import.meta.url);
  const sourceMap = require("source-map") as { SourceMapGenerator: new (args: { file: string }) => Generator };
  return new sourceMap.SourceMapGenerator({ file: "app.min.js" });
}

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("SourceMapStackMapper", () => {
  it("resolves a local minified frame and never calls fetch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ef-map-"));
    roots.push(root);
    const dist = path.join(root, "dist");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dist);
    const map = generator();
    map.addMapping({
      generated: { line: 1, column: 9201 },
      original: { line: 47, column: 12 },
      source: "src/features/orders/CutoffGuard.ts",
      name: "guardCutoff",
    });
    await writeFile(path.join(dist, "app.min.js.map"), map.toString());
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches += 1;
      throw new Error("remote source map fetch is forbidden");
    }) as typeof fetch;
    try {
      const mapper = new SourceMapStackMapper([root]);
      const frames = await mapper.mapStack("at guardCutoff (dist/app.min.js:1:9201)");
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        source: "src/features/orders/CutoffGuard.ts",
        originalLine: 47,
        originalColumn: 12,
        functionName: "guardCutoff",
        resolved: true,
        ignoredRemote: false,
      });
      const hashed = generator();
      hashed.addMapping({
        generated: { line: 1, column: 48291 },
        original: { line: 12, column: 4 },
        source: "src/main.tsx",
        name: "boot",
      });
      await writeFile(path.join(root, "index-8f92a.js.map"), hashed.toString());
      const assetFrames = await new SourceMapStackMapper([root]).mapStack("assets/index-8f92a.js:1:48291");
      expect(assetFrames[0]).toMatchObject({
        source: "src/main.tsx",
        originalLine: 12,
        originalColumn: 4,
        functionName: "boot",
        resolved: true,
      });
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("ignores remote map URLs and preserves the original frame", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ef-map-remote-"));
    roots.push(root);
    await writeFile(
      path.join(root, "lib.js"),
      "function lib(){return 1;}\n//# sourceMappingURL=https://cdn.example.com/lib.js.map\n",
    );
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches += 1;
      throw new Error("remote source map fetch is forbidden");
    }) as typeof fetch;
    try {
      const mapper = new SourceMapStackMapper([root]);
      const remote = await mapper.mapStack("at lib (https://cdn.example.com/lib.js:1:9201)");
      expect(remote[0]).toMatchObject({
        file: "https://cdn.example.com/lib.js",
        resolved: false,
        ignoredRemote: true,
        source: null,
      });
      const commented = await mapper.mapStack("lib.js:1:10");
      expect(commented[0]).toMatchObject({
        file: "lib.js",
        resolved: false,
        ignoredRemote: false,
        source: null,
      });
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
