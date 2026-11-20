import { DEFAULT_HEAD_LINES, DEFAULT_LINE_CHARS, DEFAULT_TAIL_LINES } from "./constants.js";

const ANSI_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

interface DisplayLine {
  readonly text: string;
  readonly omittedChars: number;
  readonly lineNo: number;
}

class LineWindow {
  private stored: DisplayLine[] = [];
  private head: DisplayLine[] = [];
  private tail: DisplayLine[] = [];
  private total = 0;
  private charTruncated = false;

  constructor(
    private readonly headCount: number,
    private readonly tailCount: number,
    private readonly lineChars: number,
  ) {}

  push(line: string): void {
    this.total += 1;
    const omittedChars = line.length > this.lineChars ? line.length - this.lineChars : 0;
    if (omittedChars > 0) this.charTruncated = true;
    const display: DisplayLine = {
      text: omittedChars > 0 ? line.slice(0, this.lineChars) : line,
      omittedChars,
      lineNo: this.total,
    };
    const limit = this.headCount + this.tailCount;
    if (this.total <= limit) {
      this.stored.push(display);
      return;
    }
    if (this.head.length === 0) {
      this.head = this.stored.slice(0, this.headCount);
      this.tail = this.stored.slice(this.headCount);
      this.stored = [];
    }
    this.tail.push(display);
    if (this.tail.length > this.tailCount) this.tail.shift();
  }

  omittedLines(): number {
    return Math.max(0, this.total - this.headCount - this.tailCount);
  }

  hasCharTruncation(): boolean {
    return this.charTruncated;
  }

  totalLines(): number {
    return this.total;
  }

  render(artifactId: string): string {
    const lines = this.total <= this.headCount + this.tailCount ? this.stored : [...this.head, ...this.tail];
    const omitted = this.omittedLines();
    const rendered = lines.map((line) => this.renderLine(line, artifactId));
    if (omitted === 0) return rendered.join("\n");
    const head = rendered.slice(0, this.headCount);
    const tail = rendered.slice(this.headCount);
    const banner = `${omitted} lines omitted; use harness.read_log('${artifactId}', ...)`;
    return [...head, banner, ...tail].join("\n");
  }

  private renderLine(line: DisplayLine, artifactId: string): string {
    if (line.omittedChars === 0) return line.text;
    return `${line.text}[... ${line.omittedChars} chars omitted on line ${line.lineNo}; use harness.read_log('${artifactId}', ...)]`;
  }
}

interface Diagnostic {
  readonly tool: "tsc" | "eslint";
  readonly file: string;
  readonly message: string;
  readonly key: string;
}

