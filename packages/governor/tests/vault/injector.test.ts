import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeOnlyEnvInjector, workerEnvironmentIsCredentialFree } from "../../src/vault/injector.js";
import { stripeLivePrefix, stripeTestPrefix } from "../../src/vault/patterns.js";
import type { StoredSecret, VaultSecretSource } from "../../src/vault/ports.js";
import { PacketSecurityRedactor } from "../../src/vault/redactor.js";
import { LiveKeyTestRefusalGuard } from "../../src/vault/refusal.js";
import { LiveKeyRefusedError, ZeroArgvSecretError } from "../../src/vault/types.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class MemorySecrets implements VaultSecretSource {
  constructor(private readonly rows: readonly StoredSecret[]) {}

  async readSecret(secretId: string): Promise<StoredSecret | null> {
    return this.rows.find((row) => row.secretId === secretId) ?? null;
  }
}

const testKey = `${stripeTestPrefix()}fixture_child_999`;
const liveKey = `${stripeLivePrefix()}CANARY_888`;
const pem = [
  "-----BEGIN TEST KEY-----",
  "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
  "-----END TEST KEY-----",
].join("\n");

function row(partial: Pick<StoredSecret, "secretId" | "name" | "value" | "envScope">): StoredSecret {
  return {
    projectId: "proj",
    taggedProd: false,
    testOverride: false,
    ...partial,
  };
}

describe("RuntimeOnlyEnvInjector", () => {
  it("injects through the child env block, redacts echoed env, and keeps worker sandboxes clean", async () => {
    const secrets = new MemorySecrets([
      row({ secretId: "test", name: "STRIPE_TEST_KEY", value: testKey, envScope: "test" }),
      row({ secretId: "live", name: "STRIPE_SECRET_KEY", value: liveKey, envScope: "prod" }),
      row({ secretId: "pem", name: "PEM_KEY", value: pem, envScope: "dev" }),
      row({ secretId: "openai", name: "OPENAI_API_KEY", value: "CANARY_WORKER_OPENAI_999", envScope: "prod" }),
      row({ secretId: "github", name: "GITHUB_TOKEN", value: "CANARY_WORKER_GITHUB_999", envScope: "prod" }),
      row({ secretId: "vercel", name: "VERCEL_TOKEN", value: "CANARY_WORKER_VERCEL_999", envScope: "prod" }),
    ]);
    const guard = new LiveKeyTestRefusalGuard();
    const injector = new RuntimeOnlyEnvInjector(secrets, new PacketSecurityRedactor(), guard);
    const dir = await mkdtemp(path.join(tmpdir(), "ef-inject-"));
    try {
      const echoed = await injector.spawn({
        role: "preview",
        tier: "A",
        secretIds: ["test"],
        command: process.execPath,
        args: [
          "-e",
          "const {createHash}=require('node:crypto'); const value=process.env.STRIPE_TEST_KEY||''; process.stdout.write('sha='+createHash('sha256').update(value).digest('hex')+'\\n'); process.stdout.write(value+'\\n'); process.stdout.write('github='+String(process.env.GITHUB_TOKEN)+'\\n');",
        ],
        cwd: dir,
        baseEnv: { PUBLIC_APP_NAME: "demo", GITHUB_TOKEN: "CANARY_WORKER_GITHUB_999" },
      });
      expect(echoed.shell).toBe(false);
      expect(echoed.redactedStdout.includes(`sha=${sha(testKey)}`)).toBe(true);
      expect(echoed.redactedStdout.includes("[REDACTED:STRIPE_TEST_KEY]")).toBe(true);
      expect(echoed.redactedStdout.includes(testKey)).toBe(false);
      expect(echoed.redactedStdout.includes("github=undefined")).toBe(true);
      expect(echoed.argv.some((arg) => arg.includes(testKey))).toBe(false);
      expect(echoed.envNames.includes("STRIPE_TEST_KEY")).toBe(true);
      expect(echoed.envNames.includes("GITHUB_TOKEN")).toBe(false);

      const multiline = await injector.spawn({
        role: "test",
        secretIds: ["pem"],
        command: process.execPath,
        args: [
          "-e",
          "const value=process.env.PEM_KEY||''; const line=(value.split(/\\n/)[1]||''); process.stdout.write(line+'\\n'); process.stdout.write(value+'\\n');",
        ],
        cwd: dir,
      });
      expect(multiline.redactedStdout.includes("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=")).toBe(false);
      expect(multiline.redactedStdout.includes(pem)).toBe(false);
      expect(multiline.redactedStdout.includes("[REDACTED:PEM_KEY]")).toBe(true);

      await expect(
        injector.spawn({
          role: "preview",
          secretIds: ["test"],
          command: process.execPath,
          args: ["-e", "process.exit(0)", testKey],
          cwd: dir,
        }),
      ).rejects.toBeInstanceOf(ZeroArgvSecretError);

      await expect(
        injector.spawn({
          role: "preview",
          secretIds: ["live"],
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          cwd: dir,
        }),
      ).rejects.toBeInstanceOf(LiveKeyRefusedError);

      for (const tier of ["A", "B", "C"] as const) {
        const worker = await injector.spawn({
          role: "coding-worker",
          tier,
          secretIds: ["openai", "github", "vercel", "live"],
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('openai='+String(process.env.OPENAI_API_KEY)+'\\n'); process.stdout.write('github='+String(process.env.GITHUB_TOKEN)+'\\n'); process.stdout.write('vercel='+String(process.env.VERCEL_TOKEN)+'\\n'); process.stdout.write('public='+String(process.env.PUBLIC_APP_NAME)+'\\n');",
          ],
          cwd: dir,
          baseEnv: {
            PUBLIC_APP_NAME: "demo",
            GITHUB_TOKEN: "CANARY_WORKER_GITHUB_999",
            OPENAI_API_KEY: "CANARY_WORKER_OPENAI_999",
          },
        });
        expect(worker.redactedStdout.includes("openai=undefined")).toBe(true);
        expect(worker.redactedStdout.includes("github=undefined")).toBe(true);
        expect(worker.redactedStdout.includes("vercel=undefined")).toBe(true);
        expect(worker.redactedStdout.includes("public=demo")).toBe(true);
        expect(worker.envNames.includes("OPENAI_API_KEY")).toBe(false);
        expect(workerEnvironmentIsCredentialFree(Object.fromEntries(worker.envNames.map((name) => [name, "kept"])))).toBe(
          true,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
