import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConflictVerificationError } from "./errors.js";
import { featureSymbols } from "./conflict-text.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

async function writeFiles(root: string, files: readonly { path: string; text: string }[]): Promise<void> {
  for (const file of files) {
    const full = path.join(root, file.path);
    await mkdir(path.dirname(full), { recursive: true });
    const text = file.text.endsWith("\n") ? file.text : `${file.text}\n`;
    await writeFile(full, text, "utf8");
  }
}

async function runNode(args: readonly string[], cwd: string): Promise<{ status: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: 0, output: `${stdout ?? ""}\n${stderr ?? ""}`.trim() };
  } catch (error) {
    const execErr = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const status = typeof execErr.code === "number" ? execErr.code : 1;
    const stdout = execErr.stdout ?? "";
    const stderr = execErr.stderr ?? execErr.message ?? "";
    return { status, output: `${stdout}\n${stderr}`.trim() };
  }
}

/**
 * Typechecks merged route modules and runs node:test cases that both route paths survive.
 */
export async function verifyRouteResolution(
  files: readonly { path: string; text: string }[],
): Promise<void> {
  const routeFile = files.find((file) => /export const routes\b/.test(file.text));
  if (!routeFile) return;
  const symbols = featureSymbols(routeFile.text).filter((symbol) => symbol.startsWith("/"));
  if (symbols.length === 0) return;
  const root = await mkdtemp(path.join(os.tmpdir(), "ef-route-verify-"));
  try {
    await writeFiles(root, files.filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx")));
    await writeFile(path.join(root, "package.json"), `${JSON.stringify({ type: "module" })}\n`, "utf8");
    const tsc = require.resolve("typescript/lib/tsc.js");
    const sources = files
      .map((file) => file.path.replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    const typecheck = await runNode(
      [
        tsc,
        "--noEmit",
        "--strict",
        "--pretty",
        "false",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "--skipLibCheck",
        ...sources,
      ],
      root,
    );
    if (typecheck.status !== 0) {
      throw new ConflictVerificationError(`typecheck failed:\n${typecheck.output}`);
    }
    const emit = await runNode(
      [
        tsc,
        "--pretty",
        "false",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "--skipLibCheck",
        "--outDir",
        "dist",
        "--rootDir",
        ".",
        ...sources,
      ],
      root,
    );
    if (emit.status !== 0) {
      throw new ConflictVerificationError(`emit failed:\n${emit.output}`);
    }
    const compiled = `dist/${routeFile.path.replaceAll("\\", "/").replace(/\.tsx?$/, ".js")}`;
    const importPath = path.posix.relative("tests", compiled);
    const cases = symbols
      .map(
        (route) =>
          `test(${JSON.stringify(`route ${route} survived`)}, () => { assert.ok(routes.some((item) => item && item.path === ${JSON.stringify(route)}), ${JSON.stringify(route)}); });`,
      )
      .join("\n");
    const testSource = [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      `import { routes } from ${JSON.stringify(importPath)};`,
      cases,
      "",
    ].join("\n");
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "tests", "routes.test.mjs"), testSource, "utf8");
    const tested = await runNode(["--test", "tests/routes.test.mjs"], root);
    if (tested.status !== 0) {
      throw new ConflictVerificationError(`route tests failed:\n${tested.output}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
