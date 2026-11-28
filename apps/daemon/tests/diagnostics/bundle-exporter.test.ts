import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLE_FILE_ORDER,
  BundleAllowlistError,
  DAEMON_LOG_LINE_CAP,
  LocalPacketSecurityRedactor,
  REDACTED_SECRET,
  RedactedDiagnosticsBundleExporter,
  assertBundleEntryName,
  buildRedactedSummaryMarkdown,
  copyRedactedSummary,
  readStoredZip,
  runSafeCacheCleanup,
  scrubDiagnosticsText,
  stageBundleEntries,
} from "../../src/diagnostics/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "ef-bundle-"));
  directories.push(directory);
  return directory;
}

const canary = "CANARY_BEARER_FRAGMENT_7H3K";
const sourcePayload = "SOURCE_CANARY_PAYLOAD_QX_991";
const promptPayload = "PROMPT_CANARY_PAYLOAD_QX_772";

function request(lines: readonly string[], includeGraph: boolean) {
  return {
    osVersion: "Windows 11",
    ramClass: "16 GB",
    cpuClass: "8 cores",
    appVersion: "0.0.0",
    componentVersions: { daemon: "0.0.0", mingit: "2.47.0" },
    metrics24h: { writeP99Ms: 18, note: "steady" },
    governorTimeline: [{ at: 1, level: "Green", reason: "normal" }],
    daemonLogLines: lines,
    schemaHealth: { state: 7, global: 3, telemetry: 1 },
    includeSanitizedGraph: includeGraph,
    graphNodes: [
      {
        id: "node-1",
        state: "ready",
        source: sourcePayload,
        prompt: promptPayload,
        prose: "secret startup pitch",
      },
    ],
    redactor: new LocalPacketSecurityRedactor(),
    windowsUsernames: ["SecretName"],
    repoFolderNames: ["secret-startup"],
    hostnames: ["DESKTOP-SECRETBOX"],
    canaries: [canary, sourcePayload, promptPayload],
  };
}

