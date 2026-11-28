import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function systemTool(name: string): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(root, "System32", name);
}

export async function runTool(file: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    windowsHide: true,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export function parseIcaclsIdentities(output: string, filePath: string): string[] {
  const identities: string[] = [];
  const normalizedPath = path.normalize(filePath).toLowerCase();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^successfully processed/i.test(line) || /^failed processing/i.test(line)) continue;
    let rest = line;
    const normalizedLine = path.normalize(line).toLowerCase();
    if (normalizedLine.startsWith(normalizedPath)) {
      rest = line.slice(filePath.length).trim();
      if (rest.length === 0) continue;
    }
    const match = /^(.*?):(?:\([A-Za-z]+\))+$/.exec(rest);
    const identity = match?.[1]?.trim();
    if (identity) identities.push(identity);
  }
  return identities;
}

export async function currentWindowsIdentity(): Promise<string> {
  const result = await runTool(systemTool("whoami.exe"), []);
  return result.stdout.trim();
}

/** Leave a file with an owner-only allow ACE via icacls. */
export async function lockDownOwnerOnly(filePath: string): Promise<void> {
  const icacls = systemTool("icacls.exe");
  await runTool(icacls, [filePath, "/inheritance:r"]);
  const who = await currentWindowsIdentity();
  await runTool(icacls, [filePath, "/grant:r", `${who}:(F)`]);
  const listed = await runTool(icacls, [filePath]);
  const identities = parseIcaclsIdentities(listed.stdout, filePath);
  for (const identity of identities) {
    if (identity.toLowerCase() === who.toLowerCase()) continue;
    await runTool(icacls, [filePath, "/remove", identity]);
  }
  await runTool(icacls, [filePath, "/grant:r", `${who}:(F)`]);
}
