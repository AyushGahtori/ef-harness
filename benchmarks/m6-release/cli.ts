import path from "node:path";
import { fileURLToPath } from "node:url";
import { V1ReleaseCertificationRunner } from "./src/index.ts";
import type { CertificationProfile } from "./src/types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function take(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

function parse(argv: readonly string[]): {
  profile: CertificationProfile;
  outDir: string;
  inject: string[];
  unsignedDev: boolean;
} {
  let profile: CertificationProfile = "ci-replay";
  let outDir = "";
  const inject: string[] = [];
  let unsignedDev = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      const value = take(argv, index, "--profile");
      index += 1;
      if (value !== "ci-replay" && value !== "full-release-certification") fail(`unknown profile ${value}`);
      profile = value;
    } else if (arg === "--out") {
      outDir = take(argv, index, "--out");
      index += 1;
    } else if (arg === "--inject") {
      inject.push(take(argv, index, "--inject"));
      index += 1;
    } else if (arg === "--unsigned-dev") {
      unsignedDev = true;
    } else {
      fail(`unknown argument ${arg ?? ""}`);
    }
  }
  if (!outDir) fail("--out is required");
  return { profile, outDir, inject, unsignedDev };
}

const options = parse(process.argv.slice(2));
const scorecard = new V1ReleaseCertificationRunner({
  profile: options.profile,
  repoRoot,
  outDir: path.resolve(options.outDir),
  inject: options.inject,
  unsignedDev: options.unsignedDev,
}).run();

if (scorecard.decision === "GO") {
  console.log(
    `GO scope=${scorecard.decisionScope} liveSignOff=${scorecard.liveSignOff} productionCertificationClaimed=${scorecard.productionCertificationClaimed}`,
  );
} else {
  console.error(`NO-GO ${scorecard.failingGateIds.join(",")}`);
  process.exitCode = 1;
}
