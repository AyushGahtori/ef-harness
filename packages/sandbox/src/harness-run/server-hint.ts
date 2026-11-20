import path from "node:path";

const LISTENING_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/\S*)?/i;

export function looksLikeDevServer(commandText: string): boolean {
  const parts = commandText.split(/&&|\|\||[;|\n]/);
  return parts.some((part) => {
    const tokens = part.trim().split(/\s+/).filter((token) => token.length > 0);
    const first = tokens[0];
    if (first === undefined) return false;
    const exe = path.win32
      .basename(first)
      .toLowerCase()
      .replace(/\.(exe|cmd|bat)$/i, "");
    const rest = tokens.slice(1).map((token) => token.toLowerCase());
    if ((exe === "pnpm" || exe === "npm" || exe === "yarn") && rest[0] === "dev") return true;
    if (
      (exe === "pnpm" || exe === "npm" || exe === "yarn") &&
      rest[0] === "run" &&
      rest[1] === "dev"
    ) {
      return true;
    }
    if (exe === "next" && rest[0] === "dev") return true;
    if (exe === "vite") return true;
    return false;
  });
}

export function serverRejectionHint(
  commandText: string,
  output: string,
  timedOut: boolean,
): string | null {
  if (!timedOut) return null;
  if (!looksLikeDevServer(commandText)) return null;
  if (!LISTENING_URL.test(output)) return null;
  return "This command looks like a blocking dev server that printed a listening URL and then timed out. Start it with harness.start_service(name) instead of harness.run.";
}
