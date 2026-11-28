export const FORBIDDEN_DEVELOPER_CHECKOUT_SUBCOMMANDS = new Set([
  "stash",
  "clean",
]);

function argvImpliesForbiddenMutation(argv: readonly string[]): boolean {
  const lower = argv.map((arg) => arg.toLowerCase());
  const joined = lower.join(" ");
  if (joined.includes("stash")) return true;
  if (lower.includes("reset") && (lower.includes("--hard") || lower.includes("-hard"))) return true;
  if (lower.includes("checkout") && (lower.includes("-f") || lower.includes("--force"))) return true;
  if (lower.includes("clean") && (lower.includes("-fd") || lower.includes("-df") || lower.includes("-f"))) return true;
  return false;
}

export class ForbiddenDeveloperCheckoutCommandError extends Error {
  constructor(readonly argv: readonly string[]) {
    super(`Forbidden git command in developer checkout: ${argv.join(" ")}`);
    this.name = "ForbiddenDeveloperCheckoutCommandError";
  }
}

export function assertDeveloperCheckoutGitAllowed(argv: readonly string[]): void {
  if (argv.length === 0) return;
  const first = (argv[0] ?? "").toLowerCase();
  if (FORBIDDEN_DEVELOPER_CHECKOUT_SUBCOMMANDS.has(first)) {
    throw new ForbiddenDeveloperCheckoutCommandError(argv);
  }
  if (argvImpliesForbiddenMutation(argv)) {
    throw new ForbiddenDeveloperCheckoutCommandError(argv);
  }
}

export function isForbiddenDeveloperCheckoutGit(argv: readonly string[]): boolean {
  try {
    assertDeveloperCheckoutGitAllowed(argv);
    return false;
  } catch {
    return true;
  }
}