import { expect, it } from "vitest";

import {
  DOCKER_INFO_ARGS,
  DOCKER_NOT_INSTALLED_DIAGNOSIS,
  DOCKER_NOT_RUNNING_DIAGNOSIS,
  MAX_PROBE_TIMEOUT_MS,
  assertProbeTimeout,
  diagnoseCaught,
  openHumanSteps,
  probeDocker,
  type CommandRunRequest,
  type CommandRunResult,
} from "../../src/human-steps/index.js";
import { silentProbeLogger } from "../../src/human-steps/ports.js";

it("distinguishes Docker missing, stopped, and running", async () => {
  const stopped = await probeDocker({
    runner: scripted(() => command("", "error during connect: //./pipe/dockerDesktopLinuxEngine", 1, null)),
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    now: () => 10,
    logger: silentProbeLogger,
  });
  expect(stopped.code).toBe("INSTALLED_NOT_RUNNING");
  expect(stopped.diagnosis).toBe(DOCKER_NOT_RUNNING_DIAGNOSIS);

  const missing = await probeDocker({
    runner: scripted(() => command("", "", null, "ENOENT")),
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    now: () => 10,
    logger: silentProbeLogger,
  });
  expect(missing.code).toBe("NOT_INSTALLED");
  expect(missing.diagnosis).toBe(DOCKER_NOT_INSTALLED_DIAGNOSIS);

  const calls: CommandRunRequest[] = [];
  const running = await probeDocker({
    runner: scripted((request) => {
      calls.push(request);
      return command("27.3.1\n", "", 0, null);
    }),
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    now: () => 10,
    logger: silentProbeLogger,
  });
  expect(running.outcome).toBe("pass");
  expect(running.code).toBe("RUNNING");
  expect(calls[0]?.args).toEqual([...DOCKER_INFO_ARGS]);
});

it("translates cryptic OS errors into one-line fixes", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  expect(diagnoseCaught(refused)).toBe(
    "Nothing is accepting connections on 127.0.0.1:5432 — start the service and click Check again",
  );
  expect(diagnoseCaught(new Error("error during connect: //./pipe/dockerDesktopLinuxEngine"))).toBe(
    DOCKER_NOT_RUNNING_DIAGNOSIS,
  );
  expect(diagnoseCaught(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }))).toBe(
    "The required command was not found — install it and click Check again",
  );
});

it("caps every probe at 10 seconds and kills a hung probe", async () => {
  expect(MAX_PROBE_TIMEOUT_MS).toBe(10_000);
  expect(() => assertProbeTimeout(10_001)).toThrow(/10/);
  let aborted = false;
  const runtime = openHumanSteps({
    now: () => 30,
    timeoutMs: 40,
    runner: {
      run(request: CommandRunRequest): Promise<CommandRunResult> {
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve(command("", "", 0, null));
          }, 60_000);
          request.signal?.addEventListener("abort", () => {
            aborted = true;
            clearTimeout(timer);
            resolve(command("", "", null, "ABORTED"));
          });
        });
      },
    },
  });
  const step = runtime.createStep({
    stepType: "runtime_install",
    title: "Docker",
    plainEnglishInstructions: ["Start Docker Desktop."],
    probeSpec: { kind: "docker" },
    blockingTaskIds: ["T-8"],
  });
  const started = Date.now();
  const result = await runtime.checkAgain(step.stepId);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(result.code).toBe("PROBE_TIMEOUT");
  expect(result.durationMs).toBeLessThan(MAX_PROBE_TIMEOUT_MS);
  expect(aborted).toBe(true);
  expect(runtime.store.require(step.stepId).status).toBe("failed");
  runtime.close();
});

