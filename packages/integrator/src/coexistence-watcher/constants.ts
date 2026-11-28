export const COEXISTENCE_WATCH_DEBOUNCE_MS = 300;

/** Task states treated as actively touching the working tree (Task 171 spec). */
export const ACTIVE_COEXISTENCE_STATES = [
  "WORKING",
  "VERIFYING",
  "INTEGRATING",
] as const;

export type ActiveCoexistenceState = (typeof ACTIVE_COEXISTENCE_STATES)[number];

export const OVERLAP_CHOICES = ["take_over", "keep_both", "ignore"] as const;

export type OverlapChoice = (typeof OVERLAP_CHOICES)[number];

export const LOCKFILE_INCLUDE_CHOICES = ["commit_and_include", "keep_separate"] as const;

export type LockfileIncludeChoice = (typeof LOCKFILE_INCLUDE_CHOICES)[number];

export const EDITOR_OVERLAP_HOLD_REASON = "editor_overlap" as const;

export const IGNORED_WATCH_SEGMENTS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".turbo",
  ".pnpm-store",
  ".harness",
] as const;

export const VIEWS_EXPORT_ROOT = ".harness/views";

export const IGNORED_WATCH_GLOBS = [
  "*.swp",
  "*~",
  ".#*",
  "*.tmp",
  ".DS_Store",
] as const;

export const LOCKFILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

export const HARNESS_INTEGRATION_REF = "refs/heads/harness/integration";