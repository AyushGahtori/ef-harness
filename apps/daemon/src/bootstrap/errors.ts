export class FrameTooLargeError extends Error {
  readonly declared: number;
  readonly limit: number;

  constructor(declared: number, limit: number) {
    super(`frame payload ${declared} exceeds ${limit}`);
    this.name = "FrameTooLargeError";
    this.declared = declared;
    this.limit = limit;
  }
}

export class FrameChannelError extends Error {
  readonly channel: number;

  constructor(channel: number) {
    super(`unknown frame channel ${channel}`);
    this.name = "FrameChannelError";
    this.channel = channel;
  }
}

export class PipeInUseError extends Error {
  constructor(pipePath: string) {
    super(`named pipe is already in use: ${pipePath}`);
    this.name = "PipeInUseError";
  }
}
