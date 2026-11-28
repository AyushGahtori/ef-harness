/** 64 KB credit chunk shared with Task 033 binary streaming. */
export const DIFF_CHUNK_BYTES = 64 * 1024;

/** Files above this size stay collapsed until the user loads one chunk. */
export const LARGE_FILE_BYTES = 100 * 1024;

/** Raw stream keeps at most this many lines in the rendered tree. */
export const MAX_VISIBLE_LOG_LINES = 500;

/** Extra renderer heap allowed for one inspected task's heavy payloads. */
export const MAX_RENDERER_HEAP_BYTES = 25 * 1024 * 1024;

/** Task 033 default initial credit (8 × 64 KB). The inspector holds one chunk. */
export const INITIAL_STREAM_CREDITS = 8;

/** Mounted skills on a pinned brief. */
export const MAX_MOUNTED_SKILLS = 2;

/** Collapsible right inspector width from the shell spec. */
export const INSPECTOR_MIN_PX = 340;
export const INSPECTOR_MAX_PX = 480;

export const INSPECTOR_SHELL_SLOT = {
  shell: "CollapsibleInspectorShell",
  minPx: INSPECTOR_MIN_PX,
  maxPx: INSPECTOR_MAX_PX,
  collapsible: true,
  popoutCompatible: true,
} as const;
