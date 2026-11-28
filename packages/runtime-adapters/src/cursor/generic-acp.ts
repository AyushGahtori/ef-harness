import { GenericAcpAdapter } from "../acp/adapter.js";
import { ACP_RUNTIME_PROFILES } from "../acp/profiles.js";
import type { CursorAcpSessionHandle, CursorAcpSpawnRequest, GenericAcpAdapterPort } from "./ports.js";
import type { CursorRunResult } from "./types.js";

/**
 * Cursor ACP fallback. Framing and supervision stay on GenericAcpAdapter.
 */
export class CursorGenericAcp implements GenericAcpAdapterPort {
  async probe(): Promise<{ readonly installed: boolean; readonly version: string; readonly loadSession: boolean }> {
    const probed = await new GenericAcpAdapter({ profile: ACP_RUNTIME_PROFILES["cursor-acp"] }).probe();
    return { installed: probed.installed, version: probed.version, loadSession: true };
  }

  async start(request: CursorAcpSpawnRequest): Promise<CursorAcpSessionHandle> {
    const adapter = new GenericAcpAdapter({
      profile: {
        ...ACP_RUNTIME_PROFILES["cursor-acp"],
        command: request.command,
        args: request.args,
      },
    });
    const opened = await adapter.startSession({
      attemptId: "cursor-acp",
      taskId: "cursor-acp",
      worktreeRoot: request.cwd,
      cwd: request.cwd,
      writeScope: ["**"],
      env: request.env,
      mcpTools: ["kb.*", "harness.run", "harness.read_result"],
    });
    return {
      sessionId: opened.agentSessionId || opened.sessionId,
      pid: opened.pid,
      childPids: [opened.pid],
      argv: [request.command, ...request.args],
      prompt: async (prompt) => {
        const turn = await adapter.sendTurn(opened.sessionId, prompt);
        const usage = await adapter.usage(opened.sessionId);
        const result: CursorRunResult = {
          httpStatus: 200,
          events: [],
          usage,
          agentUsage: null,
        };
        void turn;
        return result;
      },
      steer: async (note) => {
        await adapter.steer(opened.sessionId, note);
      },
      cancel: () => adapter.interrupt(opened.sessionId),
      load: async () => {
        const loaded = await adapter.resume(opened.sessionId, opened.sessionId);
        return { supported: loaded.supported };
      },
      dispose: () => adapter.dispose(),
    };
  }
}
