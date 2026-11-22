import { Buffer } from "node:buffer";
import type {
  BinaryStreamClient,
  DiffRangeChunk,
  InspectorDependencies,
  InspectorShellPort,
  SeekableZstdLogReader,
} from "../../src/cockpit/inspector/ports.js";
import type {
  AttemptSnapshot,
  CheckReceipt,
  DiffFileSummary,
  HandoffHop,
  HandoffRead,
  InspectorTaskSnapshot,
  PinnedBrief,
  TimelineMilestone,
  WorkerIdentity,
} from "../../src/cockpit/inspector/types.js";

export const DIFF_CHUNK = 64 * 1024;
export const HEAP_LIMIT = 25 * 1024 * 1024;
export const LOG_BYTES = 50 * 1024 * 1024;

export function rawCredential(): string {
  return ["sk", "_live_", "unit"].join("");
}

export function identity(overrides: Partial<WorkerIdentity> = {}): WorkerIdentity {
  return {
    agentId: "A0014",
    title: "print page",
    model: "gpt-5.1",
    connection: "ChatGPT Plus",
    level: "Mid",
    elapsedMs: 4 * 60 * 1000,
    spendMicroUsd: 180_000,
    lane: "Working",
    holdReason: null,
    phase0GateOpen: true,
    waitingOn: [],
    estimatedLevel: "Mid",
    estimatedCostMicroUsd: 110_000,
    ...overrides,
  };
}

export function milestone(
  id: string,
  summary: string,
  extras: Partial<TimelineMilestone> = {},
): TimelineMilestone {
  return {
    id,
    at: "14:02",
    summary,
    command: null,
    commandOutput: null,
    handoffId: null,
    filePath: null,
    line: null,
    ...extras,
  };
}

export function attempt(overrides: Partial<AttemptSnapshot> & Pick<AttemptSnapshot, "attemptId" | "number" | "outcome">): AttemptSnapshot {
  return {
    hint: null,
    model: "gpt-5.1",
    level: "Mid",
    escalatedFrom: null,
    sliceSha256: null,
    logArtifactId: null,
    milestones: [],
    files: [],
    checks: [],
    ...overrides,
  };
}

export function file(path: string, byteSize: number, insertions: number, deletions: number): DiffFileSummary {
  return { path, byteSize, insertions, deletions };
}

export function check(overrides: Partial<CheckReceipt> & Pick<CheckReceipt, "id" | "layer" | "status">): CheckReceipt {
  return {
    summary: overrides.layer ?? "",
    sealedSource: null,
    hideSealedSource: false,
    screenshotArtifactId: null,
    disputeAvailable: false,
    ...overrides,
  };
}

export function brief(overrides: Partial<PinnedBrief> = {}): PinnedBrief {
  return {
    sliceSha256: "sha-historical",
    taskId: "T-7",
    nodeVersions: { "R-5": 3 },
    mustTokens: 2400,
    shouldTokens: 400,
    couldTokens: 80,
    requirements: [
      {
        id: "R-5",
        band: "MUST",
        version: 3,
        text: "cutoff 10:45 Europe/Berlin",
        laterVersion: 4,
      },
    ],
    rules: [
      { id: "X-01", text: "Contract pins stay stable" },
      { id: "X-14", text: "Owned write scope is closed" },
      { id: "X-99", text: "not a cross-cutting rule" },
    ],
    skills: [
      { id: "skill-print", sha256: "abc" },
      { id: "skill-a11y", sha256: "def" },
    ],
    writeScope: ["src/kitchen/print.tsx"],
    pulls: [{ tool: "kb.get_fact", targetId: "fact-cutoff" }],
    goal: "Show today's totals on /kitchen",
    ...overrides,
  };
}

export class ShellRecorder implements InspectorShellPort {
  readonly pauses: string[] = [];
  readonly explains: { taskId: string; summary: string; evidence: readonly string[] }[] = [];
  readonly fixes: string[] = [];
  readonly nodes: string[] = [];
  readonly editors: string[] = [];
  readonly disputes: { taskId: string; checkId: string }[] = [];
  readonly copies: string[] = [];

  pause(taskId: string): void {
    this.pauses.push(taskId);
  }

  explain(taskId: string, summary: string, evidence: readonly string[]): void {
    this.explains.push({ taskId, summary, evidence });
  }

  fixedItMyself(taskId: string): void {
    this.fixes.push(taskId);
  }

  openCanvasNode(nodeId: string): void {
    this.nodes.push(nodeId);
  }

  openInEditor(command: string): void {
    this.editors.push(command);
  }

  disputeTest(taskId: string, checkId: string): void {
    this.disputes.push({ taskId, checkId });
  }

  copyText(text: string): void {
    this.copies.push(text);
  }
}

interface DiffSpec {
  readonly line: number;
  readonly lines: readonly string[];
}

export class FakePorts {
  readonly shell = new ShellRecorder();
  readonly signals: AbortSignal[] = [];
  readonly diffCalls: { attemptId: string; filePath: string; hunkOffset: number; limit: number }[] = [];
  readonly logCalls: { artifactId: string; byteOffset: number; limit: number }[] = [];
  readonly shotCalls: { artifactId: string; limit: number }[] = [];
  readonly briefRequests: string[] = [];
  totalLines = 1200;
  totalBytes = LOG_BYTES;
  archived = true;
  honorAbort = true;
  /** When set, every log window is this exact text. Used to prove redaction refusal. */
  forcedLogText: string | null = null;
  snapshots = new Map<string, InspectorTaskSnapshot>();
  briefs = new Map<string, PinnedBrief>();
  previews = new Map<string, PinnedBrief>();
  handoffReads = new Map<string, readonly HandoffRead[]>();
  lineage = new Map<string, readonly HandoffHop[]>();
  diffs = new Map<string, DiffSpec>();
  /** When set, the next diff fetch returns this promise instead of a body. */
  heldDiff: Promise<DiffRangeChunk> | null = null;
  screenshot = Buffer.from([137, 80, 78, 71]);

