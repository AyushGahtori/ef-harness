import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCAL_CRASH_REPORTER } from "../../src/diagnostics/index.js";

describe("diagnostics zero telemetry egress", () => {
  it("has no network client and never uploads crash dumps", () => {
    const root = fileURLToPath(new URL("../../src/diagnostics/", import.meta.url));
    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [
      "node:http",
      "node:https",
      "node:net",
      "node:dgram",
      "undici",
      "uploadToServer: true",
      "fetch(",
      "XMLHttpRequest",
      "http.request",
      "https.request",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect(text.includes(needle), `${file} contains ${needle}`).toBe(false);
      }
    }
    expect(LOCAL_CRASH_REPORTER.uploadToServer).toBe(false);
    expect(LOCAL_CRASH_REPORTER).not.toHaveProperty("submitURL");
  });
});

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}
