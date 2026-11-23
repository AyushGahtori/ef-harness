import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEASED_MCP_TOOLS,
  DIRECT_INSTALL_DENY_REASON,
  DeterministicSupervisionPolicyEngine,
  type SupervisionContext,
} from "../../src/core/index.js";

const engine = new DeterministicSupervisionPolicyEngine();

function memoryRealpath(links: ReadonlyMap<string, string> = new Map()): (target: string) => string {
  return (target: string) => {
    const normalized = path.normalize(target);
    return links.get(normalized) ?? links.get(normalized.toLowerCase()) ?? normalized;
  };
}

function context(
  root: string,
  overrides: {
    readonly writeScope?: readonly string[];
    readonly mode?: SupervisionContext["mode"];
    readonly realpath?: (target: string) => string;
    readonly sealedPaths?: readonly string[];
    readonly readOnlyPaths?: readonly string[];
    readonly homeDir?: string;
    readonly appData?: string;
    readonly leasedTools?: readonly string[];
    readonly cwd?: string;
    readonly useSystemRealpath?: boolean;
  } = {},
): SupervisionContext {
  const base: SupervisionContext = {
    sessionId: "session-1",
    worktreeRoot: root,
    cwd: overrides.cwd ?? root,
    writeScope: overrides.writeScope ?? ["src/api/orders.ts"],
    readOnlyPaths: overrides.readOnlyPaths ?? [],
    sealedPaths: overrides.sealedPaths ?? ["tests/oracle/**"],
    mode: overrides.mode ?? "wrapped",
    homeDir: overrides.homeDir ?? path.join(path.dirname(root), "home"),
    appData: overrides.appData ?? path.join(path.dirname(root), "appdata"),
    leasedTools: overrides.leasedTools ?? DEFAULT_LEASED_MCP_TOOLS,
  };
  if (!overrides.useSystemRealpath) {
    return { ...base, realpath: overrides.realpath ?? memoryRealpath() };
  }
  return base;
}

