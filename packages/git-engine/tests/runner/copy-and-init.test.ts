import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../../src/runner/exec-git.js";
import { initializeNewRepo } from "../../src/runner/init-repo.js";
import { workOnACopy } from "../../src/runner/work-on-copy.js";
import { gitOk, makeSandbox, removeSandbox, seedRepo, type Sandbox } from "./helpers.js";

const sandboxes: string[] = [];

function sandbox(): Sandbox {
  const created = makeSandbox();
  sandboxes.push(created.root);
  return created;
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) removeSandbox(root);
});

describe("initializeNewRepo and workOnACopy", { timeout: 30_000 }, () => {
  it("silently initializes an empty folder on main and refuses a non-empty folder or a blank consent token", async () => {
    const box = sandbox();
    const empty = path.join(box.root, "empty");
    fs.mkdirSync(empty);
    await expect(
      initializeNewRepo({
        cwd: empty,
        userExplicitConsentToken: "   ",
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toThrow(/consent/i);
    expect(fs.existsSync(path.join(empty, ".git"))).toBe(false);

    const created = await initializeNewRepo({
      cwd: empty,
      userExplicitConsentToken: "silent-init",
      env: box.env,
      gitBinary: box.git,
    });
    expect(created.branch).toBe("main");
    expect(created.git.exitCode).toBe(0);
    const branch = await execGit({
      args: ["symbolic-ref", "--short", "HEAD"],
      cwd: empty,
      env: box.env,
      gitBinary: box.git,
    });
    expect(branch.stdout.trim()).toBe("main");
    const head = await execGit({
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: empty,
      env: box.env,
      gitBinary: box.git,
    });
    expect(head.exitCode).not.toBe(0);

    const occupied = path.join(box.root, "occupied");
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, "notes.txt"), "notes");
    await expect(
      initializeNewRepo({
        cwd: occupied,
        userExplicitConsentToken: "silent-init",
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toThrow(/not an empty folder/);
    expect(fs.existsSync(path.join(occupied, ".git"))).toBe(false);
  });

  it("copies files without Git or another VCS into a new repository and leaves the original untouched", async () => {
    const box = sandbox();
    const source = path.join(box.root, "source");
    fs.mkdirSync(path.join(source, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(source, ".hg"));
    fs.mkdirSync(path.join(source, ".p4"));
    fs.writeFileSync(path.join(source, "app.txt"), "app");
    fs.writeFileSync(path.join(source, "debug.log"), "log");
    fs.writeFileSync(path.join(source, "keep.log"), "keep");
    fs.writeFileSync(path.join(source, ".gitignore"), "*.log\nnode_modules/\n!keep.log\n");
    fs.writeFileSync(path.join(source, "node_modules", "pkg", "index.js"), "module");
    fs.writeFileSync(path.join(source, ".hg", "store"), "hg");
    fs.writeFileSync(path.join(source, ".p4", "client"), "p4");
    fs.writeFileSync(path.join(source, ".p4config"), "P4PORT=perforce:1666\n");
    fs.writeFileSync(path.join(source, "Thumbs.db"), "junk");
    const before = fs.readFileSync(path.join(source, "app.txt"), "utf8");
    const destination = path.join(box.root, "copy");

    await expect(
      workOnACopy({
        source,
        destination,
        userExplicitConsentToken: " ",
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toThrow(/consent/i);

    const copied = await workOnACopy({
      source,
      destination,
      userExplicitConsentToken: "work-on-a-copy",
      env: box.env,
      gitBinary: box.git,
    });
    expect(copied.initializedBranch).toBe("main");
    expect(copied.copiedPaths).toEqual(expect.arrayContaining(["app.txt", "keep.log", ".gitignore"]));
    expect(copied.copiedPaths).not.toEqual(expect.arrayContaining(["debug.log", "Thumbs.db", ".p4config"]));
    expect(copied.skippedPaths).toEqual(expect.arrayContaining([".hg", ".p4", ".p4config", "node_modules", "debug.log", "Thumbs.db"]));
    expect(fs.readFileSync(path.join(source, "app.txt"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(source, ".hg", "store"))).toBe(true);
    expect(fs.existsSync(path.join(destination, "app.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(destination, "keep.log"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(destination, "debug.log"))).toBe(false);
    expect(fs.existsSync(path.join(destination, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(destination, ".hg"))).toBe(false);
    expect(fs.existsSync(path.join(destination, ".p4"))).toBe(false);
    expect(fs.existsSync(path.join(destination, ".p4config"))).toBe(false);
    expect(fs.existsSync(path.join(destination, "Thumbs.db"))).toBe(false);
    expect(gitOk(destination, ["symbolic-ref", "--short", "HEAD"], box.env).stdout.trim()).toBe("main");
    expect(fs.existsSync(path.join(source, ".git"))).toBe(false);

    const nested = path.join(source, "nested");
    await expect(
      workOnACopy({
        source,
        destination: nested,
        userExplicitConsentToken: "work-on-a-copy",
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toThrow(/outside the original/);
    expect(fs.existsSync(path.join(source, ".git"))).toBe(false);
  }, 30_000);

  it("refuses to copy an existing Git checkout", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    await expect(
      workOnACopy({
        source: repo,
        destination: path.join(box.root, "elsewhere"),
        userExplicitConsentToken: "work-on-a-copy",
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toThrow(/git_clean/);
    expect(fs.existsSync(path.join(box.root, "elsewhere"))).toBe(false);
  });
});
