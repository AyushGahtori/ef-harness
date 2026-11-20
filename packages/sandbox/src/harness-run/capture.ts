import { TextDecoder } from "node:util";
import { PROGRESS_THROTTLE_MS } from "./constants.js";
import { StreamingSecretRedactor } from "./redactor.js";
import type { OutputSummarizer } from "./summarizer.js";
import type { ProgressEvent, RegisteredSecret } from "./types.js";

class LineAssembler {
  private partial = "";

  push(text: string, onLine: (line: string) => void): void {
    this.partial += text;
    let index = this.partial.indexOf("\n");
    while (index >= 0) {
      let line = this.partial.slice(0, index);
      this.partial = this.partial.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      onLine(line);
      index = this.partial.indexOf("\n");
    }
  }

  flush(onLine: (line: string) => void): void {
    if (this.partial.length === 0) return;
    const line = this.partial.endsWith("\r") ? this.partial.slice(0, -1) : this.partial;
    this.partial = "";
    onLine(line);
  }
}

interface StreamState {
  readonly name: "stdout" | "stderr";
  readonly decoder: TextDecoder;
  readonly redactor: StreamingSecretRedactor;
  readonly lines: LineAssembler;
  binary: boolean;
  seenBytes: number;
  stored: Buffer[];
  storedBytes: number;
  lineCount: number;
}

export class CommandOutputCapture {
  private readonly stdout: StreamState;
  private readonly stderr: StreamState;
  private outputLimited = false;
  private lastProgress = 0;

  constructor(
    private readonly maxBytes: number,
    secrets: readonly RegisteredSecret[],
    private readonly summarizer: OutputSummarizer,
    private readonly onProgress: (event: ProgressEvent) => void,
    private readonly commandId: string,
  ) {
    this.stdout = this.makeStream("stdout", secrets);
    this.stderr = this.makeStream("stderr", secrets);
  }

  onStdout(chunk: Buffer): void {
    this.accept(this.stdout, chunk);
  }

  onStderr(chunk: Buffer): void {
    this.accept(this.stderr, chunk);
  }

  shouldAbort(): { readonly abort: boolean; readonly reason: string } {
    if (!this.outputLimited) return { abort: false, reason: "" };
    return { abort: true, reason: "output_limit_exceeded" };
  }

  finish(): {
    readonly body: Buffer;
    readonly outputLimited: boolean;
  } {
    this.finishStream(this.stdout);
    this.finishStream(this.stderr);
    const stdout = Buffer.concat(this.stdout.stored);
    const stderr = Buffer.concat(this.stderr.stored);
    let body = stdout;
    if (stderr.length > 0) {
      const needsBreak = stdout.length > 0 && stdout[stdout.length - 1] !== 0x0a;
      body = Buffer.concat([
        stdout,
        Buffer.from(needsBreak ? "\n----- stderr -----\n" : "----- stderr -----\n"),
        stderr,
      ]);
    }
    this.emit(true);
    return { body, outputLimited: this.outputLimited };
  }

  private makeStream(name: "stdout" | "stderr", secrets: readonly RegisteredSecret[]): StreamState {
    return {
      name,
      decoder: new TextDecoder("utf8", { fatal: false }),
      redactor: new StreamingSecretRedactor(secrets),
      lines: new LineAssembler(),
      binary: false,
      seenBytes: 0,
      stored: [],
      storedBytes: 0,
      lineCount: 0,
    };
  }

  private accept(stream: StreamState, chunk: Buffer): void {
    stream.seenBytes += chunk.length;
    if (chunk.includes(0)) stream.binary = true;
    if (this.outputLimited) {
      this.emit(false);
      return;
    }
    const decoded = stream.decoder.decode(chunk, { stream: true });
    const redacted = stream.redactor.push(decoded);
    this.writeRedacted(stream, redacted);
    this.emit(false);
  }

  private finishStream(stream: StreamState): void {
    if (this.outputLimited) return;
    const decoded = stream.decoder.decode();
    const redacted = `${stream.redactor.push(decoded)}${stream.redactor.flush()}`;
    this.writeRedacted(stream, redacted);
    if (!stream.binary) {
      stream.lines.flush((line) => {
        this.summarizer.push(stream.name, line);
        stream.lineCount += 1;
      });
    }
    if (stream.binary) this.summarizer.markBinary(stream.name, stream.seenBytes);
  }

  private writeRedacted(stream: StreamState, redacted: string): void {
    if (redacted.length === 0 || this.outputLimited) return;
    const bytes = Buffer.from(redacted, "utf8");
    const room = this.maxBytes - this.storedBytes();
    if (room <= 0 || bytes.length > room) {
      if (room > 0) stream.stored.push(bytes.subarray(0, room));
      stream.storedBytes += Math.max(0, room);
      this.outputLimited = true;
      this.summarizer.markOutputLimited();
      return;
    }
    stream.stored.push(bytes);
    stream.storedBytes += bytes.length;
    if (!stream.binary) {
      stream.lines.push(redacted, (line) => {
        this.summarizer.push(stream.name, line);
        stream.lineCount += 1;
      });
    }
  }

  private storedBytes(): number {
    return this.stdout.storedBytes + this.stderr.storedBytes;
  }

  private emit(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastProgress < PROGRESS_THROTTLE_MS) return;
    this.lastProgress = now;
    this.onProgress({
      commandId: this.commandId,
      stream: "stdout",
      bytes: this.stdout.seenBytes + this.stderr.seenBytes,
      lines: this.stdout.lineCount + this.stderr.lineCount,
      truncated: this.outputLimited,
    });
  }
}
