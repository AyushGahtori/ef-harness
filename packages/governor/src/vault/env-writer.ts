import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { lockDownOwnerOnly } from "./ntfs-acl.js";
import { GITIGNORE_OFFER, VaultError } from "./types.js";

export interface LocalEnvWriteRequest {
  readonly projectDir: string;
  readonly explicitOptIn: boolean;
  readonly entries: Readonly<Record<string, string>>;
  readonly git?: (args: readonly string[], cwd: string) => Promise<number>;
}

export type LocalEnvWriteResult =
  | {
      readonly written: true;
      readonly path: string;
    }
  | {
      readonly written: false;
      readonly reason: "opt-in-required" | "not-ignored" | "empty";
      readonly message: string;
      readonly offer?: string;
    };

export class GitignoredLocalEnvWriter {
  async write(request: LocalEnvWriteRequest): Promise<LocalEnvWriteResult> {
    if (request.explicitOptIn !== true) {
      return {
        written: false,
        reason: "opt-in-required",
        message: "Local .env.local export is off until the developer explicitly opts in.",
      };
    }
    const names = Object.keys(request.entries);
    if (names.length === 0) {
      return {
        written: false,
        reason: "empty",
        message: "Nothing to export.",
      };
    }
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new VaultError("secret_name", "Refusing to write an env name that is not a shell identifier.");
      }
    }
    const git = request.git ?? defaultGit;
    const ignored = await git(["check-ignore", "-q", ".env.local"], request.projectDir);
    if (ignored !== 0) {
      return {
        written: false,
        reason: "not-ignored",
        message: "Refusing to write .env.local because Git does not ignore it.",
        offer: GITIGNORE_OFFER,
      };
    }
    const destination = path.join(request.projectDir, ".env.local");
    await assertNotSymlink(destination);
    const example = path.join(request.projectDir, ".env.example");
    const beforeExample = await readIfExists(example);
    const body = formatEnv(request.entries);
    const temporary = path.join(
      request.projectDir,
      `.env.local.${randomBytes(8).toString("hex")}.partial`,
    );
    await writeFile(temporary, body, { encoding: "utf8" });
    const handle = await open(temporary, "r+");
    await handle.sync();
    await handle.close();
    await replaceFile(temporary, destination);
    await lockDownOwnerOnly(destination);
    const afterExample = await readIfExists(example);
    if (beforeExample !== afterExample) {
      throw new VaultError("env_example", "Refusing to leave .env.example changed.");
    }
    return { written: true, path: destination };
  }
}

export function formatEnv(entries: Readonly<Record<string, string>>): string {
  const lines = ["# EF Harness local env. Gitignored. Do not commit."];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key}=${quoteEnv(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function quoteEnv(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
  return `"${escaped}"`;
}

async function defaultGit(args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd, windowsHide: true, shell: false });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function assertNotSymlink(file: string): Promise<void> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) {
      throw new VaultError("env_symlink", "Refusing to write .env.local through a symlink.");
    }
  } catch (error) {
    if (error instanceof VaultError) throw error;
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
}

async function replaceFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    try {
      await unlink(to);
    } catch (unlinkError) {
      if (errorCode(unlinkError) !== "ENOENT") throw unlinkError;
    }
    await rename(from, to);
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}
