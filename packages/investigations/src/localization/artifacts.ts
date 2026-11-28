import { createHash } from "node:crypto";
import type { LocalizationArtifacts } from "./types.js";

export class LocalizationArtifactStore {
  private readonly blobs = new Map<string, LocalizationArtifacts>();

  put(artifacts: LocalizationArtifacts): string {
    const json = JSON.stringify(artifacts);
    const ref = createHash("sha256").update(json, "utf8").digest("hex");
    this.blobs.set(ref, artifacts);
    return ref;
  }

  get(ref: string): LocalizationArtifacts | undefined {
    return this.blobs.get(ref);
  }
}