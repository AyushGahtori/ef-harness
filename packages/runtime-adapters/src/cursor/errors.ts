export class CursorAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CursorAdapterError";
    this.code = code;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof CursorAdapterError && error.code === "unauthorized") return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { readonly status?: unknown; readonly httpStatus?: unknown; readonly code?: unknown };
  return record.status === 401 || record.httpStatus === 401 || record.code === "unauthorized";
}