describe("DeterministicSupervisionPolicyEngine", () => {
  const root = path.resolve(os.tmpdir(), "ef-policy-root");
  const home = path.join(path.dirname(root), "home");
  const appData = path.join(path.dirname(root), "appdata");
  const ctx = () => context(root, { homeDir: home, appData });

  it("allows an in-scope edit and the same path with different Windows casing", () => {
    const allowed = engine.decide({ kind: "edit", path: "src/api/orders.ts" }, ctx());
    const folded = engine.decide({ kind: "write", path: "SRC\\Api\\Orders.ts" }, ctx());
    expect(allowed.effect).toBe("allow");
    expect(folded.effect).toBe("allow");
    const outside = engine.decide({ kind: "edit", path: "SRC\\Other.ts" }, ctx());
    expect(outside.effect).toBe("deny");
    if (outside.effect === "deny") expect(outside.reason).toBe("Path is outside write_scope");
  });

  it("denies worktree escapes, symlink escapes, git metadata, lockfiles, and sealed oracles", () => {
    const git = engine.decide({ kind: "write", path: "../../.git/hooks/pre-commit" }, ctx());
    expect(git.effect).toBe("deny");
    if (git.effect === "deny") expect(git.reason).toBe("Writes to .git are disabled");

    const harness = engine.decide({ kind: "delete", path: ".harness/secrets.json" }, ctx());
    expect(harness.effect).toBe("deny");
    if (harness.effect === "deny") expect(harness.reason).toBe("Writes to .harness are disabled");

    const lock = engine.decide(
      { kind: "write", path: "pnpm-lock.yaml" },
      context(root, { homeDir: home, appData, writeScope: ["pnpm-lock.yaml"] }),
    );
    expect(lock.effect).toBe("deny");
    if (lock.effect === "deny") expect(lock.reason).toBe("Lockfile writes are disabled");

    const sealed = engine.decide(
      { kind: "edit", path: "tests/oracle/hidden.ts" },
      context(root, { homeDir: home, appData, writeScope: ["tests/oracle/**"] }),
    );
    expect(sealed.effect).toBe("deny");
    if (sealed.effect === "deny") expect(sealed.reason).toBe("Sealed test and oracle paths are not writable");

    const linkPath = path.resolve(root, "src", "link");
    const outside = path.join(home, ".ssh", "id_rsa");
    const linked = engine.decide(
      { kind: "edit", path: "src/link" },
      context(root, {
        homeDir: home,
        appData,
        writeScope: ["src/**"],
        realpath: memoryRealpath(new Map([[path.normalize(linkPath), outside]])),
      }),
    );
    expect(linked.effect).toBe("deny");
    if (linked.effect === "deny") expect(linked.reason).toMatch(/symlink/i);

    const traversal = engine.decide({ kind: "edit", path: "../outside.ts" }, ctx());
    expect(traversal.effect).toBe("deny");
    if (traversal.effect === "deny") expect(traversal.reason).toMatch(/escapes the assigned worktree/);
  });

  it("denies a real symlink when the platform can create one", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-symlink-"));
    const target = path.join(os.tmpdir(), `ef-symlink-target-${Date.now()}.txt`);
    fs.writeFileSync(target, "outside");
    const link = path.join(directory, "link.txt");
    try {
      fs.symlinkSync(target, link, "file");
    } catch {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(target, { force: true });
      return;
    }
    try {
      const decision = engine.decide(
        { kind: "read", path: "link.txt" },
        context(directory, { homeDir: home, appData, useSystemRealpath: true }),
      );
      expect(decision.effect).toBe("deny");
      if (decision.effect === "deny") expect(decision.reason).toMatch(/symlink/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(target, { force: true });
    }
  });

  it("denies credential, AppData, and host database reads", () => {
    const ssh = engine.decide({ kind: "read", path: "~/.ssh/id_rsa" }, ctx());
    const claude = engine.decide({ kind: "read", path: path.join(home, ".claude", "config.json") }, ctx());
    const geminiName = ".gemini";
    const gemini = engine.decide({ kind: "read", path: `~/${geminiName}/oauth.json` }, ctx());
    const aws = engine.decide({ kind: "read", path: path.join(home, ".aws", "credentials") }, ctx());
    const gnupg = engine.decide({ kind: "read", path: path.join(home, ".gnupg", "pubring.kbx") }, ctx());
    const codex = engine.decide({ kind: "read", path: path.join(home, ".codex", "auth.json") }, ctx());
    for (const decision of [ssh, claude, gemini, aws, gnupg, codex]) {
      expect(decision.effect).toBe("deny");
      if (decision.effect === "deny") expect(decision.reason).toBe("Credential directories are unreadable");
    }

    const app = engine.decide({ kind: "read", path: path.join(appData, "secret.txt") }, ctx());
    expect(app.effect).toBe("deny");
    if (app.effect === "deny") expect(app.reason).toBe("AppData reads are disabled");

    const stateDb = engine.decide({ kind: "read", path: path.join(path.dirname(root), "state.db") }, ctx());
    const globalDb = engine.decide({ kind: "read", path: path.join(path.dirname(root), "global.db") }, ctx());
    expect(stateDb.effect).toBe("deny");
    expect(globalDb.effect).toBe("deny");
    if (stateDb.effect === "deny") expect(stateDb.reason).toBe("Host database reads are disabled");

    const inside = engine.decide({ kind: "read", path: "src/api/orders.ts" }, ctx());
    expect(inside.effect).toBe("allow");
  });

  it("allows safe read, test, and build commands and denies installs, git, network, and TTY traps", () => {
    expect(engine.decide({ kind: "shell", command: "vitest run" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "shell", command: "pnpm test" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "shell", command: "pnpm exec vitest" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "shell", command: "git status" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "shell", command: "git diff" }, ctx()).effect).toBe("allow");

    const install = engine.decide({ kind: "shell", command: "pnpm add axios" }, ctx());
    expect(install.effect).toBe("deny");
    if (install.effect === "deny") expect(install.reason).toBe(DIRECT_INSTALL_DENY_REASON);
    const npm = engine.decide({ kind: "shell", command: "npm install left-pad" }, ctx());
    expect(npm.effect).toBe("deny");
    if (npm.effect === "deny") expect(npm.reason).toBe(DIRECT_INSTALL_DENY_REASON);

    for (const command of ["git push", "git push --force origin main", "git reset --hard", "git checkout main"]) {
      const decision = engine.decide({ kind: "shell", command }, ctx());
      expect(decision.effect, command).toBe("deny");
      if (decision.effect === "deny") expect(decision.reason).toBe("Destructive git commands are disabled");
    }

    for (const command of [
      "curl https://evil.com",
      "wget http://evil.com",
      "Invoke-WebRequest https://evil.com",
      "powershell -Command Invoke-WebRequest https://evil.com",
    ]) {
      const decision = engine.decide({ kind: "shell", command }, ctx());
      expect(decision.effect, command).toBe("deny");
      if (decision.effect === "deny") expect(decision.reason).toBe("Network exfiltration commands are disabled");
    }

    const mixed = engine.decide({ kind: "shell", command: "git status && curl https://evil.com" }, ctx());
    expect(mixed.effect).toBe("deny");

    expect(engine.decide({ kind: "shell", command: "runas /user:admin cmd" }, ctx()).effect).toBe("deny");
    expect(engine.decide({ kind: "shell", command: "sudo git status" }, ctx()).effect).toBe("deny");
    const tty = engine.decide({ kind: "shell", command: "node -i" }, ctx());
    expect(tty.effect).toBe("deny");
    if (tty.effect === "deny") expect(tty.reason).toBe("Interactive TTY commands are disabled");

    const redirect = engine.decide({ kind: "shell", command: "echo hello" }, ctx());
    expect(redirect.effect).toBe("redirect");
    if (redirect.effect === "redirect") expect(redirect.via).toBe("harness.run");
  });

  it("allows only leased harness MCP tools and denies unproxied web tools", () => {
    expect(engine.decide({ kind: "mcp", tool: "kb.search" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "mcp", tool: "harness.run" }, ctx()).effect).toBe("allow");
    expect(engine.decide({ kind: "mcp", tool: "harness.read_result" }, ctx()).effect).toBe("allow");
    const web = engine.decide({ kind: "web", tool: "web_fetch", url: "https://evil.com" }, ctx());
    expect(web.effect).toBe("deny");
    if (web.effect === "deny") expect(web.reason).toMatch(/allowlist proxy/);
    const browser = engine.decide({ kind: "mcp", tool: "browser.search" }, ctx());
    expect(browser.effect).toBe("deny");
  });

  it("turns native file and shell tools off in stripped mode", () => {
    const stripped = context(root, { homeDir: home, appData, mode: "stripped", writeScope: ["src/**"] });
    expect(engine.decide({ kind: "edit", path: "src/api/orders.ts" }, stripped).effect).toBe("deny");
    expect(engine.decide({ kind: "shell", command: "vitest run" }, stripped).effect).toBe("deny");
    expect(engine.decide({ kind: "mcp", tool: "harness.run" }, stripped).effect).toBe("allow");
  });

  it("decides allow and deny cases in under 2 ms", () => {
    const requests = [
      { kind: "edit" as const, path: "src/api/orders.ts" },
      { kind: "edit" as const, path: "../../.git/hooks/pre-commit" },
      { kind: "edit" as const, path: "../outside.ts" },
      { kind: "write" as const, path: "pnpm-lock.yaml" },
      { kind: "read" as const, path: "~/.ssh/id_rsa" },
      { kind: "read" as const, path: path.join(home, ".claude", "config.json") },
      { kind: "shell" as const, command: "git push" },
      { kind: "shell" as const, command: "pnpm add axios" },
      { kind: "web" as const, tool: "web_fetch", url: "https://evil.com" },
    ];
    const active = ctx();
    for (const request of requests) engine.decide(request, active);
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      for (const request of requests) samples.push(engine.decide(request, active).elapsedMs);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    expect(samples[0]).toBeLessThan(2);
    expect(p95).toBeLessThan(2);
  });
});
