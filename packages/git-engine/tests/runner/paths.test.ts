import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledMinGitPath,
  directoryExists,
  isUncPath,
  normalizeRepoPath,
  normalizeWindowsPath,
  pathIsInside,
  probeDirectoryExists,
  scrubGitEnv,
} from "../../src/runner/paths.js";

describe("Windows path normalization", () => {
  it("normalizes drive prefixes, slashes, and extended-length UNC prefixes", () => {
    expect(normalizeWindowsPath("c:/tools/git")).toBe("C:\\tools\\git");
    expect(normalizeWindowsPath("C:\\tools\\\\git\\")).toBe("C:\\tools\\git");
    expect(normalizeWindowsPath("\\\\?\\C:\\tools\\git")).toBe("C:\\tools\\git");
    expect(normalizeWindowsPath("\\\\?\\UNC\\server\\share\\repo")).toBe("\\\\server\\share\\repo");
    expect(normalizeWindowsPath("//server/share/repo")).toBe("\\\\server\\share\\repo");
    expect(isUncPath("\\\\server\\share\\repo")).toBe(true);
    expect(isUncPath("//server/share/repo")).toBe(true);
    expect(isUncPath("C:\\repo")).toBe(false);
    expect(pathIsInside("C:\\Cloud\\project\\app", "c:/cloud")).toBe(true);
    expect(pathIsInside("C:\\CloudExtra\\project", "C:\\Cloud")).toBe(false);
  });

  it("keeps an uppercase drive prefix after resolving the real directory casing", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-path-"));
    const folder = path.join(parent, "MixedCase");
    fs.mkdirSync(folder);
    try {
      const lowered = folder.replace(/^([A-Za-z]):/, (_match, letter: string) => `${letter.toLowerCase()}:`);
      const resolved = normalizeRepoPath(lowered);
      expect(resolved[0]).toBe(resolved[0]?.toUpperCase());
      expect(resolved.toLowerCase()).toBe(folder.toLowerCase());
      expect(resolved).toContain("MixedCase");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("points the bundled resolver at resources/mingit/cmd/git.exe", () => {
    expect(bundledMinGitPath("C:\\Program Files\\EF Harness\\resources")).toBe(
      path.join("C:\\Program Files\\EF Harness\\resources", "mingit", "cmd", "git.exe"),
    );
  });

  it("disables interactive credential prompts without setting autocrlf", () => {
    const scrubbed = scrubGitEnv({
      PATH: "C:\\Windows",
      GIT_TERMINAL_PROMPT: "1",
      GIT_AUTHOR_NAME: "Kept",
    });
    expect(scrubbed.GIT_TERMINAL_PROMPT).toBe("0");
    expect(scrubbed.GCM_INTERACTIVE).toBe("Never");
    expect(scrubbed.GIT_AUTHOR_NAME).toBe("Kept");
    expect(scrubbed.PATH).toBe("C:\\Windows");
    expect(Object.keys(scrubbed).join("\n")).not.toMatch(/autocrlf/i);
  });

  it("probes local directories without treating a missing path as present", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-probe-"));
    try {
      expect(probeDirectoryExists(parent, 2_000)).toBe(true);
      expect(directoryExists(parent)).toBe(true);
      expect(probeDirectoryExists(path.join(parent, "missing"), 2_000)).toBe(false);
      expect(directoryExists(path.join(parent, "missing"))).toBe(false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
