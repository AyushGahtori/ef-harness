import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatGitVersion,
  gitVersionAtLeast,
  parseGitVersion,
  resolveGitBinary,
} from "../../src/runner/resolve-binary.js";
import {
  GIT_VERSION_REQUIREMENT_MESSAGE,
  GitBinaryNotFoundError,
  GitVersionRejectedError,
  type VersionProbeResult,
} from "../../src/runner/types.js";

function probe(text: string, exitCode = 0): VersionProbeResult {
  return { exitCode, stdout: text, stderr: "" };
}

describe("resolveGitBinary", () => {
  it("parses Git for Windows versions and enforces 2.38", () => {
    expect(parseGitVersion("git version 2.54.0.windows.1")).toEqual({ major: 2, minor: 54, patch: 0 });
    expect(formatGitVersion({ major: 2, minor: 38, patch: 0 })).toBe("2.38.0");
    expect(gitVersionAtLeast({ major: 2, minor: 38, patch: 0 })).toBe(true);
    expect(gitVersionAtLeast({ major: 2, minor: 37, patch: 9 })).toBe(false);
    expect(gitVersionAtLeast({ major: 2, minor: 39, patch: 0 })).toBe(true);
    expect(gitVersionAtLeast({ major: 3, minor: 0, patch: 0 })).toBe(true);
  });

  it("prefers bundled MinGit when Settings does not override it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-git-"));
    const resources = path.join(root, "resources");
    const bundled = path.join(resources, "mingit", "cmd", "git.exe");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "");
    try {
      const resolved = await resolveGitBinary({
        resourcesRoot: resources,
        runVersion: () => Promise.resolve(probe("git version 2.45.1")),
      });
      expect(resolved.source).toBe("bundled");
      expect(resolved.gitPath).toBe(bundled);
      expect(resolved.version).toBe("2.45.1");
      expect(resolved.settingsRejection).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors a Settings Git only when it is at least 2.38", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-git-"));
    const resources = path.join(root, "resources");
    const bundled = path.join(resources, "mingit", "cmd", "git.exe");
    const settings = path.join(root, "system-git.exe");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "");
    fs.writeFileSync(settings, "");
    try {
      const accepted = await resolveGitBinary({
        resourcesRoot: resources,
        settingsGitPath: settings,
        runVersion: (binary) =>
          Promise.resolve(probe(binary === settings ? "git version 2.38.0" : "git version 2.45.0")),
      });
      expect(accepted.source).toBe("settings");
      expect(accepted.gitPath).toBe(settings);
      expect(accepted.version).toBe("2.38.0");
      expect(accepted.settingsRejection).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects Settings Git older than 2.38 and falls back to bundled MinGit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-git-"));
    const resources = path.join(root, "resources");
    const bundled = path.join(resources, "mingit", "cmd", "git.exe");
    const settings = path.join(root, "old-git.exe");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "");
    fs.writeFileSync(settings, "");
    try {
      const resolved = await resolveGitBinary({
        resourcesRoot: resources,
        settingsGitPath: settings,
        runVersion: (binary) =>
          Promise.resolve(probe(binary === settings ? "git version 2.30.2" : "git version 2.47.0")),
      });
      expect(resolved.source).toBe("bundled");
      expect(resolved.gitPath).toBe(bundled);
      expect(resolved.version).toBe("2.47.0");
      expect(resolved.settingsRejection?.path).toBe(settings);
      expect(resolved.settingsRejection?.version).toBe("2.30.2");
      expect(resolved.settingsRejection?.message).toContain(GIT_VERSION_REQUIREMENT_MESSAGE);
      expect(resolved.settingsRejection?.message).toContain("bundled MinGit");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear version error when the old Settings Git has no bundled fallback", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-git-"));
    const settings = path.join(root, "old-git.exe");
    fs.writeFileSync(settings, "");
    try {
      await expect(
        resolveGitBinary({
          resourcesRoot: path.join(root, "missing-resources"),
          settingsGitPath: settings,
          runVersion: () => Promise.resolve(probe("git version 2.37.9")),
        }),
      ).rejects.toThrow(GitVersionRejectedError);
      try {
        await resolveGitBinary({
          resourcesRoot: path.join(root, "missing-resources"),
          settingsGitPath: settings,
          runVersion: () => Promise.resolve(probe("git version 2.37.9")),
        });
      } catch (error) {
        expect(error).toBeInstanceOf(GitVersionRejectedError);
        expect((error as Error).message).toContain(GIT_VERSION_REQUIREMENT_MESSAGE);
        expect((error as Error).message).toContain("bundled MinGit");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a missing binary when neither Settings nor bundled MinGit exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-git-"));
    try {
      await expect(
        resolveGitBinary({
          resourcesRoot: path.join(root, "resources"),
          runVersion: () => Promise.resolve(probe("git version 2.45.0")),
        }),
      ).rejects.toThrow(GitBinaryNotFoundError);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
