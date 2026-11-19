import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreeSlotManager } from "../../src/worktrees/index.js";
import { createProcessGitRunner } from "../../src/worktrees/git-runner.js";
import {
  TEST_TIMEOUT_MS,
  cleanupFixture,
  commitAll,
  createFixture,
  spyGit,
  writeFiles,
  type Fixture,
} from "./helpers.js";

const PROJECT = "kitchen";

describe("sparse checkout, submodules, and git lfs", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture) await cleanupFixture(fixture);
    fixture = undefined;
  });

  it(
    "limits a cone-mode sparse checkout to the declared read set and shared packages",
    async () => {
      fixture = await createFixture();
      await writeFiles(fixture.main, {
        "README.md": "root\n",
        "packages/app/index.txt": "app\n",
        "packages/shared/index.txt": "shared\n",
        "packages/other/index.txt": "other\n",
      });
      const base = await commitAll(fixture.git, fixture.main, "init");
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
        sparse: { readSet: ["packages/app"], sharedPackages: ["packages/shared"] },
      });
      await expect(fs.readFile(path.join(handle.slotPath, "packages", "app", "index.txt"), "utf8")).resolves.toBe("app\n");
      await expect(fs.readFile(path.join(handle.slotPath, "packages", "shared", "index.txt"), "utf8")).resolves.toBe("shared\n");
      await expect(fs.readFile(path.join(handle.slotPath, "README.md"), "utf8")).resolves.toBe("root\n");
      await expect(fs.access(path.join(handle.slotPath, "packages", "other", "index.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const commands = fixture.git.calls.filter((call) => call[0] === "sparse-checkout");
      expect(commands.some((call) => call.includes("init") && call.includes("--cone"))).toBe(true);
      expect(commands.some((call) => call[1] === "set" && call.includes("packages/app") && call.includes("packages/shared"))).toBe(
        true,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "initializes submodules with the main repository as an object reference",
    async () => {
      fixture = await createFixture();
      const sub = path.join(fixture.root, "sub");
      await fs.mkdir(sub, { recursive: true });
      const git = fixture.git;
      await gitOkLocal(git, sub, ["init", "-b", "main"]);
      await gitOkLocal(git, sub, ["config", "user.name", "EF Harness Test"]);
      await gitOkLocal(git, sub, ["config", "user.email", "test@example.com"]);
      await gitOkLocal(git, sub, ["config", "commit.gpgsign", "false"]);
      await fs.writeFile(path.join(sub, "lib.txt"), "lib\n");
      await gitOkLocal(git, sub, ["add", "lib.txt"]);
      await gitOkLocal(git, sub, ["commit", "-m", "sub"]);
      await fs.writeFile(path.join(fixture.main, "README.md"), "root\n");
      await gitOkLocal(git, fixture.main, ["add", "README.md"]);
      await gitOkLocal(git, fixture.main, ["commit", "-m", "init"]);
      await gitOkLocal(git, fixture.main, ["-c", "protocol.file.allow=always", "submodule", "add", "--", sub, "vendor/lib"]);
      const staged = await git.execGit(["status", "--porcelain"], { cwd: fixture.main });
      if (staged.stdout.trim().length > 0) {
        await gitOkLocal(git, fixture.main, ["add", "-A"]);
        await gitOkLocal(git, fixture.main, ["commit", "-m", "add sub"]);
      }
      const base = await gitOkLocal(git, fixture.main, ["rev-parse", "HEAD"]);
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      const lib = await fs.readFile(path.join(handle.slotPath, "vendor", "lib", "lib.txt"), "utf8");
      expect(lib.replaceAll("\r\n", "\n")).toBe("lib\n");
      const update = fixture.git.calls.find((call) => call[0] === "-c" && call.includes("submodule") && call.includes("update"));
      expect(update).toEqual([
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "update",
        "--init",
        "--reference",
        path.resolve(fixture.main),
      ]);
      const clean = fixture.git.calls.filter((call) => call[0] === "clean");
      expect(clean.every((call) => !call.includes("-ff") && !call.includes("-x"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fetches only the LFS objects that match the task paths",
    async () => {
      fixture = await createFixture();
      const lfsCalls: string[][] = [];
      const git = spyGit(createProcessGitRunner(), async (args) => {
        if (args[0] !== "lfs") return null;
        lfsCalls.push([...args]);
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });
      fixture = { ...fixture, git };
      await writeFiles(fixture.main, {
        "README.md": "root\n",
        ".gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        "assets/needed.bin": "needed\n",
        "assets/other.bin": "other\n",
      });
      const base = await commitAll(git, fixture.main, "init");
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git });
      await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
        taskPaths: ["assets/needed.bin"],
      });
      expect(lfsCalls).toEqual([["lfs", "fetch", "--include=assets/needed.bin"]]);
      lfsCalls.length = 0;
      await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t039",
        attempt: 1,
      });
      expect(lfsCalls).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

async function gitOkLocal(git: Fixture["git"], cwd: string, args: readonly string[]): Promise<string> {
  const result = await git.execGit(args, { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}
