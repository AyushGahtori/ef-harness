import type { MessageRow, NewMessage, RouterStore } from "./database.js";
import type { OutboxPort } from "./ports.js";
import { STEERING_OUTBOX_CONSUMERS } from "./ports.js";
import { isCheckpointStatus } from "./types.js";

/**
 * Assigns a strictly increasing `msg_seq` and drains messages in that order.
 * A message that is still executing blocks every later sequence number.
 */
export class UnifiedMessageSequencer {
  private draining = false;

  constructor(
    private readonly store: RouterStore,
    private readonly outbox: OutboxPort,
    private readonly now: () => number,
  ) {}

  accept(message: NewMessage): MessageRow {
    return this.store.transaction(() => {
      const result = this.store.insertMessage(message);
      if (result.inserted) {
        this.outbox.appendEventInTx(
          { isTransaction: this.store.inTransaction },
          {
            id: `steering:${result.row.messageId}`,
            type: "SteeringMessageSequenced",
            subject: result.row.messageId,
            payload: { msgSeq: result.row.msgSeq, origin: result.row.origin },
            createdAt: this.now(),
          },
          STEERING_OUTBOX_CONSUMERS,
        );
      }
      return result.row;
    });
  }

  async drain(worker: (message: MessageRow) => Promise<void>): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const next = this.nextIncomplete();
        if (!next) return;
        await worker(next);
      }
    } finally {
      this.draining = false;
    }
  }

  nextIncomplete(): MessageRow | null {
    for (const row of this.store.listMessages()) {
      if (!isCheckpointStatus(row.status)) return row;
    }
    return null;
  }
}
