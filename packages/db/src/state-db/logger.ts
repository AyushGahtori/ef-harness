import type { StateDbLogger } from "./types.js";

export function createDefaultLogger(): StateDbLogger {
  return {
    info(message, fields) {
      writeLog("info", message, fields);
    },
    warn(message, fields) {
      writeLog("warn", message, fields);
    },
    error(message, fields) {
      writeLog("error", message, fields);
    },
  };
}

function writeLog(level: string, message: string, fields: unknown): void {
  let line: string;
  try {
    line = `${JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: "state-db",
      msg: message,
      fields: fields === undefined ? {} : fields,
    })}\n`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    line = `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      component: "state-db",
      msg: "state-db log record could not be encoded",
      fields: { reason },
    })}\n`;
  }
  process.stderr.write(line);
}
