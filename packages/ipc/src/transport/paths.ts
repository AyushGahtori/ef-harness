import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LEAF = /^[A-Za-z0-9._-]{1,120}$/;

export function sanitizeUserName(userName: string): string {
  const cleaned = userName
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "user";
}

export function assertPipeLeaf(leaf: string): string {
  if (!LEAF.test(leaf)) throw new Error("invalid named pipe leaf");
  return leaf;
}

export function pipePathForLeaf(leaf: string): string {
  const safe = assertPipeLeaf(leaf);
  if (process.platform === "win32") return `\\\\.\\pipe\\${safe}`;
  return path.join(os.tmpdir(), `${safe}.sock`);
}

export function pipeLeafFromPath(pipePath: string): string {
  if (process.platform === "win32") {
    const marker = "\\pipe\\";
    const index = pipePath.toLowerCase().lastIndexOf(marker);
    if (index < 0) throw new Error("not a Windows named pipe path");
    return assertPipeLeaf(pipePath.slice(index + marker.length));
  }
  return assertPipeLeaf(path.basename(pipePath, ".sock"));
}

export function userPipePath(userName: string = os.userInfo().username): string {
  return pipePathForLeaf(`efharness-${sanitizeUserName(userName)}`);
}

export function testPipePath(id: string = randomUUID()): string {
  return pipePathForLeaf(`efharness-test-${id}`);
}

export function defaultTokenDirectory(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA;
    if (!base) throw new Error("LOCALAPPDATA is not set");
    return path.join(base, "EFHarness");
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "EFHarness");
}
