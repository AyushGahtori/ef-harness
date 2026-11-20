import type { ExtractedCodeName, NameAuditFailure, NameRegistryService } from "./ports.js";
import type { RegistrySnapshot } from "./types.js";

const SHARED_OWNERS = new Set(["project_integrator", "shared"]);
const CASE_INSENSITIVE = new Set([
  "http_route",
  "page_route",
  "env_var",
  "db_table",
  "db_column",
  "db_index",
]);

/**
 * In-memory stand-in for Task 019 NameRegistryService.auditCodeNamesAgainstRegistry.
 * Swap for the real registry service at integration.
 */
export function createLocalNameRegistry(snapshot: RegistrySnapshot): NameRegistryService {
  const names = snapshot.names.map((entry) => ({
    ...entry,
    kind: entry.kind,
    normalized: normalizeRegistered(entry.kind, entry.value),
  }));
  return {
    auditCodeNamesAgainstRegistry(extracted, featureId) {
      const failures: NameAuditFailure[] = [];
      for (const name of extracted) {
        const normalized = normalizeRegistered(name.kind, name.value);
        const match = names.find(
          (entry) => kindsCompatible(entry.kind, name.kind) && entry.normalized === normalized,
        );
        if (!match) {
          failures.push(failure(name, "unregistered", null));
          continue;
        }
        const shared =
          SHARED_OWNERS.has(match.owner) ||
          SHARED_OWNERS.has(match.feature) ||
          match.feature === featureId ||
          match.owner === featureId;
        if (!shared) failures.push(failure(name, "foreign_owned", match.feature || match.owner));
      }
      return failures;
    },
  };
}

function failure(
  name: ExtractedCodeName,
  reason: "unregistered" | "foreign_owned",
  owner: string | null,
): NameAuditFailure {
  return {
    kind: name.kind,
    value: name.value,
    reason,
    file: name.file,
    line: name.line,
    owner,
  };
}

function kindsCompatible(registered: string, extracted: string): boolean {
  if (registered === extracted) return true;
  const storage = new Set(["storage_key", "cookie"]);
  return storage.has(registered) && storage.has(extracted);
}

function normalizeRegistered(kind: string, value: string): string {
  let text = value.trim();
  if (kind === "http_route" || kind === "page_route") {
    text = text.toLowerCase();
    if (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
  } else if (CASE_INSENSITIVE.has(kind)) {
    text = text.toLowerCase();
  }
  return text;
}
