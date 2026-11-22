import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  CHROMIUM_LAUNCH_ARGS,
  CONSENT_PROMPT,
  PLAYWRIGHT_INSTALL_COMMAND,
  ChildProcessJobSupervisor,
  ConsentedTerminalInstaller,
  inspectPlaywright,
  nodeDnsResolver,
  openHumanSteps,
  probeDns,
  probePlaywright,
  type TerminalEvent,
} from "../../src/human-steps/index.js";
import { silentProbeLogger } from "../../src/human-steps/ports.js";
import type { HttpProbeRequest, WindowsJobSupervisor } from "../../src/human-steps/ports.js";

it("checks Playwright revision parity and a headless about:blank launch", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ef-pw-"));
  const browsers = path.join(root, "browsers");
  seedPlaywright(root, "1.49.0", "1148");
  mkdirSync(path.join(browsers, "chromium-1100"), { recursive: true });
  const mismatch = inspectPlaywright(root, browsers);
  expect(mismatch.expectedRevision).toBe("1148");
  expect(mismatch.executablePath).toBeNull();
  const mismatched = await probePlaywright({
    projectRoot: root,
    browsersPath: browsers,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    now: () => 1,
    logger: silentProbeLogger,
  });
  expect(mismatched.code).toBe("VERSION_MISMATCH");

  const executable = path.join(browsers, "chromium-1148", "chrome-win64", "chrome.exe");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "");
  let launchArgsSeen = false;
  const passed = await probePlaywright({
    projectRoot: root,
    browsersPath: browsers,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    now: () => 2,
    logger: silentProbeLogger,
    launch: async (file) => {
      expect(file).toBe(executable);
      launchArgsSeen = true;
      return { exitCode: 0, stdout: "<html><head></head><body></body></html>", stderr: "", timedOut: false };
    },
  });
  expect(passed.outcome).toBe("pass");
  expect(passed.code).toBe("PASS");
  expect(launchArgsSeen).toBe(true);
  expect([...CHROMIUM_LAUNCH_ARGS]).toContain("about:blank");
});

it("probes DNS TXT and CNAME records and an HTTPS cloud API without logging the bearer", async () => {
  const txt = await probeDns({
    hostname: "example.com",
    recordType: "TXT",
    expected: "google-site-verification=abc",
    resolver: { async resolveTxt() { return ["google-site-verification=abc"]; }, async resolveCname() { return []; } },
    now: () => 3,
    logger: silentProbeLogger,
  });
  expect(txt.code).toBe("DNS_MATCH");
  const cname = await probeDns({
    hostname: "www.example.com",
    recordType: "CNAME",
    expected: "example.com",
    resolver: { async resolveTxt() { return []; }, async resolveCname() { return ["example.com"]; } },
    now: () => 4,
    logger: silentProbeLogger,
  });
  expect(cname.outcome).toBe("pass");
  const missed = await probeDns({
    hostname: "example.com",
    recordType: "TXT",
    expected: "missing-token",
    resolver: { async resolveTxt() { return ["other"]; }, async resolveCname() { return []; } },
    now: () => 5,
    logger: silentProbeLogger,
  });
  expect(missed.code).toBe("DNS_MISMATCH");

  const logs: string[] = [];
  const runtime = openHumanSteps({
    now: () => 6,
    timeoutMs: 1_000,
    logger: { write(_event, fields) { logs.push(JSON.stringify(fields)); } },
    vault: { readSecret: () => "vault-token-canary" },
    http: {
      async request(input: HttpProbeRequest) {
        expect(input.method).toBe("GET");
        if (input.url.includes("vercel.example")) {
          expect(input.headers.authorization).toBe("Bearer vault-token-canary");
        }
        return { status: input.url.includes("/webhook") ? 404 : 200 };
      },
    },
  });
  const cloud = runtime.createStep({
    stepType: "cloud_api",
    title: "Vercel project",
    plainEnglishInstructions: ["The Vercel project must answer HTTPS."],
    probeSpec: { kind: "cloud_api", url: "https://vercel.example/api/project", secretId: "vercel" },
    blockingTaskIds: ["T-cloud"],
    hardLocal: false,
  });
  expect((await runtime.checkAgain(cloud.stepId)).code).toBe("HTTPS_OK");
  const hook = runtime.createStep({
    stepType: "webhook",
    title: "OAuth callback",
    plainEnglishInstructions: ["The callback URL must be reachable."],
    probeSpec: { kind: "webhook", url: "https://app.example/webhook" },
    blockingTaskIds: ["T-hook"],
    hardLocal: false,
  });
  expect((await runtime.checkAgain(hook.stepId)).outcome).toBe("pass");
  const httpUrl = runtime.createStep({
    stepType: "cloud_api",
    title: "Insecure URL",
    plainEnglishInstructions: ["HTTPS is required."],
    probeSpec: { kind: "cloud_api", url: "http://vercel.example/api" },
    blockingTaskIds: ["T-http"],
    hardLocal: false,
  });
  expect((await runtime.checkAgain(httpUrl.stepId)).code).toBe("HTTPS_ONLY");
  expect(logs.join("\n")).not.toContain("vault-token-canary");
  const local = await nodeDnsResolver().resolveTxt("localhost").then(
    () => "unexpected",
    (error: unknown) => (error instanceof Error ? error.code ?? error.message : "failed"),
  );
  expect(local).not.toBe("unexpected");
  runtime.close();
});

