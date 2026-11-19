export interface AttemptProcessRef {
  readonly attemptId: string;
  readonly task: string;
  readonly pid: number | null;
}

export interface AttemptProcessProbe {
  isLive(attempt: AttemptProcessRef): boolean;
}

export class OsProcessProbe implements AttemptProcessProbe {
  isLive(attempt: AttemptProcessRef): boolean {
    if (attempt.pid === null) return true;
    try {
      process.kill(attempt.pid, 0);
      return true;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      return code === "EPERM";
    }
  }
}
