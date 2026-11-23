import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { base64Forms } from "./text.js";
import type { CanaryToken, LeakHit, LeakReport } from "./types.js";

function needleForms(canary: CanaryToken): readonly string[] {
  return [canary.value, ...base64Forms(canary.value)];
}

export class VaultCanaryLeakDetector {
  constructor(private readonly canaries: readonly CanaryToken[]) {}

  scanText(text: string, sink: string): readonly LeakHit[] {
    const hits: LeakHit[] = [];
    for (const canary of this.canaries) {
      for (const form of needleForms(canary)) {
        if (form.length < 8) continue;
        let offset = text.indexOf(form);
        while (offset !== -1) {
          hits.push({
            sink,
            canaryId: canary.id,
            encoding: form === canary.value ? "raw" : "base64",
            offset,
          });
          offset = text.indexOf(form, offset + form.length);
        }
      }
    }
    return hits;
  }

  scanBuffer(buf: Buffer, sink: string): readonly LeakHit[] {
    return this.scanText(buf.toString("utf8"), sink);
  }

  scanFile(filePath: string): readonly LeakHit[] {
    const rel = path.basename(filePath);
    return this.scanBuffer(readFileSync(filePath), rel === filePath ? filePath : filePath);
  }

  scanDirectory(root: string): LeakReport {
    const leaks: LeakHit[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(root, full).replaceAll("\\", "/");
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (stat.size > 5_000_000) continue;
        leaks.push(...this.scanBuffer(readFileSync(full), rel));
      }
    };
    walk(root);
    return { leaks };
  }
}