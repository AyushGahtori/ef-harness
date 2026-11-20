import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { symlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  PathTraversalError,
  SecureDocFetcher,
  readLocalPackageSource,
} from "../../src/doc-fetcher/index.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("readLocalPackageSource", () => {
  it("reads the installed d.ts, exports, and README with zero network calls", async () => {
    const root = await tempRoot();
    await writePackage(path.join(root, "node_modules", "widget"), {
      name: "widget",
      version: "1.2.3",
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
      readme: "# Widget\n\nLocal readme.",
      dts: "export declare function id<T>(value: T): Promise<string>;\n",
    });
    const originalConnect = net.Socket.prototype.connect;
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    net.Socket.prototype.connect = function (this: net.Socket, ...args: never[]): net.Socket {
      networkCalls += 1;
      return originalConnect.apply(this, args);
    };
    globalThis.fetch = () => {
      networkCalls += 1;
      return Promise.reject(new Error("fetch"));
    };
    try {
      const source = readLocalPackageSource("widget@1.2.3", { nodeModulesRoots: [root] });
      expect(source?.version).toBe("1.2.3");
      expect(source?.packageJson.exports).toEqual({ ".": { types: "./index.d.ts", import: "./index.js" } });
      expect(source?.readme).toContain("Local readme.");
      expect(source?.declarationFiles.map((file) => file.text).join("\n")).toContain(
        "function id<T>(value: T): Promise<string>",
      );
      expect(networkCalls).toBe(0);
      const fetcher = new SecureDocFetcher({
        nodeModulesRoots: [root],
        proxy: {
          async fetch() {
            throw new Error("network");
          },
        },
        resolveHost: async () => {
          throw new Error("dns");
        },
      });
      const fetched = await fetcher.fetchDocs("widget@1.2");
      expect(fetched.fromCache).toBe(false);
      expect(fetched.detectedVersion).toBe("1.2.3");
      expect(fetched.markdown).toContain("function id<T>(value: T): Promise<string>");
      expect(fetched.wrappedDataBlock).toContain('trust="untrusted"');
      expect(fetched.wrappedDataBlock).toContain('source="doc_fetcher"');
      expect(networkCalls).toBe(0);
    } finally {
      net.Socket.prototype.connect = originalConnect;
      globalThis.fetch = originalFetch;
    }
  });

  it("finds the pnpm virtual store and a shared store directory", async () => {
    const root = await tempRoot();
    const pnpmPkg = path.join(root, "node_modules", ".pnpm", "widget@1.2.3", "node_modules", "widget");
    await writePackage(pnpmPkg, {
      name: "widget",
      version: "1.2.3",
      exports: "./index.js",
      readme: "from pnpm",
      dts: "export const fromPnpm = true;\n",
    });
    expect(readLocalPackageSource("widget@1.2.3", { nodeModulesRoots: [root] })?.readme).toBe("from pnpm");

    const store = await tempRoot();
    await writePackage(path.join(store, "widget", "9.9.9"), {
      name: "widget",
      version: "9.9.9",
      exports: null,
      readme: "from store",
      dts: "export const fromStore = true;\n",
    });
    expect(readLocalPackageSource("widget@9.9.9", { pnpmStoreDir: store })?.readme).toBe("from store");
    expect(readLocalPackageSource("widget@9.9.8", { pnpmStoreDir: store })).toBeNull();
  });

  it("rejects path traversal and does not read a types path outside the package", async () => {
    const root = await tempRoot();
    const secret = "CANARY_DO_NOT_LEAK";
    await writeFile(path.join(root, "secret.txt"), secret, "utf8");
    await writePackage(path.join(root, "node_modules", "widget"), {
      name: "widget",
      version: "1.0.0",
      exports: { types: "../../secret.txt" },
      readme: "safe readme",
      dts: "export const safe = 1;\n",
      typesField: "../../secret.txt",
    });
    expect(() => readLocalPackageSource("../../.ssh@1.0.0", { nodeModulesRoots: [root] })).toThrow(
      PathTraversalError,
    );
    expect(() => readLocalPackageSource("..\\..\\.ssh@1.0.0", { nodeModulesRoots: [root] })).toThrow(
      PathTraversalError,
    );
    const source = readLocalPackageSource("widget@1.0.0", { nodeModulesRoots: [root] });
    expect(JSON.stringify(source)).not.toContain(secret);
    expect(source?.declarationFiles.some((file) => file.text.includes(secret))).toBe(false);

    const outside = await tempRoot();
    await writePackage(outside, {
      name: "linked",
      version: "1.0.0",
      exports: null,
      readme: secret,
      dts: "export const leak = true;\n",
    });
    let linked = false;
    try {
      symlinkSync(outside, path.join(root, "node_modules", "linked"), "junction");
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      expect(() => readLocalPackageSource("linked@1.0.0", { nodeModulesRoots: [root] })).toThrow(PathTraversalError);
    }
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ef-doc-"));
  roots.push(root);
  return root;
}

async function writePackage(
  dir: string,
  input: {
    name: string;
    version: string;
    exports: unknown;
    readme: string;
    dts: string;
    typesField?: string;
  },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    name: input.name,
    version: input.version,
    exports: input.exports,
    types: input.typesField ?? "./index.d.ts",
  };
  await writeFile(path.join(dir, "package.json"), JSON.stringify(manifest), "utf8");
  await writeFile(path.join(dir, "README.md"), input.readme, "utf8");
  await writeFile(path.join(dir, "index.d.ts"), input.dts, "utf8");
}