  catalogLoad: InspectorDependencies["catalog"]["load"] = async (taskId, signal) => {
    this.signals.push(signal);
    await this.wait(signal);
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) throw new Error(`missing snapshot ${taskId}`);
    return snapshot;
  };

  deps(): InspectorDependencies {
    const logs: SeekableZstdLogReader = {
      locateLineWindow: async (artifactId, startLine, maxLines, maxBytes, signal) => {
        await this.wait(signal);
        const located = this.locate(artifactId, startLine, maxLines, maxBytes);
        return located.location;
      },
    };
    const binary: BinaryStreamClient = {
      fetchDiffRange: async (attemptId, filePath, hunkOffset, limit, signal) => {
        this.diffCalls.push({ attemptId, filePath, hunkOffset, limit });
        if (this.heldDiff) {
          const pending = this.heldDiff;
          this.heldDiff = null;
          return pending;
        }
        await this.wait(signal);
        const spec = this.diffs.get(`${attemptId}:${filePath}`) ?? {
          line: 1,
          lines: ["+const ready = 1"],
        };
        const text = spec.lines.join("\n");
        return {
          attemptId,
          filePath,
          hunkOffset,
          limit,
          bytesRead: Buffer.byteLength(text),
          hunks: [
            {
              index: hunkOffset,
              header: "@@ -1 +1 @@",
              oldStart: 1,
              newStart: spec.line,
              lines: spec.lines,
            },
          ],
        };
      },
      fetchLogChunk: async (artifactId, byteOffset, limit, signal) => {
        this.logCalls.push({ artifactId, byteOffset, limit });
        await this.wait(signal);
        const bytes = this.logBytes.get(`${byteOffset}:${limit}`) ?? Buffer.alloc(Math.min(limit, 1));
        return {
          artifactId,
          byteOffset,
          bytes,
          totalBytes: this.totalBytes,
          archived: this.archived,
        };
      },
      fetchScreenshot: async (artifactId, _byteOffset, limit, signal) => {
        this.shotCalls.push({ artifactId, limit });
        await this.wait(signal);
        return { artifactId, bytes: this.screenshot, totalBytes: this.screenshot.byteLength };
      },
    };
    return {
      catalog: { load: this.catalogLoad },
      slicer: {
        pinnedManifest: async (sliceSha256, signal) => {
          this.briefRequests.push(sliceSha256);
          await this.wait(signal);
          const found = this.briefs.get(sliceSha256);
          if (!found) throw new Error(`missing brief ${sliceSha256}`);
          return found;
        },
        previewManifest: async (taskId, signal) => {
          await this.wait(signal);
          const found = this.previews.get(taskId);
          if (!found) throw new Error(`missing preview ${taskId}`);
          return found;
        },
      },
      handoffs: {
        readsForAttempt: async (attemptId, signal) => {
          await this.wait(signal);
          return this.handoffReads.get(attemptId) ?? [];
        },
        lineage: (handoffId) => this.lineage.get(handoffId) ?? [],
      },
      binary,
      logs,
      shell: this.shell,
    };
  }

  private readonly logBytes = new Map<string, Uint8Array>();

  locate(
    artifactId: string,
    startLine: number,
    maxLines: number,
    maxBytes: number,
  ): {
    location: {
      artifactId: string;
      byteOffset: number;
      byteLength: number;
      startLine: number;
      endLine: number;
      totalLines: number;
      totalBytes: number;
      archived: boolean;
      framesDecompressed: number;
    };
  } {
    const start = Math.min(Math.max(1, startLine), this.totalLines);
    if (this.forcedLogText !== null) {
      const bytes = Buffer.from(this.forcedLogText);
      this.logBytes.set(`0:${bytes.byteLength}`, bytes);
      return {
        location: {
          artifactId,
          byteOffset: 0,
          byteLength: bytes.byteLength,
          startLine: 1,
          endLine: 1,
          totalLines: this.totalLines,
          totalBytes: this.totalBytes,
          archived: this.archived,
          framesDecompressed: 1,
        },
      };
    }
    let end = Math.min(this.totalLines, start + maxLines - 1);
    const parts: string[] = [];
    for (let line = start; line <= end; line += 1) {
      parts.push(`L${String(line).padStart(6, "0")}`);
      const text = parts.join("\n");
      if (Buffer.byteLength(text) > maxBytes) {
        parts.pop();
        end = line - 1;
        break;
      }
    }
    const text = parts.join("\n");
    const bytes = Buffer.from(text);
    const byteOffset = start - 1;
    this.logBytes.set(`${byteOffset}:${bytes.byteLength}`, bytes);
    return {
      location: {
        artifactId,
        byteOffset,
        byteLength: bytes.byteLength,
        startLine: start,
        endLine: end,
        totalLines: this.totalLines,
        totalBytes: this.totalBytes,
        archived: this.archived,
        framesDecompressed: 2,
      },
    };
  }

  private async wait(signal: AbortSignal): Promise<void> {
    await Promise.resolve();
    if (this.honorAbort && signal.aborted) {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
  }
}
