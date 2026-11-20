import { lstat, open, readdir, readlink } from "node:fs/promises";
import type { SafetyScanIo, StatsLike } from "./types.js";

export function createNodeIo(): SafetyScanIo {
  return {
    async lstat(absolutePath: string): Promise<StatsLike> {
      return lstat(absolutePath);
    },
    async readlink(absolutePath: string): Promise<string> {
      return readlink(absolutePath);
    },
    async readdir(absolutePath: string): Promise<readonly string[]> {
      return readdir(absolutePath);
    },
    async readPrefix(absolutePath: string, maxBytes: number): Promise<Buffer> {
      if (maxBytes <= 0) return Buffer.alloc(0);
      const handle = await open(absolutePath, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}
