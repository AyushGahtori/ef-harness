import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertHarnessOperationsAllowed, detectSyncWarning, inspectWorkspaceFolder } from "../../src/runner/inspect-folder.js";
import { execGit } from "../../src/runner/exec-git.js";
import { DeveloperCheckoutMutationError, MidOperationBlockedError } from "../../src/runner/types.js";
import {
  commitFile,
  gitOk,
  gitPath,
  initRepo,
  makeSandbox,
  rawGit,
  removeSandbox,
  seedRepo,
  type Sandbox,
} from "./helpers.js";

const sandboxes: string[] = [];

function sandbox(options?: { readonly identity?: boolean }): Sandbox {
  const created = makeSandbox(options);
  sandboxes.push(created.root);
  return created;
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) removeSandbox(root);
});

function inspect(folder: string, box: Sandbox, env: NodeJS.ProcessEnv = box.env) {
  return inspectWorkspaceFolder(folder, { env, gitBinary: box.git, timeoutMs: 20_000 });
}

describe("inspectWorkspaceFolder", { timeout: 30_000 }, () => {
  it("classifies an empty folder", async () => {
    const box = sandbox();
    const folder = path.join(box.root, "empty");
    fs.mkdirSync(folder);
    const result = await inspect(folder, box);
    expect(result.primary).toBe("empty");
    expect(result.states).toContain("empty");
    expect(result.actions).toContain("Silent git init");
    expect(result.head).toBeNull();
    expect(result.dirtyCount).toBe(0);
    expect(result.onlyOsJunk).toBe(false);
  });

  it("classifies files without Git, including a folder that contains only OS junk", async () => {
    const box = sandbox();
    const files = path.join(box.root, "files");
    fs.mkdirSync(files);
    fs.writeFileSync(path.join(files, "notes.txt"), "notes");
    const withFiles = await inspect(files, box);
    expect(withFiles.primary).toBe("files_no_git");
    expect(withFiles.states).toContain("files_no_git");
    expect(withFiles.actions).toEqual(expect.arrayContaining(["Set up Git here", "Work on a copy"]));
    expect(withFiles.onlyOsJunk).toBe(false);

    const junk = path.join(box.root, "junk");
    fs.mkdirSync(junk);
    for (const name of [".DS_Store", "desktop.ini", "Thumbs.db"]) {
      fs.writeFileSync(path.join(junk, name), "junk");
    }
    const onlyJunk = await inspect(junk, box);
    expect(onlyJunk.primary).toBe("files_no_git");
    expect(onlyJunk.states).not.toContain("empty");
    expect(onlyJunk.onlyOsJunk).toBe(true);
  });

  it("records HEAD and branch for a clean Git repo and lists dirty files exactly", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const head = gitOk(repo, ["rev-parse", "HEAD"], box.env).stdout.trim();
    const clean = await inspect(repo, box);
    expect(clean.primary).toBe("git_clean");
    expect(clean.states).toContain("git_clean");
    expect(clean.head).toBe(head);
    expect(clean.branch).toBe("main");
    expect(clean.detached).toBe(false);
    expect(clean.dirtyCount).toBe(0);
    expect(clean.identity).toEqual({ name: "Test User", email: "test@example.com", missing: false });
    expect(clean.states).not.toContain("missing_git_identity");

    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    fs.writeFileSync(path.join(repo, "new-file.txt"), "new\n");
    fs.writeFileSync(path.join(repo, "another.txt"), "another\n");
    const dirty = await inspect(repo, box);
    expect(dirty.primary).toBe("git_dirty");
    expect(dirty.dirtyCount).toBe(3);
    expect(dirty.dirtyFiles.map((file) => `${file.kind}:${file.path}`).sort()).toEqual([
      "modified:README.md",
      "untracked:another.txt",
      "untracked:new-file.txt",
    ]);
    expect(dirty.actions).toEqual(
      expect.arrayContaining(["Include my changes", "Start from my last commit", "Let me commit first"]),
    );
  });

  it("classifies an unborn repository that already has untracked files", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "unborn");
    initRepo(repo, box.env);
    fs.writeFileSync(path.join(repo, "pending.txt"), "pending\n");
    const result = await inspect(repo, box);
    expect(result.primary).toBe("git_unborn");
    expect(result.states).toEqual(expect.arrayContaining(["git_unborn", "git_dirty"]));
    expect(result.head).toBeNull();
    expect(result.branch).toBe("main");
    expect(result.dirtyCount).toBe(1);
    expect(result.dirtyFiles[0]).toMatchObject({ path: "pending.txt", kind: "untracked" });
    expect(result.actions).toContain("Review baseline commit");
  });

  it("detects a real merge in a linked worktree whose .git entry is a file", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    const worktree = path.join(box.root, "wt");
    seedRepo(repo, box.env);
    commitFile(repo, box.env, "same.txt", "base\n", "base file");
    gitOk(repo, ["checkout", "-b", "side"], box.env);
    commitFile(repo, box.env, "same.txt", "side\n", "side edit");
    gitOk(repo, ["checkout", "main"], box.env);
    commitFile(repo, box.env, "same.txt", "main\n", "main edit");
    gitOk(repo, ["worktree", "add", worktree, "side"], box.env);
    const merged = rawGit(worktree, ["merge", "main"], box.env);
    expect(merged.code).not.toBe(0);
    expect(fs.statSync(path.join(worktree, ".git")).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(worktree, ".git"), "utf8")).toContain("gitdir:");
    expect(fs.existsSync(path.join(worktree, ".git", "MERGE_HEAD"))).toBe(false);
    const result = await inspect(worktree, box);
    expect(result.primary).toBe("git_mid_operation");
    expect(result.states).toContain("git_mid_operation");
    expect(result.midOperation?.kinds).toContain("merge");
    expect(result.midOperation?.markers).toContain("MERGE_HEAD");
    expect(result.midOperation?.blocked).toBe(true);
    expect(result.midOperation?.mayFinishOrAbort).toBe(false);
    expect(result.midOperation?.action).toBe("Open in my editor + Re-check");
    expect(result.actions).toContain("Open in my editor + Re-check");
    expect(fs.existsSync(gitPath(worktree, box.env, "MERGE_HEAD"))).toBe(true);
    expect(() => assertHarnessOperationsAllowed(result)).toThrow(MidOperationBlockedError);
    await expect(
      execGit({
        args: ["merge", "--abort"],
        cwd: worktree,
        env: box.env,
        gitBinary: box.git,
      }),
    ).rejects.toBeInstanceOf(DeveloperCheckoutMutationError);
    expect(fs.existsSync(gitPath(worktree, box.env, "MERGE_HEAD"))).toBe(true);
  }, 30_000);

  it("detects a real rebase, cherry-pick, and planted revert and rebase-apply markers", async () => {
    const box = sandbox();
    const rebaseRepo = path.join(box.root, "rebase");
    seedRepo(rebaseRepo, box.env);
    commitFile(rebaseRepo, box.env, "file.txt", "base\n", "base");
    gitOk(rebaseRepo, ["checkout", "-b", "feature"], box.env);
    commitFile(rebaseRepo, box.env, "file.txt", "feature\n", "feature");
    gitOk(rebaseRepo, ["checkout", "main"], box.env);
    commitFile(rebaseRepo, box.env, "file.txt", "main\n", "main");
    gitOk(rebaseRepo, ["checkout", "feature"], box.env);
    expect(rawGit(rebaseRepo, ["rebase", "main"], box.env).code).not.toBe(0);
    const rebase = await inspect(rebaseRepo, box);
    expect(rebase.primary).toBe("git_mid_operation");
    expect(rebase.midOperation?.kinds).toContain("rebase");
    expect(rebase.midOperation?.markers).toContain("rebase-merge");
    expect(fs.existsSync(gitPath(rebaseRepo, box.env, "rebase-merge"))).toBe(true);

    const pickRepo = path.join(box.root, "pick");
    seedRepo(pickRepo, box.env);
    commitFile(pickRepo, box.env, "pick.txt", "base\n", "base");
    gitOk(pickRepo, ["checkout", "-b", "other"], box.env);
    commitFile(pickRepo, box.env, "pick.txt", "other\n", "other");
    const other = gitOk(pickRepo, ["rev-parse", "HEAD"], box.env).stdout.trim();
    gitOk(pickRepo, ["checkout", "main"], box.env);
    commitFile(pickRepo, box.env, "pick.txt", "main\n", "main");
    expect(rawGit(pickRepo, ["cherry-pick", other], box.env).code).not.toBe(0);
    const picked = await inspect(pickRepo, box);
    expect(picked.midOperation?.kinds).toContain("cherry_pick");
    expect(picked.midOperation?.markers).toContain("CHERRY_PICK_HEAD");

    const planted = path.join(box.root, "planted");
    const plantedWorktree = path.join(box.root, "planted-wt");
    seedRepo(planted, box.env);
    gitOk(planted, ["worktree", "add", "--detach", plantedWorktree, "HEAD"], box.env);
    const head = gitOk(plantedWorktree, ["rev-parse", "HEAD"], box.env).stdout.trim();
    fs.writeFileSync(gitPath(plantedWorktree, box.env, "REVERT_HEAD"), `${head}\n`);
    fs.mkdirSync(gitPath(plantedWorktree, box.env, "rebase-apply"));
    expect(fs.existsSync(path.join(plantedWorktree, ".git", "REVERT_HEAD"))).toBe(false);
    const marked = await inspect(plantedWorktree, box);
    expect(marked.primary).toBe("git_mid_operation");
    expect(marked.midOperation?.kinds).toEqual(expect.arrayContaining(["revert", "rebase"]));
    expect(marked.midOperation?.markers).toEqual(expect.arrayContaining(["REVERT_HEAD", "rebase-apply"]));
  }, 30_000);

  it("classifies detached HEAD", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const head = gitOk(repo, ["rev-parse", "HEAD"], box.env).stdout.trim();
    gitOk(repo, ["checkout", "--detach", "HEAD"], box.env);
    const result = await inspect(repo, box);
    expect(result.primary).toBe("git_detached_head");
    expect(result.detached).toBe(true);
    expect(result.branch).toBeNull();
    expect(result.head).toBe(head);
    expect(result.states).not.toContain("git_clean");
    expect(result.actions).toEqual(expect.arrayContaining(["Pick a branch", "Create harness-base branch"]));
  });

  it("offers Work on a copy for Mercurial and Perforce folders", async () => {
    const box = sandbox();
    const mercurial = path.join(box.root, "hg");
    fs.mkdirSync(path.join(mercurial, ".hg"), { recursive: true });
    fs.writeFileSync(path.join(mercurial, "notes.txt"), "notes");
    const hg = await inspect(mercurial, box);
    expect(hg.primary).toBe("other_vcs");
    expect(hg.otherVcs).toEqual({ systems: ["mercurial"], offer: "Work on a copy" });
    expect(hg.actions).toContain("Work on a copy");

    const perforce = path.join(box.root, "p4");
    fs.mkdirSync(perforce);
    fs.writeFileSync(path.join(perforce, ".p4config"), "P4PORT=perforce:1666\n");
    const p4 = await inspect(perforce, box);
    expect(p4.primary).toBe("other_vcs");
    expect(p4.otherVcs?.systems).toEqual(["perforce"]);
    expect(p4.otherVcs?.offer).toBe("Work on a copy");
  });

  it("warns for simulated OneDrive, Dropbox, iCloud, and UNC paths without blocking", async () => {
    const box = sandbox();
    const cloud = path.join(box.root, "OneDrive");
    const project = path.join(cloud, "project");
    fs.mkdirSync(project, { recursive: true });
    const onedriveEnv = { ...box.env, OneDrive: cloud, OneDriveCommercial: "", OneDriveConsumer: "" };
    const onedrive = await inspect(project, box, onedriveEnv);
    expect(onedrive.states).toContain("synced_or_network_folder");
    expect(onedrive.syncWarning?.kinds).toContain("onedrive");
    expect(onedrive.syncWarning?.nonBlocking).toBe(true);
    expect(onedrive.syncWarning?.actions).toEqual(["Continue", "Move project"]);
    expect(onedrive.actions).toEqual(expect.arrayContaining(["Continue", "Move project"]));

    const dropboxRoot = path.join(box.root, "dropbox-root");
    const dropboxProject = path.join(dropboxRoot, "project");
    fs.mkdirSync(dropboxProject, { recursive: true });
    fs.writeFileSync(path.join(dropboxRoot, ".dropbox"), "");
    const dropbox = await inspect(dropboxProject, box);
    expect(dropbox.syncWarning?.kinds).toContain("dropbox");

    const icloud = path.join(box.root, "iCloudDrive", "project");
    fs.mkdirSync(icloud, { recursive: true });
    const apple = await inspect(icloud, box);
    expect(apple.syncWarning?.kinds).toContain("icloud");

    const unc = "\\\\ef-harness-missing\\share\\project";
    const started = Date.now();
    const warning = detectSyncWarning(unc, box.env);
    const missing = await inspect(unc, box);
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(warning?.kinds).toContain("unc");
    expect(warning?.nonBlocking).toBe(true);
    expect(missing.primary).toBe("synced_or_network_folder");
    expect(missing.syncWarning?.kinds).toContain("unc");
    expect(missing.actions).toEqual(expect.arrayContaining(["Continue", "Move project"]));
  });

  it("reports a missing Git identity without hiding the repository state", async () => {
    const box = sandbox({ identity: false });
    const repo = path.join(box.root, "repo");
    initRepo(repo, box.env);
    fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
    gitOk(repo, ["add", "--", "README.md"], box.env);
    gitOk(
      repo,
      ["-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "init"],
      box.env,
    );
    const result = await inspect(repo, box);
    expect(result.primary).toBe("git_clean");
    expect(result.identity).toEqual({ name: null, email: null, missing: true });
    expect(result.states).toContain("missing_git_identity");
    expect(result.actions).toContain("Prompt for user.name and user.email");
  });

  it("detects a shallow clone", async () => {
    const box = sandbox();
    const source = path.join(box.root, "source");
    const dest = path.join(box.root, "shallow");
    seedRepo(source, box.env);
    gitOk(box.root, ["clone", "--no-local", "--depth", "1", source, dest], box.env);
    const result = await inspect(dest, box);
    expect(result.shallow).toBe(true);
    expect(result.states).toContain("shallow_clone");
    expect(result.primary).toBe("git_clean");
    expect(result.head).toMatch(/^[0-9a-f]{40}$/);
    expect(result.branch).toBe("main");
  }, 30_000);

  it("keeps a busy developer checkout locked and says Git is busy", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const lockPath = gitPath(repo, box.env, "index.lock");
    fs.writeFileSync(lockPath, "keep");
    const result = await inspect(repo, box);
    expect(result.gitBusy).toBe(true);
    expect(result.gitBusyMessage).toBe("Git busy in another process");
    expect(result.statusReliable).toBe(false);
    expect(result.actions[0]).toBe("Git busy in another process");
    expect(result.primary).not.toBe("empty");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("keep");
  });
});
