import fs from "node:fs";
import path from "node:path";
import { RED_TEAM_VECTORS, type ReplayMatrix } from "./replay-matrix.ts";
import { shipPolicySelfCheck } from "./ship-port.ts";
import type {
  BrokerTrace,
  ChaosTrace,
  CheckResult,
  EvidenceClass,
  GateResult,
  GateVerdict,
  LinuxCaseRepairTrace,
  MilestoneVerdict,
  PortabilityTrace,
  ShipTrace,
  SuiteRollup,
} from "./types.ts";
import type { IntegrationScan } from "./integration-closure.ts";

export interface GateInput {
  readonly matrix: ReplayMatrix;
  readonly repoRoot: string;
  readonly linux: LinuxCaseRepairTrace;
  readonly ship: ShipTrace;
  readonly portability: PortabilityTrace;
  readonly broker: BrokerTrace;
  readonly chaos: ChaosTrace;
  readonly foundation: readonly CheckResult[];
  readonly integration: IntegrationScan;
  readonly profile: "ci-replay" | "full-release-certification";
  readonly unsignedDev: boolean;
  readonly hygiene: {
    readonly leakedPids: number;
    readonly unexpectedLeftovers: number;
    readonly tempRemoved: boolean;
  };
}

function check(
  id: string,
  pass: boolean,
  evidenceClass: EvidenceClass,
  observed: string,
  expected: string,
): CheckResult {
  return { id, verdict: pass ? "PASS" : "FAIL", evidenceClass, observed, expected };
}

function withheld(id: string, evidenceClass: EvidenceClass, observed: string, expected: string): CheckResult {
  return { id, verdict: "WITHHELD", evidenceClass, observed, expected };
}

function rollup(checks: readonly CheckResult[]): GateVerdict {
  if (checks.some((item) => item.verdict === "FAIL")) return "FAIL";
  if (checks.some((item) => item.verdict === "WITHHELD")) return "WITHHELD";
  return "PASS";
}

function evidenceOf(checks: readonly CheckResult[]): EvidenceClass {
  if (checks.some((item) => item.evidenceClass === "unavailable-on-base")) return "unavailable-on-base";
  if (checks.some((item) => item.evidenceClass === "local-port-fixture")) return "local-port-fixture";
  if (checks.every((item) => item.evidenceClass === "executed-foundation")) return "executed-foundation";
  return "executed-local";
}

function makeGate(
  id: string,
  summary: string,
  checks: readonly CheckResult[],
  requiredForCiReplay: boolean,
  requiredForLiveSignOff: boolean,
  veto = false,
): GateResult {
  return {
    id,
    verdict: rollup(checks),
    evidenceClass: evidenceOf(checks),
    productExecuted: false,
    requiredForCiReplay,
    requiredForLiveSignOff,
    veto,
    summary,
    checks,
  };
}

function resumeManifest(repoRoot: string): { readonly pass: boolean; readonly observed: string } {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "resume-changer-benchmark.json"), "utf8")) as {
    commit: string;
    summary: { markdown_files: number; plan_or_task_files: number; plan_or_task_lines: number };
    files: readonly { lines: number; plan_or_task: boolean }[];
  };
  const plans = raw.files.filter((file) => file.plan_or_task);
  const lines = plans.reduce((sum, file) => sum + file.lines, 0);
  const pass =
    raw.commit.startsWith("497831ec") &&
    raw.files.length === 73 &&
    plans.length === 17 &&
    lines === 4906 &&
    raw.summary.markdown_files === 73 &&
    raw.summary.plan_or_task_files === 17 &&
    raw.summary.plan_or_task_lines === 4906;
  return { pass, observed: `${raw.files.length} docs, ${plans.length} plans, ${lines} lines, ${raw.commit.slice(0, 8)}` };
}

