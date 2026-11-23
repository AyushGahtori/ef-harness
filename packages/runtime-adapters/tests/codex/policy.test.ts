import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalDeterministicSupervisionPolicyEngine } from "../../src/codex/policy.js";
import { assertSafeCodexArgs, assertSafeCodexConfig } from "../../src/codex/process.js";
import { renderConfig } from "../../src/codex/codex-home.js";
import { parseCodexRateLimits } from "../../src/codex/rate-limit.js";
import { percentToPpm } from "../../src/codex/types.js";
import { LocalTierAMxcSandbox } from "../../src/codex/ports.js";

describe("codex policy and quota math", () => {
  it("converts 92 percent to 920000 ppm and parses both windows", () => {
    expect(percentToPpm(92)).toBe(920_000);
    const snapshot = parseCodexRateLimits({
      primary: { usedPercent: 92, window: "5h", resetAt: "2026-11-23T16:00:00.000Z" },
      secondary: { usedPercent: 40, window: "7d", resetsAt: 1_764_500_000 },
    });
    expect(snapshot.primary.usedPpm).toBe(920_000);
    expect(snapshot.primary.window).toBe("5h");
    expect(snapshot.secondary.usedPpm).toBe(400_000);
    expect(snapshot.secondary.window).toBe("7d");
    expect(snapshot.primary.resetAt).toBe("2026-11-23T16:00:00.000Z");
  });

  it("allows in-scope edits and denies escapes, pushes, and installs in under 2 ms", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ef-codex-policy-"));
    writeFileSync(path.join(root, "keep.ts"), "export const keep = 1;\n");
    const engine = new LocalDeterministicSupervisionPolicyEngine();
    engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "edit", path: "keep.ts" },
    });
    const allowed = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "edit", path: "keep.ts" },
    });
    const escaped = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "edit", path: "../outside.ts" },
    });
    const pushed = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "shell", command: "git push origin main" },
    });
    const added = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "shell", command: "pnpm add left-pad" },
    });
    const curled = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "shell", command: "curl https://example.invalid" },
    });
    const tested = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "shell", command: "pnpm test" },
    });
    expect(allowed.effect).toBe("allow");
    expect(allowed.elapsedMs).toBeLessThan(2);
    expect(escaped.effect).toBe("deny");
    expect(escaped.elapsedMs).toBeLessThan(2);
    expect(pushed.effect).toBe("deny");
    expect(pushed.elapsedMs).toBeLessThan(2);
    expect(added.effect).toBe("deny");
    expect(curled.effect).toBe("deny");
    expect(tested.effect).toBe("allow");
    rmSync(root, { recursive: true, force: true });
  });

  it("denies a symlink that resolves outside the worktree", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ef-codex-link-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "ef-codex-out-"));
    const link = path.join(root, "link.ts");
    let linked = true;
    try {
      symlinkSync(path.join(outside, "secret.txt"), link);
    } catch {
      linked = false;
    }
    const engine = new LocalDeterministicSupervisionPolicyEngine({
      realpath: (target) => (target === link ? path.join(outside, "secret.txt") : target),
    });
    const decision = engine.decide({
      worktreeRoot: root,
      writeScope: ["**"],
      request: { kind: "edit", path: link },
    });
    expect(decision.effect).toBe("deny");
    expect(decision.elapsedMs).toBeLessThan(2);
    expect(linked || decision.reason.length > 0).toBe(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses unrestricted sandbox flags and renders MXC workspace-write config", () => {
    expect(() => assertSafeCodexArgs(["app-server", "--yolo"])).toThrow(/unrestricted_sandbox|yolo|danger-full-access/);
    expect(() => assertSafeCodexArgs(["danger-full-access"])).toThrow(/danger-full-access|unrestricted_sandbox/);
    expect(() => assertSafeCodexArgs(["app-server"])).not.toThrow();
    const alignment = new LocalTierAMxcSandbox().align({
      worktreeRoot: "C:/work/attempt",
      loopbackProxy: "http://127.0.0.1:9",
    });
    const toml = renderConfig(alignment, "http://127.0.0.1:9/mcp/attempt", "C:/work/attempt");
    assertSafeCodexConfig(toml);
    expect(toml).toContain('sandbox_mode = "workspace-write"');
    expect(toml).toContain('sandbox = "mxc"');
    expect(toml).toContain('approval_policy = "on-request"');
    expect(toml).toContain("network_access = false");
    expect(toml).not.toContain("danger-full-access");
    expect(toml).not.toContain("--yolo");
    expect(toml).not.toContain('approval_policy = "never"');
  });
});
