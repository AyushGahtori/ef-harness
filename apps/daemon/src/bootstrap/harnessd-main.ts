import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarnessDaemon, type HarnessdOptions } from "./daemon-server.js";
import { defaultPipePath, defaultProfileDir } from "./paths.js";
import { installShutdownSignals } from "./signals.js";

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): HarnessdOptions {
  return {
    profileDir: defaultProfileDir(env),
    pipePath: defaultPipePath(env),
    daemonVersion: text(env.EF_HARNESS_DAEMON_VERSION, "0.0.0"),
    sandboxTier: text(env.EF_HARNESS_SANDBOX_TIER, "C"),
    idleMs: numberEnv(env.EF_HARNESS_IDLE_MS, 60_000),
    handshakeMs: numberEnv(env.EF_HARNESS_HANDSHAKE_MS, 5_000),
    simTask: env.EF_HARNESS_SIM_TASK === "1",
    simStepMs: numberEnv(env.EF_HARNESS_SIM_STEP_MS, 50),
    diffNote: text(env.EF_HARNESS_DIFF_NOTE, "worker note: grouped print rows"),
    largeDiffBytes: numberEnv(env.EF_HARNESS_LARGE_DIFF_BYTES, 0),
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const daemon = createHarnessDaemon(optionsFromEnv(env));
  installShutdownSignals(daemon);
  await daemon.start();
}

function text(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function harnessdEntryPath(): string {
  return fileURLToPath(import.meta.url);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry.length > 0 && (entry === harnessdEntryPath() || /harnessd-main\.(ts|js)$/.test(entry))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "harnessd failed";
    const profile = defaultProfileDir();
    fs.mkdirSync(profile, { recursive: true });
    fs.appendFileSync(path.join(profile, "harnessd-fatal.log"), `${message}\n`);
    process.exitCode = 1;
  });
}
