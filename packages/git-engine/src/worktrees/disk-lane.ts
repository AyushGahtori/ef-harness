/**
 * One-wide mutex for cold worktree creation and heavy cleans.
 * At most one of those disk operations runs at a time.
 */
export class DiskLane {
  private tail: Promise<void> = Promise.resolve();
  private active = 0;
  maxActive = 0;

  run<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await operation();
      } finally {
        this.active -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
