import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnCommand } from "../../src/tier-c-d-selector/command-runner.js";
import { DockerLeastPrivilegeError, TierDContainerProvider, buildTierDContainerArgs } from "../../src/tier-c-d-selector/index.js";
import type { CommandRunner, TierDRunSpec } from "../../src/tier-c-d-selector/index.js";

const spec = (extra: Partial<TierDRunSpec> = {}): TierDRunSpec => ({
  projectId: "proj",
  attemptId: "att",
  commandId: "cmd",
  worktreePath: "C:\\wt\\attempt",
  tempPath: "C:\\wt\\tmp",
  packageStorePath: "C:\\pnpm-store",
  image: "node:22-bookworm",
  command: ["pnpm", "test"],
  ...extra,
});

function output(partial: Partial<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; notFound: boolean }>) {
  return {
    code: partial.code ?? 0,
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    timedOut: partial.timedOut ?? false,
    notFound: partial.notFound ?? false,
  };
}

describe("Tier D containers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces least privilege, scrubbed env, orphan labels, and preserved line endings", () => {
    process.env.GH_TOKEN = "host-only-secret-value";
    const args = buildTierDContainerArgs(
      spec({ extraEnv: { GH_TOKEN: "leak-me", LANG: "C", AWS_SECRET_ACCESS_KEY: "leak-me" } }),
    );
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("256");
    expect(args).toContain("--memory");
    expect(args).toContain(String(2 * 1024 * 1024 * 1024));
    expect(args).toContain("--cpus");
    expect(args[args.indexOf("--user") + 1]).toBe("1000:1000");
    expect(args).toContain("ef-harness.managed=true");
    expect(args).toContain("ef-harness.project=proj");
    expect(args).toContain("ef-harness.attempt=att");
    expect(args.some((arg) => arg.includes("target=/workspace/.git,readonly"))).toBe(true);
    expect(args.some((arg) => arg.includes("target=/pnpm-store,readonly"))).toBe(true);
    expect(args.some((arg) => arg.includes("target=/tmp"))).toBe(true);
    expect(args).toContain("GIT_CONFIG_KEY_0=core.autocrlf");
    expect(args).toContain("GIT_CONFIG_VALUE_0=false");
    expect(args).toContain("LANG=C");
    expect(args.join("\n")).not.toContain("leak-me");
    expect(args.join("\n")).not.toContain("host-only-secret-value");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--cap-add");
    delete process.env.GH_TOKEN;
  });

  it("allows only an ef-proxy sidecar in place of --network none", () => {
    const args = buildTierDContainerArgs(spec({ proxyNetwork: "ef-proxy-attempt1", linuxParity: "filename_case" }));
    expect(args[args.indexOf("--network") + 1]).toBe("ef-proxy-attempt1");
    expect(args).toContain("sh");
    expect(args.some((arg) => arg.includes("uniq -d"))).toBe(true);
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(() => buildTierDContainerArgs(spec({ proxyNetwork: "bridge" }))).toThrow(DockerLeastPrivilegeError);
    expect(() => buildTierDContainerArgs(spec({ proxyNetwork: "host" }))).toThrow(DockerLeastPrivilegeError);
  });

  it("reports a stopped Docker daemon without hanging and reconciles managed containers", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      run: (_command, args) => {
        calls.push([...args]);
        if (args[0] === "info") return Promise.resolve(output({ code: 1, stderr: "error during connect" }));
        if (args[0] === "--status") return Promise.resolve(output({ notFound: true, code: 1 }));
        if (args[0] === "ps") return Promise.resolve(output({ stdout: "abc\ndef\n" }));
        return Promise.resolve(output({}));
      },
    };
    const provider = new TierDContainerProvider({ runner, wslCommand: "wsl.exe" });
    await expect(provider.probe()).resolves.toMatchObject({
      available: false,
      installed: true,
      reason: "daemon_not_running",
      wsl2Available: false,
    });
    const removed = await provider.reconcileManagedContainers({ projectId: "proj", attemptId: "att" });
    expect(removed.removed).toEqual(["abc", "def"]);
    expect(calls.some((args) => args.includes("label=ef-harness.managed=true"))).toBe(true);
    expect(calls.some((args) => args.includes("label=ef-harness.project=proj"))).toBe(true);
    expect(calls.some((args) => args.includes("label=ef-harness.attempt=att"))).toBe(true);
    expect(calls.some((args) => args[0] === "rm" && args[1] === "-f" && args.includes("abc") && args.includes("def"))).toBe(
      true,
    );
  });

  it("reports docker as missing when the CLI cannot be found", async () => {
    const runner: CommandRunner = {
      run: () => Promise.resolve(output({ notFound: true, code: 1 })),
    };
    const provider = new TierDContainerProvider({ runner });
    await expect(provider.probe()).resolves.toMatchObject({
      available: false,
      installed: false,
      reason: "not_installed",
    });
  });

  it("bounds a hung docker info probe to 3 seconds", async () => {
    vi.useFakeTimers();
    const runner: CommandRunner = {
      run: (_command, _args, options) =>
        new Promise((resolve) => {
          const finish = (): void => resolve(output({ timedOut: true, code: null }));
          options.signal?.addEventListener("abort", finish, { once: true });
        }),
    };
    const pending = new TierDContainerProvider({ runner }).probe();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toMatchObject({
      available: false,
      installed: true,
      reason: "daemon_not_running",
    });
  });

  it("passes least-privilege args through executeCommand", async () => {
    let seen: readonly string[] = [];
    const runner: CommandRunner = {
      run: (command, args) => {
        if (args[0] === "info") return Promise.resolve(output({ code: 0, stdout: "ok" }));
        if (command === "docker") seen = args;
        return Promise.resolve(output({ stdout: "tier-d-ok" }));
      },
    };
    const provider = new TierDContainerProvider({ runner, wslCommand: "missing-wsl" });
    const instance = await provider.acquireWarmInstance({
      projectId: "proj",
      attemptId: "att",
      taskId: "task",
      projectPath: "C:\\src",
      worktreePath: "C:\\wt",
      tempPath: "C:\\tmp",
      packageStorePath: "C:\\store",
      mode: "own_loop",
    });
    const result = await provider.executeCommand(instance, { commandId: "cmd", executable: "pnpm", args: ["test"] });
    expect(result.exitCode).toBe(0);
    expect(seen[seen.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(seen).toContain("ef-harness.managed=true");
    expect(seen[seen.indexOf("--network") + 1]).toBe("none");
  });
});

