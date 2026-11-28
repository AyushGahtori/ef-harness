import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArchiveIntegrityError,
  ChecksumMismatchError,
  MAX_CHECKSUM_RETRIES,
  SignedComponentDownloader,
  UnsafeArchivePathError,
  atomicDirectorySwap,
  crc32,
  extractZip,
  packZip,
  recoverInterruptedInstall,
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

describe("checksum rejection and staged swaps", () => {
  it("deletes a full staged part when SHA-256 does not match and never unpacks it", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const good = Buffer.from("correct-payload-bytes-32b!!!!");
    const bad = Buffer.alloc(good.length, 0xab);
    let hits = 0;
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        hits += 1;
        res.end(bad);
        return;
      }
      res.end(
        signedManifest(
          fileManifest({
            keyId: keys.keyId,
            id: "whisper-medium",
            label: "Whisper Medium",
            bytes: good,
            fileName: "model.bin",
            primaryUrl: `${server.origin}/payload`,
          }),
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
        headroom: generousHeadroom,
      });
      await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(ChecksumMismatchError);
      expect(hits).toBe(MAX_CHECKSUM_RETRIES + 1);
      expect(existsSync(path.join(root, "_incoming", "whisper-medium.part"))).toBe(false);
      expect(existsSync(path.join(root, "whisper-medium"))).toBe(false);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("extracts a deflated zip only after every inner hash matches", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const model = Buffer.from("gguf-bytes");
    const readme = Buffer.from("readme");
    const archive = packZip(
      [
        { path: "model.bin", data: model },
        { path: "README.txt", data: readme },
      ],
      "deflate",
    );
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        res.end(archive);
        return;
      }
      res.end(
        signedManifest(
          {
            keyId: keys.keyId,
            components: [
              {
                id: "whisper-medium",
                label: "Whisper Medium",
                version: "1.2.0",
                sizeBytes: archive.length,
                sha256: sha256Hex(archive),
                primaryUrl: `${server.origin}/payload`,
                mirrorUrls: [],
                packaging: "zip",
                files: [
                  { path: "model.bin", sha256: sha256Hex(model), sizeBytes: model.length },
                  { path: "README.txt", sha256: sha256Hex(readme), sizeBytes: readme.length },
                ],
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
        headroom: generousHeadroom,
      });
      const installed = await downloader.download("whisper-medium");
      expect(readFileSync(path.join(installed.directory, "model.bin")).equals(model)).toBe(true);
      expect(readFileSync(path.join(installed.directory, "README.txt")).equals(readme)).toBe(true);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("keeps the previous install when an inner hash fails after the archive hash matched", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const good = Buffer.from("good-binary");
    const broken = Buffer.from("broken-binary");
    const archive = packZip([{ path: "whisper-cli.exe", data: broken }], "store");
    let phase: "good" | "bad" = "good";
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        res.end(phase === "good" ? good : archive);
        return;
      }
      const manifest =
        phase === "good"
          ? fileManifest({
              keyId: keys.keyId,
              id: "whisper-medium",
              label: "Whisper Medium",
              bytes: good,
              fileName: "whisper-cli.exe",
              primaryUrl: `${server.origin}/payload`,
            })
          : {
              keyId: keys.keyId,
              components: [
                {
                  id: "whisper-medium",
                  label: "Whisper Medium",
                  version: "1.3.0",
                  sizeBytes: archive.length,
                  sha256: sha256Hex(archive),
                  primaryUrl: `${server.origin}/payload`,
                  mirrorUrls: [],
                  packaging: "zip" as const,
                  files: [
                    { path: "whisper-cli.exe", sha256: sha256Hex(good), sizeBytes: broken.length },
                  ],
                },
              ],
            };
      res.end(signedManifest(manifest, keys.privateKey));
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      await downloader.download("whisper-medium");
      phase = "bad";
      await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(ChecksumMismatchError);
      const live = path.join(root, "whisper-medium", "whisper-cli.exe");
      expect(readFileSync(live).equals(good)).toBe(true);
      expect(existsSync(path.join(root, "_incoming", "whisper-medium.staging"))).toBe(false);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("restores the previous tree when a swap is interrupted and rejects unsafe paths", async () => {
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    const root = tempComponentsRoot();
    try {
      const live = path.join(root, "comp");
      const staging = path.join(root, "staging");
      mkdirSync(live, { recursive: true });
      mkdirSync(staging, { recursive: true });
      writeFileSync(path.join(live, "bin.txt"), "old");
      writeFileSync(path.join(staging, "bin.txt"), "new");
      expect(() =>
        atomicDirectorySwap(staging, live, {
          afterMoveLiveAside() {
            throw new Error("power loss");
          },
        }),
      ).toThrow("power loss");
      expect(readFileSync(path.join(live, "bin.txt"), "utf8")).toBe("old");

      const previous = `${live}.previous`;
      mkdirSync(previous, { recursive: true });
      writeFileSync(path.join(previous, "bin.txt"), "restored");
      const removed = path.join(root, "missing-live");
      mkdirSync(`${removed}.previous`, { recursive: true });
      writeFileSync(path.join(`${removed}.previous`, "bin.txt"), "restored");
      expect(recoverInterruptedInstall(removed)).toBe("restored");
      expect(readFileSync(path.join(removed, "bin.txt"), "utf8")).toBe("restored");

      const zipPath = path.join(root, "ok.zip");
      writeFileSync(zipPath, packZip([{ path: "ok.txt", data: Buffer.from("ok") }], "store"));
      const dest = path.join(root, "extract");
      mkdirSync(dest, { recursive: true });
      await expect(
        extractZip(zipPath, dest, [
          { path: "../evil.txt", sha256: sha256Hex(Buffer.from("ok")), sizeBytes: 2 },
        ]),
      ).rejects.toBeInstanceOf(UnsafeArchivePathError);
      expect(existsSync(path.join(root, "evil.txt"))).toBe(false);
    } finally {
      removeTemp(root);
    }
  });

  it("round-trips a stored archive and rejects a bad crc", async () => {
    const root = tempComponentsRoot();
    try {
      const payload = Buffer.from("stored-bytes");
      const zipPath = path.join(root, "stored.zip");
      writeFileSync(zipPath, packZip([{ path: "payload.bin", data: payload }], "store"));
      const dest = path.join(root, "out");
      await extractZip(zipPath, dest, [
        { path: "payload.bin", sha256: sha256Hex(payload), sizeBytes: payload.length },
      ]);
      expect(readFileSync(path.join(dest, "payload.bin")).equals(payload)).toBe(true);
      const bad = packZip([{ path: "payload.bin", data: payload }], "store");
      const dataOffset = 30 + Buffer.from("payload.bin", "utf8").length;
      bad[dataOffset] = (bad[dataOffset] ?? 0) ^ 0xff;
      const badPath = path.join(root, "bad.zip");
      writeFileSync(badPath, bad);
      await expect(
        extractZip(badPath, path.join(root, "bad-out"), [
          { path: "payload.bin", sha256: sha256Hex(payload), sizeBytes: payload.length },
        ]),
      ).rejects.toBeInstanceOf(ArchiveIntegrityError);
    } finally {
      removeTemp(root);
    }
  });
});
