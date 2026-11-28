import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ELECTRON_RENDERER_SECURITY,
  securityPolicyFindings,
  sourceSecurityFindings,
} from "../../src/shell/security.js";

const shellDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shell");

describe("renderer security", () => {
  it("keeps the Electron renderer sandboxed with a self-only content security policy", () => {
    expect(securityPolicyFindings()).toEqual([]);
    expect(ELECTRON_RENDERER_SECURITY.nodeIntegration).toBe(false);
    expect(ELECTRON_RENDERER_SECURITY.contextIsolation).toBe(true);
    expect(ELECTRON_RENDERER_SECURITY.sandbox).toBe(true);
    expect(ELECTRON_RENDERER_SECURITY.rawIpcRenderer).toBe(false);
    expect(ELECTRON_RENDERER_SECURITY.contentSecurityPolicy).toBe("default-src 'self'");
    expect(ELECTRON_RENDERER_SECURITY.externalCdnFonts).toBe(false);
    expect(ELECTRON_RENDERER_SECURITY.externalCdnScripts).toBe(false);
  });

  it("scans the shell sources for raw ipc, filesystem, and remote assets", () => {
    const files = fs.readdirSync(shellDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    const findings = files.flatMap((name) => {
      const text = fs.readFileSync(path.join(shellDir, name), "utf8");
      return sourceSecurityFindings(text).map((finding) => `${name}: ${finding}`);
    });
    expect(findings).toEqual([]);
    const pipe = files.filter((name) => fs.readFileSync(path.join(shellDir, name), "utf8").includes("NamedPipeClient"));
    expect(pipe).toEqual([]);
  });
});
