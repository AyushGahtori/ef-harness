import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TierCRestrictedTokenProvider } from "../../src/tier-c-d-selector/tier-c-provider.js";

const probeScript = `
const fs = require("fs");
const [inside, outside, gitFile, modules, result, readable] = process.argv.slice(2);
const out = {
  proxy: process.env.HTTP_PROXY || "",
  gitSsh: process.env.GIT_SSH_COMMAND || "",
  canary: process.env.EF_TIERC_CANARY || "",
  gh: process.env.GH_TOKEN || "",
};
function tryWrite(name, file) {
  try { fs.writeFileSync(file, "x"); out[name] = "ok"; }
  catch (error) { out[name] = "denied:" + (error && error.code ? error.code : "error"); }
}
function tryRead(name, file) {
  try { out[name] = "read:" + fs.readFileSync(file, "utf8"); }
  catch (error) { out[name] = "read-denied:" + (error && error.code ? error.code : "error"); }
}
tryWrite("inside", inside);
tryWrite("outside", outside);
tryWrite("git", gitFile);
tryWrite("modules", modules);
tryRead("readable", readable);
fs.writeFileSync(result, JSON.stringify(out));
`;

describe("Tier C live write restriction", () => {
  it.skipIf(process.platform !== "win32")(
    "allows writes inside the scratch worktree and denies writes outside it, in .git, and in node_modules",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-tierc-live-"));
      const work = path.join(root, "work");
      const temp = path.join(root, "temp");
      const outside = path.join(root, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "readable.txt"), "secret-canary");
      const assigned: number[] = [];
      const provider = new TierCRestrictedTokenProvider({
        jobManager: {
          createJob: (spec) => ({ name: spec.name }),
          assignProcess: (_job, pid) => {
            assigned.push(pid);
          },
        },
      });
      const previousCanary = process.env.EF_TIERC_CANARY;
      const previousToken = process.env.GH_TOKEN;
      process.env.EF_TIERC_CANARY = "tierc-canary";
      process.env.GH_TOKEN = "tierc-canary-token";
      try {
        const instance = await provider.acquireWarmInstance({
          projectId: "project-1",
          attemptId: "attempt-1",
          taskId: "task-1",
          projectPath: work,
          worktreePath: work,
          tempPath: temp,
          mode: "own_loop",
        });
        const script = path.join(work, "probe.js");
        fs.writeFileSync(script, probeScript);
        const resultPath = path.join(work, "result.json");
        const result = await provider.executeCommand(instance, {
          commandId: "probe",
          executable: process.execPath,
          args: [
            script,
            path.join(work, "ok.txt"),
            path.join(outside, "no.txt"),
            path.join(work, ".git", "no.txt"),
            path.join(work, "node_modules", "no.txt"),
            resultPath,
            path.join(outside, "readable.txt"),
          ],
          timeoutMs: 30_000,
        });
        expect(result.exitCode).toBe(0);
        const body = JSON.parse(fs.readFileSync(resultPath, "utf8")) as Record<string, string>;
        expect(body.inside).toBe("ok");
        expect(body.outside).toContain("denied");
        expect(body.git).toContain("denied");
        expect(body.modules).toContain("denied");
        expect(body.readable).toContain("secret-canary");
        expect(body.canary).toBe("");
        expect(body.gh).toBe("");
        expect(body.proxy).toContain("127.0.0.1");
        expect(body.gitSsh).toContain("exit /b 1");
        expect(fs.existsSync(path.join(work, "ok.txt"))).toBe(true);
        expect(fs.existsSync(path.join(outside, "no.txt"))).toBe(false);
        expect(fs.existsSync(path.join(work, ".git", "no.txt"))).toBe(false);
        expect(fs.existsSync(path.join(work, "node_modules", "no.txt"))).toBe(false);
        fs.writeFileSync(path.join(work, ".git", "kernel.txt"), "kernel");
        expect(assigned[0]).toBeGreaterThan(0);
      } finally {
        if (previousCanary === undefined) delete process.env.EF_TIERC_CANARY;
        else process.env.EF_TIERC_CANARY = previousCanary;
        if (previousToken === undefined) delete process.env.GH_TOKEN;
        else process.env.GH_TOKEN = previousToken;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
