import { POSTINSTALL_FIXTURE } from "./fixtures.js";
import type { DefenseLayerResult } from "./types.js";

export interface InstallFixtureInput {
  readonly packageName: string;
  readonly script: string;
  readonly ignoreScripts: boolean;
  readonly allowBuilds: readonly string[];
  readonly onUnguarded: () => Promise<void>;
}

export interface InstallFixtureResult {
  readonly executed: boolean;
  readonly layers: readonly DefenseLayerResult[];
}

export async function installClosedFixture(input: InstallFixtureInput): Promise<InstallFixtureResult> {
  if (input.script !== POSTINSTALL_FIXTURE) {
    throw new Error("closed fixture rejected an unrecognized install script");
  }
  const listed = input.allowBuilds.includes(input.packageName);
  const scriptsBlocked = input.ignoreScripts && !listed;
  const executed = !scriptsBlocked;
  if (executed) await input.onUnguarded();
  return {
    executed,
    layers: [
      { id: "kernel-package-installer", triggered: true, blocked: !executed },
      { id: "pnpm-ignore-scripts", triggered: true, blocked: input.ignoreScripts && !executed },
      { id: "allowBuilds-allowlist", triggered: true, blocked: !listed && !executed },
    ],
  };
}
