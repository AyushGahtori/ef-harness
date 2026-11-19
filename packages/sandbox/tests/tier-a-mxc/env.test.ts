import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildScrubbedEnvironment,
  cacheLayout,
  environmentPairs,
  injectSingleVendorToken,
  MxcModeError,
  redirectsAreInsideTemp,
} from "../../src/tier-a-mxc/index.js";

describe("scrubbed environment", () => {
  it("builds an allowlist and redirects home, temp, and tool caches inside the attempt", () => {
    const temp = "C:\\wt\\slot-1-temp";
    const redirects = cacheLayout(temp, 47002);
    const source = {
      PATH: "C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\dev",
      HOME: "C:\\Users\\dev",
      GH_TOKEN: "personal-token",
      GITHUB_TOKEN: "personal-github",
      ACCESS_TOKEN: "personal-access",
      CURSOR_API_KEY: "personal-cursor",
      ANTHROPIC_API_KEY: "personal-anthropic",
      OPENAI_API_KEY: "personal-openai",
      AWS_SECRET_ACCESS_KEY: "personal-aws",
      AZURE_CLIENT_SECRET: "personal-azure",
      NPM_TOKEN: "personal-npm",
      EMAIL: "dev@example.test",
    };
    const env = buildScrubbedEnvironment(source, redirects);
    expect(env.PATH).toBe("C:\\Windows\\system32");
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(env.HOME).toBe(redirects.home);
    expect(env.USERPROFILE).toBe(redirects.home);
    expect(env.TEMP).toBe(temp);
    expect(env.TMP).toBe(temp);
    expect(env.TMPDIR).toBe(temp);
    expect(env.XDG_CACHE_HOME).toBe(redirects.xdgCache);
    expect(env.npm_config_cache).toBe(redirects.npmCache);
    expect(env.ESLINT_CACHE_LOCATION).toBe(redirects.eslintCache);
    expect(env.VITEST_CACHE_DIR).toBe(redirects.vitestCache);
    expect(env.TURBO_CACHE_DIR).toBe(redirects.turboCache);
    expect(env.PLAYWRIGHT_CACHE_DIR).toBe(redirects.playwrightCache);
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:47002");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:47002");
    expect(env.ALL_PROXY).toBe("http://127.0.0.1:47002");
    expect(redirectsAreInsideTemp(redirects, temp)).toBe(true);
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "ACCESS_TOKEN",
      "CURSOR_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_CLIENT_SECRET",
      "NPM_TOKEN",
      "EMAIL",
      "USERPROFILE",
    ]) {
      if (key === "USERPROFILE") {
        expect(env.USERPROFILE).not.toBe("C:\\Users\\dev");
        continue;
      }
      expect(env[key]).toBeUndefined();
    }
    const wrapped = injectSingleVendorToken(env, "codex", "scoped-value");
    expect(wrapped.ACCESS_TOKEN).toBe("scoped-value");
    expect(wrapped.ANTHROPIC_API_KEY).toBeUndefined();
    expect(wrapped.CURSOR_API_KEY).toBeUndefined();
    expect(wrapped.GH_TOKEN).toBeUndefined();
    expect(() => injectSingleVendorToken(env, "gemini", "scoped-value")).toThrow(MxcModeError);
    expect(environmentPairs(wrapped).some((pair) => pair.startsWith("ACCESS_TOKEN="))).toBe(true);
  });

  it("does not copy the parent environment object", () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL("../../src/tier-a-mxc/env.ts", import.meta.url)),
      "utf8",
    );
    const provider = fs.readFileSync(
      fileURLToPath(new URL("../../src/tier-a-mxc/provider.ts", import.meta.url)),
      "utf8",
    );
    const kernel = fs.readFileSync(
      fileURLToPath(new URL("../../src/tier-a-mxc/kernel.ts", import.meta.url)),
      "utf8",
    );
    expect(source.includes("...process.env")).toBe(false);
    expect(source.includes("...source")).toBe(false);
    expect(provider.includes("...process.env")).toBe(false);
    expect(kernel.includes("...process.env")).toBe(false);
    expect(kernel.includes("Experimental_CreateProcessInSandbox")).toBe(false);
    expect(kernel.includes("shell: true")).toBe(false);
    expect(path.basename(fileURLToPath(new URL("../../src/tier-a-mxc/env.ts", import.meta.url)))).toBe("env.ts");
  });
});
