export function commandForBinary(
  binaryPath: string,
  args: readonly string[],
): { readonly command: string; readonly args: string[] } {
  const lower = binaryPath.toLowerCase();
  if (lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".js")) {
    return { command: process.execPath, args: [binaryPath, ...args] };
  }
  return { command: binaryPath, args: [...args] };
}
