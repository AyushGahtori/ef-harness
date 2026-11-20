export class OpIdReusedError extends Error {
  readonly opId: string;

  constructor(opId: string) {
    super("op_id_reused");
    this.name = "OpIdReusedError";
    this.opId = opId;
  }
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super("project_not_found");
    this.name = "ProjectNotFoundError";
    this.projectId = projectId;
  }
}

export class SnapshotItemTooLargeError extends Error {
  readonly view: string;
  readonly itemId: string;

  constructor(view: string, itemId: string) {
    super("snapshot_section_item_exceeds_cap");
    this.name = "SnapshotItemTooLargeError";
    this.view = view;
    this.itemId = itemId;
  }
}

export function isOpIdReusedError(error: unknown): error is { opId?: string } {
  if (!(error instanceof Error)) return false;
  if (error.name !== "OpIdReusedError") return false;
  return true;
}

export function opIdFromReusedError(error: unknown): string | null {
  if (!isOpIdReusedError(error)) return null;
  if (typeof error.opId === "string" && error.opId.length > 0) return error.opId;
  return null;
}
