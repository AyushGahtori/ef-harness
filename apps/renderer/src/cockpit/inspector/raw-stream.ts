import { DIFF_CHUNK_BYTES, MAX_VISIBLE_LOG_LINES } from "./constants.js";
import { el, type InspectorElement } from "./elements.js";
import { RangeLimitError, isAbortError } from "./errors.js";
import { ResidentLedger, utf8Size } from "./memory.js";
import type { BinaryStreamClient, SeekableZstdLogReader } from "./ports.js";
import { assertPreRedacted } from "./redaction.js";

const LEDGER_KEY = "raw-stream";

interface RawWindow {
  readonly startLine: number;
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly archived: boolean;
  readonly pinned: boolean;
}

/**
 * Opt-in raw `turn_log`. Closed until the user asks. Visible lines stay capped
 * and auto-follow pauses as soon as the viewport leaves the tail.
 */
export class OptInRawStreamTab {
  private optedIn = false;
  private pinned = true;
  private window: RawWindow | null = null;
  private blocked = false;
  private copyState: "idle" | "copied" | "blocked" = "idle";
  private artifactId: string | null = null;
  private reloadInFlight = false;
  private reloadQueued = false;

  constructor(
    private readonly logs: SeekableZstdLogReader,
    private readonly binary: BinaryStreamClient,
    private readonly ledger: ResidentLedger,
  ) {}

