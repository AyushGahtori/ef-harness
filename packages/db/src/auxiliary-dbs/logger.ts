import type { AuxiliaryLogEvent, AuxiliaryLogger } from "./types.js";

export function createStderrAuxiliaryLogger(): AuxiliaryLogger {
  return {
    warn(event) {
      const line: AuxiliaryLogEvent = { level: "warn", ...event };
      process.stderr.write(`${JSON.stringify(line)}\n`);
    },
  };
}

export function createCollectingLogger(target: AuxiliaryLogEvent[]): AuxiliaryLogger {
  return {
    warn(event) {
      target.push({ level: "warn", ...event });
    },
  };
}
