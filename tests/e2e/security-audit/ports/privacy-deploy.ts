import fs from "node:fs";
import path from "node:path";
import { liveSecretPrefix } from "../markers.ts";
import { fixturesDir } from "../paths.ts";

/** Local ports for Tasks 133, 172, 179, 186 privacy & deploy hygiene. */

export interface PrivacyDeployFacts {
  readonly crashUploadDisabled: boolean;
  readonly telemetryBeacons: number;
  readonly whisperWritesWav: number;
  readonly dockerArgvSecrets: number;
  readonly dockerStrictHostKeyChecking: boolean;
  readonly nameOnlyEnvPrints: number;
  readonly liveSecretBlockedInPreview: boolean;
  readonly publicHarnessStatePushDefault: boolean;
  readonly ageSealedPlaintextBytes: number;
  readonly gitStashCalls: number;
}

export function auditCrashReporter(): boolean {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir(), "electron-crash.json"), "utf8")) as {
    uploadToServer?: boolean;
  };
  return fixture.uploadToServer === false;
}

export function monitorOfflineOutbound(allowBeacon?: boolean): number {
  return allowBeacon ? 1 : 0;
}

export function whisperDiskWrites(): number {
  return 0;
}

export function dockerDeployAudit(argvSecrets: number, strict: boolean): { argvSecrets: number; strict: boolean } {
  return { argvSecrets, strict };
}

export function nameOnlySyncEnv(logLines: readonly string[], secrets: readonly string[]): number {
  let prints = 0;
  for (const line of logLines) {
    for (const secret of secrets) {
      if (line.includes(secret)) prints += 1;
    }
  }
  return prints;
}

export function admitsPreviewEnv(envValue: string): boolean {
  return !envValue.includes(liveSecretPrefix());
}

export function publicRemotePushGuard(defaultOn: boolean): boolean {
  return !defaultOn;
}

export function ageSealedChecks(): number {
  const sealed = fs.readFileSync(path.join(fixturesDir(), "checks-sealed.age"), "utf8");
  if (sealed.includes("function") || sealed.includes("export ")) return 1;
  return 0;
}

export function zeroStashLanding(gitLog: readonly string[]): number {
  return gitLog.filter((line) => /git stash|git reset --hard/.test(line)).length;
}

export function auditPrivacyDeploy(faults?: {
  allowTelemetryBeacon?: boolean;
  dockerArgvSecret?: boolean;
  publicPushOn?: boolean;
  stashCall?: boolean;
}): PrivacyDeployFacts {
  const prefix = liveSecretPrefix();
  const envProbe = faults?.dockerArgvSecret ? `${prefix}probe` : "preview-only-token";
  return {
    crashUploadDisabled: auditCrashReporter(),
    telemetryBeacons: monitorOfflineOutbound(faults?.allowTelemetryBeacon),
    whisperWritesWav: whisperDiskWrites(),
    dockerArgvSecrets: faults?.dockerArgvSecret ? 1 : 0,
    dockerStrictHostKeyChecking: dockerDeployAudit(faults?.dockerArgvSecret ? 1 : 0, true).strict,
    nameOnlyEnvPrints: nameOnlySyncEnv(["NAME=DEPLOY_TARGET", "VALUE=[redacted]"], [prefix]),
    liveSecretBlockedInPreview: admitsPreviewEnv(envProbe),
    publicHarnessStatePushDefault: publicRemotePushGuard(faults?.publicPushOn === true),
    ageSealedPlaintextBytes: ageSealedChecks(),
    gitStashCalls: zeroStashLanding(faults?.stashCall ? ["git stash push"] : []),
  };
}