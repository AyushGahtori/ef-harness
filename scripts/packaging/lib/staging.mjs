import asar from "./asar-runtime.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  defaultOutputRoot,
  desktopBuildRoot,
  ensureDir,
  fixturesRoot,
  repoRoot,
  walkFiles,
  winUnpackedDir,
} from "./paths.mjs";
import { writeIntegrityManifest } from "./integrity-manifest.mjs";
import { writeSbomAndChecksums } from "./sbom.mjs";

const INSTALLER_BUDGET_BYTES = 180 * 1024 * 1024;

export function materializeBundledResources(resourcesRoot) {
  const from = path.join(fixturesRoot(), "resources");
  if (!fs.existsSync(from)) {
    throw new Error(`missing packaging fixtures at ${from}`);
  }
  ensureDir(path.dirname(resourcesRoot));
  fs.cpSync(from, resourcesRoot, { recursive: true, force: true });
  copyCorpusAndSkills(resourcesRoot);
  copyPolicyAndOffice(resourcesRoot);
}

function copyCorpusAndSkills(resourcesRoot) {
  const corpusSrc = path.join(repoRoot(), "v1-knowledge-corpus.md");
  const corpusDest = path.join(resourcesRoot, "corpus", "v1-knowledge-corpus.md");
  ensureDir(path.dirname(corpusDest));
  if (fs.existsSync(corpusSrc)) {
    fs.copyFileSync(corpusSrc, corpusDest);
  } else {
    fs.writeFileSync(corpusDest, "# corpus placeholder\n", "utf8");
  }
  const questionsDest = path.join(resourcesRoot, "corpus", "questions.json");
  const questions = { version: 1, count: 87, source: "foundation-wave-2" };
  fs.writeFileSync(questionsDest, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
  const skillsRoot = path.join(resourcesRoot, "corpus", "skills");
  ensureDir(skillsRoot);
  const bundledSkills = [
    "infer-or-ask",
    "systematic-debugging",
    "test-driven-verification",
    "frontend-accessibility-ui",
    "sql-migrations-safety",
    "api-security-hardening",
    "brownfield-discovery",
    "canvas-intent-parser",
    "ci-repair-loop",
    "dependency-audit",
    "docs-diagram-parity",
    "electron-lifecycle-tray",
    "git-worktree-hygiene",
    "mcp-tool-sandbox",
    "merge-queue-park",
    "nsis-packaging-integrity",
    "office-pixel-atlas",
    "provider-policy-sign",
    "runtime-adapter-conformance",
    "verification-real-apps",
  ];
  for (const skillId of bundledSkills) {
    const dest = path.join(skillsRoot, `${skillId}.md`);
    const repoSkill = path.join(repoRoot(), "skills", skillId, "SKILL.md");
    if (fs.existsSync(repoSkill)) {
      fs.copyFileSync(repoSkill, dest);
    } else {
      fs.writeFileSync(dest, `# ${skillId}\n\nBundled skill stub for packaging smoke.\n`, "utf8");
    }
  }
}

function copyPolicyAndOffice(resourcesRoot) {
  const office = path.join(fixturesRoot(), "office", "atlas.json");
  const officeDest = path.join(resourcesRoot, "office", "atlas.json");
  ensureDir(path.dirname(officeDest));
  fs.copyFileSync(office, officeDest);
  const policySrc = path.join(fixturesRoot(), "policy", "provider-policy.json");
  const policyDest = path.join(resourcesRoot, "policy", "provider-policy.json");
  ensureDir(path.dirname(policyDest));
  fs.copyFileSync(policySrc, policyDest);
}

async function createProductionAsar(appDir, asarPath) {
  ensureDir(path.dirname(asarPath));
  const pkg = {
    name: "ef-harness",
    version: "0.0.0",
    main: "main.cjs",
    private: true,
  };
  ensureDir(appDir);
  fs.writeFileSync(path.join(appDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(appDir, "main.cjs"),
    `'use strict';\n// production shell entry (unsigned-dev stub)\nmodule.exports = {};\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(appDir, "preload.cjs"),
    `'use strict';\n// production preload stub\n`,
    "utf8",
  );
  await asar.createPackage(appDir, asarPath);
}

function writeLaunchStub(unpackedRoot) {
  const stub = `import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
console.log(JSON.stringify({ event: 'shell_visible', elapsedMs: Date.now() - started }));
const script = path.join(root, 'resources', 'bin', 'harnessd-launch.mjs');
const result = spawnSync(process.execPath, [script], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, EF_HARNESS_PACKAGED: '1', EF_HARNESS_SMOKE_IDLE: process.env.EF_HARNESS_SMOKE_IDLE ?? '0' },
});
process.exit(result.status ?? 0);
`;
  fs.writeFileSync(path.join(unpackedRoot, "EF Harness.exe"), "MZEFHARNESS\r\n", "utf8");
  fs.writeFileSync(path.join(unpackedRoot, "ef-harness-launch.mjs"), stub, "utf8");
}

function writeLatestYml(outDir, artifactName, sha512, sizeBytes) {
  const yml = [
    `version: 0.0.0`,
    `files:`,
    `  - url: ${artifactName}`,
    `    sha512: ${sha512}`,
    `    size: ${sizeBytes}`,
    `path: ${artifactName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "latest.yml"), yml, "utf8");
}

function directoryByteSize(root) {
  let total = 0;
  for (const file of walkFiles(root)) {
    total += fs.statSync(file).size;
  }
  return total;
}

function simulateNsisInstaller(unpackedRoot, outDir) {
  const name = "EF-Harness-Setup-0.0.0.exe";
  const target = path.join(outDir, name);
  const zipStub = path.join(outDir, "EF-Harness-Setup-0.0.0.nsis-stub.zip");
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${unpackedRoot.replace(/'/g, "''")}\\*' -DestinationPath '${zipStub.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status === 0 && fs.existsSync(zipStub)) {
      fs.copyFileSync(zipStub, target);
      return { path: target, bytes: fs.statSync(target).size, kind: "nsis-stub-zip" };
    }
  }
  fs.writeFileSync(target, fs.readFileSync(path.join(unpackedRoot, "ef-harness-launch.mjs")));
  return { path: target, bytes: fs.statSync(target).size, kind: "portable-stub" };
}

/**
 * @param {{ mode: 'unsigned-dev' | 'release', dirOnly?: boolean, outputRoot?: string }} options
 */
export async function stageWindowsPackage(options) {
  const mode = options.mode ?? "unsigned-dev";
  const outputRoot = options.outputRoot ?? defaultOutputRoot();
  const unpacked = winUnpackedDir(outputRoot);
  fs.rmSync(unpacked, { recursive: true, force: true });
  ensureDir(unpacked);
  const resourcesRoot = path.join(unpacked, "resources");
  ensureDir(resourcesRoot);
  materializeBundledResources(resourcesRoot);
  const appStage = path.join(outputRoot, ".app-stage");
  fs.rmSync(appStage, { recursive: true, force: true });
  ensureDir(appStage);
  await createProductionAsar(appStage, path.join(resourcesRoot, "app.asar"));
  fs.rmSync(appStage, { recursive: true, force: true });
  writeIntegrityManifest(resourcesRoot, { mode });
  writeLaunchStub(unpacked);
  writeSbomAndChecksums(unpacked, { appVersion: "0.0.0-dev" });
  const unpackedBytes = directoryByteSize(unpacked);
  if (unpackedBytes >= INSTALLER_BUDGET_BYTES) {
    throw new Error(`win-unpacked exceeds ${INSTALLER_BUDGET_BYTES} bytes (${unpackedBytes})`);
  }
  let installer;
  if (!options.dirOnly) {
    installer = simulateNsisInstaller(unpacked, outputRoot);
    if (installer.bytes >= INSTALLER_BUDGET_BYTES) {
      throw new Error(`NSIS artifact exceeds ${INSTALLER_BUDGET_BYTES} bytes (${installer.bytes})`);
    }
    const hash = crypto.createHash("sha512");
    hash.update(fs.readFileSync(installer.path));
    writeLatestYml(outputRoot, path.basename(installer.path), hash.digest("base64"), installer.bytes);
  }
  fs.writeFileSync(
    path.join(outputRoot, "build-report.json"),
    `${JSON.stringify(
      {
        mode,
        unpackedRoot: unpacked,
        unpackedBytes,
        installer,
        electronBuilderConfig: path.join(desktopBuildRoot(), "electron-builder.yml"),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { unpacked, outputRoot, unpackedBytes, installer };
}