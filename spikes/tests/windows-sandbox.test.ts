import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsSandboxDir = path.resolve(here, "..", "windows-sandbox");
const testEntry = path.join(windowsSandboxDir, "windows-sandbox.test.mjs");

function runNodeTest(file: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const allow = [
      "ALLUSERSPROFILE",
      "CommonProgramFiles",
      "CommonProgramFiles(x86)",
      "CommonProgramW6432",
      "COMPUTERNAME",
      "ComSpec",
      "HOMEDRIVE",
      "HOMEPATH",
      "LOCALAPPDATA",
      "NUMBER_OF_PROCESSORS",
      "OS",
      "PATHEXT",
      "PATH",
      "PROCESSOR_ARCHITECTURE",
      "PROCESSOR_IDENTIFIER",
      "PROCESSOR_LEVEL",
      "PROCESSOR_REVISION",
      "ProgramData",
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramW6432",
      "PUBLIC",
      "SystemDrive",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERDOMAIN",
      "USERNAME",
      "USERPROFILE",
      "windir",
    ];
    const env: NodeJS.ProcessEnv = {};
    for (const key of allow) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const child = spawn(process.execPath, ["--test", file], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

describe("windows-sandbox/windows-sandbox.test.mjs", () => {
  it("passes all Windows sandbox unit and live spike tests", async () => {
    const result = await runNodeTest(testEntry, windowsSandboxDir);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/pass \d+/);
    expect(result.stdout).toContain("fail 0");
  }, 360_000);
});
