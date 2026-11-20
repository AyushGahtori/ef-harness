import path from "node:path";
import { isGitInternal, isPathInside, resolveInsideWorktree } from "./cwd.js";

export type ShellOperator = "&&" | "||" | ";" | "|";

export interface PolicyRedirect {
  readonly kind: "stdout" | "stdout_append" | "stderr" | "stderr_append" | "stdin" | "merge_stderr";
  readonly target: string;
}

export interface PolicySegment {
  readonly operator: ShellOperator | null;
  readonly argv: readonly string[];
  readonly redirects: readonly PolicyRedirect[];
}

export interface PolicyDenial {
  readonly rule: string;
  readonly reason: string;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly denials: readonly PolicyDenial[];
  readonly segments: readonly PolicySegment[];
}

interface ParseState {
  readonly segments: PolicySegment[];
  readonly commandSubstitution: boolean;
  readonly unterminatedQuote: boolean;
  readonly background: boolean;
  readonly heredoc: boolean;
  readonly subshell: boolean;
}

const DOWNLOADERS = new Set([
  "curl",
  "wget",
  "invoke-webrequest",
  "iwr",
  "invoke-restmethod",
  "irm",
]);

const SHELLS = new Set(["sh", "bash", "cmd", "powershell", "pwsh", "zsh", "dash", "wsl"]);

const INTERPRETERS = new Set(["node", "python", "python3", "perl", "ruby"]);

const DELETE_TOOLS = new Set(["del", "erase", "rd", "rmdir", "rm", "remove-item", "ri", "unlink"]);

function executableBase(token: string): string {
  return path.win32
    .basename(token)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/i, "");
}

function denial(rule: string, reason: string): PolicyDenial {
  return { rule, reason };
}

export class CommandPolicyEvaluator {
  evaluate(input: {
    readonly command: string | readonly string[];
    readonly worktreePath: string;
    readonly cwd: string;
  }): PolicyDecision {
    const parsed =
      typeof input.command === "string"
        ? parseCommandLine(input.command)
        : {
            segments: [
              {
                operator: null,
                argv: [...input.command],
                redirects: [],
              },
            ] satisfies PolicySegment[],
            commandSubstitution: false,
            unterminatedQuote: false,
            background: false,
            heredoc: false,
            subshell: false,
          };
    const flags = {
      commandSubstitution: parsed.commandSubstitution,
      unterminatedQuote: parsed.unterminatedQuote,
      background: parsed.background,
      heredoc: parsed.heredoc,
      subshell: parsed.subshell,
    };
    const expanded = expandShells(parsed.segments, flags);
    const denials: PolicyDenial[] = [];
    if (flags.commandSubstitution) {
      denials.push(denial("command_substitution", "command substitution is denied"));
    }
    if (flags.unterminatedQuote) {
      denials.push(denial("unparseable_command", "command has an unterminated quote"));
    }
    if (flags.background) {
      denials.push(denial("background_operator", "background operator & is denied"));
    }
    if (flags.heredoc) {
      denials.push(denial("heredoc_denied", "heredoc redirects are denied"));
    }
    if (flags.subshell) {
      denials.push(denial("subshell_denied", "subshells are denied"));
    }
    if (expanded.length === 0 || expanded.every((segment) => segment.argv.length === 0)) {
      denials.push(denial("empty_command", "command is empty"));
    }
    for (let index = 0; index < expanded.length; index += 1) {
      const segment = expanded[index];
      const next = expanded[index + 1];
      if (segment === undefined) continue;
      if (
        next !== undefined &&
        next.operator === "|" &&
        DOWNLOADERS.has(executableBase(segment.argv[0] ?? "")) &&
        (SHELLS.has(executableBase(next.argv[0] ?? "")) ||
          INTERPRETERS.has(executableBase(next.argv[0] ?? "")))
      ) {
        denials.push(
          denial(
            "piped_shell_download",
            `${executableBase(segment.argv[0] ?? "")} piped to a shell is denied`,
          ),
        );
      }
    }
    for (const segment of expanded) {
      denials.push(...this.checkSegment(segment, input.worktreePath, input.cwd));
    }
    return {
      allowed: denials.length === 0,
      denials,
      segments: expanded,
    };
  }

