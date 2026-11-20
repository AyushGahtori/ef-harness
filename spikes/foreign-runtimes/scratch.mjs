import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, shell: false }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

async function removeDir(dir) {
  let last = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw last instanceof Error ? last : new Error(`failed to remove ${dir}`);
}

export async function withScratchWorktree(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ef-foreign-"));
  try {
    await git(["init", "-q"], dir);
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const value = await fn(dir);
    return { dir, value };
  } finally {
    await removeDir(dir);
  }
}
