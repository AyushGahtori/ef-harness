import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConflictVerificationError } from "./errors.js";
import { featureSymbols } from "./conflict-text.js";

const require = createRequire(import.meta.url);

function writeFiles(root: string, files: readonly { path: string; text: string }[]): void {
  for (const file of files) {
    const full = path.join(root, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const text = file.text.endsWith("\n") ? file.text : `${file.text}\n`;
    fs.writeFileSync(full, text, "utf8");
  }
}

function runNode(args: readonly string[], cwd: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
}

/**
 * Typechecks merged route modules and runs node:test cases that both route paths survive.
 */
export function verifyRouteResolution(files: readonly { path: string; text: string }[]): void {
  const routeFile = files.find((file) => /export const routes\b/.test(file.text));
  if (!routeFile) return;
  const symbols = featureSymbols(routeFile.text).filter((symbol) => symbol.startsWith("/"));
  if (symbols.length === 0) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-route-verify-"));
  try {
    writeFiles(root, files.filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx")));
    fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ type: "module" })}\n`, "utf8");
    const tsc = require.resolve("typescript/lib/tsc.js");
    const sources = files
      .map((file) => file.path.replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    const typecheck = runNode(
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
    const emit = runNode(
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
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "tests", "routes.test.mjs"), testSource, "utf8");
    const tested = runNode(["--test", "tests/routes.test.mjs"], root);
    if (tested.status !== 0) {
      throw new ConflictVerificationError(`route tests failed:\n${tested.output}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
