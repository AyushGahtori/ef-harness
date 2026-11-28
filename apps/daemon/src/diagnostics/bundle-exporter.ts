import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PacketSecurityRedactorPort } from "./ports.js";
import { scrubDiagnosticsText, type RedactionContext } from "./pii-scrub.js";
import { DAEMON_LOG_LINE_CAP, BundleAllowlistError, type BundlePreview, type BundlePreviewFile } from "./types.js";
import { writeStoredZip } from "./zip-store.js";

export const BUNDLE_FILE_ORDER = [
  "system-summary.json",
  "metrics-24h.json",
  "governor-timeline.json",
  "daemon-logs-redacted.txt",
  "schema-health.json",
  "graph-structure.json",
] as const;

export type BundleFileName = (typeof BUNDLE_FILE_ORDER)[number];

const ALLOWED_BUNDLE_FILES = new Set<string>(BUNDLE_FILE_ORDER);

export interface DiagnosticsBundleRequest {
  readonly osVersion: string;
  readonly ramClass: string;
  readonly cpuClass: string;
  readonly appVersion: string;
  readonly componentVersions: Readonly<Record<string, string>>;
  readonly metrics24h: unknown;
  readonly governorTimeline: unknown;
  readonly daemonLogLines: readonly string[];
  readonly schemaHealth: unknown;
  readonly includeSanitizedGraph: boolean;
  readonly graphNodes: readonly Readonly<Record<string, unknown>>[];
  readonly redactor: PacketSecurityRedactorPort;
  readonly windowsUsernames: readonly string[];
  readonly repoFolderNames: readonly string[];
  readonly hostnames: readonly string[];
  readonly canaries: readonly string[];
}

export class RedactedDiagnosticsBundleExporter {
  createPreview(request: DiagnosticsBundleRequest): BundlePreview {
    const context: RedactionContext = {
      redactor: request.redactor,
      windowsUsernames: request.windowsUsernames,
      repoFolderNames: request.repoFolderNames,
      hostnames: request.hostnames,
      canaries: request.canaries,
    };
    const lines = request.daemonLogLines.slice(-DAEMON_LOG_LINE_CAP);
    const staged = stageBundleEntries({
      "system-summary.json": scrubDiagnosticsText(
        stableJson({
          osVersion: request.osVersion,
          ramClass: request.ramClass,
          cpuClass: request.cpuClass,
          appVersion: request.appVersion,
          componentVersions: request.componentVersions,
        }),
        context,
      ),
      "metrics-24h.json": scrubDiagnosticsText(stableJson(request.metrics24h), context),
      "governor-timeline.json": scrubDiagnosticsText(stableJson(request.governorTimeline), context),
      "daemon-logs-redacted.txt": scrubDiagnosticsText(`${lines.join("\n")}\n`, context),
      "schema-health.json": scrubDiagnosticsText(stableJson(request.schemaHealth), context),
      ...(request.includeSanitizedGraph
        ? {
            "graph-structure.json": scrubDiagnosticsText(
              stableJson(sanitizeGraph(request.graphNodes)),
              context,
            ),
          }
        : {}),
    });
    return {
      files: BUNDLE_FILE_ORDER.filter((name) => staged.has(name)).map((name) => {
        const text = staged.get(name) ?? "";
        return toFile(name, text);
      }),
    };
  }

  saveZip(preview: BundlePreview, destination: string): { readonly zipPath: string; readonly byteLength: number } {
    const entries = preview.files.filter((file) => {
      assertBundleEntryName(file.name);
      return true;
    });
    const bytes = writeStoredZip(entries.map((file) => ({ name: file.name, bytes: file.bytes })));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    return { zipPath: destination, byteLength: bytes.byteLength };
  }
}

export function assertBundleEntryName(name: string): void {
  if (!ALLOWED_BUNDLE_FILES.has(name)) throw new BundleAllowlistError(name);
}

export function stageBundleEntries(
  entries: Readonly<Record<string, string>>,
): Map<string, string> {
  const staged = new Map<string, string>();
  for (const name of BUNDLE_FILE_ORDER) {
    if (!ALLOWED_BUNDLE_FILES.has(name)) continue;
    const text = entries[name];
    if (typeof text !== "string") continue;
    staged.set(name, text);
  }
  return staged;
}

function sanitizeGraph(nodes: readonly Readonly<Record<string, unknown>>[]): {
  readonly nodeCount: number;
  readonly nodes: readonly { readonly id: string; readonly state: string }[];
} {
  const clean: { id: string; state: string }[] = [];
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id.slice(0, 128) : "";
    const state = typeof node.state === "string" ? node.state.slice(0, 64) : "";
    if (!id) continue;
    clean.push({ id, state });
  }
  return { nodeCount: clean.length, nodes: clean };
}

function toFile(name: string, text: string): BundlePreviewFile {
  return {
    name,
    text,
    bytes: new Uint8Array(Buffer.from(text, "utf8")),
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortValue(record[key]);
  }
  return sorted;
}
