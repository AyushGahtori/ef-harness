import type { CliAuthProbe, CliAuthSnapshot, CliToolAuth, CommandResult, CommandRunner } from "./types.js";

const OFFICIAL_CLI_COMMANDS = new Set([
  "gh --version",
  "gh auth status",
  "gh auth token",
  "copilot --version",
  "copilot auth status",
  "copilot auth token",
]);

export function assertOfficialCliArgv(argv: readonly string[]): void {
  if (!OFFICIAL_CLI_COMMANDS.has(argv.join(" "))) {
    throw new Error("Refusing a CLI command that is not an official read-only auth probe");
  }
}

const ABSENT: CliToolAuth = {
  installed: false,
  version: null,
  authenticated: false,
  login: null,
  token: null,
};

/**
 * Read-only `gh` / `copilot` status probe.
 * Commands are an allowlist of `--version` plus `auth status` / `auth token`.
 * Config files are never opened.
 */
export class OfficialCliAuthProbe implements CliAuthProbe {
  constructor(private readonly runner: CommandRunner) {}

  async probe(): Promise<CliAuthSnapshot> {
    const gh = await this.probeTool("gh");
    const copilot = await this.probeTool("copilot");
    return { gh, copilot };
  }

  private async probeTool(tool: "gh" | "copilot"): Promise<CliToolAuth> {
    const versionResult = await this.run([tool, "--version"]);
    if (versionResult.exitCode !== 0) return ABSENT;
    const version = firstLine(versionResult.stdout);
    if (!version) return ABSENT;
    const status = await this.run([tool, "auth", "status"]);
    const login = tool === "gh" ? parseGhLogin(status.stdout) : parseCopilotLogin(status.stdout);
    if (status.exitCode !== 0 || !login) {
      return { installed: true, version, authenticated: false, login: null, token: null };
    }
    const tokenResult = await this.run([tool, "auth", "token"]);
    const token = tokenResult.exitCode === 0 ? parseToken(tokenResult.stdout) : null;
    if (!token) {
      return { installed: true, version, authenticated: false, login, token: null };
    }
    return { installed: true, version, authenticated: true, login, token };
  }

  private async run(argv: readonly string[]): Promise<CommandResult> {
    assertOfficialCliArgv(argv);
    return this.runner.run(argv);
  }
}

function parseGhLogin(stdout: string): string | null {
  const match = /Logged in to github\.com account ([A-Za-z0-9-]+)/.exec(stdout);
  return match?.[1] ?? null;
}

function parseCopilotLogin(stdout: string): string | null {
  const match = /Logged in as ([A-Za-z0-9-]+)/.exec(stdout);
  return match?.[1] ?? null;
}

function parseToken(stdout: string): string | null {
  const line = firstLine(stdout);
  if (!line || line.length < 12) return null;
  return line;
}

function firstLine(stdout: string): string | null {
  const line = stdout.split(/\r?\n/).find((item) => item.trim().length > 0);
  return line?.trim() ?? null;
}
