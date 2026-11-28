import { expect, it } from "vitest";

import { openHumanSteps, type CommandRunRequest, type CommandRunResult } from "../../src/human-steps/index.js";

it("reprobes pending and failed steps on cold open and when focus returns", async () => {
  let ghAuthed = false;
  const runtime = openHumanSteps({
    now: () => 200,
    timeoutMs: 1_000,
    runner: {
      async run(request: CommandRunRequest): Promise<CommandRunResult> {
        if (request.file === "docker") {
          return { exitCode: 1, stdout: "", stderr: "error during connect: //./pipe/dockerDesktopLinuxEngine", errorCode: null, durationMs: 1, timedOut: false };
        }
        if (request.args[0] === "--version") {
          return { exitCode: 0, stdout: "gh version 2.62.0\n", stderr: "", errorCode: null, durationMs: 1, timedOut: false };
        }
        return {
          exitCode: ghAuthed ? 0 : 1,
          stdout: ghAuthed ? "logged in" : "",
          stderr: ghAuthed ? "" : "not logged in",
          errorCode: null,
          durationMs: 1,
          timedOut: false,
        };
      },
    },
  });
  const gh = runtime.createStep({
    stepType: "cli_auth",
    title: "Log in to GitHub",
    plainEnglishInstructions: ["Run gh auth login."],
    probeSpec: { kind: "cli_tool", tool: "gh", checkAuth: true },
    blockingTaskIds: ["T-ship"],
  });
  const docker = runtime.createStep({
    stepType: "runtime_install",
    title: "Docker",
    plainEnglishInstructions: ["Start Docker Desktop."],
    probeSpec: { kind: "docker" },
    blockingTaskIds: ["T-docker"],
  });
  const manual = runtime.createStep({
    stepType: "account_attestation",
    title: "Accept Apple terms",
    plainEnglishInstructions: ["Accept the terms in the Apple dashboard."],
    probeSpec: { kind: "unprobeable" },
    blockingTaskIds: ["T-apple"],
    hardLocal: false,
  });
  expect((await runtime.checkAgain(gh.stepId)).code).toBe("NOT_AUTHENTICATED");
  expect((await runtime.checkAgain(docker.stepId)).code).toBe("INSTALLED_NOT_RUNNING");
  ghAuthed = true;
  const report = await runtime.reentry.onColdOpen();
  expect(report.skipped).toEqual([manual.stepId]);
  expect(runtime.store.require(gh.stepId).status).toBe("verified");
  expect(runtime.store.holdsFor("T-ship")).toEqual([]);
  expect(runtime.store.require(docker.stepId).status).toBe("failed");
  expect(runtime.store.holdsFor("T-docker")).toHaveLength(1);
  const again = await runtime.reentry.onFocusReturn();
  expect(again.checked.map((item) => item.stepId)).toEqual([docker.stepId]);
  expect(runtime.store.require(manual.stepId).status).toBe("pending");
  runtime.close();
});
