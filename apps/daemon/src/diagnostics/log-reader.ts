import type { SeekableZstdLogReaderPort } from "./ports.js";
import { DAEMON_LOG_LINE_CAP } from "./types.js";

export class ArrayLogReader implements SeekableZstdLogReaderPort {
  constructor(private readonly lines: readonly string[]) {}

  readLastLines(limit: number = DAEMON_LOG_LINE_CAP): readonly string[] {
    const cap = Math.max(0, Math.min(limit, DAEMON_LOG_LINE_CAP));
    return this.lines.slice(-cap);
  }
}
