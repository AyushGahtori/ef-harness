export class FrameTooLargeError extends Error {
  readonly declaredLength: number;
  readonly channel: number | null;
  readonly limit: number;

  constructor(declaredLength: number, channel: number | null, limit: number) {
    super(`frame length ${declaredLength} exceeds ${limit}`);
    this.name = "FrameTooLargeError";
    this.declaredLength = declaredLength;
    this.channel = channel;
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

export class ProtocolVersionMismatchError extends Error {
  readonly protocol: string;
  readonly supported: readonly string[];

  constructor(protocol: string, supported: readonly string[]) {
    super(`unsupported protocol ${protocol}`);
    this.name = "ProtocolVersionMismatchError";
    this.protocol = protocol;
    this.supported = supported;
  }
}

export class OutboundBufferLimitError extends Error {
  readonly bufferedBytes: number;
  readonly frameBytes: number;
  readonly limitBytes: number;

  constructor(bufferedBytes: number, frameBytes: number, limitBytes: number) {
    super(`outbound buffer ${bufferedBytes}+${frameBytes} exceeds ${limitBytes}`);
    this.name = "OutboundBufferLimitError";
    this.bufferedBytes = bufferedBytes;
    this.frameBytes = frameBytes;
    this.limitBytes = limitBytes;
  }
}

export class ConnectionClosedError extends Error {
  constructor(message = "connection closed") {
    super(message);
    this.name = "ConnectionClosedError";
  }
}

export class PipeInUseError extends Error {
  readonly code = "EADDRINUSE" as const;

  constructor(pipePath: string) {
    super(`named pipe is already in use: ${pipePath}`);
    this.name = "PipeInUseError";
  }
}
