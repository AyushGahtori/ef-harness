import path from "node:path";
import type { PackageManager } from "./types.js";

export interface InstallCommand {
  readonly file: string;
  readonly args: readonly string[];
}

export function packageInstallCommand(input: {
  readonly manager: PackageManager;
  readonly storeDir: string;
  readonly offline: boolean;
}): InstallCommand {
  if (input.manager === "pnpm") {
    const args = [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.strict-dep-builds=true",
      "--store-dir",
      input.storeDir,
    ];
    if (input.offline) args.push("--offline");
    return { file: "pnpm", args };
  }
  if (input.manager === "npm") {
    return { file: "npm", args: ["ci", "--ignore-scripts"] };
  }
  return { file: "yarn", args: ["install", "--immutable", "--ignore-scripts"] };
}

export function renderCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

const INSTALL_SUBCOMMANDS = new Set(["add", "install", "i", "ci", "update", "upgrade", "import"]);

function commandBase(file: string): string {
  return path.basename(file).toLowerCase().replace(/\.cmd$/, "").replace(/\.exe$/, "");
}

/** Package-manager installs workers must not run through harness.run. */
export function isWorkerPackageManagerInstall(file: string, args: readonly string[]): boolean {
  const base = commandBase(file);
  const sub = (args[0] ?? "").toLowerCase();
  if ((base === "pnpm" || base === "npm" || base === "yarn") && INSTALL_SUBCOMMANDS.has(sub)) return true;
  if ((base === "pip" || base === "pip3") && sub === "install") return true;
  return false;
}
