import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface CasStore {
  stage(content: string): string;
  promote(hash: string): void;
  recover(): string[];
  hasBlob(hash: string): boolean;
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** In-memory CAS used by the fast :memory: runs. Rename is still a distinct step. */
export class MemoryCasStore implements CasStore {
  private readonly staged = new Map<string, string>();
  private readonly blobs = new Map<string, string>();

  stage(content: string): string {
    const hash = digest(content);
    this.staged.set(hash, content);
    return hash;
  }

  promote(hash: string): void {
    const content = this.staged.get(hash);
    if (content === undefined) throw new Error(`missing staged blob ${hash}`);
    if (digest(content) !== hash) throw new Error(`staged blob hash mismatch ${hash}`);
    this.blobs.set(hash, content);
    this.staged.delete(hash);
  }

  recover(): string[] {
    const promoted: string[] = [];
    for (const [hash, content] of this.staged) {
      if (digest(content) === hash) {
        this.blobs.set(hash, content);
        promoted.push(hash);
      }
      this.staged.delete(hash);
    }
    return promoted;
  }

  hasBlob(hash: string): boolean {
    return this.blobs.has(hash);
  }
}

/** Real temp-file rename into the blob directory. Crash leaves the temp file behind. */
export class DiskCasStore implements CasStore {
  constructor(private readonly root: string) {}

  private tmp(hash: string): string {
    return path.join(this.root, "cas", "tmp", hash);
  }

  private dest(hash: string): string {
    return path.join(this.root, "cas", "blobs", hash);
  }

  stage(content: string): string {
    const hash = digest(content);
    fs.mkdirSync(path.dirname(this.tmp(hash)), { recursive: true });
    fs.writeFileSync(this.tmp(hash), content);
    return hash;
  }

  promote(hash: string): void {
    const tmp = this.tmp(hash);
    const bytes = fs.readFileSync(tmp);
    if (digest(bytes.toString("utf8")) !== hash) throw new Error(`staged blob hash mismatch ${hash}`);
    fs.mkdirSync(path.dirname(this.dest(hash)), { recursive: true });
    fs.renameSync(tmp, this.dest(hash));
  }

  recover(): string[] {
    const dir = path.join(this.root, "cas", "tmp");
    if (!fs.existsSync(dir)) return [];
    const promoted: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const tmp = path.join(dir, name);
      const bytes = fs.readFileSync(tmp);
      if (digest(bytes.toString("utf8")) === name) {
        fs.mkdirSync(path.dirname(this.dest(name)), { recursive: true });
        if (!fs.existsSync(this.dest(name))) fs.renameSync(tmp, this.dest(name));
        else fs.rmSync(tmp, { force: true });
        promoted.push(name);
      } else {
        fs.rmSync(tmp, { force: true });
      }
    }
    return promoted;
  }

  hasBlob(hash: string): boolean {
    return fs.existsSync(this.dest(hash));
  }
}
