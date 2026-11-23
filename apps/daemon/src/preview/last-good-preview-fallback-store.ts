import fs from "node:fs";
import path from "node:path";
import { lastGoodBanner, noLastGoodBanner } from "./preview-partition.js";
import type { FallbackPlan, HealthyBootRecord, LastGoodFallbackPort } from "./ports.js";
import { CRASH_DETECT_MS, HEALTHY_BOOT_WINDOW_MS } from "./timings.js";

/**
 * Remembers the last commit that booted with HTTP 200 and zero startup crashes within 5s.
 * A later failed boot restores that commit instead of leaving a blank preview.
 */
export class LastGoodPreviewFallbackStore implements LastGoodFallbackPort {
  private readonly records = new Map<string, HealthyBootRecord>();

  constructor(
    private readonly directory: string,
    private readonly healthyBootWindowMs = HEALTHY_BOOT_WINDOW_MS,
  ) {
    this.load();
  }

  recordHealthy(input: {
    readonly projectId: string;
    readonly sha: string;
    readonly httpStatus: number;
    readonly startupCrashes: number;
    readonly bootMs: number;
  }): boolean {
    if (input.httpStatus !== 200 || input.startupCrashes !== 0 || input.bootMs > this.healthyBootWindowMs) {
      return false;
    }
    if (input.bootMs < 0 || input.sha.length === 0) return false;
    const record: HealthyBootRecord = {
      projectId: input.projectId,
      lastGoodPreviewCommitSha: input.sha,
      httpStatus: 200,
      startupCrashes: 0,
      bootMs: input.bootMs,
    };
    this.records.set(input.projectId, record);
    this.persist();
    return true;
  }

  current(projectId: string): HealthyBootRecord | null {
    return this.records.get(projectId) ?? null;
  }

  planFailure(input: {
    readonly projectId: string;
    readonly attemptedSha: string;
    readonly detectedWithinMs: number;
    readonly stderr: string;
    readonly reason: FallbackPlan["reason"];
    readonly redact: (text: string) => string;
  }): FallbackPlan {
    const current = this.current(input.projectId);
    const restoreSha =
      current && current.lastGoodPreviewCommitSha !== input.attemptedSha
        ? current.lastGoodPreviewCommitSha
        : null;
    return {
      restoreSha,
      banner: restoreSha ? lastGoodBanner(restoreSha) : noLastGoodBanner(),
      stderrRedacted: input.redact(input.stderr),
      detectedWithinMs: input.detectedWithinMs,
      withinCrashWindow: input.detectedWithinMs <= CRASH_DETECT_MS,
      reason: input.reason,
      actions: ["inspect_error", "send_error_to_fix"],
    };
  }

  private load(): void {
    const file = this.file();
    if (!fs.existsSync(file)) return;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    for (const value of Object.values(parsed)) {
      if (!isRecord(value)) continue;
      this.records.set(value.projectId, value);
    }
  }

  private persist(): void {
    fs.mkdirSync(this.directory, { recursive: true });
    const payload: Record<string, HealthyBootRecord> = {};
    for (const [projectId, record] of this.records) payload[projectId] = record;
    const file = this.file();
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(temp, file);
  }

  private file(): string {
    return path.join(this.directory, "last-good-preview.json");
  }
}

function isRecord(value: unknown): value is HealthyBootRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HealthyBootRecord>;
  return (
    typeof record.projectId === "string" &&
    typeof record.lastGoodPreviewCommitSha === "string" &&
    record.httpStatus === 200 &&
    record.startupCrashes === 0 &&
    typeof record.bootMs === "number"
  );
}
