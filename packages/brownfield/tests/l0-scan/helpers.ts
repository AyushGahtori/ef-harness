import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l0-${name}-`));
  return dir;
}

export function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

export function gitInit(root: string): void {
  execSync("git init", { cwd: root, stdio: "ignore", windowsHide: true });
  execSync('git config user.email "test@ef-harness.local"', { cwd: root, stdio: "ignore", windowsHide: true });
  execSync('git config user.name "EF Harness"', { cwd: root, stdio: "ignore", windowsHide: true });
}

export function gitAddCommit(root: string, message: string): void {
  execSync("git add -A", { cwd: root, stdio: "ignore", windowsHide: true });
  execSync(`git commit -m "${message}"`, { cwd: root, stdio: "ignore", windowsHide: true, shell: true });
}

export function seedNextApp(root: string): void {
  writeFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "next-app",
        scripts: { dev: "next dev", build: "next build", test: "vitest run", lint: "eslint ." },
        dependencies: { next: "14.0.0", react: "18.0.0" },
        devDependencies: { vitest: "1.0.0", tailwindcss: "3.0.0" },
      },
      null,
      2,
    ),
  );
  writeFile(root, "app/page.tsx", "export default function Page() { return null; }\n");
  writeFile(root, "pages/legacy.tsx", "export default function Legacy() { return null; }\n");
  writeFile(root, "prisma/schema.prisma", "model User { id String @id }\n");
  writeFile(root, ".env.example", "DATABASE_URL=\nNEXTAUTH_SECRET=\n");
  writeFile(root, ".github/workflows/ci.yml", "jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node\n        with:\n          node-version: 20\n");
  writeFile(root, "README.md", "# App\n");
  writeFile(root, "docs/guide.md", "# Guide\n");
}

export function seedExpressPrisma(root: string): void {
  writeFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "api",
        scripts: { dev: "tsx src/index.ts", test: "vitest" },
        dependencies: { express: "4.0.0", "@prisma/client": "5.0.0" },
        devDependencies: { prisma: "5.0.0", vitest: "1.0.0" },
      },
      null,
      2,
    ),
  );
  writeFile(root, "src/index.ts", "import express from 'express';\nexport const app = express();\n");
  writeFile(root, "prisma/schema.prisma", "datasource db { provider = \"postgresql\" }\n");
}

export function seedPythonFastApi(root: string): void {
  writeFile(
    root,
    "pyproject.toml",
    "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
  );
  writeFile(root, "app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n");
  writeFile(root, "requirements.txt", "fastapi\npytest\n");
}

export function seedPnpmMonorepo(root: string): void {
  writeFile(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "mono", private: true, scripts: { test: "pnpm -r test" } }, null, 2),
  );
  writeFile(
    root,
    "apps/web/package.json",
    JSON.stringify(
      {
        name: "@mono/web",
        dependencies: { "@mono/core": "workspace:*" },
        scripts: { test: "vitest" },
      },
      null,
      2,
    ),
  );
  writeFile(root, "apps/web/src/index.ts", "export {};\n");
  writeFile(
    root,
    "packages/core/package.json",
    JSON.stringify({ name: "@mono/core", scripts: { test: "vitest" } }, null, 2),
  );
  writeFile(root, "packages/core/src/index.ts", "export const core = 1;\n");
  writeFile(root, "packages/ui/package.json", JSON.stringify({ name: "@mono/ui" }, null, 2));
  writeFile(root, "packages/shared/package.json", JSON.stringify({ name: "@mono/shared" }, null, 2));
  writeFile(root, "packages/extra/package.json", JSON.stringify({ name: "@mono/extra" }, null, 2));
}