import { createRequire } from "node:module";

let initPromise: Promise<boolean> | undefined;

export async function ensureWebTreeSitterInitialized(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const require = createRequire(import.meta.url);
        const mod = require("web-tree-sitter") as { Parser: { init: () => Promise<void> } };
        await mod.Parser.init();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return initPromise;
}