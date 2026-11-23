import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { verifyBundledBinaryIntegrity } from "../../../scripts/packaging/lib/integrity-manifest.mjs";
import { repoRoot } from "../../../scripts/packaging/lib/paths.mjs";
import { stageWindowsPackage } from "../../../scripts/packaging/lib/staging.mjs";

const UNICODE_PROFILE = "Temp Test Üser";

export class CleanMachineWinSmokeSuite {
  static defaultRoot() {
    return repoRoot();
  }

  constructor(root = CleanMachineWinSmokeSuite.defaultRoot()) {
    this.root = root;
    this.tempDirs = [];
  }

  dispose() {
    for (const dir of this.tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async ensurePackage(outputRoot) {
    const out = outputRoot ?? path.join(this.root, "apps", "desktop", "build", "dist", "e2e-smoke");
    const unpacked = path.join(out, "win-unpacked");
    if (!fs.existsSync(path.join(unpacked, "resources", "integrity-manifest.json"))) {
      await stageWindowsPackage({ mode: "unsigned-dev", dirOnly: true, outputRoot: out });
    }
    return { outputRoot: out, unpacked };
  }

  isolatedProfileDir() {
    const base = path.join(os.tmpdir(), "ef-harness-packaging-smoke");
    const profile = path.join(base, UNICODE_PROFILE, "ef harness");
    fs.mkdirSync(profile, { recursive: true });
    this.tempDirs.push(base);
    return profile;
  }

  strippedPathEnv(extra = []) {
    const blocked = /(^|;)(git|node|pnpm|npm)(\\|\/|$)/i;
    const parts = (process.env.PATH ?? "")
      .split(path.delimiter)
      .filter((entry) => entry && !blocked.test(entry));
    for (const entry of extra) {
      if (entry && !parts.includes(entry)) parts.unshift(entry);
    }
    return parts.join(path.delimiter);
  }

  async launchPackagedApp(unpacked, profileDir) {
    const launch = path.join(unpacked, "ef-harness-launch.mjs");
    const started = performance.now();
    const env = {
      ...process.env,
      PATH: this.strippedPathEnv(path.join(unpacked, "resources", "bin", "mingit", "cmd")),
      LOCALAPPDATA: profileDir,
      APPDATA: profileDir,
      EF_HARNESS_PACKAGED: "1",
      EF_HARNESS_SMOKE_IDLE: "1",
    };
  return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [launch], {
        cwd: unpacked,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        const elapsedMs = performance.now() - started;
        resolve({ code: code ?? 1, elapsedMs, stdout });
      });
    });
  }

  spawnHarnessd(unpacked, profileDir) {
    const script = path.join(unpacked, "resources", "bin", "harnessd-launch.mjs");
    const env = {
      ...process.env,
      PATH: this.strippedPathEnv(),
      LOCALAPPDATA: profileDir,
      APPDATA: profileDir,
    };
    const result = spawnSync(process.execPath, [script], {
      cwd: unpacked,
      env,
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: result.status ?? 1, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  mingitInit(unpacked, workDir) {
    fs.mkdirSync(workDir, { recursive: true });
    const git = path.join(unpacked, "resources", "bin", "mingit", "cmd", "git.cmd");
    const env = {
      ...process.env,
      PATH: this.strippedPathEnv(path.dirname(git)),
    };
    const init = spawnSync(git, ["init"], { cwd: workDir, env, encoding: "utf8", shell: true, windowsHide: true });
    const status = spawnSync(git, ["status"], {
      cwd: workDir,
      env,
      encoding: "utf8",
      shell: true,
      windowsHide: true,
    });
    return {
      ok: init.status === 0 && status.status === 0,
      stdout: `${init.stdout ?? ""}\n${status.stdout ?? ""}`,
    };
  }

  dpapiRoundTrip() {
    if (process.platform !== "win32") {
      return { ok: true, skipped: true };
    }
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$p=[System.Text.Encoding]::UTF8.GetBytes('ef-harness-packaging-smoke')",
      "$c=[System.Security.Cryptography.ProtectedData]::Protect($p,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "$o=[System.Security.Cryptography.ProtectedData]::Unprotect($c,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "$t=[System.Text.Encoding]::UTF8.GetString($o)",
      "if ($t -ne 'ef-harness-packaging-smoke') { exit 2 }",
    ].join("; ");
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true },
    );
    return { ok: result.status === 0, skipped: false, stderr: result.stderr };
  }

  countHarnessProcesses() {
    if (process.platform !== "win32") return 0;
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'EF Harness|harnessd' } | Measure-Object).Count",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const count = Number.parseInt((result.stdout ?? "0").trim(), 10);
    return Number.isFinite(count) ? count : 0;
  }

  async runAll(options = {}) {
    const { outputRoot, unpacked } = await this.ensurePackage(options.outputRoot);
    const profile = this.isolatedProfileDir();
    const resources = path.join(unpacked, "resources");
    const issues = [];
    const integrity = verifyBundledBinaryIntegrity(resources);
    if (integrity.percent !== 100) {
      issues.push(`integrity ${integrity.percent}%`);
    }
    const launch = await this.launchPackagedApp(unpacked, profile);
    if (launch.elapsedMs >= 4000) {
      issues.push(`cold launch ${Math.round(launch.elapsedMs)}ms >= 4000ms`);
    }
    const harnessd = this.spawnHarnessd(unpacked, profile);
    if (harnessd.status !== 0) {
      issues.push(`harnessd exit ${harnessd.status}`);
    } else if (!/harnessd_ready/.test(harnessd.stdout)) {
      issues.push("harnessd did not report ready");
    }
    const repoDir = path.join(profile, "repos", "smoke-init");
    const mingit = this.mingitInit(unpacked, repoDir);
    if (!mingit.ok) {
      issues.push("bundled MinGit init/status failed");
    }
    const dpapi = this.dpapiRoundTrip();
    if (!dpapi.ok && !dpapi.skipped) {
      issues.push("DPAPI round-trip failed");
    }
    const skillCount = fs
      .readdirSync(path.join(resources, "corpus", "skills"))
      .filter((name) => name.endsWith(".md")).length;
    if (skillCount < 20) {
      issues.push(`expected 20 bundled skills, saw ${skillCount}`);
    }
    const questionMeta = JSON.parse(fs.readFileSync(path.join(resources, "corpus", "questions.json"), "utf8"));
    if (questionMeta.count !== 87) {
      issues.push(`expected 87 corpus questions, saw ${questionMeta.count}`);
    }
    const alive = this.countHarnessProcesses();
    if (alive > 0) {
      issues.push(`expected 0 harness processes after quit, saw ${alive}`);
    }
    return {
      ok: issues.length === 0,
      issues,
      launchMs: launch.elapsedMs,
      outputRoot,
      unpacked,
      integrityPercent: integrity.percent,
      dpapi,
    };
  }

  static formatIssues(issues) {
    return issues.map((item) => `- ${item}`).join("\n");
  }
}