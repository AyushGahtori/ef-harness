import { createHash } from "node:crypto";
import type { FakeDualClock } from "./clock.js";

/** Canonical event log. The SHA-256 of these lines is the run's reproducibility witness. */
export class SimTrace {
  readonly lines: string[] = [];

  add(clock: FakeDualClock, kind: string, detail: string): void {
    this.lines.push(`${this.lines.length}|${clock.monoMs()}|${clock.wallMs()}|${kind}|${detail}`);
  }

  hash(): string {
    return createHash("sha256").update(this.lines.join("\n")).digest("hex");
  }
}
