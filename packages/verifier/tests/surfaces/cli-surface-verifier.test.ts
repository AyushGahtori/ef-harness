import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CliSurfaceVerifier } from "../../src/surfaces/cli-surface-verifier.js";
import { verifierContext } from "./support.js";

async function script(name: string, source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ef-cli-"));
  const file = path.join(directory, name);
  await writeFile(file, source, "utf8");
  return file;
}

function spec(file: string, expectExitCode: number) {
  return {
    checkId: "cli.orders",
    command: [process.execPath, file],
    expectExitCode,
    stdout: { format: "json" as const, jsonRequiredKeys: ["orders"] },
    stderr: { linePattern: "^level=(debug|info|warn|error) msg=\\S+$" },
  };
}

describe("CliSurfaceVerifier", () => {
  it("accepts JSON on stdout and formatted warnings on stderr", async () => {
    const file = await script(
      "pass.mjs",
      `console.error("level=warn msg=disk");\nconsole.log(JSON.stringify({ orders: 1 }));\n`,
    );
    const results = await new CliSurfaceVerifier().verify(spec(file, 0), verifierContext("http://127.0.0.1"));
    expect(results.every((result) => result.status === "pass")).toBe(true);
  });

  it("fails when a warning is written to stdout and corrupts the JSON contract", async () => {
    const file = await script(
      "mixed.mjs",
      `console.log("warning: disk");\nconsole.log(JSON.stringify({ orders: 1 }));\n`,
    );
    const results = await new CliSurfaceVerifier().verify(spec(file, 0), verifierContext("http://127.0.0.1"));
    expect(results.find((result) => result.check_id === "cli.orders:stdout")?.status).toBe("fail");
    expect(results.find((result) => result.check_id === "cli.orders:stdout")?.message).toContain("stderr");
  });

  it("fails when the exit code does not match the contract", async () => {
    const file = await script(
      "exit.mjs",
      `console.error("level=error msg=nope");\nconsole.log(JSON.stringify({ orders: 0 }));\nprocess.exit(2);\n`,
    );
    const results = await new CliSurfaceVerifier().verify(spec(file, 0), verifierContext("http://127.0.0.1"));
    expect(results.find((result) => result.check_id === "cli.orders:exit")?.status).toBe("fail");
  });
});
