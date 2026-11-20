import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MXC_24H2_BUILD, MXC_25H2_BUILD, MXC_REVISION } from "./constants.js";
import type { MxcAvailability } from "./types.js";

export interface ProbeMxcOptions {
  readonly osBuild?: string;
  readonly platform?: NodeJS.Platform;
  readonly windowsProduct?: "windows_10" | "windows_11" | "other";
  readonly runtime?: { readonly exportPresent: boolean };
  readonly helperPresent?: boolean;
  readonly helperPath?: string;
  readonly parseOnly?: boolean;
}

export interface ParsedOsBuild {
  readonly build: number;
  readonly revision: number;
  readonly osBuild: string;
}

export function isMxcBuildEligible(buildNumber: number, revision: number): boolean {
  if (!Number.isFinite(buildNumber) || !Number.isFinite(revision)) return false;
  if (buildNumber === MXC_24H2_BUILD && revision >= MXC_REVISION) return true;
  if (buildNumber === MXC_25H2_BUILD && revision >= MXC_REVISION) return true;
  if (buildNumber > MXC_25H2_BUILD && revision >= 0) return true;
  if (buildNumber > MXC_24H2_BUILD && buildNumber < MXC_25H2_BUILD && revision >= MXC_REVISION) {
    return true;
  }
  return false;
}

export function parseOsBuild(text: string): ParsedOsBuild | null {
  const parts = text
    .trim()
    .split(".")
    .map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  let build = parts[0] ?? -1;
  let revision = 0;
  if (parts.length === 1) {
    build = parts[0] ?? -1;
  } else if (parts.length === 2) {
    build = parts[0] ?? -1;
    revision = parts[1] ?? 0;
  } else if (parts.length === 3) {
    build = parts[2] ?? -1;
  } else {
    build = parts[2] ?? -1;
    revision = parts[3] ?? 0;
  }
  if (!Number.isInteger(build) || build < 0) return null;
  return { build, revision, osBuild: `${build}.${revision}` };
}

let runtimeCache: Promise<{ readonly exportPresent: boolean; readonly detail: string }> | null = null;
let hostCache: Promise<MxcAvailability> | null = null;

export function clearMxcProbeCache(): void {
  runtimeCache = null;
  hostCache = null;
}

export async function probeMxcAvailability(options?: ProbeMxcOptions): Promise<MxcAvailability> {
  if (!options) {
    hostCache ??= probeHost();
    return hostCache;
  }
  return probeFromOptions(options);
}

async function probeHost(): Promise<MxcAvailability> {
  if (process.platform !== "win32") {
    return unavailable("not_windows", process.platform, false, false);
  }
  const identity = readWindowsBuild();
  if (!identity) return unavailable("os_build_unreadable", "unknown", false, false);
  const product = identity.build >= 22000 ? "windows_11" : "windows_10";
  return probeFromOptions({
    osBuild: identity.text,
    platform: "win32",
    windowsProduct: product,
  });
}

async function probeFromOptions(options: ProbeMxcOptions): Promise<MxcAvailability> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return unavailable("not_windows", options.osBuild ?? platform, false, false);
  }
  const parsed = options.osBuild ? parseOsBuild(options.osBuild) : null;
  if (options.osBuild && !parsed) {
    return unavailable("os_build_unreadable", options.osBuild, false, false);
  }
  const identity = parsed ?? readWindowsBuildParsed();
  if (!identity) return unavailable("os_build_unreadable", options.osBuild ?? "unknown", false, false);
  const product = options.windowsProduct ?? (identity.build >= 22000 ? "windows_11" : "windows_10");
  const buildEligible = product !== "windows_10" && isMxcBuildEligible(identity.build, identity.revision);
  if (!buildEligible) {
    return unavailable("os_build_too_old", identity.osBuild, false, false);
  }
  if (options.parseOnly) {
    return {
      available: true,
      osBuild: identity.osBuild,
      reason: null,
      policyBasedGrants: true,
      buildEligible: true,
      runtimeExportPresent: false,
      helperPresent: false,
      launchable: false,
      launchBlocker: "mxc_requires_pinned_helper",
    };
  }
  const runtime = options.runtime ?? (await probeRuntimeExport());
  const helper = options.helperPresent ?? helperFileExists(options.helperPath);
  const launchable = runtime.exportPresent && helper;
  let launchBlocker: MxcAvailability["launchBlocker"] = null;
  if (!runtime.exportPresent) launchBlocker = "mxc_runtime_export_missing";
  else if (!helper) launchBlocker = "mxc_requires_pinned_helper";
  return {
    available: true,
    osBuild: identity.osBuild,
    reason: null,
    policyBasedGrants: true,
    buildEligible: true,
    runtimeExportPresent: runtime.exportPresent,
    helperPresent: helper,
    launchable,
    launchBlocker,
  };
}

