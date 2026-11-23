/**
 * Serializes park and wake for one attempt.
 * The next waiter starts only after the previous body settles, so a wake
 * cannot write the stdin of a process the parker is terminating.
 */
export class AttemptMutex {
  private readonly tail = new Map<string, Promise<void>>();

  run<T>(attemptId: string, body: () => T | Promise<T>): Promise<T> {
    const previous = this.tail.get(attemptId) ?? Promise.resolve();
    const run = previous.then(() => body());
    this.tail.set(
      attemptId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
