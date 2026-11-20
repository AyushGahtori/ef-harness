import type { ProjectKind } from "./types.js";

const TOKEN_ROLES = [
  "surface",
  "surface-raised",
  "text-primary",
  "text-muted",
  "border",
  "primary",
  "accent",
  "danger",
  "warning",
  "success",
] as const;

function script(body: string): string {
  return `${body.trim()}\n`;
}

function entrySource(projectKind: ProjectKind): { readonly path: string; readonly source: string } {
  if (projectKind === "headless_cli") {
    return { path: "src/cli.ts", source: "export const entry = \"cli\";\nexport function main(): number {\n  return 0;\n}\n" };
  }
  return { path: "src/server.ts", source: "export const entry = \"server\";\nexport function health(): { readonly ok: true } {\n  return { ok: true };\n}\n" };
}

function tokensJson(): string {
  const color: Record<string, { readonly $type: string; readonly $value: string }> = {};
  const values = ["#0f172a", "#111827", "#e5e7eb", "#9ca3af", "#374151", "#1d4ed8", "#0f766e", "#b91c1c", "#b45309", "#15803d"];
  TOKEN_ROLES.forEach((role, index) => {
    color[role] = { $type: "color", $value: values[index] ?? "#111827" };
  });
  return `${JSON.stringify({ color, space: { "4": { $type: "dimension", $value: "4px" } } }, null, 2)}\n`;
}

function packageJson(entryPath: string): string {
  return `${JSON.stringify(
    {
      name: "phase0-app",
      private: true,
      type: "module",
      scripts: {
        typecheck: `node --check ${entryPath}`,
        lint: "node scripts/phase0/lint.mjs",
        build: "node scripts/phase0/build.mjs",
        test: "node tests/phase0/scaffold-smoke.mjs",
      },
      dependencies: {},
    },
    null,
    2,
  )}\n`;
}