describe("optional live Docker", () => {
  it("runs the least-privilege container when docker info succeeds", async () => {
    const provider = new TierDContainerProvider();
    const probe = await provider.probe();
    if (!probe.available) {
      expect(probe.available).toBe(false);
      return;
    }
    const listed = await spawnCommand("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"], {
      timeoutMs: 10_000,
    });
    const image = listed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("<none>") && /^(node|alpine|debian|ubuntu|busybox)/.test(line));
    if (!image) {
      expect(probe.available).toBe(true);
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-tierd-"));
    const work = path.join(root, "work");
    const temp = path.join(root, "temp");
    const store = path.join(root, "store");
    fs.mkdirSync(work);
    fs.mkdirSync(temp);
    fs.mkdirSync(store);
    fs.mkdirSync(path.join(work, ".git"));
    const command = image.startsWith("node") ? ["-e", "process.stdout.write('tier-d-ok')"] : ["echo", "tier-d-ok"];
    const args = buildTierDContainerArgs({
      ...spec({
        image,
        worktreePath: work,
        tempPath: temp,
        packageStorePath: store,
        command,
        commandId: "live",
      }),
    });
    const result = await spawnCommand("docker", args, { timeoutMs: 60_000 });
    fs.rmSync(root, { recursive: true, force: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tier-d-ok");
  });
});
