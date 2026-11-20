import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { VerifierIntegrityError } from "./errors.js";
import { canonicalJson, sha256Hex } from "./hash.js";
import type { ExpectationUnsealer } from "./ports.js";
import type { DispatchFingerprint, RequiredCheckRef } from "./types.js";

export interface ExpectationCheckBody {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly input: unknown;
  readonly expected: unknown;
  readonly entry?: string;
}

export interface ExpectationBinder {
  readonly path: string;
  readonly digest: string;
}

export interface ExpectationDocument {
  readonly checks: readonly ExpectationCheckBody[];
  readonly binders: readonly ExpectationBinder[];
}

export interface MaterializedCheck {
  readonly ref: RequiredCheckRef;
  readonly input: unknown;
  readonly expected: unknown;
  readonly entry: string | null;
}

export interface MaterializedExpectations {
  readonly pinnedCommand: readonly string[];
  readonly checks: readonly MaterializedCheck[];
  readonly heldBackFiles: readonly string[];
}

export interface MaterializeInput {
  readonly dispatch: DispatchFingerprint;
  readonly required: readonly RequiredCheckRef[];
  readonly worktreePath: string;
  readonly hostDir: string;
  readonly loadBlob: (digest: string) => Promise<Uint8Array | null>;
  readonly unsealer: ExpectationUnsealer;
}

/**
 * Load fingerprinted runner, command, config, and expectations from CAS.
 * Hash comparison happens before unseal and before any candidate process starts.
 * Held-back expected values are written only under `hostDir`, never into the checkout.
 */
export async function materializeExpectations(input: MaterializeInput): Promise<MaterializedExpectations> {
  const runnerBytes = await requireBlob(input, input.dispatch.runnerDigest, "runner");
  assertFingerprint(sha256Hex(runnerBytes), input.dispatch.runnerSha256, "runner", "runner fingerprint mismatch");

  const commandHash = sha256Hex(canonicalJson(input.dispatch.pinnedCommand));
  assertFingerprint(commandHash, input.dispatch.commandSha256, "command", "command fingerprint mismatch");

  const configBytes = await requireBlob(input, input.dispatch.configDigest, "config");
  assertFingerprint(sha256Hex(configBytes), input.dispatch.configSha256, "config", "config fingerprint mismatch");

  const expectationBytes = await requireBlob(input, input.dispatch.expectationDigest, "expectations");
  assertFingerprint(
    sha256Hex(expectationBytes),
    input.dispatch.expectationsSha256,
    "expectations",
    "expectations fingerprint mismatch",
  );

  const unsealed = input.unsealer.unseal(expectationBytes);
  const document = parseExpectationDocument(unsealed);
  const byId = new Map<string, ExpectationCheckBody>();
  for (const check of document.checks) {
    byId.set(check.checkId, check);
  }

  mkdirSync(join(input.hostDir, "runner"), { recursive: true });
  mkdirSync(join(input.hostDir, "held-back"), { recursive: true });
  mkdirSync(join(input.worktreePath, ".harness-verifier", "inputs"), { recursive: true });
  mkdirSync(join(input.worktreePath, ".harness-verifier", "visible"), { recursive: true });
  writeFileSync(join(input.hostDir, "runner", "runner.bin"), runnerBytes, { mode: 0o600 });
  writeFileSync(join(input.hostDir, "runner", "config.bin"), configBytes, { mode: 0o600 });

  const checks: MaterializedCheck[] = [];
  const heldBackFiles: string[] = [];
  for (const ref of input.required) {
    const body = byId.get(ref.checkId);
    if (!body) {
      throw new VerifierIntegrityError(
        `missing protected expectation for ${ref.checkId}`,
        "expectations",
      );
    }
    if (body.checkVersion !== ref.checkVersion) {
      throw new VerifierIntegrityError(
        `check version mismatch for ${ref.checkId}`,
        "expectations",
      );
    }
    const entry = typeof body.entry === "string" ? body.entry : null;
    const materialized: MaterializedCheck = {
      ref,
      input: body.input,
      expected: body.expected,
      entry,
    };
    checks.push(materialized);
    const inputOnly = { checkId: ref.checkId, input: body.input, entry };
    writeFileSync(
      join(input.worktreePath, ".harness-verifier", "inputs", `${ref.checkId}.json`),
      canonicalJson(inputOnly),
      { mode: 0o600 },
    );
    if (ref.visibility === "visible") {
      writeFileSync(
        join(input.worktreePath, ".harness-verifier", "visible", `${ref.checkId}.json`),
        canonicalJson({ checkId: ref.checkId, input: body.input, expected: body.expected }),
        { mode: 0o600 },
      );
    } else {
      const sealedPath = join(input.hostDir, "held-back", `${ref.checkId}.json`);
      writeFileSync(
        sealedPath,
        canonicalJson({ checkId: ref.checkId, input: body.input, expected: body.expected }),
        { mode: 0o600 },
      );
      heldBackFiles.push(sealedPath);
    }
  }

  for (const binder of document.binders) {
    const bytes = await requireBlob(input, binder.digest, "expectations");
    if (sha256Hex(bytes) !== binder.digest) {
      throw new VerifierIntegrityError(`binder digest mismatch for ${binder.path}`, "expectations");
    }
    const target = safeCheckoutPath(input.worktreePath, binder.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
  }

  assertHeldBackStaysOutOfSlot(input.worktreePath, checks);
  return {
    pinnedCommand: input.dispatch.pinnedCommand,
    checks,
    heldBackFiles,
  };
}

export function sealExpectationDocument(document: {
  readonly checks: readonly ExpectationCheckBody[];
  readonly binders?: readonly ExpectationBinder[];
}): Uint8Array {
  const body = Buffer.from(
    canonicalJson({
      checks: document.checks,
      binders: document.binders ?? [],
    }),
    "utf8",
  ).toString("base64");
  return Buffer.from(canonicalJson({ v: 1, alg: "host-seal", body }), "utf8");
}

export function defaultExpectationUnsealer(): ExpectationUnsealer {
  return {
    unseal(stored: Uint8Array): Uint8Array {
      const text = Buffer.from(stored).toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid json";
        throw new VerifierIntegrityError(`expectation bytes are not JSON (${reason})`, "expectations");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new VerifierIntegrityError("expectation document is not an object", "expectations");
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.alg === "string") {
        if (record.alg !== "host-seal" || record.v !== 1 || typeof record.body !== "string") {
          throw new VerifierIntegrityError("unsupported expectation seal", "expectations");
        }
        return Buffer.from(record.body, "base64");
      }
      return stored;
    },
  };
}