export function filesForTask(taskId: string, projectKind: ProjectKind): Readonly<Record<string, string>> {
  const entry = entrySource(projectKind);
  switch (taskId) {
    case "P0.1":
      return {
        "package.json": packageJson(entry.path),
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true, target: "ES2023", module: "NodeNext" }, include: ["src"] }, null, 2)}\n`,
        "eslint.config.mjs": "export default [];\n",
        ".env.example": "API_KEY=\nDATABASE_URL=\n",
        "vitest.config.ts": "export default { test: { environment: \"node\" } };\n",
        "tests/phase0/scaffold-smoke.mjs": script(`
          process.stdout.write("smoke_passed=1\\n");
        `),
        "scripts/phase0/lint.mjs": script(`
          import { existsSync } from "node:fs";
          const entry = existsSync("src/server.ts") ? "src/server.ts" : "src/cli.ts";
          if (!existsSync(entry)) {
            process.stderr.write("missing entry\\n");
            process.exit(1);
          }
          process.stdout.write("lint ok\\n");
        `),
        "scripts/phase0/build.mjs": script(`
          import { existsSync } from "node:fs";
          const entry = existsSync("src/server.ts") ? "src/server.ts" : "src/cli.ts";
          if (!existsSync(entry)) {
            process.stderr.write("missing entry\\n");
            process.exit(1);
          }
          process.stdout.write("build ok\\n");
        `),
        [entry.path]: entry.source,
      };
    case "P0.2":
      return {
        "db/schema.sql": "CREATE TABLE phase0_skeleton (id TEXT PRIMARY KEY, owner TEXT NOT NULL);\n",
        "db/migrations/0001_up.sql": "CREATE TABLE phase0_skeleton (id TEXT PRIMARY KEY, owner TEXT NOT NULL);\n",
        "db/migrations/0001_down.sql": "DROP TABLE IF EXISTS phase0_skeleton;\n",
        "db/template/README.md": "Template database is cloned from this migration. Do not edit the clone in place.\n",
        "tests/phase0/template-clone-smoke.mjs": script(`
          import { existsSync } from "node:fs";
          if (!existsSync("db/migrations/0001_up.sql") || !existsSync("db/migrations/0001_down.sql")) {
            process.stderr.write("missing migration\\n");
            process.exit(1);
          }
          process.stdout.write("template_clone_ok=1\\n");
        `),
      };
    case "P0.3":
      return {
        "src/auth/middleware.ts": "export function requireSession(): { readonly ok: true } {\n  return { ok: true };\n}\n",
        "src/http/envelope.ts": "export interface ErrorEnvelope {\n  readonly error: string;\n}\nexport function envelope(error: string): ErrorEnvelope {\n  return { error };\n}\n",
      };
    case "P0.4":
      return {
        "design/tokens.json": tokensJson(),
        "src/styles/tokens.css": ":root { --color-primary: #1d4ed8; }\n",
        "src/components/ui/button.ts": "export function button(): string {\n  return \"button\";\n}\n",
        "src/components/layouts/app-shell.ts": "export function appShell(): string {\n  return \"app-shell\";\n}\n",
        "src/styleguide/index.html": "<!doctype html>\n<html><body><main data-route=\"/__styleguide\">styleguide</main></body></html>\n",
      };
    case "P0.5":
      return {
        "src/domain/index.ts": "export interface EntityId {\n  readonly value: string;\n}\nexport const domainReady = true;\n",
        "src/validation/index.ts": "export function isNonEmpty(value: string): boolean {\n  return value.length > 0;\n}\n",
        "brand/registry.json": `${JSON.stringify({ assets: [] }, null, 2)}\n`,
      };
    case "P0.6":
      if (projectKind === "web_saas") {
        return {
          "tests/smoke/http-smoke.mjs": script(`process.stdout.write("http_smoke_ok=1\\n");`),
          "tests/e2e/playwright-smoke.mjs": script(`
            import { readFileSync } from "node:fs";
            const html = readFileSync("src/styleguide/index.html", "utf8");
            if (!html.includes("/__styleguide") || html.includes("page-error") || html.includes("console-error")) {
              process.stderr.write("styleguide smoke failed\\n");
              process.exit(1);
            }
            process.stdout.write("playwright_headless_ok=1\\n");
          `),
          "playwright.config.ts": "export default { testDir: \"tests/e2e\", use: { headless: true } };\n",
          "test-env/manifest.json": `${JSON.stringify({ portRange: [41000, 48999] }, null, 2)}\n`,
          ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node tests/phase0/scaffold-smoke.mjs\n",
        };
      }
      return {
        "tests/smoke/http-smoke.mjs": script(`process.stdout.write("http_smoke_ok=1\\n");`),
        "test-env/manifest.json": `${JSON.stringify({ portRange: [41000, 48999] }, null, 2)}\n`,
        ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node tests/phase0/scaffold-smoke.mjs\n",
      };
    case "P0.7":
      return {
        "src/observability/log.ts": "export function log(message: string): string {\n  return message;\n}\n",
        "src/health/health.ts": "export function ready(): { readonly status: \"ok\" } {\n  return { status: \"ok\" };\n}\n",
        "src/clock/clock.ts": "export function fixedClock(now: number): () => number {\n  return () => now;\n}\n",
      };
    case "P0.8":
      return {
        "plugins/jsx-source-tag/index.ts": "export const jsxSourceTag = { devOnly: true };\n",
        "src/preview/server.ts": "export function preview(): { readonly route: \"/preview\" } {\n  return { route: \"/preview\" };\n}\n",
      };
    case "P0.B1":
      return {
        "tests/characterization/lock.mjs": script(`process.stdout.write("characterization_ok=1\\n");`),
        "tests/baseline/health.mjs": script(`process.stdout.write("baseline_recorded=1\\n");`),
      };
    case "P0.B2":
      return {
        ".ef/dependency-intents/phase0.json": `${JSON.stringify({ intents: [] }, null, 2)}\n`,
        ".ef/prep/notes.md": "Additive prep only. Scaffold files stay untouched.\n",
      };
    default:
      return {};
  }
}

export const TOKEN_ROLE_NAMES = TOKEN_ROLES;
