import os from "node:os";
import type { ProcessIdentity } from "./types.js";

const processStartTime = Date.now() - Math.round(process.uptime() * 1000);

export function currentProcessIdentity(): ProcessIdentity {
  return {
    pid: process.pid,
    processStartTime,
    hostname: os.hostname(),
  };
}