function unavailable(
  reason: NonNullable<MxcAvailability["reason"]>,
  osBuild: string,
  runtimeExportPresent: boolean,
  helperPresent: boolean,
): MxcAvailability {
  return {
    available: false,
    osBuild,
    reason,
    policyBasedGrants: false,
    buildEligible: false,
    runtimeExportPresent,
    helperPresent,
    launchable: false,
    launchBlocker: reason,
  };
}

function readWindowsBuildParsed(): ParsedOsBuild | null {
  const identity = readWindowsBuild();
  if (!identity) return null;
  return parseOsBuild(identity.text);
}

function readWindowsBuild(): { readonly build: number; readonly revision: number; readonly text: string } | null {
  const build = queryRegistry("CurrentBuild");
  const revision = queryRegistry("UBR");
  if (!Number.isFinite(build) || !Number.isFinite(revision)) return null;
  return { build, revision, text: `${build}.${revision}` };
}

function queryRegistry(valueName: string): number {
  const reg = path.join(systemRoot(), "System32", "reg.exe");
  const result = spawnSync(
    reg,
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "/v", valueName],
    { encoding: "utf8", windowsHide: true, shell: false },
  );
  if (result.status !== 0) return Number.NaN;
  const text = result.stdout ?? "";
  const dword = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(text);
  if (dword?.[1]) return Number.parseInt(dword[1], 16);
  const sz = /REG_SZ\s+(\d+)/.exec(text);
  if (sz?.[1]) return Number(sz[1]);
  return Number.NaN;
}

export function probeRuntimeExport(): Promise<{ readonly exportPresent: boolean; readonly detail: string }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ exportPresent: false, detail: "not_windows" });
  }
  runtimeCache ??= actuallyProbeRuntime();
  return runtimeCache;
}

function actuallyProbeRuntime(): Promise<{ readonly exportPresent: boolean; readonly detail: string }> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class EfMxcExportProbe {",
    "  [DllImport(\"kernel32\", SetLastError=true, CharSet=CharSet.Unicode)]",
    "  public static extern IntPtr LoadLibraryEx(string file, IntPtr h, uint flags);",
    "  [DllImport(\"kernel32\", SetLastError=true, CharSet=CharSet.Ansi)]",
    "  public static extern IntPtr GetProcAddress(IntPtr module, string name);",
    "  [DllImport(\"kernel32\", SetLastError=true)]",
    "  public static extern bool FreeLibrary(IntPtr module);",
    "}",
    "'@",
    "$mod = [EfMxcExportProbe]::LoadLibraryEx('processmodel.dll', [IntPtr]::Zero, 2048)",
    "if ($mod -eq [IntPtr]::Zero) { Write-Output 'absent'; exit 0 }",
    "$proc = [EfMxcExportProbe]::GetProcAddress($mod, 'Experimental_CreateProcessInSandbox')",
    "[EfMxcExportProbe]::FreeLibrary($mod) | Out-Null",
    "if ($proc -eq [IntPtr]::Zero) { Write-Output 'absent' } else { Write-Output 'present' }",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const powershell = path.join(systemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
    }, 20_000);
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).pop() ?? "";
      resolve({
        exportPresent: line === "present",
        detail: line === "present" ? "export_present" : stderr.trim() || line || "export_absent",
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exportPresent: false, detail: error.message });
    });
  });
}

export function resolveHelperPath(explicit?: string): string | null {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env.EF_HARNESS_MXC_HELPER;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return null;
}

function helperFileExists(explicit?: string): boolean {
  const candidate = resolveHelperPath(explicit);
  if (!candidate) return false;
  return fs.existsSync(candidate);
}

function systemRoot(): string {
  const value = process.env.SystemRoot;
  if (typeof value === "string" && value.length > 0) return value;
  return "C:\\Windows";
}
