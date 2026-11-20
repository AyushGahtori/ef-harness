export function splitCommandLine(input: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    const quoted = match[1] ?? match[2] ?? match[3];
    if (quoted !== undefined && quoted !== "") parts.push(quoted);
  }
  return parts;
}

export function commandExecutable(file: string): string {
  const base = file.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  if (base === "node" || base === "node.exe") return process.execPath;
  return file;
}
