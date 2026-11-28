import { GenericAcpAdapter } from "../acp/adapter.js";
import { ACP_RUNTIME_PROFILES } from "../acp/profiles.js";
import type { AcpLaunchSpec, GenericAcpAdapterPort, GenericAcpSessionPort } from "./ports.js";
import type { CopilotModelDescriptor } from "./types.js";

/**
 * Production ACP fallback. Framing and supervision stay on GenericAcpAdapter.
 */
export class CopilotGenericAcp implements GenericAcpAdapterPort {
  private readonly sessions = new Map<string, LiveCopilotAcp>();
  private nextId = 0;

  async probe(): Promise<{ readonly installed: boolean; readonly version: string; readonly loadSession: boolean }> {
    const probed = await new GenericAcpAdapter({ profile: ACP_RUNTIME_PROFILES["copilot-acp"] }).probe();
    return { installed: probed.installed, version: probed.version, loadSession: true };
  }

  listModels(): Promise<readonly CopilotModelDescriptor[]> {
    return Promise.resolve([]);
  }

  async authStatus(): Promise<{
    readonly signedIn: boolean;
    readonly authExpired: boolean;
    readonly accountLogin: string | null;
  }> {
    const status = await new GenericAcpAdapter({ profile: ACP_RUNTIME_PROFILES["copilot-acp"] }).authStatus();
    return { signedIn: status.signedIn, authExpired: false, accountLogin: null };
  }

  accountGetQuota(): Promise<unknown> {
    return Promise.resolve(null);
  }

  async startSession(spec: AcpLaunchSpec): Promise<GenericAcpSessionPort> {
    const command = spec.argv[0] ?? ACP_RUNTIME_PROFILES["copilot-acp"].command;
    const args = spec.argv.slice(1);
    const adapter = new GenericAcpAdapter({
      profile: { ...ACP_RUNTIME_PROFILES["copilot-acp"], command, args },
    });
    this.nextId += 1;
    const sessionId = `copilot-acp-${this.nextId}`;
    try {
      const opened = await adapter.startSession({
        attemptId: sessionId,
        taskId: sessionId,
        worktreeRoot: spec.cwd,
        writeScope: ["**"],
        cwd: spec.cwd,
        mcpTools: ["kb.*", "harness.run", "harness.read_result"],
      });
      const live: LiveCopilotAcp = { adapter, sessionId, pid: opened.pid };
      this.sessions.set(sessionId, live);
      return new CopilotAcpSession(live);
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
  }

  async loadSession(sessionId: string, spec: AcpLaunchSpec): Promise<GenericAcpSessionPort | null> {
    const live = this.sessions.get(sessionId);
    if (!live) return null;
    const loaded = await live.adapter.resume(sessionId, spec.sessionConfigDir);
    if (!loaded.supported) return null;
    return new CopilotAcpSession(live);
  }
}

interface LiveCopilotAcp {
  readonly adapter: GenericAcpAdapter;
  readonly sessionId: string;
  readonly pid: number | null;
}

class CopilotAcpSession implements GenericAcpSessionPort {
  readonly id: string;
  readonly pid: number | null;
  readonly resumeSupported = false;

  constructor(private readonly live: LiveCopilotAcp) {
    this.id = live.sessionId;
    this.pid = live.pid;
  }

  async prompt(text: string) {
    const result = await this.live.adapter.sendTurn(this.id, text);
    return {
      stopReason: result.stopReason,
      partial: result.cancelled,
      text: "",
      editedPaths: [] as readonly string[],
      metrics: null,
    };
  }

  async steer(note: string): Promise<"mid_turn" | "queued"> {
    await this.live.adapter.steer(this.id, note);
    return "queued";
  }

  cancel(): Promise<void> {
    return this.live.adapter.interrupt(this.id);
  }

  usageUpdate(): Promise<unknown> {
    return this.live.adapter.usage(this.id);
  }
}
