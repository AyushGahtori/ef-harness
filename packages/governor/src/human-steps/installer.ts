import { HumanStepError } from "./errors.js";
import type { ProbeRecheck, WindowsJobSupervisor } from "./ports.js";
import {
  CONSENT_PROMPT,
  GH_AUTH_LOGIN_COMMAND,
  PLAYWRIGHT_INSTALL_COMMAND,
  type ConsentApproval,
  type ConsentCard,
  type HumanStepRecord,
  type InstallArgv,
  type TerminalEvent,
} from "./types.js";

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SAFE_FILE = /^(npx|npx\.cmd|gh|winget|choco|npm|npm\.cmd|node|node\.exe)$/i;
const SAFE_ARG = /^[A-Za-z0-9@._:=+/-]+$/;

export interface InstallerRunResult {
  readonly disposition: "completed" | "cancelled" | "failed";
  readonly exitCode: number | null;
  readonly reprobed: boolean;
}

export interface InstallerSession {
  readonly finished: Promise<InstallerRunResult>;
  cancel(): void;
}

/**
 * Shows the exact command and runs it only after an explicit approval click.
 * Output is streamed. Cancel terminates the supervised process tree.
 * Exit 0 immediately runs the matching probe again.
 */
export class ConsentedTerminalInstaller {
  constructor(
    private readonly supervisor: WindowsJobSupervisor,
    private readonly recheck: ProbeRecheck,
  ) {}

  propose(step: HumanStepRecord): ConsentCard {
    const command = commandFor(step);
    return {
      stepId: step.stepId,
      title: step.title,
      prompt: CONSENT_PROMPT,
      exactCommand: command.exactCommand,
      file: command.file,
      args: command.args,
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    };
  }

  start(card: ConsentCard, approval: ConsentApproval, onEvent: (event: TerminalEvent) => void): InstallerSession {
    if (approval.approved !== true || approval.exactCommand !== card.exactCommand) {
      throw new HumanStepError("consent_required", "Run this command only after the exact command is approved");
    }
    const controller = new AbortController();
    const finished = this.execute(card, controller.signal, onEvent);
    return {
      finished,
      cancel(): void {
        controller.abort();
      },
    };
  }

  private async execute(
    card: ConsentCard,
    signal: AbortSignal,
    onEvent: (event: TerminalEvent) => void,
  ): Promise<InstallerRunResult> {
    onEvent({ type: "started", stepId: card.stepId, text: card.exactCommand });
    const result = await this.supervisor.runCommand({
      file: card.file,
      args: card.args,
      ...(card.cwd === undefined ? {} : { cwd: card.cwd }),
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onOutput: (chunk) => {
        onEvent({ type: "output", stepId: card.stepId, stream: chunk.stream, text: chunk.text });
      },
    });
    if (result.reason === "terminated" || signal.aborted) {
      onEvent({ type: "cancelled", stepId: card.stepId, exitCode: null });
      return { disposition: "cancelled", exitCode: null, reprobed: false };
    }
    onEvent({ type: "exit", stepId: card.stepId, exitCode: result.exitCode });
    if (result.exitCode === 0) {
      await this.recheck.checkAgain(card.stepId);
      return { disposition: "completed", exitCode: 0, reprobed: true };
    }
    return { disposition: "failed", exitCode: result.exitCode, reprobed: false };
  }
}

function commandFor(step: HumanStepRecord): {
  readonly file: string;
  readonly args: readonly string[];
  readonly exactCommand: string;
  readonly cwd?: string;
} {
  if (step.probeSpec.kind === "playwright") {
    return {
      file: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["playwright", "install", "chromium"],
      exactCommand: PLAYWRIGHT_INSTALL_COMMAND,
      cwd: step.probeSpec.projectRoot,
    };
  }
  if (step.probeSpec.kind === "cli_tool" && step.probeSpec.install) {
    return accepted(step.probeSpec.install);
  }
  if (step.probeSpec.kind === "cli_tool" && step.probeSpec.tool === "gh") {
    return { file: "gh", args: ["auth", "login"], exactCommand: GH_AUTH_LOGIN_COMMAND };
  }
  throw new HumanStepError("no_install_command", "This step has no consented install command");
}

function accepted(install: InstallArgv): { readonly file: string; readonly args: readonly string[]; readonly exactCommand: string } {
  if (!SAFE_FILE.test(install.file)) {
    throw new HumanStepError("install_command", "That installer is not in the consented allow list");
  }
  if (install.args.some((arg) => !SAFE_ARG.test(arg))) {
    throw new HumanStepError("install_command", "Install arguments must be plain tokens with no shell syntax");
  }
  return { file: install.file, args: install.args, exactCommand: [install.file, ...install.args].join(" ") };
}
