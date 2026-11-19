import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../../src/runner/exec-git.js";
import { runProcess } from "../../src/runner/process-runner.js";
import { ensureSupportedGit } from "../../src/runner/resolve-binary.js";
import {
  DeveloperCheckoutMutationError,
  GitBinaryNotFoundError,
  LineEndingProtectionError,
  type StructuredLogger,
} from "../../src/runner/types.js";
import { gitOk, gitPath, initRepo, makeSandbox, rawGit, removeSandbox, seedRepo, type Sandbox } from "./helpers.js";

const sandboxes: string[] = [];

function sandbox(): Sandbox {
  const created = makeSandbox();
  sandboxes.push(created.root);
  return created;
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) removeSandbox(root);
});

describe("execGit", { timeout: 30_000 }, () => {
  it("spawns Git with long paths, unquoted UTF-8 names, and a structured result", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const name = "caf\u00e9-\u4e16\u754c.txt";
    fs.writeFileSync(path.join(repo, name), "hello");
    const events: string[] = [];
    const logger: StructuredLogger = {
      debug: (message) => events.push(message),
      info: (message) => events.push(message),
      warn: (message) => events.push(message),
      error: (message) => events.push(message),
    };
    const result = await execGit({
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
      logger,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(name);
    expect(result.stdout).not.toContain("\\303");
    expect(result.stderr).not.toContain("autocrlf");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
    expect(result.busyMessage).toBeNull();
    expect(result.gitPath).toBe(box.git);
    expect(result.argv).toEqual([
      "-c",
      "core.longpaths=true",
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    expect(events).toContain("git command finished");
  });

  it("does not interpolate shell metacharacters into a command string", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const injected = path.join(repo, "injected.txt");
    const result = await execGit({
      args: ["rev-parse", "--verify", `HEAD & echo pwned > "${injected}"`],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(result.exitCode).not.toBe(0);
    expect(fs.existsSync(injected)).toBe(false);
  });

  it("refuses mutating commands in the developer checkout without consent and leaves files untouched", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const readme = path.join(repo, "README.md");
    fs.writeFileSync(readme, "changed\n");
    fs.writeFileSync(path.join(repo, "extra.txt"), "extra\n");
    const before = fs.readFileSync(readme, "utf8");
    for (const args of [
      ["checkout", "--", "README.md"],
      ["reset", "--hard", "HEAD"],
      ["stash", "push", "-u"],
      ["clean", "-fd"],
      ["add", "--", "README.md"],
      ["commit", "-m", "nope"],
    ]) {
      await expect(
        execGit({
          args,
          cwd: repo,
          env: box.env,
          gitBinary: box.git,
          developerCheckout: true,
        }),
      ).rejects.toBeInstanceOf(DeveloperCheckoutMutationError);
    }
    expect(fs.readFileSync(readme, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(repo, "extra.txt"))).toBe(true);
    const status = gitOk(repo, ["status", "--porcelain=v1"], box.env);
    expect(status.stdout).toContain("README.md");
    expect(status.stdout).toContain("extra.txt");
    expect(status.stdout).not.toMatch(/^A /m);
  });

  it("allows a consented add and a non-developer commit", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    fs.writeFileSync(path.join(repo, "added.txt"), "added\n");
    const added = await execGit({
      args: ["add", "--", "added.txt"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
      userExplicitConsentToken: "baseline-commit-click",
    });
    expect(added.exitCode).toBe(0);
    const staged = gitOk(repo, ["diff", "--cached", "--name-only"], box.env);
    expect(staged.stdout).toContain("added.txt");
    const committed = await execGit({
      args: ["commit", "-m", "worker commit"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
      developerCheckout: false,
    });
    expect(committed.exitCode).toBe(0);
  });

  it("preserves the developer's autocrlf and .gitattributes", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const attributes = "* text=auto\n*.bin -text\n";
    fs.writeFileSync(path.join(repo, ".gitattributes"), attributes);
    gitOk(repo, ["config", "core.autocrlf", "input"], box.env);
    await expect(
      execGit({
        args: ["-c", "core.autocrlf=true", "status"],
        cwd: repo,
        env: box.env,
        gitBinary: box.git,
        userExplicitConsentToken: "should-still-refuse",
      }),
    ).rejects.toBeInstanceOf(LineEndingProtectionError);
    await expect(
      execGit({
        args: ["config", "core.autocrlf", "true"],
        cwd: repo,
        env: box.env,
        gitBinary: box.git,
        userExplicitConsentToken: "should-still-refuse",
      }),
    ).rejects.toBeInstanceOf(LineEndingProtectionError);
    const status = await execGit({
      args: ["status", "--porcelain=v1"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(status.exitCode).toBe(0);
    expect(status.argv.join(" ")).not.toContain("autocrlf");
    expect(gitOk(repo, ["config", "--get", "core.autocrlf"], box.env).stdout.trim()).toBe("input");
    expect(fs.readFileSync(path.join(repo, ".gitattributes"), "utf8")).toBe(attributes);
  });

  it("reports Git busy while an index.lock is held and never deletes the lock", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const lockPath = gitPath(repo, box.env, "index.lock");
    fs.writeFileSync(lockPath, "keep");
    const result = await execGit({
      args: ["status", "--porcelain=v1"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
      maxLockRetries: 0,
    });
    expect(result.busyMessage).toBe("Git busy in another process");
    expect(result.stderr).toContain("Git busy in another process");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("keep");
  });

  it("adds and lists a path longer than 400 characters when core.longpaths is set", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const segment = "p".repeat(40);
    let deep = repo;
    for (let index = 0; index < 9; index += 1) deep = path.join(deep, `${segment}${index}`);
    const file = path.join(deep, "file.txt");
    expect(file.length).toBeGreaterThan(400);
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(file, "long");
    const relative = path.relative(repo, file);
    const status = await execGit({
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("file.txt");
    expect(status.argv.slice(0, 4)).toEqual(["-c", "core.longpaths=true", "-c", "core.quotepath=false"]);
    const added = await execGit({
      args: ["add", "--", relative],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
      userExplicitConsentToken: "add-long-path",
    });
    expect(added.exitCode).toBe(0);
    const listed = await execGit({
      args: ["ls-files", "--", relative],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout.replaceAll("\\", "/")).toContain(relative.replaceAll("\\", "/"));
  }, 30_000);

  it("enforces a configurable process timeout", async () => {
    const result = await runProcess({
      binary: process.execPath,
      args: ["-e", "setTimeout(() => {}, 30000)"],
      cwd: os.tmpdir(),
      env: process.env,
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(5_000);
    expect(result.stderr).toContain("timed out");
  });

  it("rejects a binary that is not Git 2.38 or newer", async () => {
    await expect(ensureSupportedGit(process.execPath, process.env, 10_000)).rejects.toBeInstanceOf(
      GitBinaryNotFoundError,
    );
  });

  it("returns a non-zero exit code for a missing revision instead of throwing", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    initRepo(repo, box.env);
    const missing = await execGit({
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(missing.exitCode).not.toBe(0);
    expect(missing.timedOut).toBe(false);
    expect(rawGit(repo, ["status", "--porcelain=v1"], box.env).code).toBe(0);
  });
});