describe("diagnostics redacted bundle exporter", () => {
  it("scrubs canaries, user paths, emails, and hostnames and matches the saved zip", () => {
    const leaked =
      "C:\\Users\\SecretName\\Desktop\\secret-startup\\api.ts Authorization: Bearer " +
      `${canary} founder@secret-startup.test host DESKTOP-SECRETBOX`;
    const exporter = new RedactedDiagnosticsBundleExporter();
    const preview = exporter.createPreview(request([leaked], false));
    expect(preview.files.map((file) => file.name)).toEqual([
      "system-summary.json",
      "metrics-24h.json",
      "governor-timeline.json",
      "daemon-logs-redacted.txt",
      "schema-health.json",
    ]);
    const logs = preview.files.find((file) => file.name === "daemon-logs-redacted.txt");
    expect(logs?.text).toContain("C:\\Users\\<USER>\\Desktop\\<REPO>\\api.ts");
    expect(logs?.text).toContain(REDACTED_SECRET);
    expect(logs?.text).toContain("<EMAIL>");
    expect(logs?.text).toContain("<HOST>");
    expect(logs?.text).not.toContain("SecretName");
    expect(logs?.text).not.toContain(canary);
    expect(logs?.text).not.toContain("secret-startup");
    expect(logs?.text).not.toContain("founder@");
    const directory = tempDir();
    const zipPath = join(directory, "diagnostics.zip");
    exporter.saveZip(preview, zipPath);
    const unzipped = readStoredZip(readFileSync(zipPath));
    for (const file of preview.files) {
      expect(Buffer.from(unzipped.get(file.name) ?? new Uint8Array())).toEqual(Buffer.from(file.bytes));
    }
    const listing = execFileSync("tar", ["-tf", zipPath], { encoding: "utf8" });
    for (const file of preview.files) expect(listing).toContain(file.name);
    const extracted = execFileSync("tar", ["-xOf", zipPath, "daemon-logs-redacted.txt"]);
    expect(Buffer.from(extracted)).toEqual(Buffer.from(logs?.bytes ?? new Uint8Array()));
    const raw = readFileSync(zipPath);
    expect(raw.includes(Buffer.from(canary))).toBe(false);
    expect(raw.includes(Buffer.from("SecretName"))).toBe(false);
    expect(raw.includes(Buffer.from(sourcePayload))).toBe(false);
    expect(raw.includes(Buffer.from("state.db"))).toBe(false);
  });

  it("keeps the last 2000 log lines and refuses source, prompts, vault, and state.db", () => {
    const lines = Array.from({ length: 2500 }, (_, index) => `LINE-${index}`);
    const preview = new RedactedDiagnosticsBundleExporter().createPreview(request(lines, false));
    const logs = preview.files.find((file) => file.name === "daemon-logs-redacted.txt")?.text ?? "";
    const body = logs.trim().split("\n");
    expect(body).toHaveLength(DAEMON_LOG_LINE_CAP);
    expect(body[0]).toBe("LINE-500");
    expect(body[body.length - 1]).toBe("LINE-2499");
    expect(() => assertBundleEntryName("state.db")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName("src/app.ts")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName(".env")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName("capture.har")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName("vault.bin")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName("prompt.txt")).toThrow(BundleAllowlistError);
    expect(() => assertBundleEntryName("chat.jsonl")).toThrow(BundleAllowlistError);
    const staged = stageBundleEntries({
      "daemon-logs-redacted.txt": "safe\n",
      "state.db": sourcePayload,
      "src/app.ts": sourcePayload,
      ".env": "SECRET_ENV_VALUE",
      "capture.har": sourcePayload,
      "vault.bin": sourcePayload,
      "notes.diff": promptPayload,
    });
    expect([...staged.keys()]).toEqual(["daemon-logs-redacted.txt"]);
    expect(JSON.stringify([...staged.values()])).not.toContain(sourcePayload);
    expect(BUNDLE_FILE_ORDER).not.toContain("state.db");
  });

  it("omits the graph unless opted in, then keeps only ids and states", () => {
    const exporter = new RedactedDiagnosticsBundleExporter();
    const hidden = exporter.createPreview(request(["ok"], false));
    expect(hidden.files.some((file) => file.name === "graph-structure.json")).toBe(false);
    const shown = exporter.createPreview(request(["ok"], true));
    const graph = shown.files.find((file) => file.name === "graph-structure.json")?.text ?? "";
    expect(graph).toContain("\"nodeCount\": 1");
    expect(graph).toContain("\"id\": \"node-1\"");
    expect(graph).toContain("\"state\": \"ready\"");
    expect(graph).not.toContain(sourcePayload);
    expect(graph).not.toContain(promptPayload);
    expect(graph).not.toContain("pitch");
  });

  it("copies a redacted summary and invokes pin-safe cache cleanup", () => {
    const markdown = buildRedactedSummaryMarkdown({
      osVersion: "Windows 11",
      appVersion: "0.0.0",
      sqlite: {
        sampleCount: 5,
        p50Ms: 14,
        p95Ms: 18,
        p99Ms: 18,
        busyRetryCount: 3,
        sloMs: 50,
        withinSlo: true,
      },
      governor: "Green",
      recentErrors: [`Bearer ${canary} on C:\\Users\\SecretName\\project`],
      scrub: (text) =>
        scrubDiagnosticsText(text, {
          redactor: new LocalPacketSecurityRedactor(),
          windowsUsernames: ["SecretName"],
          repoFolderNames: [],
          hostnames: [],
          canaries: [canary],
        }),
    });
    expect(markdown).toContain("- OS: Windows 11");
    expect(markdown).toContain("- App Version: 0.0.0");
    expect(markdown).toContain("SQLite health: p99 18 ms (within 50 ms SLO)");
    expect(markdown).toContain("- Governor: Green");
    expect(markdown).toContain("Recent errors:");
    expect(markdown).toContain(REDACTED_SECRET);
    expect(markdown).not.toContain(canary);
    expect(markdown).not.toContain("SecretName");
    let copied = "";
    expect(copyRedactedSummary(markdown, { writeText: (value) => { copied = value; } })).toBe(markdown);
    expect(copied).toBe(markdown);
    let calls = 0;
    const result = runSafeCacheCleanup({
      runSafeCacheCleanup: () => {
        calls += 1;
        return { reclaimedBytes: 100, pinnedKept: 2 };
      },
    });
    expect(calls).toBe(1);
    expect(result.pinnedKept).toBe(2);
  });

  it("fails closed when a canary survives redaction", () => {
    const redactor = {
      registerCanary(): void {},
      redact(text: string): string {
        return text;
      },
    };
    expect(() =>
      scrubDiagnosticsText("prefix CANARY_NOT_REMOVED_91 suffix", {
        redactor,
        windowsUsernames: [],
        repoFolderNames: [],
        hostnames: [],
        canaries: ["CANARY_NOT_REMOVED_91"],
      }),
    ).toThrow(/canary/i);
  });
});