  private checkSegment(segment: PolicySegment, worktreePath: string, cwd: string): PolicyDenial[] {
    if (segment.argv.length === 0) {
      return [denial("empty_command", "a pipeline segment is empty")];
    }
    const found: PolicyDenial[] = [];
    for (const redirect of segment.redirects) {
      if (redirect.kind === "merge_stderr") continue;
      const resolved = resolveInsideWorktree(worktreePath, cwd, redirect.target);
      if (resolved === null) {
        found.push(
          denial("redirect_escape", `redirect escapes the attempt worktree: ${redirect.target}`),
        );
      }
    }
    const piped = segment.operator === "|";
    if (piped && segment.redirects.some((redirect) => redirect.kind === "stdout" || redirect.kind === "stdout_append")) {
      found.push(denial("redirect_conflicts_with_pipe", "stdout redirect conflicts with a pipe"));
    }
    const exe = executableBase(segment.argv[0] ?? "");
    if (unwrapShell(segment) === "interactive") {
      found.push(denial("interactive_shell", `${exe} without a command string is denied`));
    }
    const hard = hardDeny(segment.argv, worktreePath, cwd);
    if (hard !== null) found.push(hard);
    if (hard === null && !isAllowlisted(segment.argv, worktreePath, cwd)) {
      found.push(denial("not_allowlisted", `${exe || "command"} is not on the command allowlist`));
    }
    return found;
  }
}

function hardDeny(argv: readonly string[], worktreePath: string, cwd: string): PolicyDenial | null {
  const exe = executableBase(argv[0] ?? "");
  if (exe === "git") {
    const sub = gitSubcommand(argv);
    if (sub === "push") return denial("git_push", "git push is denied");
    if (sub === "checkout" || sub === "switch") {
      return denial("git_checkout", `git ${sub} is denied`);
    }
    if (sub === "commit") return denial("git_commit", "git commit is denied");
    if (sub === "reset") {
      const hard = argv.some((arg) => arg === "--hard" || arg === "-hard");
      return hard
        ? denial("git_reset_hard", "git reset --hard is denied")
        : denial("git_not_readonly", "git reset is denied");
    }
    if (sub !== null && sub !== "status" && sub !== "diff") {
      return denial("git_not_readonly", `git ${sub} is not a read-only status or diff`);
    }
    if (gitGlobalPathEscapes(argv, worktreePath, cwd)) {
      return denial("git_dir_escape", "git -C escapes the attempt worktree");
    }
  }
  if (isNetworkInstaller(argv)) {
    return denial("network_installer", `${exe} installer invocation is denied`);
  }
  if (DOWNLOADERS.has(exe)) {
    return denial("network_fetch", `${exe} is denied`);
  }
  if (DELETE_TOOLS.has(exe)) {
    const outside = deleteTargets(argv).filter((target) => !targetInside(worktreePath, cwd, target));
    if (outside.length > 0) {
      return denial(
        "destructive_delete_outside_worktree",
        `destructive delete escapes the attempt worktree: ${outside[0] ?? ""}`,
      );
    }
  }
  return null;
}

function isAllowlisted(argv: readonly string[], worktreePath: string, cwd: string): boolean {
  const exe = executableBase(argv[0] ?? "");
  if (exe === "node") return nodeAllowed(argv, worktreePath, cwd);
  if (exe === "git") {
    const sub = gitSubcommand(argv);
    return sub === "status" || sub === "diff";
  }
  if (exe === "pnpm" || exe === "npm" || exe === "yarn") {
    return packageManagerAllowed(argv, worktreePath, cwd);
  }
  if (exe === "python" || exe === "python3") return pythonAllowed(argv, worktreePath, cwd);
  if (exe === "pytest" || exe === "vitest" || exe === "jest" || exe === "playwright") return true;
  if (exe === "tsc" || exe === "eslint" || exe === "prettier" || exe === "biome" || exe === "stylelint") {
    return true;
  }
  if (exe === "rustc") return true;
  if (exe === "go") {
    const sub = firstSubcommand(argv);
    return sub === "test" || sub === "build" || sub === "vet" || sub === "fmt";
  }
  if (exe === "cargo") {
    const sub = firstSubcommand(argv);
    return sub === "test" || sub === "build" || sub === "check" || sub === "clippy" || sub === "fmt";
  }
  if (exe === "vite") return true;
  if (exe === "next") {
    const sub = firstSubcommand(argv);
    return sub === null || sub === "dev" || sub === "build" || sub === "lint" || sub === "test" || sub === "start";
  }
  return false;
}

