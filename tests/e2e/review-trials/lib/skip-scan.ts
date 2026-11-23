import fs from "node:fs";
import path from "node:path";

const markerSkip = "." + "skip";
const markerTodo = "." + "todo";
const callers = ["it", "test", "describe"];

export function skipMarkers(): readonly string[] {
  return callers.flatMap((caller) => [caller + markerSkip, caller + markerTodo]);
}

export function findSkipMarkers(source: string): string[] {
  return skipMarkers().filter((marker) => source.includes(marker));
}

export function scanDirectory(dir: string): { file: string; marker: string }[] {
  const hits: { file: string; marker: string }[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|mjs|js|md)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const marker of findSkipMarkers(text)) {
        hits.push({ file: path.relative(dir, full).replaceAll("\\", "/"), marker });
      }
    }
  };
  visit(dir);
  return hits;
}
