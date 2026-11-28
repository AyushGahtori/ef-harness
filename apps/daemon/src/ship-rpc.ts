import path from "node:path";
import { GlobalBrokerDb, openProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import {
  PayloadHashMismatchError,
  bindMigrationState,
  createPostDeployCleanVerifier,
  deployAdapters,
  deployCanonicalPayloadHash,
  shipDeployModules,
} from "@ef-harness/ship-deploy";

export type ShipDispatch =
  | { readonly handled: false }
  | { readonly handled: true; readonly result: unknown };

type DeployTarget = "preview" | "staging" | "production";

export function handleShipMethod(
  method: string,
  params: Record<string, unknown>,
  ctx: { readonly statePath: string; readonly profileDir: string },
): ShipDispatch {
  if (method === "ship.modules") {
    return { handled: true, result: { modules: [...shipDeployModules] } };
  }
  if (method === "ship.approvalHash") {
    const targetEnv = readTarget(params.targetEnv);
    const commitSha = readText(params.commitSha);
    const envDiff = readDiff(params.envDiff);
    if (!targetEnv || !commitSha || !envDiff) {
      return { handled: true, result: { ok: false } };
    }
    return {
      handled: true,
      result: {
        ok: true,
        hash: deployCanonicalPayloadHash({ targetEnv, commitSha, envDiff }),
      },
    };
  }
  if (method === "ship.migrationEffect") {
    return { handled: true, result: recordMigration(params, ctx.statePath) };
  }
  if (method === "ship.parseSmoke") {
    const text = typeof params.text === "string" ? params.text : "";
    const report = createPostDeployCleanVerifier().parseCollectedCaseIds(text);
    return { handled: true, result: { format: report.format, cases: report.cases.length } };
  }
  if (method === "ship.vaultNames") {
    if (process.platform !== "win32") {
      return { handled: true, result: { available: false, names: [] } };
    }
    return { handled: true, result: listWindowsVaultNames(params, ctx.profileDir) };
  }
  return { handled: false };
}

function listWindowsVaultNames(params: Record<string, unknown>, profileDir: string): unknown {
  const projectId = readText(params.projectId) ?? "ship";
  const state = openProjectStateDb({ projectId, rootDir: profileDir });
  const global = GlobalBrokerDb.open({ root: profileDir });
  const vault = new WindowsDpapiSecretsVault({
    global,
    state,
    vaultDir: path.join(profileDir, "vault"),
  });
  try {
    const names = deployAdapters
      .vaultNameHashPort(vault)
      .listSecretNamesAndHashes(projectId, "prod")
      .map((item) => item.name);
    return { available: true, names };
  } finally {
    state.close();
    global.close();
  }
}

function recordMigration(params: Record<string, unknown>, statePath: string): unknown {
  const idempotencyKey = readText(params.idempotencyKey);
  const payloadHash = readText(params.payloadHash);
  const kind = readText(params.kind) ?? "migration_expand";
  const target = readText(params.target) ?? "db";
  const targetEnv = readTarget(params.targetEnv);
  if (!idempotencyKey || !payloadHash || !targetEnv) return { ok: false };
  const store = bindMigrationState(statePath);
  try {
    store.recordEffect({
      id: `effect-${idempotencyKey}`,
      kind,
      target,
      payloadHash,
      idempotencyKey,
      targetEnv,
      approval: "intended",
    });
    return { ok: true, rejected: false };
  } catch (error) {
    if (error instanceof PayloadHashMismatchError) {
      return { ok: false, rejected: true, code: error.code };
    }
    throw error;
  } finally {
    store.close();
  }
}

function readTarget(value: unknown): DeployTarget | null {
  if (value === "preview" || value === "staging" || value === "production") return value;
  return null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readDiff(value: unknown): {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
  readonly summary: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const added = readNames(record.added);
  const changed = readNames(record.changed);
  const deleted = readNames(record.deleted);
  if (!added || !changed || !deleted) return null;
  const summary = typeof record.summary === "string" ? record.summary : "";
  return { added, changed, deleted, summary };
}

function readNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    names.push(item);
  }
  return names;
}
