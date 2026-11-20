import path from "node:path";
import { DockerLeastPrivilegeError } from "./errors.js";
import { scrubContainerEnv } from "./environment.js";
import type { LinuxParityKind } from "./types.js";

export interface TierDRunSpec {
  readonly projectId: string;
  readonly attemptId: string;
  readonly commandId: string;
  readonly worktreePath: string;
  readonly tempPath: string;
  readonly packageStorePath: string;
  readonly image: string;
  readonly command: readonly string[];
  readonly memoryBytes?: number;
  readonly pidsLimit?: number;
  readonly cpus?: number;
  readonly user?: string;
  readonly proxyNetwork?: string;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly linuxParity?: LinuxParityKind;
}

const FORBIDDEN_NETWORKS = new Set(["host", "bridge", "default", "none"]);
const DEFAULT_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_PIDS = 256;
const DEFAULT_CPUS = 1;

export function sanitizeDockerId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[^A-Za-z0-9]+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 63) : "unknown";
}

export function dockerMountPath(target: string): string {
  return target.replaceAll("\\", "/");
}

export function linuxParityShell(kind: LinuxParityKind): string {
  if (kind === "filename_case") {
    return "find /workspace -print | tr '[:upper:]' '[:lower:]' | sort | uniq -d";
  }
  if (kind === "line_endings") {
    return "find /workspace -type f -print0 | xargs -0 grep -l $'\\r' || true";
  }
  if (kind === "path_separator") {
    return "grep -R -n '\\\\' /workspace || true";
  }
  return "node -p process.platform || python3 -c 'import sys; print(sys.platform)' || true";
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DockerLeastPrivilegeError(`Tier D ${name} must be a positive limit.`);
  }
}

function containerEnv(spec: TierDRunSpec): Record<string, string> {
  const base: Record<string, string> = {
    HOME: "/tmp",
    TEMP: "/tmp",
    TMP: "/tmp",
    TMPDIR: "/tmp",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    EF_HARNESS_ATTEMPT_ID: spec.attemptId,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.autocrlf",
    GIT_CONFIG_VALUE_0: "false",
    LANG: "C.UTF-8",
  };
  if (spec.proxyNetwork) {
    base.HTTP_PROXY = "http://127.0.0.1:9";
    base.HTTPS_PROXY = "http://127.0.0.1:9";
    base.NO_PROXY = "localhost,127.0.0.1,::1";
  }
  return scrubContainerEnv(spec.extraEnv, base);
}

export function buildTierDContainerArgs(spec: TierDRunSpec): string[] {
  const memoryBytes = spec.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  const pidsLimit = spec.pidsLimit ?? DEFAULT_PIDS;
  const cpus = spec.cpus ?? DEFAULT_CPUS;
  requirePositive("memory", memoryBytes);
  requirePositive("pids", pidsLimit);
  requirePositive("cpus", cpus);
  let network = "none";
  if (spec.proxyNetwork) {
    if (FORBIDDEN_NETWORKS.has(spec.proxyNetwork) || !/^ef-proxy-[a-z0-9-]+$/.test(spec.proxyNetwork)) {
      throw new DockerLeastPrivilegeError(
        "Tier D only allows --network none or an ef-proxy-* loopback sidecar network.",
      );
    }
    network = spec.proxyNetwork;
  }
  const worktree = dockerMountPath(spec.worktreePath);
  const git = dockerMountPath(path.posix.join(worktree, ".git"));
  const store = dockerMountPath(spec.packageStorePath);
  const temp = dockerMountPath(spec.tempPath);
  const args = [
    "run",
    "--name",
    sanitizeDockerId(`ef-harness-${spec.attemptId}-${spec.commandId}`),
    "--label",
    "ef-harness.managed=true",
    "--label",
    `ef-harness.project=${sanitizeDockerId(spec.projectId)}`,
    "--label",
    `ef-harness.attempt=${sanitizeDockerId(spec.attemptId)}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--network",
    network,
    "--pids-limit",
    String(pidsLimit),
    "--memory",
    String(memoryBytes),
    "--cpus",
    String(cpus),
    "--user",
    spec.user ?? "1000:1000",
    "--mount",
    `type=bind,source=${worktree},target=/workspace`,
    "--mount",
    `type=bind,source=${git},target=/workspace/.git,readonly`,
    "--mount",
    `type=bind,source=${store},target=/pnpm-store,readonly`,
    "--mount",
    `type=bind,source=${temp},target=/tmp`,
    "-w",
    "/workspace",
    "--rm",
  ];
  for (const [key, value] of Object.entries(containerEnv(spec))) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(spec.image);
  if (spec.linuxParity) {
    args.push("sh", "-c", linuxParityShell(spec.linuxParity));
  } else {
    args.push(...spec.command);
  }
  return args;
}

export function assertLeastPrivilegeArgs(args: readonly string[]): void {
  const required = ["--cap-drop", "--network", "--pids-limit", "--memory", "--security-opt", "--user"];
  for (const flag of required) {
    if (!args.includes(flag)) throw new DockerLeastPrivilegeError(`Tier D args missing ${flag}.`);
  }
  const cap = args[args.indexOf("--cap-drop") + 1];
  const network = args[args.indexOf("--network") + 1];
  const security = args[args.indexOf("--security-opt") + 1];
  if (cap !== "ALL" || security !== "no-new-privileges") {
    throw new DockerLeastPrivilegeError("Tier D container is missing cap-drop ALL or no-new-privileges.");
  }
  if (network !== "none" && !network?.startsWith("ef-proxy-")) {
    throw new DockerLeastPrivilegeError("Tier D network is not none or an ef-proxy sidecar.");
  }
  if (args.includes("--privileged") || args.includes("--cap-add")) {
    throw new DockerLeastPrivilegeError("Tier D container requested extra privileges.");
  }
  if (!args.includes("ef-harness.managed=true")) {
    throw new DockerLeastPrivilegeError("Tier D container is missing the managed orphan label.");
  }
}