export function buildGates(input: GateInput): GateResult[] {
  const manifest = resumeManifest(input.repoRoot);
  const kitchen = input.matrix.kitchen;
  const gates: GateResult[] = [
    makeGate(
      "suite:kitchen-web",
      "Local-port fixture checked against Kitchen bars. The Kitchen product run was not executed.",
      [
        check("pass-rate", kitchen.hiddenAcceptancePassRate >= 0.9, "local-port-fixture", String(kitchen.hiddenAcceptancePassRate), ">= 0.90"),
        check("speedup", kitchen.parallelSpeedup >= 2, "local-port-fixture", String(kitchen.parallelSpeedup), ">= 2.0"),
        check("lockouts", kitchen.prematureLockouts === 0, "local-port-fixture", String(kitchen.prematureLockouts), "0"),
        check("paperwork", kitchen.paperworkSpend <= 0.2, "local-port-fixture", String(kitchen.paperworkSpend), "<= 0.20"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:resume-changer-brownfield",
      "Manifest parity was read from resume-changer-benchmark.json. Behavior bars are a local-port fixture, not a product run.",
      [
        check("resume-manifest-parity", manifest.pass, "executed-foundation", manifest.observed, "497831ec, 73 docs, 17 plans, 4906 lines"),
        check("stale-docs", input.matrix.resume.staleDocsDetected, "local-port-fixture", String(input.matrix.resume.staleDocsDetected), "detected"),
        check("baseline-regressions", input.matrix.resume.baselineRegressions === 0, "local-port-fixture", String(input.matrix.resume.baselineRegressions), "0"),
        check("ui-stages", input.matrix.resume.uiConsistencyStagesPassed === 6, "local-port-fixture", String(input.matrix.resume.uiConsistencyStagesPassed), "6"),
        check("silent-stash", input.matrix.resume.silentStashCount === 0, "local-port-fixture", String(input.matrix.resume.silentStashCount), "0"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:expense-cli",
      "Local-port fixture for the greenfield CLI bars. The product CLI was not built.",
      [
        check("web-artifacts", input.matrix.expense.webArtifactCount === 0, "local-port-fixture", String(input.matrix.expense.webArtifactCount), "0"),
        check("stdout-json", input.matrix.expense.stdoutJsonPure, "local-port-fixture", String(input.matrix.expense.stdoutJsonPure), "pure json"),
        check("exit-codes", input.matrix.expense.exitCodesDeterministic, "local-port-fixture", String(input.matrix.expense.exitCodesDeterministic), "deterministic"),
        check("hidden-acceptance", input.matrix.expense.hiddenAcceptancePass, "local-port-fixture", String(input.matrix.expense.hiddenAcceptancePass), "pass"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:booking-api",
      "Local-port fixture for Booking API bars. The product API was not built.",
      [
        check("concurrency", input.matrix.booking.concurrencyLocking, "local-port-fixture", String(input.matrix.booking.concurrencyLocking), "locking"),
        check("idempotency", input.matrix.booking.doubleSubmitIdempotent, "local-port-fixture", String(input.matrix.booking.doubleSubmitIdempotent), "idempotent"),
        check("timezone", input.matrix.booking.timezoneBoundaries, "local-port-fixture", String(input.matrix.booking.timezoneBoundaries), "boundaries"),
        check("rbac", input.matrix.booking.rbac, "local-port-fixture", String(input.matrix.booking.rbac), "rbac"),
        check("webhook", input.matrix.booking.webhookSignatureVerified, "local-port-fixture", String(input.matrix.booking.webhookSignatureVerified), "signature"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:ten-bug-set",
      "Local-port fixture for the 10-bug investigation bars. The seeded product suite was not executed.",
      [
        check("stages", input.matrix.bugs.investigationStages === 6, "local-port-fixture", String(input.matrix.bugs.investigationStages), "6"),
        check("bisect", input.matrix.bugs.flakeSafeBisect, "local-port-fixture", String(input.matrix.bugs.flakeSafeBisect), "flake-safe"),
        check("ddmin", input.matrix.bugs.ddminShrinker, "local-port-fixture", String(input.matrix.bugs.ddminShrinker), "shrinker"),
        check("anti-symptom", input.matrix.bugs.antiSymptomPatch, "local-port-fixture", String(input.matrix.bugs.antiSymptomPatch), "detector"),
        check("repro", input.matrix.bugs.permanentRepro, "local-port-fixture", String(input.matrix.bugs.permanentRepro), "permanent repro"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:sweep-set",
      "Local-port fixture for sweep bars. The product sweep was not executed.",
      [
        check("leases", input.matrix.sweep.pathLeasesDrained, "local-port-fixture", String(input.matrix.sweep.pathLeasesDrained), "drained"),
        check("codemod", input.matrix.sweep.codemodApplied, "local-port-fixture", String(input.matrix.sweep.codemodApplied), "applied"),
        check("zone2", input.matrix.sweep.zone2Protected, "local-port-fixture", String(input.matrix.sweep.zone2Protected), "protected"),
        check("zone1", input.matrix.sweep.zone1Leftovers === 0, "local-port-fixture", String(input.matrix.sweep.zone1Leftovers), "0"),
        check("symbol-map", input.matrix.sweep.symbolMapUpdated, "local-port-fixture", String(input.matrix.sweep.symbolMapUpdated), "updated"),
      ],
      true,
      false,
    ),
    makeGate(
      "suite:red-team-security",
      "Local-port fixture for 6 blocked vectors and a zero-leak canary. A canary leak is an unconditional veto. The product red-team suite was not executed.",
      [
        check(
          "vectors-blocked",
          input.matrix.redTeam.blocked.length === RED_TEAM_VECTORS.length && input.matrix.redTeam.blocked.every(Boolean),
          "local-port-fixture",
          `${input.matrix.redTeam.blocked.filter(Boolean).length}/${RED_TEAM_VECTORS.length}`,
          "6/6 blocked",
        ),
        check("canary-leak-bytes", input.matrix.redTeam.canaryLeakBytes === 0, "local-port-fixture", String(input.matrix.redTeam.canaryLeakBytes), "0"),
      ],
      true,
      false,
      true,
    ),
    makeGate(
      "linux-ci-case-repair",
      "Executed a local port of the Class 2 repair against real git index casing. Task 178 is not on this base.",
      [
        check("class-2", input.linux.classification === "class-2", "executed-local", input.linux.classification, "class-2"),
        check("local-windows", input.linux.localWindowsVerification === "PASS", "executed-local", input.linux.localWindowsVerification, "PASS"),
        check("linux-before", input.linux.linuxBefore === "TS2307", "executed-local", input.linux.linuxBefore, "TS2307"),
        check("one-push", input.linux.repairPushes === 1 && input.linux.repairPushes <= input.linux.pushCap, "executed-local", String(input.linux.repairPushes), "1 and <= 3"),
        check("fourth-push-rejected", input.linux.fourthPushRejected, "executed-local", String(input.linux.fourthPushRejected), "rejected"),
        check("ledger", input.linux.ledgerApproved, "executed-local", String(input.linux.ledgerApproved), "approved"),
        check("ci-green", input.linux.ciStatus === "CI_GREEN", "executed-local", input.linux.ciStatus, "CI_GREEN"),
        check("broken-rename-rejected", input.linux.brokenRenameAccepted === false, "executed-local", input.linux.brokenIndexCase, "index case unchanged and rejected"),
        check("repair-index-case", input.linux.appliedRepairIndexCase === "src/header.tsx", "executed-local", input.linux.appliedRepairIndexCase, "src/header.tsx"),
      ],
      true,
      false,
    ),
    makeGate(
      "ship-deploy-migration-rollback",
      "Executed local-port Vercel and Docker SSH deploy, 6-phase migration, and rollback policy. Live hosts were not contacted.",
      [
        check("phases", input.ship.phases.join(",") === "REHEARSE,BACKUP,EXPAND,APP_DEPLOY,BACKFILL,CONTRACT", "executed-local", input.ship.phases.join(","), "6 phases"),
        check("destructive-expand", input.ship.destructiveBlockedInExpand, "executed-local", String(input.ship.destructiveBlockedInExpand), "blocked"),
        check("backup-block", input.ship.backupFailureBlocksExpand, "executed-local", String(input.ship.backupFailureBlocksExpand), "blocked"),
        check("pause-cursor", input.ship.pauseResumeFromPk === 3, "executed-local", String(input.ship.pauseResumeFromPk), "3"),
        check("backfill", input.ship.backfillComplete, "executed-local", String(input.ship.backfillComplete), "complete"),
        check("contract-guard", input.ship.contractBlockedWhileIncomplete, "executed-local", String(input.ship.contractBlockedWhileIncomplete), "blocked"),
        check("policy", shipPolicySelfCheck(), "executed-local", `${input.ship.stagingRollbackOnFailedSmoke}/${input.ship.productionRollbackOnFailedSmoke}`, "automatic/offered"),
        check("build-id", input.ship.vercelBuildId === input.ship.dockerSshBuildId && input.ship.deployedBuildId === input.ship.vercelBuildId, "executed-local", input.ship.deployedBuildId, "matching local-port build id"),
        check("docker-argv", input.ship.dockerArgvHasEnvSecret === false, "executed-local", input.ship.dockerArgv.join(" "), "no -e secret"),
        check("smoke", input.ship.happyPathSmoke === "pass", "executed-local", input.ship.happyPathSmoke, "pass"),
      ],
      true,
      false,
    ),
    makeGate(
      "portability-lease-broker-protocol",
      "Executed local git fast-import, fenced lease takeover, and a non-age X25519 seal. Production age format is not claimed.",
      [
        check("graph-sha", input.portability.canonicalGraphMatch, "executed-local", String(input.portability.canonicalGraphMatch), "match"),
        check("plaintext", input.portability.plaintextInGit === false, "executed-local", String(input.portability.plaintextInGit), "absent"),
        check("read-only", input.portability.laptopBInitialMode === "read-only", "executed-local", input.portability.laptopBInitialMode, "read-only"),
        check("epoch", input.portability.takeoverEpoch === 5, "executed-local", String(input.portability.takeoverEpoch), "5"),
        check("fence", input.portability.staleLaptopAMode === "fenced", "executed-local", input.portability.staleLaptopAMode, "fenced"),
        check("force-with-lease", input.portability.staleForceWithLeaseRejected && input.portability.blindForcePushUsed === false, "executed-local", String(input.portability.staleForceWithLeaseRejected), "stale push rejected"),
        check("lost-key", input.portability.lostKeyKnowledgePreserved && input.portability.lostKeyDecryptFailed && input.portability.oracleRegenerated, "executed-local", "preserved", "knowledge kept and seal regenerated"),
        check("public-default", input.portability.publicPushDefault === "off", "executed-local", input.portability.publicPushDefault, "off"),
        check("zip-slip", input.portability.zipSlipRejected, "executed-local", String(input.portability.zipSlipRejected), "rejected"),
        check("secret-export", input.portability.secretExportBlocked, "executed-local", String(input.portability.secretExportBlocked), "blocked"),
        check("cipher", input.portability.productionAgeFormat === false, "executed-local", input.portability.cipher, "local port cipher, not production age"),
      ],
      true,
      false,
    ),
    makeGate(
      "multi-project-wfq",
      "Executed a local weighted-fair allocation for 3 projects. The global.db broker package is not on this base.",
      [
        check("interactive-share", input.broker.shares.interactive === 8, "executed-local", String(input.broker.shares.interactive), "8"),
        check("foreground-share", input.broker.shares.foreground === 4, "executed-local", String(input.broker.shares.foreground), "4"),
        check("background-share", input.broker.shares.background === 2, "executed-local", String(input.broker.shares.background), "2"),
        check("no-starvation", input.broker.starved === false, "executed-local", String(input.broker.starved), "none starved"),
        check("reserved-slot", input.broker.reservedInteractiveSlot, "executed-local", String(input.broker.reservedInteractiveSlot), "reserved"),
      ],
      true,
      false,
    ),
    makeGate(
      "chaos-local-oracle",
      "Executed the local-port invariant oracle. This is not the integrated daemon fault simulator.",
      [
        check("seeds", input.chaos.seeds >= 50, "executed-local", String(input.chaos.seeds), ">= 50"),
        check("violations", input.chaos.violations === 0, "executed-local", String(input.chaos.violations), "0"),
        check("integrated", input.chaos.integratedDaemon === false, "executed-local", "false", "not claimed"),
      ],
      true,
      false,
    ),
    makeGate(
      "review-trials-checklist",
      "Local-port checklist of 10 areas and 6 trials. Task 194 product trials were not executed.",
      [
        check("areas", input.matrix.reviewAreaIds.join("") === "ABCDEFGHIJ", "local-port-fixture", input.matrix.reviewAreaIds.join(""), "A-J"),
        check("trials", input.matrix.reviewTrialIds.join(",") === "1,2,3,4,5,6", "local-port-fixture", input.matrix.reviewTrialIds.join(","), "1-6"),
      ],
      true,
      false,
    ),
    makeGate(
      "docs-diagram-schema",
      "Executed foundation schema and diagram checks. A stale-diagram injection fails this gate.",
      input.foundation.filter((item) => item.id !== "owned-tree-secret-scan"),
      true,
      false,
    ),
    makeGate(
      "perf-slo-replay",
      "Threshold arithmetic on local-port replay numbers. harnessd was not measured.",
      [
        check("db-p99", input.matrix.slos.dbWriteP99Ms < 50, "local-port-fixture", String(input.matrix.slos.dbWriteP99Ms), "< 50 ms"),
        check("board", input.matrix.slos.boardUpdateMs < 10, "local-port-fixture", String(input.matrix.slos.boardUpdateMs), "< 10 ms"),
        check("entity-export", input.matrix.slos.entityIncrementalExportMs < 150, "local-port-fixture", String(input.matrix.slos.entityIncrementalExportMs), "< 150 ms"),
        check("migration-ram", input.matrix.slos.migrationPeakRamMb < 400 && input.matrix.slos.migrationIntegrityOk, "local-port-fixture", String(input.matrix.slos.migrationPeakRamMb), "< 400 MB and integrity ok"),
        check("ui-p95", input.matrix.slos.uiInputP95Ms < 50, "local-port-fixture", String(input.matrix.slos.uiInputP95Ms), "< 50 ms"),
        check("ipc-p99", input.matrix.slos.ipcP99Ms < 5, "local-port-fixture", String(input.matrix.slos.ipcP99Ms), "< 5 ms"),
      ],
      true,
      false,
    ),
    makeGate(
      "security-local-scan",
      "Scanned task 200 files for secret markers. This is not the five-pillar product audit.",
      input.foundation.filter((item) => item.id === "owned-tree-secret-scan"),
      true,
      false,
    ),
    makeGate(
      "hygiene",
      "Certification temp roots are removed and no child process is left running.",
      [
        check("pids", input.hygiene.leakedPids === 0, "executed-local", String(input.hygiene.leakedPids), "0"),
        check(
          "leftovers",
          input.hygiene.unexpectedLeftovers === 0 && input.hygiene.tempRemoved,
          "executed-local",
          String(input.hygiene.unexpectedLeftovers),
          "0",
        ),
      ],
      true,
      true,
    ),
    makeGate(
      "integration-accounted",
      "Every task is either a handoff on this branch or an explicit local-port swap. Swaps are not harness/integration wiring.",
      [
        check("unaccounted", input.integration.unaccounted.length === 0, "executed-local", input.integration.unaccounted.join(",") || "none", "none"),
        check("conflicts", input.integration.conflicts.length === 0, "executed-local", input.integration.conflicts.join(",") || "none", "none"),
      ],
      true,
      false,
    ),
    makeGate(
      "integration-on-harness",
      "Live sign-off requires all 200 handoffs on harness/integration with zero local-port swaps.",
      [
        check("branch", input.integration.branch === "harness/integration", "executed-local", input.integration.branch, "harness/integration"),
        check("zero-swaps", input.integration.swapCount === 0, "executed-local", String(input.integration.swapCount), "0"),
        check("two-hundred-handoffs", input.integration.handoffPresentCount === 200, "executed-local", String(input.integration.handoffPresentCount), "200"),
      ],
      false,
      true,
    ),
    makeGate(
      "packaging-signed-nsis",
      "Signed Windows NSIS installer was not produced on this base.",
      [withheld("installer", "unavailable-on-base", "absent", "signed NSIS under 180 MB")],
      false,
      true,
    ),
    makeGate(
      "latest-yml-sha512",
      "latest.yml SHA-512 blockmap was not produced on this base.",
      [withheld("blockmap", "unavailable-on-base", "absent", "SHA-512 blockmap")],
      false,
      true,
    ),
    makeGate(
      "cyclonedx-sbom",
      "CycloneDX SBOM was not produced on this base.",
      [withheld("sbom", "unavailable-on-base", "absent", "CycloneDX SBOM")],
      false,
      true,
    ),
    makeGate(
      "authenticode",
      "Authenticode signature was not produced on this base.",
      [withheld("authenticode", "unavailable-on-base", "absent", "Authenticode signature")],
      false,
      true,
    ),
    makeGate(
      "live-providers",
      "Live provider certification was not executed.",
      [withheld("providers", "unavailable-on-base", "not executed", "live provider gauntlet")],
      false,
      true,
    ),
    makeGate(
      "chaos-integrated-daemon",
      "Integrated 1000-seed daemon fault injection is not on this base. The local oracle does not replace it.",
      [withheld("integrated-daemon", "unavailable-on-base", `local oracle seeds ${input.chaos.seeds}`, "1000 integrated daemon seeds")],
      false,
      true,
    ),
    makeGate(
      "production-age",
      "Production age encryption is not available in this worktree. The local X25519 seal is a labeled stand-in.",
      [withheld("age-format", "unavailable-on-base", input.portability.cipher, "production age format")],
      false,
      true,
    ),
    makeGate(
      "security-five-pillar",
      "The five-pillar product audit is not on this base. A failing audit would veto release; a missing audit withholds live sign-off.",
      [withheld("five-pillar", "unavailable-on-base", "task 199 report absent", "0 findings")],
      false,
      true,
      true,
    ),
    makeGate(
      "product-milestone-exits",
      "Milestone product exit suites from tasks 034, 068, 105, 134, 152, and 175 are not on this base.",
      [withheld("milestone-exits", "unavailable-on-base", "sibling branches absent", "M0-M6 product exits")],
      false,
      true,
    ),
    makeGate(
      "product-suite-execution",
      "Frozen suite product runs are not on this base. Ci-replay fixture bars are a separate gate.",
      [withheld("product-suites", "unavailable-on-base", "fixtures only", "executed product suites")],
      false,
      true,
    ),
  ];
  if (input.unsignedDev) {
    gates.push(
      makeGate(
        "unsigned-dev-refused",
        "Full release profile refuses an unsigned installer. Authenticode, latest.yml SHA-512, and a CycloneDX SBOM are required before tagging.",
        [check("unsigned-dev", false, "executed-local", "unsigned-dev", "Authenticode signed installer")],
        false,
        true,
      ),
    );
  }
  return gates;
}

export function suiteRollups(gates: readonly GateResult[]): SuiteRollup[] {
  return gates
    .filter((gate) => gate.id.startsWith("suite:"))
    .map((gate) => ({
      id: gate.id,
      verdict: gate.verdict,
      evidenceClass: gate.evidenceClass,
      productExecuted: false as const,
      summary: gate.summary,
    }));
}

export function milestoneVerdicts(schemaPassed: boolean): MilestoneVerdict[] {
  const later = ["M1", "M2", "M3", "M4", "M5", "M6"] as const;
  return [
    {
      id: "M0",
      verdict: "WITHHELD",
      evidenceClass: "executed-foundation",
      summary: schemaPassed
        ? "schema/schema-test.js passed 67/67. The 10000-run kernel simulation is not on this base."
        : "schema/schema-test.js did not pass. The 10000-run kernel simulation is not on this base.",
    },
    ...later.map((id) => ({
      id,
      verdict: "WITHHELD" as const,
      evidenceClass: "unavailable-on-base" as const,
      summary: `${id} product exit evidence is not on this base.`,
    })),
  ];
}
