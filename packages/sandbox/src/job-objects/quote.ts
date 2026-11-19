export function quoteWindowsArgument(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\t "]/u.test(arg)) return arg;
  let quoted = '"';
  let slashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    if (char === '"') {
      quoted += "\\".repeat(slashes * 2 + 1);
      quoted += '"';
      slashes = 0;
      continue;
    }
    if (slashes > 0) {
      quoted += "\\".repeat(slashes);
      slashes = 0;
    }
    quoted += char;
  }
  if (slashes > 0) quoted += "\\".repeat(slashes * 2);
  quoted += '"';
  return quoted;
}

export function windowsCommandLine(application: string, args: readonly string[]): string {
  return [application, ...args].map((arg) => quoteWindowsArgument(arg)).join(" ");
}
