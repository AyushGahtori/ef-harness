import { isUiProjectKind } from "@ef-harness/shared-contracts";

import type { PlanningProfile } from "./phase0-shared.js";
import type { Phase0Recipe } from "./types.js";

const SCAFFOLD_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  "prettier.config.mjs",
  ".env.example",
  "vitest.config.ts",
  "tests/phase0/scaffold-smoke.test.ts",
] as const;

function recipe(input: Phase0Recipe): Phase0Recipe {
  return input;
}

export function phase0Catalog(profile: PlanningProfile): ReadonlyMap<string, Phase0Recipe> {
  const cli = profile.projectKind === "cli_tool" && !profile.brownfield;
  const entry = cli ? "src/cli.ts" : "src/server.ts";
  const ui = isUiProjectKind(profile.projectKind) && !profile.brownfield;
  const smokeScope = ui
    ? ["tests/smoke/**", "tests/e2e/**", "playwright.config.ts", "test-env/**", ".github/workflows/ci.yml"]
    : ["tests/smoke/**", "test-env/**", ".github/workflows/ci.yml"];
  const smokeSteps = ui
    ? [
        "Wire the test environment so servers lease loopback ports in 41000-48999 and tear down with zero leaked child processes.",
        "Add a Playwright smoke project and an HTTP smoke that requests the application health route.",
        "Add a CI workflow stub that runs typecheck, lint, and the smoke suite on the integration branch.",
      ]
    : cli
      ? [
          "Wire the test environment so any local stub leases loopback ports in 41000-48999 and tears down cleanly.",
          "Add a CLI smoke harness that runs the built entry with fixture arguments and asserts exit code 0.",
          "Add a CI workflow stub that runs typecheck, lint, and the CLI smoke suite.",
        ]
      : [
          "Wire the test environment so servers lease loopback ports in 41000-48999 and tear down with zero leaked child processes.",
          "Add an HTTP smoke harness against the API health route. Do not add a browser project.",
          "Add a CI workflow stub that runs typecheck, lint, and the HTTP smoke suite.",
        ];

  const recipes: Phase0Recipe[] = [
    recipe({
      id: "P0.1",
      title: "Project scaffold, manifest, lockfile, configs, env example, and test runner",
      stage: "serial",
      dependsOn: [],
      level: "Junior",
      writeScope: [...SCAFFOLD_FILES, entry],
      steps: [
        "Create the package manifest with a private name, type module, and scripts for typecheck, lint, and test.",
        "Add a strict TypeScript config, an ESLint flat config, and a Prettier config.",
        "Write .env.example with empty values and no live credentials.",
        `Add vitest.config.ts and tests/phase0/scaffold-smoke.test.ts that imports ${entry}.`,
        `Add the runnable entry module ${entry}.`,
        "Declare toolchain dependency intents. The kernel installer (Task 048) is the only writer of pnpm-lock.yaml.",
      ],
      expectedOutputs: [...SCAFFOLD_FILES, entry],
      refs: ["Task 048"],
    }),
    recipe({
      id: "P0.2",
      title: "Primary database schema skeleton, migration harness, and template database",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Mid",
      writeScope: ["db/schema.sql", "db/migrations/**", "db/template/**"],
      steps: [
        "Write the skeleton schema with primary keys, ownership, and the relations other features share.",
        "Add a migration harness that applies and rolls back the skeleton on an empty database.",
        "Add the pre-seeded test template database (Task 052) and a clone check that leaves the template unchanged.",
      ],
      expectedOutputs: ["db/schema.sql", "db/migrations/**", "db/template/**"],
      refs: ["Task 052"],
    }),
    recipe({
      id: "P0.3",
      title: "Auth, session, and tenant middleware plus the shared error envelope",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Mid",
      writeScope: ["src/auth/**", "src/http/**"],
      steps: [
        "Add session, tenant, and role-check middleware primitives.",
        "Add one shared error and response envelope that later routes must use.",
        "Do not implement feature endpoints in this recipe.",
      ],
      expectedOutputs: ["src/auth/**", "src/http/**"],
      refs: [],
    }),
    recipe({
      id: "P0.4",
      title: "UI design system foundation and styleguide harness",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Mid",
      writeScope: [
        "design/tokens.json",
        "src/styles/**",
        "src/components/ui/**",
        "src/components/layouts/**",
        "src/styleguide/**",
      ],
      steps: [
        "Author design/tokens.json as W3C design tokens: color roles, type scale, 4px spacing, radii, elevation, motion, light and dark.",
        "Compile tokens with Style Dictionary into CSS variables and the Tailwind theme.",
        "Add shadcn/ui-style primitives and layout templates for app shell, list, detail, form, auth, and print.",
        "Add the dev-only /__styleguide route (Task 094) rendering every primitive and template.",
      ],
      expectedOutputs: [
        "design/tokens.json",
        "src/styles/**",
        "src/components/ui/**",
        "src/components/layouts/**",
        "src/styleguide/**",
      ],
      refs: ["Task 094"],
    }),
    recipe({
      id: "P0.5",
      title: "Shared domain types, validation schemas, and brand asset registry",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Junior",
      writeScope: ["src/domain/**", "src/validation/**", "brand/**"],
      steps: [
        "Add shared domain types that later features import instead of redeclaring.",
        "Add canonical validation schemas for those types.",
        "Add the brand asset registry (Task 099) and do not copy binary assets into feature folders.",
      ],
      expectedOutputs: ["src/domain/**", "src/validation/**", "brand/**"],
      refs: ["Task 099"],
    }),
    recipe({
      id: "P0.6",
      title: "Test environment, smoke harness, and CI workflow stub",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Junior",
      writeScope: smokeScope,
      steps: smokeSteps,
      expectedOutputs: smokeScope,
      refs: ["test-environments.md"],
    }),
    recipe({
      id: "P0.7",
      title: "Observability, health checks, and deterministic clock hooks",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Mid",
      writeScope: ["src/observability/**", "src/health/**", "src/clock/**"],
      steps: [
        "Add request logging and a health-check middleware.",
        "Add a deterministic clock and seed hook so tests never read the wall clock.",
        "Keep this tree disjoint from auth, domain, and UI trees.",
      ],
      expectedOutputs: ["src/observability/**", "src/health/**", "src/clock/**"],
      refs: [],
    }),
    recipe({
      id: "P0.8",
      title: "Dev JSX source tagging and preview server entrypoint",
      stage: "parallel",
      dependsOn: ["P0.1"],
      level: "Junior",
      writeScope: ["plugins/jsx-source-tag/**", "src/preview/**"],
      steps: [
        "Add the dev-only JSX source-tagging plugin (Task 161).",
        "Add the preview server entrypoint (Task 160).",
        "Do not enable the source-tagging plugin in production builds.",
      ],
      expectedOutputs: ["plugins/jsx-source-tag/**", "src/preview/**"],
      refs: ["Task 160", "Task 161"],
    }),
    recipe({
      id: "P0.B1",
      title: "Brownfield characterization tests and baseline test health",
      stage: "parallel",
      dependsOn: [],
      level: "Mid",
      writeScope: ["tests/characterization/**", "tests/baseline/**"],
      steps: [
        "Add characterization tests that lock the behavior this change must not break.",
        "Record the baseline test-health result for the existing suite.",
        "Do not edit package.json, pnpm-lock.yaml, tsconfig.json, ESLint config, or Prettier config.",
      ],
      expectedOutputs: ["tests/characterization/**", "tests/baseline/**"],
      refs: ["Task 170"],
    }),
    recipe({
      id: "P0.B2",
      title: "Brownfield dependency preparation without scaffold changes",
      stage: "parallel",
      dependsOn: [],
      level: "Junior",
      writeScope: [".ef/dependency-intents/**", ".ef/prep/**"],
      steps: [
        "Write additive dependency intents for the kernel installer.",
        "Prepare only the notes this change needs. Do not rewrite the working tree structure.",
        "Do not edit package.json or the lockfile in this recipe.",
      ],
      expectedOutputs: [".ef/dependency-intents/**", ".ef/prep/**"],
      refs: ["Task 048", "Task 166"],
    }),
  ];
  return new Map(recipes.map((item) => [item.id, item]));
}
