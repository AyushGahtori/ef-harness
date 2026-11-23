import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempRepo(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `l1-${name}-`));
}

export function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

export function seedTsAliasRepo(root: string): void {
  writeFile(
    root,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      },
      null,
      2,
    ),
  );
  writeFile(root, "src/lib/pdf.ts", "export function renderResumePdf(): Buffer { return Buffer.from(''); }\n");
  writeFile(root, "src/lib/types.ts", "export interface ResumeDoc { title: string }\n");
  writeFile(
    root,
    "src/components/index.ts",
    "export { PdfButton } from './pdf-button.js';\nexport * from '../lib/types.js';\n",
  );
  writeFile(
    root,
    "src/components/pdf-button.tsx",
    "import { renderResumePdf } from '@/lib/pdf';\nexport function PdfButton() { renderResumePdf(); return null; }\n",
  );
  writeFile(
    root,
    "src/app/export/page.tsx",
    "import { PdfButton, ResumeDoc } from '@/components';\nexport default function ExportPage() { const _doc: ResumeDoc = { title: 'x' }; return <PdfButton />; }\n",
  );
  writeFile(
    root,
    "src/broken/wip.ts",
    "export function ok() {}\nexport function broken(\n",
  );
  writeFile(
    root,
    "graphql-types.generated.ts",
    "// @generated\n".padEnd(20, "x") + "\nexport type Gql = string;\n",
  );
  writeFile(root, "vendor/noise.min.js", "x".repeat(5000));
  writeFile(root, "pnpm-lock.yaml", "lockfileVersion: 9\n");
  writeFile(root, "src/models.sql", "CREATE TABLE resumes (id TEXT PRIMARY KEY);\n");
  writeFile(root, "handlers/user.py", "class UserService:\n    def list(self):\n        return []\n");
  writeFile(root, "pkg/auth.go", "package auth\n\nfunc Serve() {}\n");
}

export function gitInit(root: string): string {
  execSync("git init", { cwd: root, stdio: "ignore", windowsHide: true });
  execSync('git config user.email "test@ef-harness.local"', { cwd: root, stdio: "ignore", windowsHide: true });
  execSync('git config user.name "EF Harness"', { cwd: root, stdio: "ignore", windowsHide: true });
  execSync("git add -A", { cwd: root, stdio: "ignore", windowsHide: true });
  execSync('git commit -m "seed"', { cwd: root, stdio: "ignore", windowsHide: true, shell: true });
  return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}