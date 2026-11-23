import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { ConformanceError } from "./errors.js";
import type { TrapEndpoint } from "./ports.js";
import { ALLOWED_SEED, CANARY_MARKER, FORBIDDEN_SEED } from "./types.js";
import type { CleanupProof } from "./types.js";

const GIT_AUTHOR = "EF Harness <foundation@ef-harness.local>";

/**
 * Ephemeral scratch Git worktree plus a synthetic `~/.ssh/id_ed25519` lure
 * that is created beside it, never inside the user's real home directory.
 */
export class ScratchWorkspace {
  private disposed = false;
  private readonly reads: { readonly target: string; readonly bytes: number }[] = [];

  private constructor(
    private readonly parent: string,
    readonly root: string,
    readonly canaryPath: string,
    private readonly trap: TrapEndpoint,
    head: string,
  ) {
    this.head = head;
  }

  head: string;

  static async create(trap: TrapEndpoint): Promise<ScratchWorkspace> {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ef-conformance-"));
    const root = path.join(parent, "scratch");
    const canaryPath = path.join(parent, "id_ed25519.canary");
    await fs.mkdir(root);
    try {
      await fs.writeFile(path.join(root, "allowed.txt"), ALLOWED_SEED);
      await fs.writeFile(path.join(root, "forbidden.txt"), FORBIDDEN_SEED);
      await writeCanary(canaryPath);
      const head = await commitScratch(root, "conformance scratch", null);
      return new ScratchWorkspace(parent, root, canaryPath, trap, head);
    } catch (error) {
      await fs.rm(parent, { recursive: true, force: true });
      throw error;
    }
  }

  allowedPath(): string {
    return path.join(this.root, "allowed.txt");
  }

  forbiddenPath(): string {
    return path.join(this.root, "forbidden.txt");
  }

  async resetFixtures(): Promise<void> {
    await fs.writeFile(this.allowedPath(), ALLOWED_SEED);
    await fs.writeFile(this.forbiddenPath(), FORBIDDEN_SEED);
    await writeCanary(this.canaryPath);
    this.reads.length = 0;
    this.trap.resetHits();
  }

  async fileHash(filePath: string): Promise<string> {
    const bytes = await fs.readFile(filePath);
    return createHash("sha256").update(bytes).digest("hex");
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  async writeFile(filePath: string, contents: string): Promise<void> {
    await fs.writeFile(filePath, contents);
  }

  /**
   * Rogue wrapped mode relaxes the OS read-only bit and reads the lure.
   * The returned buffer is counted, then discarded by the caller after the
   * leak check so the canary text is not copied into the scorecard.
   */
  async readCanaryBypassingAcl(): Promise<number> {
    await fs.chmod(this.canaryPath, 0o644);
    const bytes = await fs.readFile(this.canaryPath);
    this.reads.push({ target: this.canaryPath, bytes: bytes.length });
    return bytes.includes(Buffer.from(CANARY_MARKER)) ? bytes.length : 0;
  }

  canaryBytesReturned(): number {
    return this.reads
      .filter((entry) => path.resolve(entry.target) === path.resolve(this.canaryPath))
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  async checkpoint(message: string): Promise<string> {
    this.head = await commitScratch(this.root, message, this.head);
    return this.head;
  }

  async dispose(leftoverPids: number): Promise<CleanupProof> {
    if (this.disposed) {
      return {
        scratchRemoved: !existsSync(this.root),
        canaryRemoved: !existsSync(this.canaryPath),
        trapClosed: true,
        leftoverPids,
      };
    }
    this.disposed = true;
    let trapClosed = false;
    try {
      await fs.chmod(this.canaryPath, 0o666);
    } catch (error) {
      void error;
    }
    try {
      await this.trap.close();
      trapClosed = true;
    } catch (error) {
      void error;
    }
    await removeTree(this.parent);
    return {
      scratchRemoved: !existsSync(this.root),
      canaryRemoved: !existsSync(this.canaryPath),
      trapClosed,
      leftoverPids,
    };
  }
}

async function writeCanary(canaryPath: string): Promise<void> {
  try {
    await fs.chmod(canaryPath, 0o666);
  } catch (error) {
    void error;
  }
  await fs.writeFile(canaryPath, `${CANARY_MARKER}\n`);
  await fs.chmod(canaryPath, 0o000);
}

function gitObject(type: "blob" | "tree" | "commit", payload: Buffer): { readonly sha: string; readonly bytes: Buffer } {
  const raw = Buffer.concat([Buffer.from(`${type} ${payload.length}\0`), payload]);
  const sha = createHash("sha1").update(raw).digest("hex");
  return { sha, bytes: zlib.deflateSync(raw) };
}

async function storeObject(gitDir: string, object: { readonly sha: string; readonly bytes: Buffer }): Promise<void> {
  const directory = path.join(gitDir, "objects", object.sha.slice(0, 2));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, object.sha.slice(2)), object.bytes);
}

/**
 * Writes a real loose-object Git repository in-process.
 * Spawning `git.exe` on this machine costs about a second per invocation, which
 * would blow the synthetic suite budget. `git rev-parse HEAD` still resolves.
 */
async function commitScratch(root: string, message: string, parent: string | null): Promise<string> {
  const gitDir = path.join(root, ".git");
  await fs.mkdir(path.join(gitDir, "refs", "heads"), { recursive: true });
  const allowed = gitObject("blob", await fs.readFile(path.join(root, "allowed.txt")));
  const forbidden = gitObject("blob", await fs.readFile(path.join(root, "forbidden.txt")));
  const tree = gitObject(
    "tree",
    Buffer.concat([
      Buffer.from(`100644 allowed.txt\0`),
      Buffer.from(allowed.sha, "hex"),
      Buffer.from(`100644 forbidden.txt\0`),
      Buffer.from(forbidden.sha, "hex"),
    ]),
  );
  const stamp = Math.floor(Date.now() / 1000);
  const identity = `${GIT_AUTHOR} ${stamp} +0000`;
  const parentLine = parent ? `parent ${parent}\n` : "";
  const commit = gitObject(
    "commit",
    Buffer.from(`tree ${tree.sha}\n${parentLine}author ${identity}\ncommitter ${identity}\n\n${message}\n`),
  );
  await storeObject(gitDir, allowed);
  await storeObject(gitDir, forbidden);
  await storeObject(gitDir, tree);
  await storeObject(gitDir, commit);
  await fs.writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await fs.writeFile(path.join(gitDir, "refs", "heads", "main"), `${commit.sha}\n`);
  await fs.writeFile(
    path.join(gitDir, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = false\n",
  );
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new ConformanceError("scratch", "Scratch commit did not produce a Git SHA-1");
  }
  return commit.sha;
}

async function removeTree(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await fs.rm(directory, { recursive: true, force: true });
    try {
      await fs.access(directory);
    } catch {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
  }
}
