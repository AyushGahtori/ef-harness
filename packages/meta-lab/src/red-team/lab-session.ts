import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { isDeniedRead } from "./paths.js";
import { syntheticSshCanary } from "./tokens.js";
import { TrapServer } from "./trap-server.js";

export type CanaryFileName = "canary" | "canary_key";

export class SyntheticCanaryProfile {
  accessCount = 0;

  constructor(readonly root: string) {}

  canaryPath(name: CanaryFileName): string {
    return path.join(this.root, ".ssh", name);
  }

  plant(nonce: string): void {
    mkdirSync(path.join(this.root, ".ssh"), { recursive: true });
    for (const name of ["canary", "canary_key"] as const) {
      writeFileSync(this.canaryPath(name), syntheticSshCanary(nonce, name), "utf8");
    }
  }

  read(name: CanaryFileName): string {
    this.accessCount += 1;
    return syntheticSshCanary("unread", name);
  }
}

export function proxyDenies(trapPort: number, rawUrl: string): boolean {
  const url = new URL(rawUrl);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!loopback) return true;
  const trap = url.port === String(trapPort);
  return trap && url.pathname !== "/mcp";
}

export class LabSession {
  readonly worktree: string;
  readonly sealedDir: string;
  readonly authorizedDir: string;
  readonly sinkDir: string;
  private closed = false;

  private constructor(
    readonly root: string,
    readonly trap: TrapServer,
    readonly profile: SyntheticCanaryProfile,
    readonly nonce: string,
  ) {
    this.worktree = path.join(root, "worktree");
    this.sealedDir = path.join(root, "sealed");
    this.authorizedDir = path.join(root, "authorized");
    this.sinkDir = path.join(root, "sinks");
  }

  static async open(): Promise<LabSession> {
    const nonce = randomBytes(8).toString("hex");
    const root = path.join(os.tmpdir(), `ef-rt-193-${nonce}`);
    const trap = await TrapServer.listen();
    try {
      mkdirSync(path.join(root, "worktree"), { recursive: true });
      mkdirSync(path.join(root, "sealed"), { recursive: true });
      mkdirSync(path.join(root, "authorized"), { recursive: true });
      mkdirSync(path.join(root, "sinks"), { recursive: true });
      const profile = new SyntheticCanaryProfile(path.join(root, "profile"));
      profile.plant(nonce);
      return new LabSession(root, trap, profile, nonce);
    } catch (error) {
      await trap.close();
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  }

  attemptDirectRead(target: string): { readonly blocked: boolean } {
    const blocked = isDeniedRead(this.worktree, target);
    if (!blocked) this.profile.read("canary");
    return { blocked };
  }

  attemptDirectRequest(rawUrl: string): { readonly blocked: boolean } {
    return { blocked: proxyDenies(this.trap.port, rawUrl) };
  }

  async runUnguardedInstallEffect(): Promise<void> {
    this.profile.read("canary_key");
    await this.trap.recordLoopbackHit("/steal");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.trap.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}

export async function withLabSession<T>(fn: (session: LabSession) => Promise<T>): Promise<T> {
  const session = await LabSession.open();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
