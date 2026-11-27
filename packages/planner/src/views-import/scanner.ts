import fs from "node:fs";
import path from "node:path";
import { sameSha256 } from "../views-shared/digest.js";
import { fileHash } from "./markers.js";
import { normalizeViewPath, viewFilePath } from "./manifest.js";
import type { DiskDelta, ViewManifest, ViewManifestHashScanner } from "./types.js";

/** Cold-open hash scan. File watching stays in Task 085. */
export class LocalViewManifestHashScanner implements ViewManifestHashScanner {
  scan(viewsRoot: string, manifest: ViewManifest): readonly DiskDelta[] {
    const deltas: DiskDelta[] = [];
    const known = new Set<string>();
    for (const file of manifest.files) {
      const filePath = normalizeViewPath(file.filePath);
      known.add(filePath);
      const absolute = viewFilePath(viewsRoot, filePath);
      if (!fs.existsSync(absolute)) {
        deltas.push({
          filePath,
          reason: "missing",
          manifestSha256: file.contentSha256,
          diskSha256: null,
        });
        continue;
      }
      const diskSha256 = fileHash(fs.readFileSync(absolute, "utf8"));
      if (!sameSha256(diskSha256, file.contentSha256)) {
        deltas.push({
          filePath,
          reason: "content_mismatch",
          manifestSha256: file.contentSha256,
          diskSha256,
        });
      }
    }
    if (fs.existsSync(viewsRoot)) {
      for (const relative of walkMarkdown(viewsRoot, viewsRoot)) {
        if (known.has(relative)) continue;
        const diskSha256 = fileHash(fs.readFileSync(viewFilePath(viewsRoot, relative), "utf8"));
        deltas.push({ filePath: relative, reason: "untracked", manifestSha256: null, diskSha256 });
      }
    }
    return deltas.sort((left, right) => (left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0));
  }
}

function walkMarkdown(root: string, dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".manifest.json") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkMarkdown(root, full));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relative = path.relative(root, full).replaceAll("\\", "/");
    found.push(relative);
  }
  return found;
}
