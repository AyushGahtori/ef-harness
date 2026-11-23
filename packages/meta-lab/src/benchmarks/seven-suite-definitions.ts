import {
  gradeBookingConcurrency,
  gradeBookingIdempotency,
  gradeBugFixture,
  gradeExpenseJsonStdout,
  gradeExpenseWindowsPath,
  gradeKitchenAuth,
  gradeKitchenCutoff,
  gradeRedTeamFixture,
  gradeResumeChanger,
  gradeSweepFixture,
} from "./graders.js";
import { computeSuiteManifestDigest } from "./manifest-digest.js";
import type { BenchmarkCaseDefinition, SuiteDefinition, SuiteId } from "./types.js";

function finalizeSuite(
  partial: Omit<SuiteDefinition, "manifestDigest">,
): SuiteDefinition {
  const { digest } = computeSuiteManifestDigest({
    id: partial.id,
    suiteVersion: partial.suiteVersion,
    cases: partial.cases,
  });
  return { ...partial, manifestDigest: digest };
}

const BUG_FIXTURES = [
  "race-condition",
  "timezone-off-by-one",
  "safari-date-parse",
  "n-plus-one-sql",
  "cache-invalidation",
  "auth-idor",
  "windows-case-import",
  "csv-escaping",
  "react-stale-closure",
  "memory-listener-leak",
] as const;

function bugCases(): BenchmarkCaseDefinition[] {
  return BUG_FIXTURES.map((name, index) => ({
    id: `ten-bug:${name}`,
    split: index < 3 ? "dev" : "held_out",
    tags: ["investigation", "bisect", name],
    smoke: index < 2,
    fixtureRelativePath: `ten-bug-set/${name}.json`,
    grade: gradeBugFixture,
  }));
}

const SUITE_BUILDERS: (() => Omit<SuiteDefinition, "manifestDigest">)[] = [
  () => ({
    id: "suite:kitchen-web",
    title: "Kitchen Meal-Ordering Web App",
    suiteVersion: "suite_v1.0",
    description: "Greenfield web Kitchen benchmark with timezone cutoff and catering email checks.",
    cases: [
      {
        id: "kitchen:auth-roles",
        split: "dev",
        tags: ["auth", "ui"],
        smoke: true,
        fixtureRelativePath: "kitchen-web/dev-auth-roles.json",
        grade: gradeKitchenAuth,
      },
      {
        id: "kitchen:order-cutoff",
        split: "held_out",
        tags: ["time", "cutoff", "catering"],
        smoke: true,
        fixtureRelativePath: "kitchen-web/held-order-cutoff.json",
        grade: gradeKitchenCutoff,
      },
    ],
  }),
  () => ({
    id: "suite:resume-changer-brownfield",
    title: "resume-changer@497831ec Brownfield",
    suiteVersion: "suite_v1.0",
    description: "Pinned brownfield benchmark verified against resume-changer-benchmark.json.",
    cases: [
      {
        id: "resume-changer:offline-slice",
        split: "held_out",
        tags: ["brownfield", "manifest"],
        smoke: true,
        fixtureRelativePath: "resume-changer/offline-manifest-slice.json",
        pinnedCommitSha: "497831ec5aa7effb354bb1a8d22d2f031b17a4e0",
        grade: gradeResumeChanger,
      },
    ],
  }),
  () => ({
    id: "suite:expense-cli",
    title: "Expense CLI",
    suiteVersion: "suite_v1.0",
    description: "Greenfield CLI with JSON stdout purity and Windows path handling.",
    cases: [
      {
        id: "expense:json-stdout",
        split: "dev",
        tags: ["cli", "json"],
        smoke: true,
        fixtureRelativePath: "expense-cli/dev-json-stdout.json",
        grade: gradeExpenseJsonStdout,
      },
      {
        id: "expense:windows-path",
        split: "held_out",
        tags: ["cli", "windows", "export"],
        smoke: false,
        fixtureRelativePath: "expense-cli/held-windows-path.json",
        grade: gradeExpenseWindowsPath,
      },
    ],
  }),
  () => ({
    id: "suite:booking-api",
    title: "Booking API",
    suiteVersion: "suite_v1.0",
    description: "REST booking API with idempotency and slot overlap concurrency.",
    cases: [
      {
        id: "booking:idempotency",
        split: "dev",
        tags: ["api", "idempotency"],
        smoke: true,
        fixtureRelativePath: "booking-api/dev-idempotency.json",
        grade: gradeBookingIdempotency,
      },
      {
        id: "booking:slot-overlap",
        split: "held_out",
        tags: ["api", "concurrency"],
        smoke: true,
        fixtureRelativePath: "booking-api/held-slot-overlap.json",
        grade: gradeBookingConcurrency,
      },
    ],
  }),
  () => ({
    id: "suite:ten-bug-set",
    title: "Ten-Bug Investigation Set",
    suiteVersion: "suite_v1.0",
    description: "Seeded mystery bugs that must fail on untouched baselines.",
    cases: bugCases(),
  }),
  () => ({
    id: "suite:sweep-set",
    title: "Sweep and Rename Set",
    suiteVersion: "suite_v1.0",
    description: "Multi-file refactor traps including Prisma @map.",
    cases: [
      {
        id: "sweep:ts-symbol-rename",
        split: "dev",
        tags: ["sweep", "typescript"],
        smoke: true,
        fixtureRelativePath: "sweep-set/ts-symbol-rename.json",
        grade: gradeSweepFixture,
      },
      {
        id: "sweep:prisma-map-trap",
        split: "held_out",
        tags: ["sweep", "prisma"],
        smoke: false,
        fixtureRelativePath: "sweep-set/prisma-map-trap.json",
        grade: gradeSweepFixture,
      },
    ],
  }),
  () => ({
    id: "suite:red-team-security",
    title: "Red-Team Security Set",
    suiteVersion: "suite_v1.0",
    description: "Adversarial fixtures for malicious instructions and vault canaries.",
    cases: [
      {
        id: "red-team:readme-curl-sh",
        split: "held_out",
        tags: ["security", "supply-chain"],
        smoke: true,
        fixtureRelativePath: "red-team-security/readme-curl-sh.json",
        grade: gradeRedTeamFixture,
      },
      {
        id: "red-team:vault-canary",
        split: "held_out",
        tags: ["security", "exfil"],
        smoke: true,
        fixtureRelativePath: "red-team-security/vault-canary-exfil.json",
        grade: gradeRedTeamFixture,
      },
    ],
  }),
];

export function buildSevenSuiteDefinitions(): readonly SuiteDefinition[] {
  return SUITE_BUILDERS.map((build) => finalizeSuite(build()));
}

export const SEVEN_SUITE_DEFINITIONS: readonly SuiteDefinition[] = buildSevenSuiteDefinitions();

export const SUITE_IDS: readonly SuiteId[] = SEVEN_SUITE_DEFINITIONS.map((suite) => suite.id);