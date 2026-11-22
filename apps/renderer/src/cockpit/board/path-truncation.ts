export interface TruncatedPath {
  readonly display: string;
  readonly full: string;
}

/** Keep the last three segments: `.../orders/handlers/submitOrderHandler.ts`. */
export function truncateRepoPath(filePath: string): TruncatedPath {
  const full = filePath.replaceAll("\\", "/");
  const segments = full.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 3) return { display: full, full };
  return { display: `.../${segments.slice(-3).join("/")}`, full };
}