it("probes the real local node and git binaries and enforces semver", async () => {
  const runtime = openHumanSteps({ now: () => 40 });
  const node = runtime.createStep({
    stepType: "cli_auth",
    title: "Node",
    plainEnglishInstructions: ["Node 18 or newer is required."],
    probeSpec: { kind: "cli_tool", tool: "node", minimumVersion: "18.0.0", checkAuth: false },
    blockingTaskIds: ["T-node"],
  });
  const nodeResult = await runtime.checkAgain(node.stepId);
  expect(nodeResult.outcome).toBe("pass");
  expect(nodeResult.evidence.tool).toBe("node");
  expect(runtime.store.require(node.stepId).status).toBe("verified");
  expect(runtime.store.holdsFor("T-node")).toEqual([]);

  const git = runtime.createStep({
    stepType: "cli_auth",
    title: "Git",
    plainEnglishInstructions: ["Git is required."],
    probeSpec: { kind: "cli_tool", tool: "git", minimumVersion: "2.0.0", checkAuth: false },
    blockingTaskIds: ["T-git"],
  });
  const gitResult = await runtime.checkAgain(git.stepId);
  expect(gitResult.outcome).toBe("pass");
  expect(String(gitResult.evidence.version)).toMatch(/^\d+\.\d+\.\d+$/);

  const ancient = runtime.createStep({
    stepType: "cli_auth",
    title: "Ancient node",
    plainEnglishInstructions: ["This minimum is intentionally unreachable."],
    probeSpec: { kind: "cli_tool", tool: "node", minimumVersion: "99.0.0", checkAuth: false },
    blockingTaskIds: ["T-old"],
  });
  const tooOld = await runtime.checkAgain(ancient.stepId);
  expect(tooOld.code).toBe("BELOW_MINIMUM");
  expect(runtime.store.require(ancient.stepId).status).toBe("failed");
  runtime.close();
});

it("reports a CLI that is installed but not authenticated", async () => {
  const runtime = openHumanSteps({
    now: () => 50,
    runner: {
      async run(request: CommandRunRequest): Promise<CommandRunResult> {
        if (request.args[0] === "--version") return command("gh version 2.40.0\n", "", 0, null);
        return command("", "You are not logged in", 1, null);
      },
    },
  });
  const step = runtime.createStep({
    stepType: "cli_auth",
    title: "GitHub CLI",
    plainEnglishInstructions: ["Log in with gh auth login."],
    probeSpec: { kind: "cli_tool", tool: "gh", checkAuth: true },
    blockingTaskIds: ["T-gh"],
  });
  const result = await runtime.checkAgain(step.stepId);
  expect(result.code).toBe("NOT_AUTHENTICATED");
  expect(result.diagnosis).toContain("gh auth login");
  expect(runtime.store.holdsFor("T-gh")).toHaveLength(1);
  runtime.close();
});

it("clears waiting holds for every blocked task when Check again passes", async () => {
  const dbSteps = openHumanSteps({
    now: () => 60,
    runner: {
      async run(): Promise<CommandRunResult> {
        return command("gh version 2.40.0\n", "", 0, null);
      },
    },
  });
  const step = dbSteps.createStep({
    stepType: "cli_auth",
    title: "GitHub CLI",
    plainEnglishInstructions: ["gh is required for ship."],
    probeSpec: { kind: "cli_tool", tool: "gh", checkAuth: false },
    blockingTaskIds: ["T-a", "T-b"],
  });
  dbSteps.store.holds.placeHold({ task: "T-a", reason: "user_pause", source: "msg-9", createdAt: 60 });
  await dbSteps.checkAgain(step.stepId);
  expect(dbSteps.store.require(step.stepId).status).toBe("verified");
  expect(dbSteps.store.holdsFor("T-a").map((hold) => hold.reason)).toEqual(["user_pause"]);
  expect(dbSteps.store.holdsFor("T-b")).toEqual([]);
  dbSteps.close();
});

function scripted(handle: (request: CommandRunRequest) => CommandRunResult) {
  return {
    async run(request: CommandRunRequest): Promise<CommandRunResult> {
      return handle(request);
    },
  };
}

function command(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  errorCode: CommandRunResult["errorCode"],
): CommandRunResult {
  return { stdout, stderr, exitCode, errorCode, durationMs: 1, timedOut: errorCode === "TIMEOUT" };
}
