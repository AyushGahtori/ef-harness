import path from "node:path";
import { FORBIDDEN_POLL_EXECUTABLES, TelemetryError } from "./types.js";

export class PollSubprocessGuard {
  private sampling = false;
  processStarts = 0;
  sampleProcessStarts = 0;

  enterSample(): void {
    this.sampling = true;
  }

  exitSample(): void {
    this.sampling = false;
  }

  assertCanStart(executable: string): void {
    const base = path.win32.basename(executable).toLowerCase();
    if (FORBIDDEN_POLL_EXECUTABLES.some((name) => name === base)) {
      throw new TelemetryError(
        "forbidden_poll_subprocess",
        `${base} cannot be spawned by Windows resource telemetry`,
      );
    }
    if (this.sampling) {
      this.sampleProcessStarts += 1;
      throw new TelemetryError("poll_subprocess", "a telemetry sample tried to spawn a subprocess");
    }
  }

  recordStart(executable: string): void {
    this.assertCanStart(executable);
    this.processStarts += 1;
  }
}