export function secretLeaves(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    if (value.length >= 8) into.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) secretLeaves(item, into);
    return;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      secretLeaves(child, into);
    }
  }
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
  let redacted = message;
  const unique = [...new Set(secrets)].sort((left, right) => right.length - left.length);
  for (const secret of unique) {
    if (secret.length < 8) continue;
    if (!redacted.includes(secret)) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function assertHeldBackStaysOutOfSlot(worktreePath: string, checks: readonly MaterializedCheck[]): void {
  const secrets: string[] = [];
  for (const check of checks) {
    if (check.ref.visibility !== "held_back") continue;
    secretLeaves(check.expected, secrets);
    const canonical = canonicalJson(check.expected);
    if (canonical.length >= 8) secrets.push(canonical);
  }
  const root = join(worktreePath, ".harness-verifier");
  if (treeContains(root, secrets)) {
    throw new VerifierIntegrityError(
      "held-back expectation leaked into the verifier slot",
      "expectations",
    );
  }
}

function treeContains(dir: string, secrets: readonly string[]): boolean {
  if (!existsSync(dir) || secrets.length === 0) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (treeContains(full, secrets)) return true;
      continue;
    }
    const text = readFileSync(full, "utf8");
    for (const secret of secrets) {
      if (secret.length >= 8 && text.includes(secret)) return true;
    }
  }
  return false;
}

function safeCheckoutPath(worktreePath: string, rel: string): string {
  if (rel.length === 0 || rel.includes("\0") || isAbsolute(rel)) {
    throw new VerifierIntegrityError("binder path escapes the clean checkout", "expectations");
  }
  const root = resolve(worktreePath);
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new VerifierIntegrityError("binder path escapes the clean checkout", "expectations");
  }
  return target;
}

async function requireBlob(
  input: MaterializeInput,
  digest: string,
  field: "runner" | "command" | "config" | "expectations",
): Promise<Uint8Array> {
  const bytes = await input.loadBlob(digest);
  if (!bytes) {
    throw new VerifierIntegrityError(`missing CAS blob ${digest}`, field);
  }
  return bytes;
}

function assertFingerprint(
  actual: string,
  expected: string,
  field: "runner" | "command" | "config" | "expectations",
  message: string,
): void {
  if (actual !== expected) {
    throw new VerifierIntegrityError(message, field);
  }
}

function parseExpectationDocument(bytes: Uint8Array): ExpectationDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid json";
    throw new VerifierIntegrityError(`unsealed expectations are not JSON (${reason})`, "expectations");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new VerifierIntegrityError("unsealed expectations are not an object", "expectations");
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.checks)) {
    throw new VerifierIntegrityError("expectation document is missing checks", "expectations");
  }
  const checks: ExpectationCheckBody[] = [];
  for (const item of record.checks) {
    if (!item || typeof item !== "object") {
      throw new VerifierIntegrityError("expectation check is not an object", "expectations");
    }
    const check = item as Record<string, unknown>;
    if (typeof check.checkId !== "string" || typeof check.checkVersion !== "number") {
      throw new VerifierIntegrityError("expectation check is missing id or version", "expectations");
    }
    if (!Object.prototype.hasOwnProperty.call(check, "expected")) {
      throw new VerifierIntegrityError(`expectation ${check.checkId} has no expected value`, "expectations");
    }
    const body: ExpectationCheckBody = {
      checkId: check.checkId,
      checkVersion: check.checkVersion,
      input: check.input ?? null,
      expected: check.expected,
    };
    checks.push(typeof check.entry === "string" ? { ...body, entry: check.entry } : body);
  }
  const binders: ExpectationBinder[] = [];
  if (Array.isArray(record.binders)) {
    for (const item of record.binders) {
      if (!item || typeof item !== "object") continue;
      const binder = item as Record<string, unknown>;
      if (typeof binder.path !== "string" || typeof binder.digest !== "string") {
        throw new VerifierIntegrityError("binder entry is missing path or digest", "expectations");
      }
      binders.push({ path: binder.path, digest: binder.digest });
    }
  }
  return { checks, binders };
}