it("requires the exact consented command, streams output, cancels, and reprobes on exit 0", async () => {
  const events: TerminalEvent[] = [];
  const supervisor = new ScriptedSupervisor();
  let reprobes = 0;
  const installer = new ConsentedTerminalInstaller(supervisor, {
    async checkAgain() {
      reprobes += 1;
      return {
        outcome: "pass",
        code: "PASS",
        diagnosis: "Chromium is installed",
        durationMs: 1,
        checkedAt: 9,
        evidence: { readOnly: true },
      };
    },
  });
  const step = {
    stepId: "HS-pw",
    stepType: "runtime_install" as const,
    title: "Install Chromium",
    plainEnglishInstructions: ["Install the Playwright browser."],
    probeSpec: { kind: "playwright" as const, projectRoot: "C:/app" },
    status: "pending" as const,
    lastProbeResult: null,
    blockingTaskIds: ["T-pw"],
    hardLocal: true,
  };
  const card = installer.propose(step);
  expect(card.prompt).toBe(CONSENT_PROMPT);
  expect(card.exactCommand).toBe(PLAYWRIGHT_INSTALL_COMMAND);
  expect(card.args).toEqual(["playwright", "install", "chromium"]);
  expect(supervisor.calls).toBe(0);
  expect(() => installer.start(card, { approved: true, exactCommand: "npx playwright install chromium --with-deps" }, () => undefined)).toThrow(
    /exact command/,
  );
  expect(supervisor.calls).toBe(0);

  const winget = installer.propose({
    ...step,
    stepId: "HS-winget",
    probeSpec: {
      kind: "cli_tool",
      tool: "gh",
      install: { file: "winget", args: ["install", "--id", "GitHub.cli", "-e"] },
    },
  });
  expect(winget.exactCommand).toBe("winget install --id GitHub.cli -e");
  expect(supervisor.calls).toBe(0);

  const cancelled = installer.start(card, { approved: true, exactCommand: card.exactCommand }, (event) => events.push(event));
  cancelled.cancel();
  const cancelResult = await cancelled.finished;
  expect(cancelResult.disposition).toBe("cancelled");
  expect(cancelResult.reprobed).toBe(false);
  expect(reprobes).toBe(0);
  expect(events.some((event) => event.type === "cancelled")).toBe(true);

  supervisor.mode = "finish";
  const finished = installer.start(card, { approved: true, exactCommand: card.exactCommand }, (event) => events.push(event));
  const done = await finished.finished;
  expect(done).toMatchObject({ disposition: "completed", exitCode: 0, reprobed: true });
  expect(reprobes).toBe(1);
  expect(events.some((event) => event.type === "output" && event.text?.includes("Downloading Chromium"))).toBe(true);
});

it("terminates a real child process tree when the installer is cancelled", async () => {
  const supervisor = new ChildProcessJobSupervisor();
  const controller = new AbortController();
  const pending = supervisor.runCommand({
    file: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  const result = await pending;
  expect(result.reason).toBe("terminated");
  expect(result.exitCode).toBeNull();
});

function seedPlaywright(root: string, version: string, revision: string): void {
  const playwright = ensure(root, "node_modules/playwright");
  const core = ensure(root, "node_modules/playwright-core");
  writeFileSync(path.join(playwright, "package.json"), JSON.stringify({ version }));
  writeFileSync(path.join(core, "package.json"), JSON.stringify({ version }));
  writeFileSync(
    path.join(core, "browsers.json"),
    JSON.stringify({ browsers: [{ name: "chromium", revision, installByDefault: true }] }),
  );
}

function ensure(root: string, folder: string): string {
  const full = path.join(root, folder);
  mkdirSync(full, { recursive: true });
  return full;
}

class ScriptedSupervisor implements WindowsJobSupervisor {
  calls = 0;
  mode: "cancel" | "finish" = "cancel";

  runCommand(request: Parameters<WindowsJobSupervisor["runCommand"]>[0]): ReturnType<WindowsJobSupervisor["runCommand"]> {
    this.calls += 1;
    return new Promise((resolve) => {
      request.onOutput?.({ stream: "stdout", text: "Downloading Chromium\n" });
      const timer = setTimeout(() => {
        request.onOutput?.({ stream: "stdout", text: "done\n" });
        resolve({ reason: "exited", exitCode: this.mode === "finish" ? 0 : 1, durationMs: 5, jobId: "job-1" });
      }, 30);
      request.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve({ reason: "terminated", exitCode: null, durationMs: 5, jobId: "job-1" });
      });
    });
  }
}
