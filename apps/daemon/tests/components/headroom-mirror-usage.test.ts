import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_DOWNLOAD_RESERVE_BYTES,
  ComponentDiskUsageManager,
  ComponentLeaseActiveError,
  DownloadTimeoutError,
  HttpDowngradeError,
  InsufficientDiskHeadroomError,
  SignedComponentDownloader,
  componentDownloadFits,
  formatComponentDiskUsage,
  nodeDiskHeadroomGuard,
  remainingDownloadHeadroom,
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

describe("disk headroom, mirrors, and component disk usage", () => {
  it("applies the 5 GB formula, including the 5.2 GB / 1.6 GB example", () => {
    const size = 1_600_000_000n;
    const free = 5_200_000_000n;
    expect(remainingDownloadHeadroom(free, size)).toBe(2_000_000_000n);
    expect(componentDownloadFits(free, size)).toBe(false);
    const exact = COMPONENT_DOWNLOAD_RESERVE_BYTES + 2n * size;
    expect(componentDownloadFits(exact, size)).toBe(true);
    expect(componentDownloadFits(exact - 1n, size)).toBe(false);
  });

  it("refuses the whisper-large example before opening the payload connection", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    let payloadHits = 0;
    const decoy = Buffer.from("decoy");
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        payloadHits += 1;
        res.end(decoy);
        return;
      }
      const entry = fileManifest({
        keyId: keys.keyId,
        id: "whisper-large",
        label: "Whisper Large",
        bytes: decoy,
        fileName: "model.bin",
        primaryUrl: `${server.origin}/payload`,
      }).components[0];
      if (entry === undefined) throw new Error("missing entry");
      res.end(
        signedManifest(
          {
            keyId: keys.keyId,
            components: [
              {
                ...entry,
                sizeBytes: 1_600_000_000,
                files: [{ ...entry.files[0], path: "model.bin", sha256: entry.sha256, sizeBytes: 1_600_000_000 }],
              },
            ],
          },
          keys.privateKey,
        ),
      );
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: { freeBytes: () => 5_200_000_000n },
      });
      await expect(downloader.download("whisper-large")).rejects.toBeInstanceOf(InsufficientDiskHeadroomError);
      expect(payloadHits).toBe(0);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("allows a download when free bytes sit exactly on the 5 GB reserve", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const bytes = Buffer.from("tiny-model");
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        res.end(bytes);
        return;
      }
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "whisper-medium",
            label: "Whisper Medium",
            bytes,
            fileName: "model.bin",
            primaryUrl: `${server.origin}/payload`,
          }),
          keys.privateKey,
        ),
      );
    });
    try {
      const free = COMPONENT_DOWNLOAD_RESERVE_BYTES + 2n * BigInt(bytes.length);
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: { freeBytes: () => free },
      });
      const installed = await downloader.download("whisper-medium");
      expect(installed.verified).toBe(true);
      const blocked = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: { freeBytes: () => free - 1n },
      });
      await expect(blocked.download("whisper-medium")).rejects.toBeInstanceOf(InsufficientDiskHeadroomError);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("falls back to a signed mirror when the primary times out", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const bytes = Buffer.from("mirror-bytes");
    let primaryHits = 0;
    const primary = await listenLoopback(() => {
      primaryHits += 1;
    });
    const mirror = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        res.end(bytes);
        return;
      }
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "playwright-chromium",
            label: "Playwright Chromium",
            bytes,
            fileName: "chrome.exe",
            primaryUrl: `${primary.origin}/payload`,
            mirrorUrls: [`${mirror.origin}/payload`],
          }),
          keys.privateKey,
        ),
      );
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${mirror.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
        requestTimeoutMs: 200,
      });
      const installed = await downloader.download("playwright-chromium");
      expect(primaryHits).toBeGreaterThan(0);
      expect(readFileSync(path.join(installed.directory, "chrome.exe")).equals(bytes)).toBe(true);
    } finally {
      await primary.close();
      await mirror.close();
      removeTemp(root);
    }
  });

  it("does not follow an HTTPS manifest onto an HTTP mirror", async () => {
    const keys = makeKeys();
    const calls: string[] = [];
    const bytes = Buffer.from("https-bytes");
    const manifest = fileManifest({
      keyId: keys.keyId,
      id: "gitleaks",
      label: "gitleaks",
      bytes,
      fileName: "gitleaks.exe",
      primaryUrl: "https://cdn.example/gitleaks.exe",
      mirrorUrls: ["http://mirror.example/gitleaks.exe"],
    });
    const body = signedManifest(manifest, keys.privateKey);
    const root = tempComponentsRoot();
    const downloader = new SignedComponentDownloader({
      componentsRoot: root,
      manifestUrl: "https://cdn.example/components-manifest.json",
      publicKey: keys.publicKey,
      expectedKeyId: keys.keyId,
      headroom: generousHeadroom,
      requestTimeoutMs: 200,
      fetchImpl: (url) => {
        calls.push(url);
        if (url.endsWith("components-manifest.json")) {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.reject(new DownloadTimeoutError("gitleaks"));
      },
    });
    try {
      await expect(downloader.download("gitleaks")).rejects.toBeInstanceOf(HttpDowngradeError);
      expect(calls).toEqual([
        "https://cdn.example/components-manifest.json",
        "https://cdn.example/gitleaks.exe",
      ]);
      expect(calls.some((url) => url.startsWith("http://"))).toBe(false);
    } finally {
      removeTemp(root);
    }
  });

  it("reads real free space and formats Settings disk-usage rows", async () => {
    const free = nodeDiskHeadroomGuard.freeBytes(tmpdir());
    expect(free >= 0n).toBe(true);
    expect(formatComponentDiskUsage("Whisper Medium", 480 * 1024 * 1024)).toBe("Whisper Medium: 480 MB");
    expect(formatComponentDiskUsage("Playwright Chromium", 290 * 1024 * 1024)).toBe(
      "Playwright Chromium: 290 MB",
    );
    expect(formatComponentDiskUsage("Local Postgres", 140 * 1024 * 1024)).toBe("Local Postgres: 140 MB");

    const root = tempComponentsRoot();
    try {
      const dir = path.join(root, "whisper-medium");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "component.json"), JSON.stringify({ label: "Whisper Medium" }));
      writeFileSync(path.join(dir, "model.bin"), Buffer.alloc(1024, 1));
      const leases = new Map<string, string>();
      const manager = new ComponentDiskUsageManager(root, {
        holder(componentId: string) {
          return leases.get(componentId) ?? null;
        },
      });
      const [row] = manager.list();
      expect(row?.label).toBe("Whisper Medium");
      expect(row?.display).toBe(formatComponentDiskUsage("Whisper Medium", row?.sizeBytes ?? 0));
      leases.set("whisper-medium", "T-5");
      expect(() => manager.uninstall("whisper-medium")).toThrow(ComponentLeaseActiveError);
      expect(existsSync(path.join(dir, "model.bin"))).toBe(true);
      leases.delete("whisper-medium");
      manager.uninstall("whisper-medium");
      expect(manager.list()).toEqual([]);
    } finally {
      removeTemp(root);
    }
  });
});