function nodeAllowed(argv: readonly string[], worktreePath: string, cwd: string): boolean {
  let index = 1;
  let sawEval = false;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print") {
      sawEval = true;
      index += 2;
      continue;
    }
    if (arg === "-r" || arg === "--require" || arg === "--import") {
      const loaded = argv[index + 1];
      if (loaded !== undefined && !loaded.startsWith("-") && !pathInside(worktreePath, cwd, loaded)) {
        return false;
      }
      index += 2;
      continue;
    }
    if (arg === "--") {
      const script = argv[index + 1];
      return script !== undefined && pathInside(worktreePath, cwd, script);
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return pathInside(worktreePath, cwd, arg);
  }
  return sawEval;
}

function pythonAllowed(argv: readonly string[], worktreePath: string, cwd: string): boolean {
  const moduleFlag = argv.indexOf("-m");
  if (moduleFlag >= 0) {
    const moduleName = argv[moduleFlag + 1];
    return moduleName === "pytest" || moduleName === "unittest";
  }
  const script = argv.find((arg, index) => index > 0 && !arg.startsWith("-"));
  return script !== undefined && pathInside(worktreePath, cwd, script);
}

function packageManagerAllowed(
  argv: readonly string[],
  worktreePath: string,
  cwd: string,
): boolean {
  const sub = firstSubcommand(argv);
  if (sub === null) return false;
  if (
    sub === "test" ||
    sub === "lint" ||
    sub === "build" ||
    sub === "format" ||
    sub === "check" ||
    sub === "typecheck" ||
    sub === "dev"
  ) {
    return true;
  }
  if (sub === "run") return true;
  if (sub === "exec") {
    const rest = argsAfterSubcommand(argv, "exec");
    if (rest.length === 0) return false;
    return isAllowlisted(rest, worktreePath, cwd) && hardDeny(rest, worktreePath, cwd) === null;
  }
  return false;
}

function isNetworkInstaller(argv: readonly string[]): boolean {
  const exe = executableBase(argv[0] ?? "");
  const sub = firstSubcommand(argv);
  if ((exe === "pnpm" || exe === "yarn") && (sub === "add" || sub === "install" || sub === "i" || sub === "update" || sub === "dlx" || sub === "create")) {
    return true;
  }
  if (exe === "npm" && (sub === "install" || sub === "i" || sub === "add" || sub === "ci" || sub === "update")) {
    return true;
  }
  if ((exe === "pip" || exe === "pip3") && sub === "install") return true;
  if ((exe === "python" || exe === "python3") && argv.includes("-m")) {
    const moduleFlag = argv.indexOf("-m");
    if (argv[moduleFlag + 1] === "pip" && argv.includes("install")) return true;
  }
  if (exe === "cargo" && sub === "install") return true;
  if (exe === "go" && sub === "install") return true;
  if (exe === "gem" && sub === "install") return true;
  return false;
}

function gitSubcommand(argv: readonly string[]): string | null {
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) return null;
    if (arg === "-C" || arg === "-c" || arg === "--git-dir" || arg === "--work-tree" || arg === "--namespace") {
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return arg.toLowerCase();
  }
  return null;
}

function gitGlobalPathEscapes(argv: readonly string[], worktreePath: string, cwd: string): boolean {
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree") {
      const target = argv[index + 1];
      if (target !== undefined && !pathInside(worktreePath, cwd, target)) return true;
    }
  }
  return false;
}

function firstSubcommand(argv: readonly string[]): string | null {
  const valueFlags = new Set(["--dir", "--filter", "-C", "--prefix", "-F", "--loglevel", "--workspace-root"]);
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) return null;
    if (arg === "--") {
      return argv[index + 1]?.toLowerCase() ?? null;
    }
    if (valueFlags.has(arg)) {
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return arg.toLowerCase();
  }
  return null;
}

function argsAfterSubcommand(argv: readonly string[], name: string): string[] {
  const valueFlags = new Set(["--dir", "--filter", "-C", "--prefix", "-F", "--loglevel"]);
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) return [];
    if (arg === "--") {
      const next = argv[index + 1];
      if (next?.toLowerCase() === name) return argv.slice(index + 2).filter((item) => item !== "--");
      return [];
    }
    if (valueFlags.has(arg)) {
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    if (arg.toLowerCase() === name) {
      return argv.slice(index + 1).filter((item) => item !== "--");
    }
    return [];
  }
  return [];
}

