export class LeaseFencedError extends Error {
  readonly task: string;
  readonly attemptId: string;
  readonly epoch: number;

  constructor(task: string, attemptId: string, epoch: number) {
    super(`lease fenced for task ${task} attempt ${attemptId} at epoch ${epoch}`);
    this.name = "LeaseFencedError";
    this.task = task;
    this.attemptId = attemptId;
    this.epoch = epoch;
  }
}
