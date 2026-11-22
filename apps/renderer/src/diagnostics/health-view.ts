import type {
  BundlePreviewFile,
  CrashDumpRow,
  DiagnosticsHealthActions,
  DiagnosticsHealthModel,
  LearnedFootprint,
  PoolUtilization,
  ProviderHealth,
  SelfCheckItem,
  SqliteDatabaseHealth,
} from "./model.js";
import { escapeHtml, formatNumber, renderSparkline } from "./sparkline.js";
import { paint, palette, type DiagnosticsTheme } from "./theme.js";

export class DiagnosticsHealthView {
  private previewName: string | null;

  constructor(
    private readonly model: DiagnosticsHealthModel,
    private readonly actions: DiagnosticsHealthActions,
  ) {
    this.previewName = model.previewFiles[0]?.name ?? null;
  }

  renderDocument(theme: DiagnosticsTheme): string {
    return renderHealthDocument(this.model, theme, this.previewName);
  }

  selectPreview(name: string): void {
    this.previewName = name;
  }

  runSelfCheck(): Promise<readonly SelfCheckItem[]> {
    return this.actions.runSelfCheck();
  }

  exportBundle(): Promise<readonly BundlePreviewFile[]> {
    return this.actions.exportBundle();
  }

  saveZip(): Promise<void> {
    return this.actions.saveZip();
  }

  runSafeCacheCleanup(): Promise<string> {
    return this.actions.runSafeCacheCleanup();
  }

  copySummary(): Promise<void> | void {
    return this.actions.copySummary(this.model.redactedSummary);
  }

  rebuildTelemetry(): Promise<void> {
    return this.actions.rebuildTelemetry();
  }

  setIncludeSanitizedGraph(include: boolean): void {
    this.actions.setIncludeSanitizedGraph(include);
  }
}

