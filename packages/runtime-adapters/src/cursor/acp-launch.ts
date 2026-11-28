import { CursorAdapterError } from "./errors.js";
import type { CursorRuntimeDeps, OpenCursorAgent } from "./ports.js";
import type { BeforeShellInput, CursorLocalSandboxOptions, HookDecision, PreToolUseInput } from "./types.js";

export async function openCursorAcp(
  deps: CursorRuntimeDeps,
  input: {
    readonly apiKey: string;
    readonly worktree: string;
    readonly configDir: string;
    readonly proxyUrl: string;
    readonly sandboxOptions: CursorLocalSandboxOptions;
    readonly hooks: {
      readonly preToolUse: (hookInput: PreToolUseInput) => HookDecision;
      readonly beforeShellExecution: (hookInput: BeforeShellInput) => HookDecision;
    };
  },
): Promise<OpenCursorAgent> {
  const handle = await deps.acp.start({
    command: "cursor-agent",
    args: ["acp"],
    cwd: input.worktree,
    env: {
      HTTP_PROXY: input.proxyUrl,
      HTTPS_PROXY: input.proxyUrl,
      NO_PROXY: "127.0.0.1,localhost",
      CURSOR_CONFIG_DIR: input.configDir,
      CURSOR_API_KEY: input.apiKey,
    },
    sandboxOptions: input.sandboxOptions,
    hooks: input.hooks,
  });
  if (handle.argv.some((arg) => arg.includes(input.apiKey))) {
    throw new CursorAdapterError("credential_in_argv", "The Cursor key was passed in process argv");
  }
  return {
    vendorId: handle.sessionId,
    pid: handle.pid,
    childPids: handle.childPids,
    argv: handle.argv,
    send: (prompt, signal) => handle.prompt(prompt, signal),
    steer: (note) => handle.steer(note),
    abort: () => handle.cancel(),
    resume: (agentHandle) => handle.load(agentHandle),
    dispose: () => handle.dispose(),
  };
}
