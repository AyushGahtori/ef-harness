import { commandMissingDiagnosis } from "./diagnosis.js";
import type { CommandRunner, ProbeLogger } from "./ports.js";
import { formatSemver, parseSemver, semverGte } from "./semver.js";
import { PROBE_TIMEOUT_DIAGNOSIS, type CliToolName, type ProbeResult } from "./types.js";

export interface CliToolProfile {
  readonly versionArgs: readonly string[];
  readonly authArgs?: readonly string[];
  readonly versionOnStderr?: boolean;
}

export const CLI_CATALOG: Record<CliToolName, CliToolProfile> = {
  git: { versionArgs: ["--version"] },
  gh: { versionArgs: ["--version"], authArgs: ["auth", "status"] },
  node: { versionArgs: ["--version"] },
  pnpm: { versionArgs: ["--version"] },
  vercel: { versionArgs: ["--version"], authArgs: ["whoami"] },
  ssh: { versionArgs: ["-V"], versionOnStderr: true },
  codex: { versionArgs: ["--version"], authArgs: ["login", "status"] },
  claude: { versionArgs: ["--version"], authArgs: ["auth", "status"] },
  copilot: { versionArgs: ["--version"] },
  cursor: { versionArgs: ["--version"] },
  opencode: { versionArgs: ["--version"], authArgs: ["auth", "status"] },
};

export async function probeCliTool(input: {
  readonly tool: CliToolName;
  readonly minimumVersion?: string;
  readonly checkAuth?: boolean;
  readonly runner: CommandRunner;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly logger: ProbeLogger;
}): Promise<ProbeResult> {
  const started = input.now();
  const profile = CLI_CATALOG[input.tool];
  input.logger.write("cli_probe", { tool: input.tool, readOnly: true });
  const version = await input.runner.run({
    file: input.tool,
    args: profile.versionArgs,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  if (version.timedOut || version.errorCode === "TIMEOUT" || version.errorCode === "ABORTED") {
    return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, { tool: input.tool, readOnly: true });
  }
  if (version.errorCode === "ENOENT" || version.exitCode === null) {
    return done(input.now, started, "fail", "NOT_INSTALLED", commandMissingDiagnosis(input.tool), {
      tool: input.tool,
      readOnly: true,
    });
  }
  const versionText = profile.versionOnStderr ? `${version.stderr}\n${version.stdout}` : version.stdout;
  const actual = parseSemver(versionText);
  if (!actual) {
    return done(input.now, started, "fail", "VERSION_UNPARSEABLE", `${input.tool} did not report a semver version`, {
      tool: input.tool,
      readOnly: true,
    });
  }
  if (input.minimumVersion) {
    const minimum = parseSemver(input.minimumVersion);
    if (!minimum) {
      return done(input.now, started, "fail", "BAD_MINIMUM", `${input.tool} minimum version is not semver`, {
        tool: input.tool,
        readOnly: true,
      });
    }
    if (!semverGte(actual, minimum)) {
      return done(
        input.now,
        started,
        "fail",
        "BELOW_MINIMUM",
        `${input.tool} ${formatSemver(minimum)} is required and ${formatSemver(actual)} is installed — upgrade ${input.tool} and click Check again`,
        { tool: input.tool, version: formatSemver(actual), readOnly: true },
      );
    }
  }
  const shouldAuth = input.checkAuth !== false && profile.authArgs !== undefined;
  if (!shouldAuth || !profile.authArgs) {
    return done(input.now, started, "pass", "PASS", `${input.tool} ${formatSemver(actual)} is available`, {
      tool: input.tool,
      version: formatSemver(actual),
      auth: "not_applicable",
      readOnly: true,
    });
  }
  const auth = await input.runner.run({
    file: input.tool,
    args: profile.authArgs,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  if (auth.timedOut || auth.errorCode === "TIMEOUT" || auth.errorCode === "ABORTED") {
    return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, { tool: input.tool, readOnly: true });
  }
  if (auth.exitCode !== 0) {
    const login = input.tool === "gh" ? "gh auth login" : `${input.tool} login`;
    return done(
      input.now,
      started,
      "fail",
      "NOT_AUTHENTICATED",
      `${input.tool} is installed but not logged in — run ${login} and click Check again`,
      { tool: input.tool, version: formatSemver(actual), readOnly: true },
    );
  }
  return done(input.now, started, "pass", "AUTHENTICATED", `${input.tool} ${formatSemver(actual)} is installed and authenticated`, {
    tool: input.tool,
    version: formatSemver(actual),
    auth: "ok",
    readOnly: true,
  });
}

function done(
  now: () => number,
  started: number,
  outcome: ProbeResult["outcome"],
  code: string,
  diagnosis: string,
  evidence: Record<string, string | number | boolean>,
): ProbeResult {
  return { outcome, code, diagnosis, durationMs: Math.max(0, now() - started), checkedAt: now(), evidence };
}
