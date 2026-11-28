import { spawnSync } from "node:child_process";
import { commandForBinary } from "./spawn.js";
import {
  DEFAULT_OPENCODE_MIN_VERSION,
  type CliVersionPolicy,
  type CommandResult,
  type CommandRunner,
  type VersionProbe,
} from "./types.js";

export function compareSemver(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function parseSemver(text: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

export function defaultCommandRunner(): CommandRunner {
  return {
    run(binaryPath: string, args: readonly string[]): CommandResult {
      const invoked = commandForBinary(binaryPath, args);
      const result = spawnSync(invoked.command, invoked.args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        shell: false,
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

/**
 * Local stand-in for Task 135 `CliMinVersionGate`.
 * Passing this gate is the precondition for registering OpenCode as
 * `conformance_verified`. Task 151 still owns the 10-probe suite.
 */
export function probeOpenCodeBinary(
  binaryPath: string,
  policy: CliVersionPolicy = { minVersion: DEFAULT_OPENCODE_MIN_VERSION, denylist: [] },
  runner: CommandRunner = defaultCommandRunner(),
): VersionProbe {
  const versionRun = runner.run(binaryPath, ["--version"]);
  const versionText = `${versionRun.stdout}\n${versionRun.stderr}`;
  const version = versionRun.status === 0 ? parseSemver(versionText) : null;
  if (versionRun.status !== 0 || !version) {
    return {
      installed: false,
      version: null,
      supportsAcp: false,
      trust: "disabled",
      message: "opencode binary was not found or did not print a version",
    };
  }
  const help = runner.run(binaryPath, ["acp", "--help"]);
  const helpText = `${help.stdout}\n${help.stderr}`;
  const supportsAcp = help.status === 0 && /acp/i.test(helpText);
  if (!supportsAcp) {
    return {
      installed: true,
      version,
      supportsAcp: false,
      trust: "disabled",
      message: "opencode does not support the acp subcommand",
    };
  }
  if (policy.denylist.includes(version)) {
    return {
      installed: true,
      version,
      supportsAcp: true,
      trust: "disabled",
      message: `opencode ${version} is denylisted`,
    };
  }
  if (compareSemver(version, policy.minVersion) < 0) {
    return {
      installed: true,
      version,
      supportsAcp: true,
      trust: "disabled",
      message: `Update opencode to >= ${policy.minVersion}`,
    };
  }
  return {
    installed: true,
    version,
    supportsAcp: true,
    trust: "conformance_verified",
    message: `opencode ${version} passed the minimum version gate`,
  };
}
