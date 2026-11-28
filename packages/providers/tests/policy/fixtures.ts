import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  SignedProviderPolicyEngine,
  bundledPolicyUnsigned,
  signPolicyDocument,
  type SignedProviderPolicyEngineOptions,
  type UnsignedProviderPolicy,
} from "../../src/policy/index.js";

export const TEST_POLICY_SEED = Uint8Array.from(
  Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }
});

export function editablePolicy(): UnsignedProviderPolicy {
  return structuredClone(bundledPolicyUnsigned());
}

export function signPolicy(unsigned: UnsignedProviderPolicy = editablePolicy()) {
  return signPolicyDocument(unsigned, TEST_POLICY_SEED);
}

const offlineFetch: typeof fetch = async () => {
  throw new Error("network disabled");
};

export function createEngine(
  overrides: Partial<SignedProviderPolicyEngineOptions> = {},
  directory?: string,
): { engine: SignedProviderPolicyEngine; dir: string; close: () => void } {
  const dir = directory ?? mkdtempSync(join(tmpdir(), "ef-policy-"));
  const ownsDirectory = directory === undefined;
  const rest: Partial<SignedProviderPolicyEngineOptions> = { ...overrides };
  delete rest.cacheDirectory;
  let closed = false;
  let removed = false;
  const engine = new SignedProviderPolicyEngine({
    cacheDirectory: dir,
    fetchImpl: offlineFetch,
    ...rest,
  });
  const release = () => {
    if (closed) return;
    closed = true;
    engine.close();
  };
  const cleanup = () => {
    release();
    if (removed || !ownsDirectory) return;
    removed = true;
    rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return { engine, dir, close: release };
}
