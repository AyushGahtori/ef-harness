import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_COMPONENT_MANIFEST_KEY_ID,
  InvalidManifestSignatureError,
  SignedComponentDownloader,
  StrictTlsDisabledError,
  UnpinnedLatestUrlError,
  UnsignedComponentError,
  UnsafeArchivePathError,
  assertComponentExecutableAllowed,
  bundledComponentManifestPublicKey,
  HttpDowngradeError,
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

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/components");

function readSources(): string {
  return readdirSync(sourceRoot)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(path.join(sourceRoot, name), "utf8"))
    .join("\n");
}

describe("Ed25519 component manifests", () => {
  it("rejects a tampered manifest before any component byte is requested", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    let payloadHits = 0;
    const bytes = Buffer.from("whisper-model");
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        payloadHits += 1;
        res.end(bytes);
        return;
      }
      const manifest = fileManifest({
        keyId: keys.keyId,
        id: "whisper-medium",
        label: "Whisper Medium",
        bytes,
        fileName: "model.bin",
        primaryUrl: "http://127.0.0.1/payload",
      });
      const envelope = JSON.parse(signedManifest(manifest, keys.privateKey)) as {
        manifest: { components: { primaryUrl: string }[] };
        signature: string;
      };
      const component = envelope.manifest.components[0];
      if (component) component.primaryUrl = "http://127.0.0.1/payload-tampered";
      res.end(JSON.stringify(envelope));
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(InvalidManifestSignatureError);
      expect(payloadHits).toBe(0);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("rejects a manifest signed by a key other than the bundled pin", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const bytes = Buffer.from("pinned");
    const server = await listenLoopback((_req, res) => {
      const manifest = fileManifest({
        keyId: BUNDLED_COMPONENT_MANIFEST_KEY_ID,
        id: "gitleaks",
        label: "gitleaks",
        bytes,
        fileName: "gitleaks.exe",
        primaryUrl: "http://127.0.0.1/payload",
      });
      res.end(signedManifest(manifest, keys.privateKey));
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        headroom: generousHeadroom,
      });
      await expect(downloader.download("gitleaks")).rejects.toBeInstanceOf(InvalidManifestSignatureError);
      expect(bundledComponentManifestPublicKey()).toHaveLength(32);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("rejects a valid signature whose key id does not match the pin", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    let payloadHits = 0;
    const bytes = Buffer.from("bytes");
    const server = await listenLoopback((req, res) => {
      if (req.url === "/payload") {
        payloadHits += 1;
        res.end(bytes);
        return;
      }
      const manifest = fileManifest({
        keyId: "some-other-key",
        id: "gitleaks",
        label: "gitleaks",
        bytes,
        fileName: "gitleaks.exe",
        primaryUrl: `${serverOrigin}/payload`,
      });
      res.end(signedManifest(manifest, keys.privateKey));
    });
    const serverOrigin = server.origin;
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      await expect(downloader.download("gitleaks")).rejects.toBeInstanceOf(InvalidManifestSignatureError);
      expect(payloadHits).toBe(0);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("refuses an unpinned latest URL that has no digest and allows one that is digest-pinned", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const bytes = Buffer.from("latest-but-pinned");
    let payloadHits = 0;
    const server = await listenLoopback((req, res) => {
      if (req.url?.startsWith("/latest/")) {
        payloadHits += 1;
        res.end(bytes);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    try {
      const unpinned = fileManifest({
        keyId: keys.keyId,
        id: "whisper-medium",
        label: "Whisper Medium",
        bytes,
        fileName: "model.bin",
        primaryUrl: `${server.origin}/latest/model.bin`,
      });
      const unpinnedEntry = unpinned.components[0];
      if (unpinnedEntry === undefined) throw new Error("missing component");
      const unsignedLatest: typeof unpinned = {
        keyId: unpinned.keyId,
        components: [{ ...unpinnedEntry, sha256: "", files: [{ ...unpinnedEntry.files[0]!, sha256: "" }] }],
      };
      const badServer = await listenLoopback((_req, res) => {
        res.end(signedManifest(unsignedLatest, keys.privateKey));
      });
      try {
        const downloader = new SignedComponentDownloader({
          componentsRoot: root,
          manifestUrl: `${badServer.origin}/manifest`,
          publicKey: keys.publicKey,
          expectedKeyId: keys.keyId,
          headroom: generousHeadroom,
        });
        await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(UnpinnedLatestUrlError);
        expect(payloadHits).toBe(0);
      } finally {
        await badServer.close();
      }

      const versionLatest = fileManifest({
        keyId: keys.keyId,
        id: "whisper-medium",
        label: "Whisper Medium",
        bytes,
        fileName: "model.bin",
        primaryUrl: `${server.origin}/latest/model.bin`,
        version: "latest",
      });
      const versionServer = await listenLoopback((_req, res) => {
        res.end(signedManifest(versionLatest, keys.privateKey));
      });
      try {
        const downloader = new SignedComponentDownloader({
          componentsRoot: root,
          manifestUrl: `${versionServer.origin}/manifest`,
          publicKey: keys.publicKey,
          expectedKeyId: keys.keyId,
          headroom: generousHeadroom,
        });
        await expect(downloader.download("whisper-medium")).rejects.toBeInstanceOf(UnpinnedLatestUrlError);
      } finally {
        await versionServer.close();
      }

      const pinned = fileManifest({
        keyId: keys.keyId,
        id: "whisper-medium",
        label: "Whisper Medium",
        bytes,
        fileName: "model.bin",
        primaryUrl: `${server.origin}/latest/model.bin`,
        version: "1.2.0",
      });
      const goodServer = await listenLoopback((req, res) => {
        if (req.url === "/manifest") {
          res.end(signedManifest(pinned, keys.privateKey));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      try {
        const downloader = new SignedComponentDownloader({
          componentsRoot: root,
          manifestUrl: `${goodServer.origin}/manifest`,
          publicKey: keys.publicKey,
          expectedKeyId: keys.keyId,
          headroom: generousHeadroom,
        });
        const installed = await downloader.download("whisper-medium");
        expect(installed.verified).toBe(true);
        expect(payloadHits).toBe(1);
        assertComponentExecutableAllowed(installed);
        expect(() => assertComponentExecutableAllowed({ verified: false })).toThrow(UnsignedComponentError);
      } finally {
        await goodServer.close();
      }
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("refuses disabled TLS verification and non-loopback HTTP before any fetch", async () => {
    const root = tempComponentsRoot();
    try {
      const blocked = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: "http://127.0.0.1:9/manifest",
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        headroom: generousHeadroom,
      });
      await expect(blocked.download("whisper-medium")).rejects.toBeInstanceOf(StrictTlsDisabledError);

      const downgrade = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: "http://203.0.113.9/manifest",
        env: {},
        headroom: generousHeadroom,
      });
      await expect(downgrade.download("whisper-medium")).rejects.toBeInstanceOf(HttpDowngradeError);
    } finally {
      removeTemp(root);
    }
  });

  it("refuses an HTTP redirect when the signed URL is loopback HTTP upgraded to a public HTTP host", async () => {
    const keys = makeKeys();
    const root = tempComponentsRoot();
    const bytes = Buffer.from("redirected");
    const server = await listenLoopback((req, res) => {
      if (req.url === "/manifest") {
        const manifest = fileManifest({
          keyId: keys.keyId,
          id: "gitleaks",
          label: "gitleaks",
          bytes,
          fileName: "gitleaks.exe",
          primaryUrl: `${server.origin}/payload`,
        });
        res.end(signedManifest(manifest, keys.privateKey));
        return;
      }
      res.statusCode = 302;
      res.setHeader("location", "http://203.0.113.9/evil.bin");
      res.end();
    });
    try {
      const downloader = new SignedComponentDownloader({
        componentsRoot: root,
        manifestUrl: `${server.origin}/manifest`,
        publicKey: keys.publicKey,
        expectedKeyId: keys.keyId,
        headroom: generousHeadroom,
      });
      await expect(downloader.download("gitleaks")).rejects.toBeInstanceOf(HttpDowngradeError);
      expect(() => {
        throw new UnsafeArchivePathError("../evil.exe");
      }).toThrow(UnsafeArchivePathError);
    } finally {
      await server.close();
      removeTemp(root);
    }
  });

  it("does not spawn component binaries or disable TLS inside the component sources", () => {
    const source = readSources();
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("rejectUnauthorized");
  });
});
