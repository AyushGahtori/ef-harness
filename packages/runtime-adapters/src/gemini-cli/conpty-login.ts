import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { LocalGenericAcpAdapter } from "./acp-engine.js";
import { GeminiOptInComplianceGate } from "./opt-in-gate.js";
import { buildIsolatedEnv, GeminiHomeGuard } from "./home-guard.js";
import { LocalHarnessRunRecorder, LocalJobObject, LocalLoopbackAllowlistProxy } from "./ports.js";
import { nodeProcessSpawner, terminatePidTree, type ProcessSpawner } from "./process-util.js";
import { LocalSupervisionPolicyEngine } from "./supervision.js";

export interface VisibleLoginSession {
  readonly visible: true;
  readonly pane: "settings-connections";
  readonly pid: number | null;
  readonly windowsHide: false;
  readonly geminiCliHome: string;
  output(): string;
  onData(listener: (chunk: string) => void): void;
  cancel(): Promise<void>;
  exited(): boolean;
}

/**
 * Visible interactive login. The user sees every official prompt.
 * Credentials stay inside the isolated GEMINI_CLI_HOME; nothing is scraped.
 */
export class GeminiVisibleConPtyLoginHelper {
  private readonly spawner: ProcessSpawner;
  private readonly guard: GeminiHomeGuard;
  private readonly command: string;
  private readonly argsPrefix: readonly string[];
  private readonly loginArgs: readonly string[];
  private readonly loginEnv: Readonly<Record<string, string>>;
  private isolatedHome: string | null = null;

  constructor(
    private readonly gate: GeminiOptInComplianceGate,
    private readonly worktree: string,
    deps?: {
      readonly spawner?: ProcessSpawner;
      readonly guard?: GeminiHomeGuard;
      readonly command?: string;
      readonly argsPrefix?: readonly string[];
      readonly loginArgs?: readonly string[];
      readonly loginEnv?: Readonly<Record<string, string>>;
    },
  ) {
    this.spawner = deps?.spawner ?? nodeProcessSpawner;
    this.guard = deps?.guard ?? new GeminiHomeGuard();
    this.command = deps?.command ?? "gemini";
    this.argsPrefix = deps?.argsPrefix ?? [];
    this.loginArgs = deps?.loginArgs ?? [];
    this.loginEnv = deps?.loginEnv ?? {};
  }

  get homeDirectory(): string | null {
    return this.isolatedHome;
  }

  async open(): Promise<VisibleLoginSession> {
    this.gate.assertCanStart();
    const home = path.join(this.worktree, ".ef-gemini-home");
    this.guard.inspect(home, "login-home");
    fs.mkdirSync(home, { recursive: true });
    this.isolatedHome = home;
    const proxy = new LocalLoopbackAllowlistProxy();
    const env = buildIsolatedEnv({
      parent: process.env,
      geminiCliHome: home,
      apiKey: null,
      extra: this.loginEnv,
      loopbackProxy: proxy.endpoint(),
      guard: this.guard,
    });
    const job = new LocalJobObject();
    const child = this.spawner({
      command: this.command,
      args: [...this.argsPrefix, ...this.loginArgs],
      cwd: this.worktree,
      env,
      windowsHide: false,
    });
    job.attach(child);
    return new LoginSession(child, job, home);
  }

  /**
   * Non-destructive auth check: `gemini --acp` initialize only.
   * Credential files are never opened.
   */
  async verifyAuthStatus(): Promise<{
    readonly ok: boolean;
    readonly method: "acp_initialize";
    readonly readsCredentialDirectory: false;
  }> {
    this.gate.assertCanStart();
    const home = this.isolatedHome ?? path.join(this.worktree, ".ef-gemini-home");
    this.guard.inspect(home, "probe-home");
    const proxy = new LocalLoopbackAllowlistProxy();
    const env = buildIsolatedEnv({
      parent: process.env,
      geminiCliHome: home,
      apiKey: null,
      extra: this.loginEnv,
      loopbackProxy: proxy.endpoint(),
      guard: this.guard,
    });
    const job = new LocalJobObject();
    const engine = new LocalGenericAcpAdapter(
      this.spawner,
      new LocalSupervisionPolicyEngine(new LocalHarnessRunRecorder()),
      job,
    );
    try {
      await engine.start({
        command: this.command,
        args: [...this.argsPrefix, "--acp"],
        cwd: this.worktree,
        env,
        windowsHide: true,
      });
      const result = await engine.initialize();
      return {
        ok: result.protocolVersion !== undefined,
        method: "acp_initialize",
        readsCredentialDirectory: false,
      };
    } finally {
      await engine.close();
    }
  }
}

class LoginSession implements VisibleLoginSession {
  readonly visible = true as const;
  readonly pane = "settings-connections" as const;
  readonly windowsHide = false as const;
  private text = "";
  private done = false;
  private readonly listeners = new Set<(chunk: string) => void>();

  constructor(
    private readonly child: ChildProcess,
    private readonly job: LocalJobObject,
    readonly geminiCliHome: string,
  ) {
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    const take = (chunk: string): void => {
      this.text += chunk;
      for (const listener of this.listeners) listener(chunk);
    };
    this.child.stdout?.on("data", take);
    this.child.stderr?.on("data", take);
    this.child.on("exit", () => {
      this.done = true;
    });
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  output(): string {
    return this.text;
  }

  onData(listener: (chunk: string) => void): void {
    this.listeners.add(listener);
  }

  exited(): boolean {
    return this.done;
  }

  async cancel(): Promise<void> {
    const pid = this.child.pid;
    this.child.kill("SIGKILL");
    if (pid !== undefined) await terminatePidTree(pid);
    await this.job.terminate();
    await new Promise<void>((resolve) => {
      if (this.done) {
        resolve();
        return;
      }
      const timer = setTimeout(() => resolve(), 1_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
