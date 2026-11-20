import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ServiceCreateRequest } from "../../src/services/index.js";

export async function makeTemp(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTemp(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function envRequest(
  tempDir: string,
  envId: string,
  extra: Partial<ServiceCreateRequest> = {},
): ServiceCreateRequest {
  return {
    projectId: "project-a",
    envId,
    kind: "attempt",
    tempDir,
    ...extra,
  };
}
