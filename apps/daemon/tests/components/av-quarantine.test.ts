import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AV_QUARANTINE_CARD,
  AvQuarantineIntegrityChecker,
  SignedComponentDownloader,
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

async function installSample(
  root: string,
  componentId: string,
  fileName: string,
  bytes: Buffer,
): Promise<{ close: () => Promise<void>; downloader: SignedComponentDownloader }> {
  const keys = makeKeys();
  const server = await listenLoopback((req, res) => {
    if (req.url === "/payload") {
      res.end(bytes);
      return;
    }
    res.end(
      signedManifest(
        fileManifest({
          keyId: keys.keyId,
          id: componentId,
          label: componentId.startsWith("whisper") ? "Whisper Medium" : "gitleaks",
          bytes,
          fileName,
          primaryUrl: `${server.origin}/payload`,
        }),
        keys.privateKey,
      ),
    );
  });
  const downloader = new SignedComponentDownloader({
    componentsRoot: root,
    manifestUrl: `${server.origin}/manifest`,
    publicKey: keys.publicKey,
    expectedKeyId: keys.keyId,
    headroom: generousHeadroom,
  });
  await downloader.download(componentId);
  return { close: () => server.close(), downloader };
}

describe("antivirus quarantine repair", () => {
  it("reports a deleted whisper binary without throwing and repairs it", async () => {
    const root = tempComponentsRoot();
    const bytes = Buffer.from("whisper-cli-bytes");
    const installed = await installSample(root, "whisper-medium", "whisper-cli.exe", bytes);
    try {
      const exe = path.join(root, "whisper-medium", "whisper-cli.exe");
      rmSync(exe);
      const checker = new AvQuarantineIntegrityChecker(root);
      const report = checker.inspect("whisper-medium");
      expect(report.ok).toBe(false);
      expect(report.card).toBe(AV_QUARANTINE_CARD);
      expect(report.suggestedFallback).toBe("os-dictation");
      expect(report.findings[0]?.reason).toBe("ENOENT");
      expect(report.findings[0]?.card).toBe(AV_QUARANTINE_CARD);
      const repaired = await checker.repair("whisper-medium", installed.downloader);
      expect(repaired.ok).toBe(true);
      expect(readFileSync(exe).equals(bytes)).toBe(true);
    } finally {
      await installed.close();
      removeTemp(root);
    }
  });

  it("reports gitleaks deletion without an OS dictation fallback", async () => {
    const root = tempComponentsRoot();
    const bytes = Buffer.from("gitleaks-bytes");
    const installed = await installSample(root, "gitleaks", "gitleaks.exe", bytes);
    try {
      rmSync(path.join(root, "gitleaks"), { recursive: true, force: true });
      const report = new AvQuarantineIntegrityChecker(root).inspect("gitleaks");
      expect(report.card).toBe(AV_QUARANTINE_CARD);
      expect(report.suggestedFallback).toBeNull();
      expect(report.findings.every((finding) => finding.reason === "ENOENT")).toBe(true);
    } finally {
      await installed.close();
      removeTemp(root);
    }
  });

  it("reports hash mismatch and EACCES without spawning", async () => {
    const root = tempComponentsRoot();
    const bytes = Buffer.from("gitleaks-bytes");
    const installed = await installSample(root, "gitleaks", "gitleaks.exe", bytes);
    try {
      const exe = path.join(root, "gitleaks", "gitleaks.exe");
      const current = readFileSync(exe);
      current[0] = (current[0] ?? 0) ^ 0xff;
      writeFileSync(exe, current);
      const mismatch = new AvQuarantineIntegrityChecker(root).inspect("gitleaks");
      expect(mismatch.findings[0]?.reason).toBe("hash_mismatch");
      expect(mismatch.card).toBe(AV_QUARANTINE_CARD);

      const blocked = new AvQuarantineIntegrityChecker(root, {
        readFile() {
          const error = new Error("blocked") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        },
      }).inspect("gitleaks");
      expect(blocked.findings[0]?.reason).toBe("EACCES");
      expect(blocked.ok).toBe(false);
    } finally {
      await installed.close();
      removeTemp(root);
    }
  });

  it("ignores components that were uninstalled on purpose", () => {
    const root = tempComponentsRoot();
    try {
      mkdirSync(root, { recursive: true });
      const report = new AvQuarantineIntegrityChecker(root).inspect("whisper-medium");
      expect(report.ok).toBe(true);
      expect(report.card).toBeNull();
    } finally {
      removeTemp(root);
    }
  });
});
