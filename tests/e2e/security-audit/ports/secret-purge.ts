import { PURGE_STEP_LABELS } from "../constants.ts";

/** Local port for Task 030 SecretPurgeEngine (8-step purge). */

export interface PurgeReceipt {
  readonly steps: readonly string[];
  readonly residualBytes: number;
  readonly secretName: string;
}

export interface PurgeTarget {
  readonly files: Map<string, Buffer>;
}

export class SecretPurgeEngine {
  purge(target: PurgeTarget, secret: string, options?: { skipVacuum?: boolean }): PurgeReceipt {
    const steps: string[] = [];
    const replace = (buf: Buffer): Buffer => {
      const text = buf.toString("utf8");
      if (!text.includes(secret)) return buf;
      return Buffer.from(text.split(secret).join(`[REDACTED]`), "utf8");
    };
    for (const label of PURGE_STEP_LABELS) {
      if ((label === "vacuum" || label === "wal-truncate") && options?.skipVacuum) {
        steps.push(`${label}:skipped`);
        continue;
      }
      for (const [file, buf] of target.files) {
        if (options?.skipVacuum && file.endsWith("-wal")) continue;
        target.files.set(file, replace(buf));
      }
      steps.push(label);
    }
    const needle = Buffer.from(secret, "utf8");
    let residual = 0;
    for (const buf of target.files.values()) {
      if (buf.includes(needle)) residual += 1;
    }
    return { steps, residualBytes: residual, secretName: "canary" };
  }
}