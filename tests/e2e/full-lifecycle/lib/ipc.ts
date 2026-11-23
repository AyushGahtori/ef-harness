export interface IpcFrame {
  readonly seq: number;
  readonly streamEpoch: number;
  readonly payload: string;
  readonly binaryChunkBytes?: number;
}

export class NamedPipeIpcSimulator {
  private seq = 0;
  private streamEpoch = 1;
  private readonly frames: IpcFrame[] = [];

  emit(payload: string, binaryChunkBytes?: number): IpcFrame {
    this.seq += 1;
    const frame: IpcFrame = {
      seq: this.seq,
      streamEpoch: this.streamEpoch,
      payload,
      binaryChunkBytes,
    };
    this.frames.push(frame);
    return frame;
  }

  reconnect(): void {
    this.streamEpoch += 1;
  }

  assertGapFree(): void {
    for (let i = 0; i < this.frames.length; i += 1) {
      const expected = i + 1;
      if (this.frames[i]?.seq !== expected) throw new Error(`seq gap at ${i}`);
    }
  }

  lastBoardEmitMs(): number {
    const started = performance.now();
    this.emit("board.patch", undefined);
    return Math.max(0, Math.round(performance.now() - started));
  }
}