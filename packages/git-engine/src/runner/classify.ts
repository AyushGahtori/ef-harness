import { DeveloperCheckoutMutationError, LineEndingProtectionError } from "./types.js";

const READ_ONLY_COMMANDS = new Set([
  "status",
  "rev-parse",
  "symbolic-ref",
  "diff",
  "merge-tree",
  "log",
  "ls-files",
  "ls-tree",
  "version",
  "help",
]);

const CONFIG_READ_FLAGS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--list",
  "-l",
  "--show-origin",
  "--show-scope",
  "--show-names",
]);

const CONFIG_WRITE_FLAGS = new Set([
  "--unset",
  "--unset-all",
  "--replace-all",
  "--add",
  "--rename-section",
  "--remove-section",
  "--edit",
]);

const VALUE_GLOBAL_OPTIONS = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
  "--exec-path",
  "--list-cmds",
]);

export interface ExtractedCommand {
  readonly command: string | null;
  readonly index: number;
}

export function extractSubcommand(args: readonly string[]): ExtractedCommand {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      return { command: null, index: -1 };
    }
    if (arg === "--version" || arg === "--help") {
      return { command: arg, index };
    }
    if (VALUE_GLOBAL_OPTIONS.has(arg)) {
      index += 2;
      continue;
    }
    if (
      arg.startsWith("--git-dir=") ||
      arg.startsWith("--work-tree=") ||
      arg.startsWith("--namespace=") ||
      arg.startsWith("--super-prefix=") ||
      arg.startsWith("--config-env=") ||
      arg.startsWith("--exec-path=") ||
      arg.startsWith("--list-cmds=")
    ) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-c") && arg.length > 2) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return { command: arg, index };
  }
  return { command: null, index: -1 };
}

function symbolicRefIsReadOnly(args: readonly string[], commandIndex: number): boolean {
  const after = args.slice(commandIndex + 1);
  if (after.some((arg) => arg === "--delete")) return false;
  const positional = after.filter((arg) => !arg.startsWith("-"));
  return positional.length <= 1;
}

function configIsReadOnly(args: readonly string[], commandIndex: number): boolean {
  const after = args.slice(commandIndex + 1);
  if (after.some((arg) => CONFIG_WRITE_FLAGS.has(arg))) return false;
  if (after.some((arg) => CONFIG_READ_FLAGS.has(arg))) return true;
  const positional = after.filter((arg) => !arg.startsWith("-"));
  return positional.length <= 1;
}

export function commandIsReadOnly(args: readonly string[]): boolean {
  const extracted = extractSubcommand(args);
  if (extracted.command === null) {
    return args.includes("--version") || args.includes("--help");
  }
  if (extracted.command === "--version" || extracted.command === "--help") return true;
  if (extracted.command === "symbolic-ref") return symbolicRefIsReadOnly(args, extracted.index);
  if (extracted.command === "config") return configIsReadOnly(args, extracted.index);
  return READ_ONLY_COMMANDS.has(extracted.command);
}

export function isLineEndingOverride(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-c" || arg === "--config-env") {
      const value = args[index + 1] ?? "";
      if (/core\.autocrlf/i.test(value)) return true;
    } else if (/^-c.*core\.autocrlf/i.test(arg) || /^--config-env=.*core\.autocrlf/i.test(arg)) {
      return true;
    }
  }
  const extracted = extractSubcommand(args);
  if (extracted.command !== "config" || extracted.index < 0) return false;
  const after = args.slice(extracted.index + 1).join("\n");
  if (!/core\.autocrlf/i.test(after)) return false;
  return !configIsReadOnly(args, extracted.index);
}

export function assertLineEndingsPreserved(args: readonly string[]): void {
  if (isLineEndingOverride(args)) throw new LineEndingProtectionError();
}

export function assertNeverMutatesDeveloperCheckout(input: {
  readonly args: readonly string[];
  readonly developerCheckout: boolean;
  readonly userExplicitConsentToken?: string;
}): void {
  if (!input.developerCheckout) return;
  if (commandIsReadOnly(input.args)) return;
  const token = input.userExplicitConsentToken?.trim() ?? "";
  if (token.length > 0) return;
  const command = extractSubcommand(input.args).command ?? "(unknown)";
  throw new DeveloperCheckoutMutationError(command);
}

export function isStatusCommand(args: readonly string[]): boolean {
  return extractSubcommand(args).command === "status";
}

export function buildGitArgs(userArgs: readonly string[]): string[] {
  return ["-c", "core.longpaths=true", "-c", "core.quotepath=false", ...userArgs];
}