function deleteTargets(argv: readonly string[]): string[] {
  const exe = executableBase(argv[0] ?? "");
  const targets: string[] = [];
  const valueFlags = new Set(["-path", "-literalpath", "--path", "--literalpath"]);
  let operands = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--") {
      operands = true;
      continue;
    }
    if (!operands && (exe === "remove-item" || exe === "ri") && valueFlags.has(arg.toLowerCase())) {
      const next = argv[index + 1];
      if (next !== undefined) targets.push(next);
      index += 1;
      continue;
    }
    if (!operands && arg.startsWith("-")) continue;
    if (!operands && (exe === "del" || exe === "erase" || exe === "rd" || exe === "rmdir") && arg.startsWith("/")) {
      continue;
    }
    targets.push(arg);
  }
  return targets;
}

function pathInside(worktreePath: string, cwd: string, target: string): boolean {
  return resolveInsideWorktree(worktreePath, cwd, target) !== null && containsLexically(worktreePath, cwd, target);
}

function containsLexically(worktreePath: string, cwd: string, target: string): boolean {
  const root = path.resolve(worktreePath);
  const lexical = path.resolve(cwd, target);
  return isPathInside(root, lexical) && !isGitInternal(root, lexical);
}

function targetInside(worktreePath: string, cwd: string, target: string): boolean {
  return containsLexically(worktreePath, cwd, target);
}

interface ParseFlags {
  commandSubstitution: boolean;
  unterminatedQuote: boolean;
  background: boolean;
  heredoc: boolean;
  subshell: boolean;
}

function expandShells(segments: readonly PolicySegment[], flags: ParseFlags): PolicySegment[] {
  return expandShellsLimited(segments, 0, flags);
}

function absorb(flags: ParseFlags, parsed: ParseState): void {
  if (parsed.commandSubstitution) flags.commandSubstitution = true;
  if (parsed.unterminatedQuote) flags.unterminatedQuote = true;
  if (parsed.background) flags.background = true;
  if (parsed.heredoc) flags.heredoc = true;
  if (parsed.subshell) flags.subshell = true;
}

function expandShellsLimited(
  segments: readonly PolicySegment[],
  depth: number,
  flags: ParseFlags,
): PolicySegment[] {
  if (depth > 4) return [...segments];
  const expanded: PolicySegment[] = [];
  for (const segment of segments) {
    const nested = unwrapShell(segment);
    if (nested === null || nested === "interactive") {
      expanded.push(segment);
      continue;
    }
    const parsed = parseCommandLine(nested);
    absorb(flags, parsed);
    const inner = expandShellsLimited(parsed.segments, depth + 1, flags);
    const [first, ...rest] = inner;
    if (first === undefined) {
      expanded.push(segment);
      continue;
    }
    expanded.push({ ...first, operator: segment.operator });
    expanded.push(...rest);
  }
  return expanded;
}

function unwrapShell(segment: PolicySegment): string | "interactive" | null {
  const exe = executableBase(segment.argv[0] ?? "");
  if (exe === "cmd") {
    const index = segment.argv.findIndex((arg) => arg.toLowerCase() === "/c" || arg.toLowerCase() === "-c");
    if (index === -1) return "interactive";
    const rest = segment.argv.slice(index + 1);
    if (rest.length === 0) return "interactive";
    return rest.join(" ");
  }
  if (SHELLS.has(exe) && exe !== "cmd") {
    const index = segment.argv.findIndex((arg) => {
      const lower = arg.toLowerCase();
      return lower === "-c" || lower === "/c" || lower === "-command" || lower === "/command";
    });
    if (index === -1) return "interactive";
    const command = segment.argv[index + 1];
    if (command === undefined) return "interactive";
    return command;
  }
  return null;
}

