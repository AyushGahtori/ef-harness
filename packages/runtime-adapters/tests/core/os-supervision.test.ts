import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryEnvProcessRegistry, OsJobSupervisor, supervisionCatalog } from "../../src/core/index.js";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/core");

describe("OS job supervision", () => {
  it("opens a real sandbox job and closes it without a helper script", async () => {
    const jobs = new OsJobSupervisor(new MemoryEnvProcessRegistry());
    const created = await jobs.create("session-a");
    expect(created.jobId.length).toBeGreaterThan(0);
    expect(await jobs.kill(created.jobId, "test")).toEqual([]);
    const catalog = supervisionCatalog();
    expect(catalog.jobs).toBe(process.platform === "win32" ? "WindowsJobObjectManager" : "PosixProcessGroupSupervisor");
    expect(catalog.proxy).toBe("AllowlistProxyServer");
    expect(catalog.vault).toBe("WindowsDpapiSecretsVault");
  });

  it("keeps the core free of the blocking helper", () => {
    const sources = fs.readdirSync(coreDir).filter((name) => name.endsWith(".ts"));
    expect(sources).not.toContain("windows-job.ts");
    for (const name of sources) {
      const text = fs.readFileSync(path.join(coreDir, name), "utf8");
      expect(text.includes("Atomics.wait")).toBe(false);
      expect(text.includes("node:sqlite")).toBe(false);
    }
  });
});