class ToolSummaryBuilder {
  private runnerKind: "vitest" | "jest" | "playwright" | null = null;
  private passed: number | null = null;
  private failed: number | null = null;
  private firstAssertion: string | null = null;
  private readonly frames: string[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private eslintFile: string | null = null;

  push(line: string): void {
    const sample = line.length > 16_000 ? `${line.slice(0, 8_000)}${line.slice(-2_000)}` : line;
    this.consumeRunner(sample.trim());
    this.consumeFrame(sample.trim());
    this.consumeDiagnostic(sample.trim());
  }

  render(): string {
    const blocks: string[] = [];
    if (this.runnerKind !== null && (this.passed !== null || this.failed !== null || this.firstAssertion !== null)) {
      const lines = [`test runner: ${this.runnerKind}`];
      if (this.passed !== null) lines.push(`passed: ${this.passed}`);
      if (this.failed !== null) lines.push(`failed: ${this.failed}`);
      if (this.firstAssertion !== null) lines.push(`firstAssertion: ${this.firstAssertion}`);
      if (this.frames.length > 0) {
        lines.push("projectFrames:");
        for (const frame of this.frames) lines.push(`- ${frame}`);
      }
      blocks.push(lines.join("\n"));
    }
    if (this.diagnostics.length > 0) {
      const shown = this.diagnostics.slice(0, 30);
      const tool = shown[0]?.tool ?? "tsc";
      const lines = [`${tool}:`, `errors: ${shown.length}`];
      for (const diagnostic of shown) {
        lines.push(`${diagnostic.file}: ${diagnostic.message}`);
      }
      blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n");
  }

  private consumeRunner(line: string): void {
    const vitestTests = /Tests\s+(\d+)\s+failed\s+\|\s+(\d+)\s+passed/i.exec(line);
    if (vitestTests !== null) {
      this.runnerKind = "vitest";
      this.failed = Number(vitestTests[1]);
      this.passed = Number(vitestTests[2]);
      return;
    }
    const vitestPassed = /Tests\s+(\d+)\s+passed(?:\s+\((\d+)\))?/i.exec(line);
    if (vitestPassed !== null && this.failed === null) {
      this.runnerKind = "vitest";
      this.passed = Number(vitestPassed[1]);
      this.failed = 0;
    }
    if (/^FAIL\s+\S/.test(line) || /^Test Files\s+/.test(line)) {
      this.runnerKind = this.runnerKind ?? "vitest";
    }
    const jest = /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/i.exec(line);
    if (jest !== null) {
      this.runnerKind = "jest";
      this.failed = jest[1] !== undefined ? Number(jest[1]) : 0;
      this.passed = jest[2] !== undefined ? Number(jest[2]) : Number(jest[3]);
    }
    const playwright = /^(\d+)\s+(passed|failed)\b/i.exec(line);
    if (playwright !== null) {
      this.runnerKind = this.runnerKind ?? "playwright";
      if (playwright[2]?.toLowerCase() === "passed") this.passed = Number(playwright[1]);
      if (playwright[2]?.toLowerCase() === "failed") this.failed = Number(playwright[1]);
    }
    if (this.firstAssertion === null && /^(?:AssertionError|Error|Expected|TimeoutError)\b/.test(line)) {
      this.firstAssertion = line;
      this.runnerKind = this.runnerKind ?? "vitest";
    }
  }

  private consumeFrame(line: string): void {
    const match = /^(?:❯|at)\s+(.+)$/.exec(line);
    const frame = match?.[1]?.trim();
    if (frame === undefined || this.frames.length >= 5) return;
    const normalized = frame.replaceAll("\\", "/");
    if (normalized.includes("node_modules/") || normalized.includes("node:internal")) return;
    if (!/(?:^|\/)[\w.@+-]+\.[cm]?[jt]sx?(?::\d+)?/.test(normalized) && !normalized.includes("src/")) return;
    this.frames.push(frame);
    this.runnerKind = this.runnerKind ?? "vitest";
  }

  private consumeDiagnostic(line: string): void {
    if (this.diagnostics.length >= 30) return;
    const tscParen = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/.exec(line);
    if (tscParen !== null) {
      this.addDiagnostic("tsc", tscParen[1] ?? "", `${tscParen[4] ?? ""}: ${tscParen[5] ?? ""}`.trim());
      return;
    }
    const tscColon = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/.exec(line);
    if (tscColon !== null) {
      this.addDiagnostic("tsc", tscColon[1] ?? "", `${tscColon[4] ?? ""}: ${tscColon[5] ?? ""}`.trim());
      return;
    }
    const eslintUnix = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+)$/.exec(line);
    if (eslintUnix !== null) {
      this.addDiagnostic("eslint", eslintUnix[1] ?? "", eslintUnix[5] ?? "");
      return;
    }
    const stylish = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/.exec(line);
    if (stylish !== null && this.eslintFile !== null) {
      this.addDiagnostic("eslint", this.eslintFile, `${stylish[4] ?? ""} (${stylish[5] ?? ""})`.trim());
      return;
    }
    if (/^[\w./\\:@+-]+\.[cm]?[jt]sx?$/.test(line) && !line.includes("error")) {
      this.eslintFile = line;
    }
  }

  private addDiagnostic(tool: "tsc" | "eslint", file: string, message: string): void {
    const key = `${tool}\0${file}\0${message}`;
    if (this.diagnostics.some((item) => item.key === key)) return;
    this.diagnostics.push({ tool, file, message, key });
  }
}

export interface SummaryParts {
  readonly summary: string;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly toolSummary: string;
  readonly omittedLines: number;
  readonly truncated: boolean;
}

export interface OutputSummarizerOptions {
  readonly headLines?: number;
  readonly tailLines?: number;
  readonly lineChars?: number;
}

export class OutputSummarizer {
  private readonly stdout = new LineWindow(DEFAULT_HEAD_LINES, DEFAULT_TAIL_LINES, DEFAULT_LINE_CHARS);
  private readonly stderr = new LineWindow(DEFAULT_HEAD_LINES, DEFAULT_TAIL_LINES, DEFAULT_LINE_CHARS);
  private readonly combined = new LineWindow(DEFAULT_HEAD_LINES, DEFAULT_TAIL_LINES, DEFAULT_LINE_CHARS);
  private readonly tools = new ToolSummaryBuilder();
  private stdoutBinary = false;
  private stderrBinary = false;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private outputLimited = false;