export function renderHealthDocument(
  model: DiagnosticsHealthModel,
  theme: DiagnosticsTheme,
  selectedPreview: string | null,
): string {
  const colors = palette(theme);
  const body = paint(theme, "font-family:Segoe UI, sans-serif;font-size:16px;line-height:1.5;margin:0");
  const text = paint(theme);
  return [
    "<!DOCTYPE html>",
    `<html lang="en">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Diagnostics &amp; Health</title>",
    "</head>",
    `<body style="${body}">`,
    `<nav aria-label="Skip" style="${text}">`,
    `<a href="#diagnostics-main" style="${paint(theme, "text-decoration:underline")}">Skip to diagnostics</a>`,
    "</nav>",
    `<main id="diagnostics-main" style="${text}">`,
    `<h1 style="${text}">Diagnostics &amp; Health</h1>`,
    model.telemetryAvailable
      ? ""
      : `<p role="status" style="${text}">${escapeHtml(model.unavailableMessage ?? "")}</p>`,
    `<p style="${text}"><button type="button" data-action="rebuild-telemetry" style="${text}">Rebuild Telemetry DB</button></p>`,
    section(theme, "Live and 24 hour metrics", "metrics", metricsHtml(model, theme)),
    section(theme, "Hardware governor", "governor", governorHtml(model, theme)),
    section(theme, "Providers and workers", "providers", providersHtml(model, theme)),
    section(theme, "Storage and CAS", "storage", storageHtml(model, theme)),
    section(theme, "Crash dumps", "crashes", crashesHtml(model, theme)),
    section(theme, "Run Health Check", "self-check", selfCheckHtml(model, theme)),
    section(theme, "Export Diagnostics Bundle", "bundle", bundleHtml(model, theme, selectedPreview)),
    model.sparklines.map((series) => renderSparkline(series, colors)).join(""),
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function section(theme: DiagnosticsTheme, title: string, id: string, body: string): string {
  const text = paint(theme);
  return `<section aria-labelledby="${id}-heading" style="${text}"><h2 id="${id}-heading" style="${text}">${escapeHtml(title)}</h2>${body}</section>`;
}

function metricsHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  const latency = model.writeLatency;
  const latencyText =
    !model.telemetryAvailable || latency.sampleCount === 0 || latency.p99Ms === null
      ? "No write samples"
      : `p50 ${formatNumber(latency.p50Ms ?? 0)} ms, p95 ${formatNumber(latency.p95Ms ?? 0)} ms, p99 ${formatNumber(latency.p99Ms)} ms, SLO ${latency.sloMs} ms, ${latency.withinSlo ? "within SLO" : "above SLO"}, busy retries ${latency.busyRetryCount}`;
  const backup =
    model.lastVerifiedBackupAt === null
      ? "No verified backup"
      : `Last verified backup ${model.lastVerifiedBackupAt}`;
  return [
    table(theme, "Daemon and SQLite health", ["Database", "File bytes", "WAL bytes", "Schema version", "Quick check"], model.databases.map((database) => databaseCells(database))),
    `<p class="tabular-nums" style="${paint(theme, "font-variant-numeric:tabular-nums")}">${escapeHtml(latencyText)}</p>`,
    `<p style="${paint(theme)}">${escapeHtml(backup)}</p>`,
  ].join("");
}

function databaseCells(database: SqliteDatabaseHealth): readonly string[] {
  return [
    database.name,
    String(database.bytes),
    String(database.walBytes),
    database.schemaVersion === null ? "unknown" : String(database.schemaVersion),
    database.quickCheck,
  ];
}

function governorHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  const current = model.currentPressure
    ? `${model.currentPressure.level}: ${model.currentPressure.reason}`
    : "No pressure sample";
  return [
    `<p style="${paint(theme)}">${escapeHtml(current)}</p>`,
    table(
      theme,
      "Pressure history",
      ["Time", "Level", "Reason"],
      model.pressureHistory.map((point) => [String(point.at), point.level, point.reason]),
    ),
    table(
      theme,
      "Pool slot utilization",
      ["Pool", "Used", "Capacity"],
      model.pools.map((pool) => poolCells(pool)),
    ),
    table(
      theme,
      "Learned command footprints",
      ["Command", "p90 RAM MB", "Wall clock ms"],
      model.footprints.map((footprint) => footprintCells(footprint)),
    ),
  ].join("");
}

function poolCells(pool: PoolUtilization): readonly string[] {
  return [`Pool ${pool.id} ${pool.name}`, String(pool.used), String(pool.capacity)];
}

function footprintCells(footprint: LearnedFootprint): readonly string[] {
  return [footprint.commandClass, String(footprint.peakRamMbP90), String(footprint.wallClockMs)];
}

function providersHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  const workers = model.workers;
  return [
    table(
      theme,
      "Provider connections",
      ["Connection", "Latency ms", "429 count", "AIMD concurrency"],
      model.providers.map((provider) => providerCells(provider)),
    ),
    `<p class="tabular-nums" style="${paint(theme, "font-variant-numeric:tabular-nums")}">Workers pass ${workers.pass}, retry ${workers.retry}, stuck ${workers.stuck}, loop ${workers.loop}</p>`,
    table(
      theme,
      "Foreign adapter conformance",
      ["Adapter", "Status", "Detail"],
      model.conformance.map((row) => [row.adapterId, row.status, row.detail]),
    ),
  ].join("");
}

function providerCells(provider: ProviderHealth): readonly string[] {
  return [
    provider.connectionId,
    String(provider.latencyMs),
    String(provider.rateLimit429),
    String(provider.aimdConcurrency),
  ];
}

function storageHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  const storage = model.storage;
  return [
    table(theme, "CAS hygiene", ["Measure", "Value"], [
      ["CAS blob bytes", String(storage.casBlobBytes)],
      ["Archived zstd log bytes", String(storage.archivedZstdLogBytes)],
      ["Active worktrees", String(storage.activeWorktreeCount)],
    ]),
    `<p style="${paint(theme)}"><button type="button" data-action="safe-cache-cleanup" style="${paint(theme)}">Run safe cache cleanup</button></p>`,
    model.cleanupMessage
      ? `<p style="${paint(theme)}">${escapeHtml(model.cleanupMessage)}</p>`
      : "",
  ].join("");
}

function crashesHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  if (model.crashes.length === 0) {
    return `<p style="${paint(theme)}">No local crash dumps</p>`;
  }
  return table(
    theme,
    "Local crash dumps",
    ["Dump", "Process", "When", "Version", "Signal", "Bytes"],
    model.crashes.map((crash) => crashCells(crash)),
  );
}

function crashCells(crash: CrashDumpRow): readonly string[] {
  return [
    crash.dumpId,
    crash.processType,
    String(crash.occurredAt),
    crash.appVersion,
    crash.signalOrExitCode,
    String(crash.fileSizeBytes),
  ];
}

function selfCheckHtml(model: DiagnosticsHealthModel, theme: DiagnosticsTheme): string {
  const items =
    model.selfCheck.length === 0
      ? `<p style="${paint(theme)}">Self-check has not been run</p>`
      : `<ul style="${paint(theme)}">${model.selfCheck.map((item) => selfCheckItem(item, theme)).join("")}</ul>`;
  return `${items}<p style="${paint(theme)}"><button type="button" data-action="run-self-check" style="${paint(theme)}">Run Self-Check</button></p>`;
}

function selfCheckItem(item: SelfCheckItem, theme: DiagnosticsTheme): string {
  const fixes = item.fixSteps.length === 0 ? "" : ` Fix: ${item.fixSteps.join(" ")}`;
  return `<li style="${paint(theme)}">${escapeHtml(item.status)} ${escapeHtml(item.name)}: ${escapeHtml(item.detail)}${escapeHtml(fixes)}</li>`;
}

function bundleHtml(
  model: DiagnosticsHealthModel,
  theme: DiagnosticsTheme,
  selectedPreview: string | null,
): string {
  const checked = model.includeSanitizedGraph ? " checked" : "";
  const files =
    model.previewFiles.length === 0
      ? `<p style="${paint(theme)}">No bundle preview yet</p>`
      : `<ul style="${paint(theme)}">${model.previewFiles.map((file) => previewItem(file, theme, selectedPreview)).join("")}</ul>`;
  return [
    `<p style="${paint(theme)}"><label for="include-graph" style="${paint(theme)}">Include sanitized graph structure (node ids and states only)</label> <input id="include-graph" type="checkbox"${checked}></p>`,
    `<p style="${paint(theme)}"><button type="button" data-action="export-bundle" style="${paint(theme)}">Export Diagnostics Bundle</button></p>`,
    files,
    `<p style="${paint(theme)}"><button type="button" data-action="save-zip" style="${paint(theme)}">Save .zip</button></p>`,
    `<h3 style="${paint(theme)}">Copy Redacted Summary for GitHub Issue</h3>`,
    `<pre id="redacted-summary" tabindex="0" style="${paint(theme, "white-space:pre-wrap;overflow:auto")}">${escapeHtml(model.redactedSummary)}</pre>`,
    `<p style="${paint(theme)}"><button type="button" data-action="copy-summary" style="${paint(theme)}">Copy Redacted Summary for GitHub Issue</button></p>`,
  ].join("");
}

function safeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}

function previewItem(file: BundlePreviewFile, theme: DiagnosticsTheme, selected: string | null): string {
  const pressed = selected === file.name ? ' aria-pressed="true"' : ' aria-pressed="false"';
  return [
    `<li style="${paint(theme)}">`,
    `<button type="button" data-action="preview-file" data-file="${escapeHtml(file.name)}"${pressed} style="${paint(theme)}">${escapeHtml(file.name)} (${file.byteLength} bytes)</button>`,
    `<pre id="preview-${safeId(file.name)}" tabindex="0" style="${paint(theme, "white-space:pre-wrap;overflow:auto")}">${escapeHtml(file.text)}</pre>`,
    "</li>",
  ].join("");
}

function table(
  theme: DiagnosticsTheme,
  caption: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  if (rows.length === 0) {
    return `<p style="${paint(theme)}">${escapeHtml(caption)}: none</p>`;
  }
  const text = paint(theme, "font-variant-numeric:tabular-nums");
  const head = headers
    .map((header) => `<th scope="col" style="${text}">${escapeHtml(header)}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell, index) =>
          index === 0
            ? `<th scope="row" style="${text}">${escapeHtml(cell)}</th>`
            : `<td class="tabular-nums" style="${text}">${escapeHtml(cell)}</td>`,
        )
        .join("");
      return `<tr style="${text}">${cells}</tr>`;
    })
    .join("");
  return `<table style="${paint(theme)}"><caption style="${text}">${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
