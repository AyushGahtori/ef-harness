import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanPathsForPlaintext } from "../../src/vault/disk-scan.js";
import { WindowsDpapiMaterialStore } from "../../src/vault/dpapi-store.js";
import { diffSecretNames } from "../../src/vault/name-diff.js";
import { stripeLivePrefix, stripeLiveRefusalMessage, stripeTestPrefix } from "../../src/vault/patterns.js";
import type { PurgeReceipt, SecretPurgeEngine } from "../../src/vault/ports.js";
import { ProviderSecretProber } from "../../src/vault/prober.js";
import {
  CredentialsNeedReentryError,
  DPAPI_REENTRY_MESSAGE,
  LiveKeyRefusedError,
} from "../../src/vault/types.js";
import { WindowsDpapiSecretsVault } from "../../src/vault/vault.js";

class RecordingPurge implements SecretPurgeEngine {
  readonly secrets: string[] = [];

  executeSecretPurge(secret: string, options?: { label?: string }): PurgeReceipt {
    this.secrets.push(secret);
    return {
      id: "purge-fixture",
      status: "complete",
      partial: false,
      label: options?.label ?? "SECRET",
      placeholder: "[REDACTED_SECRET:SECRET]",
      secretFingerprint: "fixture-fingerprint",
      counts: { state: 0 },
      hashMapArtifact: null,
      rotationMandatory: true,
      rotationUrl: null,
      rotationGuidance: "Rotate the provider credential.",
      remoteHistoryRewriteRequired: false,
      remoteHistoryRewriteMessage: "",
      completedSteps: ["locate", "rewrite", "fts", "vacuum", "cas", "backups", "remote_gate", "rotation"],
      failedStep: null,
      pendingTargets: [],
      failureMessage: null,
    };
  }
}

