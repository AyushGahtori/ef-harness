import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessDataRootPrivacy,
  defaultHarnessDataRoot,
  ensureHarnessDataLayout,
  InvalidProjectIdError,
  normalizeProjectPath,
} from "../../src/auxiliary-dbs/index.js";
import { makeTempRoot, removeTempRoot } from "./temp-root.js";

describe("harness data layout", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) removeTempRoot(root);
  });

  it("defaults the data root to the per-user EFHarness folder", () => {
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA?.trim();
      const base =
        localAppData !== undefined && localAppData.length > 0
          ? localAppData
          : path.join(os.homedir(), "AppData", "Local");
      expect(defaultHarnessDataRoot()).toBe(path.join(base, "EFHarness"));
      return;
    }
    expect(defaultHarnessDataRoot()).toBe(path.join(os.homedir(), ".local", "share", "EFHarness"));
  });

  it("creates the per-user directory tree and a project folder", () => {
    const root = makeTempRoot("layout");
    roots.push(root);
    const layout = ensureHarnessDataLayout({ root, projectIds: ["p1"] });
    expect(layout.root).toBe(path.resolve(root));
    expect(layout.globalDbPath).toBe(path.join(layout.root, "global.db"));
    expect(fs.existsSync(layout.globalDbPath)).toBe(false);
    expect(fs.existsSync(layout.projectsDir)).toBe(true);
    expect(fs.existsSync(layout.casSha256Dir)).toBe(true);
    expect(fs.existsSync(layout.casTmpDir)).toBe(true);
    expect(fs.existsSync(layout.worktreesDir)).toBe(true);
    expect(fs.existsSync(layout.componentsDir)).toBe(true);
    expect(fs.existsSync(layout.logsDir)).toBe(true);
    expect(fs.existsSync(layout.projectDir("p1"))).toBe(true);
    expect(fs.existsSync(layout.projectBackupsDir("p1"))).toBe(true);
    expect(fs.existsSync(layout.projectEnvsDir("p1"))).toBe(true);
    expect(fs.existsSync(layout.projectStatePath("p1"))).toBe(false);
    expect(layout.privacy.warning).toBeNull();
  });

  it("rejects project ids that could escape the data root", () => {
    const root = makeTempRoot("layout-id");
    roots.push(root);
    const layout = ensureHarnessDataLayout({ root });
    expect(() => layout.ensureProject("..")).toThrow(InvalidProjectIdError);
    expect(() => layout.ensureProject("a/b")).toThrow(InvalidProjectIdError);
  });

  it("treats a root inside LOCALAPPDATA as private and warns for a public path", () => {
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
      const privateRoot = assessDataRootPrivacy(path.join(process.env.LOCALAPPDATA, "EFHarness"));
      expect(privateRoot.insideLocalAppData).toBe(true);
      expect(privateRoot.worldReadable).toBe(false);
      expect(privateRoot.warning).toBeNull();
      const publicRoot = assessDataRootPrivacy("C:\\Users\\Public\\EFHarness");
      expect(publicRoot.worldReadable).toBe(true);
      expect(publicRoot.warning).toMatch(/world-readable/);
      expect(publicRoot.warning).toMatch(/Settings → Storage/);
    }
    const devDrive = "Z:\\EFHarness-private-dev-drive";
    if (!fs.existsSync(devDrive)) {
      const relocated = assessDataRootPrivacy(devDrive);
      expect(relocated.insideLocalAppData).toBe(false);
      expect(relocated.warning).toBeNull();
    }
  });

  it("canonicalizes Windows project paths before registry identity checks", () => {
    if (process.platform !== "win32") {
      expect(normalizeProjectPath("/var/ef/Foo/")).toBe("/var/ef/Foo");
      return;
    }
    expect(normalizeProjectPath("C:\\Foo")).toBe(normalizeProjectPath("c:\\foo\\"));
    expect(normalizeProjectPath("C:/Foo/Bar/")).toBe("C:\\foo\\bar");
    expect(() => normalizeProjectPath("foo")).toThrow(/absolute/);
  });
});
