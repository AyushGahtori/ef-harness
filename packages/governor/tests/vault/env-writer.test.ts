import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GitignoredLocalEnvWriter } from "../../src/vault/env-writer.js";
import { currentWindowsIdentity, parseIcaclsIdentities, runTool } from "../../src/vault/ntfs-acl.js";
import { GITIGNORE_OFFER } from "../../src/vault/types.js";

const exec = promisify(execFile);

describe("GitignoredLocalEnvWriter", () => {
  it("refuses until gitignore succeeds, then writes an owner-only file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ef-env-writer-"));
    try {
      await exec("git", ["init"], { cwd: dir });
      await exec("git", ["config", "core.excludesFile", "NUL"], { cwd: dir });
      const example = "STRIPE_EXAMPLE=replace_me\n";
      await writeFile(path.join(dir, ".env.example"), example, "utf8");
      const writer = new GitignoredLocalEnvWriter();
      const optedOut = await writer.write({
        projectDir: dir,
        explicitOptIn: false,
        entries: { STRIPE_TEST_KEY: "local_fixture_value_999" },
      });
      expect(optedOut.written).toBe(false);
      if (!optedOut.written) expect(optedOut.reason).toBe("opt-in-required");
      const refused = await writer.write({
        projectDir: dir,
        explicitOptIn: true,
        entries: { STRIPE_TEST_KEY: "local_fixture_value_999" },
      });
      expect(refused.written).toBe(false);
      if (!refused.written) {
        expect(refused.offer).toBe(GITIGNORE_OFFER);
        expect(refused.offer).toBe("Add .env.local to .gitignore first");
      }
      await expect(readFile(path.join(dir, ".env.local"), "utf8")).rejects.toThrow();
      await writeFile(path.join(dir, ".gitignore"), ".env.local\n", "utf8");
      const written = await writer.write({
        projectDir: dir,
        explicitOptIn: true,
        entries: {
          STRIPE_TEST_KEY: "local_fixture_value_999",
          PEM_KEY: "line-one\nline-two",
        },
      });
      expect(written.written).toBe(true);
      const body = await readFile(path.join(dir, ".env.local"), "utf8");
      expect(body.includes("STRIPE_TEST_KEY=local_fixture_value_999")).toBe(true);
      expect(body.includes("line-one\\nline-two")).toBe(true);
      expect(await readFile(path.join(dir, ".env.example"), "utf8")).toBe(example);
      if (process.platform === "win32") {
        const icacls = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe");
        const listed = await runTool(icacls, [path.join(dir, ".env.local")]);
        const identities = parseIcaclsIdentities(listed.stdout, path.join(dir, ".env.local"));
        const who = await currentWindowsIdentity();
        expect(identities.map((identity) => identity.toLowerCase())).toEqual([who.toLowerCase()]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
