import fs from "node:fs";
import path from "node:path";
import { directSpawnSync } from "./spawn-direct.mjs";
import { systemExe } from "./helper-client.mjs";
import { isMxcBuildEligible } from "./build.mjs";

function queryRegistry(valueName) {
  const result = directSpawnSync(systemExe("reg.exe"), [
    "query",
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
    "/v",
    valueName,
  ], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const text = result.stdout || "";
  const dword = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(text);
  if (dword) return Number.parseInt(dword[1], 16);
  const sz = /REG_SZ\s+(\d+)/.exec(text);
  if (sz) return Number(sz[1]);
  return null;
}

export function readWindowsBuild() {
  const buildNumber = queryRegistry("CurrentBuild");
  const revision = queryRegistry("UBR");
  if (!Number.isFinite(buildNumber) || !Number.isFinite(revision)) {
    return { ok: false, buildNumber: buildNumber ?? null, revision: revision ?? null, text: null, eligible: false };
  }
  return {
    ok: true,
    buildNumber,
    revision,
    text: `${buildNumber}.${revision}`,
    eligible: isMxcBuildEligible(buildNumber, revision),
  };
}

export function findOnPath(name) {
  const result = directSpawnSync(systemExe("where.exe"), [name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const line = (result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line || null;
}

export function versionArgv(name) {
  if (name === "node") return [process.execPath, "--version"];
  const lines = whereLines(name);
  if (name === "pnpm") {
    const cmd = lines.find((line) => /\.(cmd|bat)$/i.test(line));
    if (cmd) {
      const entry = path.join(path.dirname(cmd), "node_modules", "pnpm", "bin", "pnpm.cjs");
      if (fs.existsSync(entry)) return [process.execPath, entry, "--version"];
    }
  }
  const exe = lines.find((line) => /\.exe$/i.test(line));
  const script = lines.find((line) => /\.(cmd|bat)$/i.test(line));
  const chosen = exe || script;
  if (!chosen) return null;
  if (/\.(cmd|bat)$/i.test(chosen)) {
    return [systemExe("cmd.exe"), "/d", "/c", chosen, "--version"];
  }
  return [chosen, "--version"];
}

function whereLines(name) {
  const result = directSpawnSync(systemExe("where.exe"), [name], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return (result.stdout || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function decodeOutput(buffer) {
  if (!buffer || buffer.length === 0) return "";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le");
  if (buffer.includes(0)) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

export function probeDocker() {
  const docker = findOnPath("docker");
  if (!docker) return { installed: false, running: false, reason: "docker_not_installed" };
  const info = directSpawnSync(docker, ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 8000,
  });
  if (info.error && info.error.code === "ETIMEDOUT") {
    return { installed: true, running: false, reason: "docker_info_timeout" };
  }
  if (info.status !== 0) {
    return {
      installed: true,
      running: false,
      reason: "daemon_not_running",
      detail: String(info.stderr || info.stdout || "").trim().slice(0, 300),
    };
  }
  return { installed: true, running: true, version: String(info.stdout || "").trim(), reason: null };
}

export function probeWsl() {
  const wsl = systemExe("wsl.exe");
  if (!fs.existsSync(wsl)) return { installed: false, reason: "wsl_exe_missing", distros: [] };
  const result = directSpawnSync(wsl, ["-l", "-q"], { encoding: "buffer", timeout: 8000 });
  if (result.error && result.error.code === "ETIMEDOUT") {
    return { installed: true, reason: "wsl_list_timeout", distros: [] };
  }
  const text = decodeOutput(result.stdout).replaceAll("\u0000", "");
  const distros = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/windows subsystem/i.test(line));
  return {
    installed: result.status === 0 || distros.length > 0,
    reason: result.status === 0 ? null : "wsl_list_failed",
    distros,
  };
}