describe("WindowsDpapiSecretsVault", () => {
  it("round-trips DPAPI secrets, refuses live test keys, and leaves no plaintext on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ef-vault-"));
    const vaultDir = path.join(dir, "vault");
    const store = new WindowsDpapiMaterialStore(vaultDir);
    const purge = new RecordingPurge();
    const prober = new ProviderSecretProber({
      fetchImpl: async (_url, init) => {
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        const livemode = authorization.includes("livemode_on");
        return new Response(JSON.stringify({ livemode }), { status: 200 });
      },
    });
    const vault = new WindowsDpapiSecretsVault({
      globalDbPath: path.join(dir, "global.db"),
      stateDbPath: path.join(dir, "state.db"),
      vaultDir,
      logsDir: path.join(dir, "logs"),
      materialStore: store,
      purge,
      prober,
      prodHostnames: ["db.prod.internal"],
    });
    const canary = "CANARY_DPAPI_SECRET_999";
    const rotated = "CANARY_DPAPI_SECRET_ROTATED";
    const live = `${stripeLivePrefix()}CANARY_888`;
    const pem = [
      "-----BEGIN TEST KEY-----",
      "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      "-----END TEST KEY-----",
    ].join("\n");
    const large = `LARGE_CANARY_START${"B".repeat(4000)}LARGE_CANARY_END`;
    try {
      await mkdir(path.join(dir, "cas"), { recursive: true });
      await writeFile(path.join(dir, "cas", "blob.txt"), "cas blob without a vault secret", "utf8");
      const saved = await vault.put({
        projectId: "proj",
        envScope: "test",
        name: "CANARY_NAME",
        value: canary,
      });
      expect((await vault.readSecret(saved.secretId))?.value).toBe(canary);
      expect(saved.lastFourMasked.includes(canary)).toBe(false);
      await expect(
        vault.put({
          projectId: "proj",
          envScope: "test",
          name: "LIVE_CANARY",
          value: live,
        }),
      ).rejects.toBeInstanceOf(LiveKeyRefusedError);
      expect(vault.listSecretNamesAndHashes("proj", "test").some((item) => item.name === "LIVE_CANARY")).toBe(false);
      const livemode = vault.put({
        projectId: "proj",
        envScope: "test",
        name: "STRIPE_TEST_KEY",
        value: `${stripeTestPrefix()}fixture_livemode_on`,
        provider: "stripe",
      });
      await expect(livemode).rejects.toBeInstanceOf(LiveKeyRefusedError);
      await expect(livemode).rejects.toThrow(stripeLiveRefusalMessage());
      const verified = await vault.put({
        projectId: "proj",
        envScope: "test",
        name: "STRIPE_TEST_KEY",
        value: `${stripeTestPrefix()}fixture_ok`,
        provider: "stripe",
      });
      expect(verified.verifiedStatus).toBe("verified_test");
      const prod = await vault.put({
        projectId: "proj",
        envScope: "prod",
        name: "LIVE_CANARY",
        value: live,
      });
      vault.invalidateCaches();
      expect((await vault.readSecret(prod.secretId))?.value).toBe(live);
      const pemSaved = await vault.put({
        projectId: "proj",
        envScope: "dev",
        name: "PEM_KEY",
        value: pem,
      });
      vault.invalidateCaches();
      expect((await vault.readSecret(pemSaved.secretId))?.value).toBe(pem);
      const before = vault.listSecretNamesAndHashes("proj", "test");
      const rotation = await vault.rotate(saved.secretId, rotated);
      await rotation.purgePrevious.invoke();
      expect(purge.secrets.includes(canary)).toBe(true);
      vault.invalidateCaches();
      expect((await vault.readSecret(saved.secretId))?.value).toBe(rotated);
      const after = vault.listSecretNamesAndHashes("proj", "test");
      const changed = diffSecretNames(after, before);
      expect(changed.changed.includes("CANARY_NAME")).toBe(true);
      expect(changed.summary).toBe(
        `${changed.added.length} added, ${changed.changed.length} changed, ${changed.deleted.length} deleted — [names only]`,
      );
      expect(JSON.stringify(after).includes(rotated)).toBe(false);
      expect(after.every((item) => /^[0-9a-f]{64}$/.test(item.hmac))).toBe(true);
      const removed = await vault.delete(saved.secretId);
      await removed.invoke();
      expect(await vault.readSecret(saved.secretId)).toBeNull();
      expect(await store.readAndUnprotect(saved.credentialTarget)).toBeNull();
      const pasted = vault.offerChatPastePurge(canary, "CANARY_NAME");
      expect(pasted.invocation).toBe("one-click");
      const receipt = await pasted.invoke();
      expect(receipt.rotationMandatory).toBe(true);
      expect(receipt.completedSteps).toHaveLength(8);
      const largeSaved = await vault.put({
        projectId: "proj",
        envScope: "dev",
        name: "LARGE_CANARY",
        value: large,
      });
      vault.invalidateCaches();
      expect((await vault.readSecret(largeSaved.secretId))?.value).toBe(large);
      vault.invalidateCaches();
      await store.replaceStoredCiphertext(
        prod.credentialTarget,
        Buffer.from("not-a-dpapi-blob"),
        path.join(vaultDir, "blobs", `${prod.secretId}.bin`),
      );
      const reentry = await vault.readSecret(prod.secretId).then(
        () => null,
        (error: unknown) => error,
      );
      expect(reentry).toBeInstanceOf(CredentialsNeedReentryError);
      if (reentry instanceof CredentialsNeedReentryError) {
        expect(reentry.message).toBe(DPAPI_REENTRY_MESSAGE);
      }
      await vault.delete(prod.secretId);
      await vault.delete(pemSaved.secretId);
      await vault.delete(largeSaved.secretId);
      await vault.delete(verified.secretId);
      const entries = await vault.materializeEnvEntries("proj", "test", false).catch((error: unknown) => error);
      expect(entries).toBeInstanceOf(Error);
    } finally {
      await vault.close();
      const hits = scanPathsForPlaintext(
        [dir],
        [canary, rotated, live, pem, "LARGE_CANARY_START", `${stripeTestPrefix()}fixture_ok`].map((needle) =>
          Buffer.from(needle, "utf8"),
        ),
      );
      expect(hits).toEqual([]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