  get opted(): boolean {
    return this.optedIn;
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  visibleLineCount(): number {
    return this.window?.lines.length ?? 0;
  }

  setArtifact(artifactId: string | null): void {
    if (artifactId === this.artifactId) return;
    this.artifactId = artifactId;
    this.optedIn = false;
    this.pinned = true;
    this.blocked = false;
    this.copyState = "idle";
    this.dropWindow();
  }

  async setOptIn(
    enabled: boolean,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "blocked"> {
    this.optedIn = enabled;
    this.copyState = "idle";
    if (!enabled) {
      this.dropWindow();
      this.pinned = true;
      this.blocked = false;
      return "applied";
    }
    this.pinned = true;
    return this.loadTail(signal, live);
  }

  async scrollTo(
    startLine: number,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "blocked"> {
    if (!this.optedIn || !this.artifactId) return "applied";
    const total = this.window?.totalLines ?? startLine;
    const tailStart = Math.max(1, total - MAX_VISIBLE_LOG_LINES + 1);
    this.pinned = startLine >= tailStart;
    return this.loadWindow(startLine, signal, live);
  }

  async jumpToLive(signal: AbortSignal, live: () => boolean): Promise<"applied" | "discarded" | "blocked"> {
    this.pinned = true;
    return this.loadTail(signal, live);
  }

  /**
   * Live producers can emit far faster than the DOM. While pinned, coalesce to
   * one tail fetch. While the user is reading upward, grant no further credits.
   */
  async noteGrowth(signal: AbortSignal, live: () => boolean): Promise<"applied" | "discarded" | "blocked"> {
    if (!this.optedIn || !this.pinned) return "applied";
    if (this.reloadInFlight) {
      this.reloadQueued = true;
      return "applied";
    }
    this.reloadInFlight = true;
    try {
      let result: "applied" | "discarded" | "blocked" = "applied";
      do {
        this.reloadQueued = false;
        result = await this.loadTail(signal, live);
      } while (this.reloadQueued && this.pinned && this.optedIn && live());
      return result;
    } finally {
      this.reloadInFlight = false;
    }
  }

  copySnippet(): { ok: boolean; text: string } {
    const text = this.window?.lines.join("\n") ?? "";
    try {
      assertPreRedacted(text, "raw-stream-copy");
    } catch {
      this.copyState = "blocked";
      return { ok: false, text: "" };
    }
    this.copyState = "copied";
    return { ok: true, text };
  }

  discard(): void {
    this.optedIn = false;
    this.pinned = true;
    this.blocked = false;
    this.copyState = "idle";
    this.artifactId = null;
    this.dropWindow();
  }

  render(): InspectorElement {
    const toggle = el("button", "Show raw log stream", "", [], { pressed: this.optedIn });
    if (!this.optedIn) {
      return el("tabpanel", "Raw Stream", "Raw stream is opt-in", [toggle]);
    }
    const children: InspectorElement[] = [toggle];
    if (this.blocked) {
      children.push(el("alert", "Raw stream blocked", "Blocked: raw stream chunk was not pre-redacted"));
    }
    if (this.window) {
      const lines = this.window.lines.map((line, index) =>
        el("line", `L${this.window ? this.window.startLine + index : index}`, line),
      );
      children.push(
        el("log", "Raw log", "", lines.slice(0, MAX_VISIBLE_LOG_LINES), {
          pinned: this.window.pinned,
          lines: lines.length,
          archived: this.window.archived,
          totalBytes: this.window.totalBytes,
        }),
      );
      if (this.window.archived) {
        children.push(el("note", "Archived turn log", "Archived seekable turn log"));
      }
    }
    if (!this.pinned) {
      children.push(el("button", "Jump to live", "Jump to live"));
    }
    children.push(el("button", "Copy redacted snippet", this.copyState));
    return el("tabpanel", "Raw Stream", "", children, { optedIn: true });
  }

  private async loadTail(
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "blocked"> {
    if (!this.artifactId) return "applied";
    const probe = await this.logs.locateLineWindow(this.artifactId, 1, 1, DIFF_CHUNK_BYTES, signal);
    if (!live()) return "discarded";
    const start = Math.max(1, probe.totalLines - MAX_VISIBLE_LOG_LINES + 1);
    return this.loadWindow(start, signal, live);
  }

  private async loadWindow(
    startLine: number,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "blocked"> {
    if (!this.artifactId || !this.optedIn) return "applied";
    let location;
    try {
      location = await this.logs.locateLineWindow(
        this.artifactId,
        startLine,
        MAX_VISIBLE_LOG_LINES,
        DIFF_CHUNK_BYTES,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || !live()) return "discarded";
      throw error;
    }
    if (!live()) return "discarded";
    const limit = Math.min(DIFF_CHUNK_BYTES, Math.max(1, location.byteLength));
    if (limit > DIFF_CHUNK_BYTES) throw new RangeLimitError("log window exceeded 64 KB");
    let chunk;
    try {
      chunk = await this.binary.fetchLogChunk(this.artifactId, location.byteOffset, limit, signal);
    } catch (error) {
      if (isAbortError(error) || !live()) return "discarded";
      throw error;
    }
    if (!live()) return "discarded";
    if (chunk.bytes.byteLength > DIFF_CHUNK_BYTES) {
      throw new RangeLimitError("log chunk exceeded 64 KB");
    }
    const decoded = new TextDecoder().decode(chunk.bytes);
    let lines = decoded.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length > MAX_VISIBLE_LOG_LINES) lines = lines.slice(0, MAX_VISIBLE_LOG_LINES);
    const body = lines.join("\n");
    try {
      assertPreRedacted(body, "raw-stream");
    } catch {
      this.dropWindow();
      this.blocked = true;
      return "blocked";
    }
    this.dropWindow();
    this.ledger.retain(LEDGER_KEY, utf8Size(body));
    const tailStart = Math.max(1, location.totalLines - MAX_VISIBLE_LOG_LINES + 1);
    this.window = {
      startLine: location.startLine,
      lines,
      totalLines: location.totalLines,
      totalBytes: location.totalBytes,
      archived: location.archived || chunk.archived,
      pinned: this.pinned && location.startLine >= tailStart,
    };
    this.pinned = this.window.pinned;
    this.blocked = false;
    return "applied";
  }

  private dropWindow(): void {
    this.ledger.release(LEDGER_KEY);
    this.window = null;
  }
}
