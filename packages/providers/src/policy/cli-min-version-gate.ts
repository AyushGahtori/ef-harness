import { bumpPatch, compareSemVer, displayVersion, parseSemVer, semverInInclusiveRange } from "./semver.js";
import type { CliFloor, CliGateDecision, CliRuntime } from "./types.js";
import { CLI_RUNTIMES } from "./types.js";

const DISPLAY_NAMES: Record<CliRuntime, string> = {
  codex: "Codex",
  claude: "Claude",
  copilot: "Copilot",
  "cursor-agent": "Cursor Agent",
  opencode: "OpenCode",
  gemini: "Gemini",
};

export class CliMinVersionGate {
  private readonly floors: ReadonlyMap<CliRuntime, CliFloor>;

  constructor(floors: readonly CliFloor[]) {
    this.floors = new Map(floors.map((floor) => [floor.runtime, floor]));
  }

  evaluate(runtime: string, installedVersion: string): CliGateDecision {
    if (!isCliRuntime(runtime)) {
      return decision(runtime, installedVersion, "disabled", false, "unknown_runtime", "", "");
    }
    const floor = this.floors.get(runtime);
    const display = DISPLAY_NAMES[runtime];
    if (!floor) {
      const title = `Update ${display} to >= v0.0.0`;
      return decision(
        runtime,
        installedVersion,
        "disabled",
        false,
        "missing_floor",
        title,
        `${display} has no signed minimum version — Update CLI to enable`,
      );
    }
    const installed = parseSemVer(installedVersion);
    const minimum = parseSemVer(floor.minVersion);
    const shown = displayVersion(installedVersion);
    if (!installed || !minimum) {
      const title = `Update ${display} to >= v${floor.minVersion}`;
      return decision(
        runtime,
        installedVersion,
        "disabled",
        false,
        "unparseable",
        title,
        `${display} CLI ${shown} is not a recognized version — Update CLI to enable`,
      );
    }

    if (installed) {
      for (const range of floor.denylist) {
        const from = parseSemVer(range.from);
        const to = parseSemVer(range.to);
        if (!from || !to) continue;
        if (!semverInInclusiveRange(installed, from, to)) continue;
        const pastRange = bumpPatch(range.to);
        const pastParsed = parseSemVer(pastRange);
        const target =
          pastParsed && compareSemVer(pastParsed, minimum) < 0 ? floor.minVersion : pastRange;
        const title = `Update ${display} to >= v${target}`;
        return decision(
          runtime,
          installedVersion,
          range.effect,
          false,
          "denylisted",
          title,
          `${display} CLI ${shown} is denylisted (${range.reason}) — Update CLI to enable`,
        );
      }
    }

    if (compareSemVer(installed, minimum) < 0) {
      const title = `Update ${display} to >= v${floor.minVersion}`;
      return decision(
        runtime,
        installedVersion,
        "disabled",
        false,
        "below_minimum",
        title,
        `${display} CLI ${shown} is below minimum safe version ${floor.minVersion} — Update CLI to enable`,
      );
    }

    return decision(runtime, installedVersion, "allowed", true, "ok", "", "");
  }
}

function isCliRuntime(value: string): value is CliRuntime {
  return (CLI_RUNTIMES as readonly string[]).includes(value);
}

function decision(
  runtime: string,
  installedVersion: string,
  status: CliGateDecision["status"],
  launchCodingTasks: boolean,
  reason: CliGateDecision["reason"],
  title: string,
  card: string,
): CliGateDecision {
  return { runtime, installedVersion, status, launchCodingTasks, reason, title, card };
}