  constructor(options: OutputSummarizerOptions = {}) {
    const head = options.headLines ?? DEFAULT_HEAD_LINES;
    const tail = options.tailLines ?? DEFAULT_TAIL_LINES;
    const lineChars = options.lineChars ?? DEFAULT_LINE_CHARS;
    this.stdout = new LineWindow(head, tail, lineChars);
    this.stderr = new LineWindow(head, tail, lineChars);
    this.combined = new LineWindow(head, tail, lineChars);
  }

  markBinary(stream: "stdout" | "stderr", bytes: number): void {
    if (stream === "stdout") {
      this.stdoutBinary = true;
      this.stdoutBytes = bytes;
    } else {
      this.stderrBinary = true;
      this.stderrBytes = bytes;
    }
  }

  markOutputLimited(): void {
    this.outputLimited = true;
  }

  push(stream: "stdout" | "stderr", line: string): void {
    const clean = stripAnsi(line);
    if (stream === "stdout") this.stdout.push(clean);
    else this.stderr.push(clean);
    this.combined.push(clean);
    this.tools.push(clean);
  }

  finalize(artifactId: string): SummaryParts {
    const toolSummary = this.tools.render();
    const stdoutSummary = this.streamSummary("stdout", artifactId);
    const stderrSummary = this.streamSummary("stderr", artifactId);
    const omittedLines = this.combined.omittedLines();
    const pieces: string[] = [];
    if (this.stdoutBinary || this.stderrBinary) {
      pieces.push(this.binaryBanner());
    }
    const combinedText = this.combined.render(artifactId);
    if (combinedText.length > 0) pieces.push(combinedText);
    if (this.outputLimited) {
      pieces.push(
        `output limit exceeded (reason: output_limit_exceeded); use harness.read_log('${artifactId}', ...)`,
      );
    }
    if (toolSummary.length > 0) pieces.push(toolSummary);
    const truncated =
      omittedLines > 0 ||
      this.combined.hasCharTruncation() ||
      this.stdout.hasCharTruncation() ||
      this.stderr.hasCharTruncation() ||
      this.outputLimited;
    return {
      summary: pieces.filter((piece) => piece.length > 0).join("\n\n"),
      stdoutSummary,
      stderrSummary,
      toolSummary,
      omittedLines,
      truncated,
    };
  }

  private streamSummary(stream: "stdout" | "stderr", artifactId: string): string {
    const binary = stream === "stdout" ? this.stdoutBinary : this.stderrBinary;
    const bytes = stream === "stdout" ? this.stdoutBytes : this.stderrBytes;
    const window = stream === "stdout" ? this.stdout : this.stderr;
    if (binary) {
      const notice =
        this.outputLimited
          ? `\noutput limit exceeded (reason: output_limit_exceeded); use harness.read_log('${artifactId}', ...)`
          : "";
      return `[binary output: ${bytes} bytes]${notice}`;
    }
    return window.render(artifactId);
  }

  private binaryBanner(): string {
    const parts: string[] = [];
    if (this.stdoutBinary) parts.push(`[binary output: ${this.stdoutBytes} bytes]`);
    if (this.stderrBinary) parts.push(`[binary stderr: ${this.stderrBytes} bytes]`);
    return parts.join("\n");
  }
}