function parseCommandLine(input: string): ParseState {
  const tokens: { type: "word" | "op" | "redirect"; value: string }[] = [];
  let commandSubstitution = false;
  let unterminatedQuote = false;
  let background = false;
  let heredoc = false;
  let subshell = false;
  let quote: "'" | '"' | null = null;
  let buf = "";
  const flush = (): void => {
    if (buf.length > 0) {
      tokens.push({ type: "word", value: buf });
      buf = "";
    }
  };
  let index = 0;
  while (index < input.length) {
    const char = input[index] ?? "";
    if (quote === "'") {
      if (char === "'") {
        quote = null;
        index += 1;
        continue;
      }
      buf += char;
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        index += 1;
        continue;
      }
      if (char === "\\" && index + 1 < input.length) {
        const next = input[index + 1] ?? "";
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          buf += next;
          index += 2;
          continue;
        }
      }
      if (char === "`") commandSubstitution = true;
      if (char === "$" && input[index + 1] === "(") commandSubstitution = true;
      buf += char;
      index += 1;
      continue;
    }
    if (char === "'") {
      quote = "'";
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = '"';
      index += 1;
      continue;
    }
    if (char === "`") {
      commandSubstitution = true;
      index += 1;
      continue;
    }
    if (char === "$" && input[index + 1] === "(") {
      commandSubstitution = true;
      buf += char;
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      subshell = true;
      flush();
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      flush();
      index += 1;
      continue;
    }
    if (char === "\n") {
      flush();
      tokens.push({ type: "op", value: ";" });
      index += 1;
      continue;
    }
    if (buf.length === 0 && input.startsWith("2>&1", index)) {
      tokens.push({ type: "redirect", value: "2>&1" });
      index += 4;
      continue;
    }
    if (buf.length === 0 && input.startsWith(">&1", index)) {
      tokens.push({ type: "redirect", value: "2>&1" });
      index += 3;
      continue;
    }
    if (buf.length === 0 && input.startsWith("2>>", index)) {
      tokens.push({ type: "redirect", value: "2>>" });
      index += 3;
      continue;
    }
    if (buf.length === 0 && input.startsWith("2>", index)) {
      tokens.push({ type: "redirect", value: "2>" });
      index += 2;
      continue;
    }
    const two = input.slice(index, index + 2);
    if (two === "&&" || two === "||" || two === ">>" || two === "<<") {
      flush();
      if (two === "<<") heredoc = true;
      tokens.push({ type: two === ">>" || two === "<<" ? "redirect" : "op", value: two });
      index += 2;
      continue;
    }
    if (char === "&") {
      flush();
      background = true;
      index += 1;
      continue;
    }
    if (char === ";" || char === "|" || char === ">" || char === "<") {
      flush();
      tokens.push({
        type: char === ">" || char === "<" ? "redirect" : "op",
        value: char,
      });
      index += 1;
      continue;
    }
    buf += char;
    index += 1;
  }
  flush();
  if (quote !== null) unterminatedQuote = true;
  return {
    ...tokensToSegments(tokens),
    commandSubstitution,
    unterminatedQuote,
    background,
    heredoc,
    subshell,
  };
}

function tokensToSegments(tokens: { type: "word" | "op" | "redirect"; value: string }[]): {
  segments: PolicySegment[];
} {
  const segments: PolicySegment[] = [];
  let operator: ShellOperator | null = null;
  let argv: string[] = [];
  let redirects: PolicyRedirect[] = [];
  const push = (): void => {
    if (argv.length === 0 && redirects.length === 0 && operator === null && segments.length === 0) return;
    segments.push({ operator, argv, redirects });
    operator = null;
    argv = [];
    redirects = [];
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.type === "op") {
      push();
      if (token.value === "&&" || token.value === "||" || token.value === ";" || token.value === "|") {
        operator = token.value;
      }
      continue;
    }
    if (token.type === "redirect") {
      if (token.value === "2>&1") {
        redirects.push({ kind: "merge_stderr", target: "&1" });
        continue;
      }
      if (token.value === "<<") continue;
      const target = tokens[index + 1];
      if (target?.type === "word") {
        index += 1;
        redirects.push({ kind: redirectKind(token.value), target: target.value });
      }
      continue;
    }
    argv.push(token.value);
  }
  push();
  return { segments };
}

function redirectKind(value: string): PolicyRedirect["kind"] {
  if (value === ">>") return "stdout_append";
  if (value === "2>") return "stderr";
  if (value === "2>>") return "stderr_append";
  if (value === "<") return "stdin";
  return "stdout";
}
