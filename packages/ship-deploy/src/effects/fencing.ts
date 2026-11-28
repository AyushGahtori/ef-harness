import { LeaseEpochFenceError } from "./errors.js";
import type { ProjectRuntimeFence } from "./types.js";

export interface LeaseEpochFencingGuardPort {
  readFence(): ProjectRuntimeFence;
}

export class LeaseEpochFencingGuard {
  constructor(private readonly port: LeaseEpochFencingGuardPort) {}

  assertDispatchAllowed(requestedEpoch: number): void {
    const fence = this.port.readFence();
    if (fence.state === "STOPPED") {
      throw new LeaseEpochFenceError("Cannot dispatch external effect while project runtime is STOPPED");
    }
    if (requestedEpoch < fence.writerEpoch) {
      throw new LeaseEpochFenceError(
        `Stale writer_epoch ${requestedEpoch} < active ${fence.writerEpoch}`,
      );
    }
  }
}