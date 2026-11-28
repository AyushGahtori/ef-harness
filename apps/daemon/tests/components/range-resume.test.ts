import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DownloadCancelledError,
  DownloadInterruptedError,
  DownloadPausedError,
  SignedComponentDownloader,
  sha256Hex,
} from "../../src/components/index.js";
import {
  fileManifest,
  generousHeadroom,
  listenLoopback,
  makeKeys,
  removeTemp,
  signedManifest,
  tempComponentsRoot,
} from "./support.js";

async function cutServer(body: Buffer, fraction: number): Promise<{
  origin: string;
  ranges: string[];
  close: () => Promise<void>;
}> {
  const cut = Math.floor(body.length * fraction);
  const ranges: string[] = [];
  const server = await listenLoopback((req, res) => {
    if (req.url === "/manifest") return;
    const header = req.headers.range;
    const range = Array.isArray(header) ? header[0] : header;
    if (range) {
      ranges.push(range);
      const start = Number(range.replace(/^bytes=/, "").split("-")[0] ?? "0");
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${String(start)}-${String(body.length - 1)}/${String(body.length)}`);
      res.setHeader("content-length", String(body.length - start));
      res.end(body.subarray(start));
      return;
    }
    res.writeHead(200, { "content-length": String(body.length) });
    res.write(body.subarray(0, cut));
    setTimeout(() => {
      res.destroy();
    }, 80);
  });
  return { origin: server.origin, ranges, close: () => server.close() };
}

describe("resumable component downloads", () => {
  it.each([0.5, 0.72])("resumes a Range download after a %s disconnect", async (fraction) => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const body = Buffer.alloc(100, 0);
    for (let index = 0; index < body.length; index += 1) body[index] = index;
    const cut = Math.floor(body.length * fraction);
    const fixture = await cutServer(body, fraction);
    const manifestServer = await listenLoopback((_req, res) => {
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "whisper-medium",
            label: "Whisper Medium",
            bytes: body,
            fileName: "model.bin",
            primaryUrl: `${fixture.origin}/payload`,
          }),
          keys.privateKey,
        ),
      );
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${manifestServer.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(DownloadInterruptedError);
      const part = path.join(root, "_incoming", "whisper-medium.part");
      expect(statSync(part).size).toBe(cut);
      const installed = await downloader.resume("whisper-medium");
      expect(fixture.ranges).toContain(`bytes=${String(cut)}-`);
      expect(installed.sha256).toBe(sha256Hex(body));
      expect(readFileSync(path.join(installed.directory, "model.bin")).equals(body)).toBe(true);
      expect(() => statSync(part)).toThrow();
    } finally {
      await fixture.close();
      await manifestServer.close();
      removeTemp(root);
    }
  });

  it("pauses without deleting the partial file and cancels by deleting it", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const body = Buffer.alloc(64, 7);
    const server = await listenLoopback(async (req, res) => {
      if (req.url === "/manifest") return;
      const header = req.headers.range;
      if (header) {
        const start = Number(String(header).replace(/^bytes=/, "").split("-")[0] ?? "0");
        res.statusCode = 206;
        res.end(body.subarray(start));
        return;
      }
      res.write(body.subarray(0, 4));
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (!res.destroyed && !res.writableEnded) res.end(body.subarray(4));
    });
    const manifest = await listenLoopback((_req, res) => {
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "whisper-medium",
            label: "Whisper Medium",
            bytes: body,
            fileName: "model.bin",
            primaryUrl: `${server.origin}/payload`,
          }),
          keys.privateKey,
        ),
      );
    });
    const part = path.join(root, "_incoming", "whisper-medium.part");
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${manifest.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      const paused = downloader.download("whisper-medium", {
        onProgress(progress) {
          if (progress.state === "running" && progress.receivedBytes < body.length) downloader.pause("whisper-medium");
        },
      });
      await expect(paused).rejects.toBeInstanceOf(DownloadPausedError);
      expect(statSync(part).size).toBeGreaterThan(0);
      expect(statSync(part).size).toBeLessThan(body.length);

      const resumed = await downloader.resume("whisper-medium");
      expect(readFileSync(path.join(resumed.directory, "model.bin")).equals(body)).toBe(true);
    } finally {
      await server.close();
      await manifest.close();
      removeTemp(root);
    }
  });

  it("cancels a download and deletes the staged partial", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const body = Buffer.alloc(64, 9);
    const server = await listenLoopback(async (req, res) => {
      const header = req.headers.range;
      if (header) {
        res.statusCode = 206;
        res.end(body);
        return;
      }
      res.write(body.subarray(0, 4));
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (!res.destroyed && !res.writableEnded) res.end(body.subarray(4));
    });
    const manifest = await listenLoopback((_req, res) => {
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "whisper-medium",
            label: "Whisper Medium",
            bytes: body,
            fileName: "model.bin",
            primaryUrl: `${server.origin}/payload`,
          }),
          keys.privateKey,
        ),
      );
    });
    const part = path.join(root, "_incoming", "whisper-medium.part");
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${manifest.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      const cancelled = downloader.download("whisper-medium", {
        onProgress(progress) {
          if (progress.receivedBytes > 0) downloader.cancel("whisper-medium");
        },
      });
      await expect(cancelled).rejects.toBeInstanceOf(DownloadCancelledError);
      expect(() => statSync(part)).toThrow();
    } finally {
      await server.close();
      await manifest.close();
      removeTemp(root);
    }
  });
});
