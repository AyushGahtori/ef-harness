import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodeIndexDb } from "@ef-harness/db";
import { routeDaemonVisualSteer } from "../../src/preview/visual-steer-service.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("daemon visual steer", () => {
  it("counts code-index references instead of a hardcoded screen total", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-steer-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, "src/components/ui"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/components/ui/button.tsx"), "export function Button() { return null; }\n");
    const index = CodeIndexDb.open({ filePath: path.join(dir, "code-index.db") });
    cleanups.push(() => index.close());
    index.upsertCommit({ commitSha: "abc123", builtAt: 1, files: 2 });
    index.linkFile({ commitSha: "abc123", path: "src/components/ui/button.tsx", fileHash: "button-hash" });
    index.linkFile({ commitSha: "abc123", path: "src/pages/Orders.tsx", fileHash: "orders-hash" });
    index.putSymbols("button-hash", [{ name: "Button", kind: "component", line: 1, signature: "Button()", exported: true }]);
    index.putRefs("orders-hash", [{ name: "Button", line: 4 }]);
    index.putRefs("home-hash", [{ name: "Button", line: 2 }]);
    const routed = routeDaemonVisualSteer({
      workspaceRoot: dir,
      instruction: "Make this purple instead of orange",
      file: "src/components/ui/button.tsx",
      commitSha: "abc123",
      codeIndex: index,
    });
    expect(routed.accepted).toBe(true);
    expect(routed.needsQuestion).toBe(true);
    expect(routed.screenCount).toBe(2);
    expect(routed.scopePrompt).toContain("2 screens");
    expect(routed.scopePrompt).toMatch(/only here|shared/i);
  });

  it("resolves a missing data-ef-source path from the code index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-steer-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, "src/legacy"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/legacy/RadixPortal.tsx"), "export function RadixPortal() { return null; }\n");
    const index = CodeIndexDb.open({ filePath: path.join(dir, "code-index.db") });
    cleanups.push(() => index.close());
    index.upsertCommit({ commitSha: "def456", builtAt: 1, files: 1 });
    index.linkFile({ commitSha: "def456", path: "src/legacy/RadixPortal.tsx", fileHash: "portal-hash" });
    index.putSymbols("portal-hash", [{ name: "RadixPortal", kind: "component", line: 1, signature: "RadixPortal()", exported: true }]);
    const routed = routeDaemonVisualSteer({
      workspaceRoot: dir,
      instruction: "Tighten modal padding",
      file: null,
      commitSha: "def456",
      codeIndex: index,
    });
    expect(routed.accepted).toBe(true);
    expect(routed.file).toBe("src/legacy/RadixPortal.tsx");
  });
});
