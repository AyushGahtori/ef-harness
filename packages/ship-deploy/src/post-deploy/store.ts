import { sha256 } from "./redactor.js";
import type {
  CasBlobStore,
  CasPutInput,
  ExternalRegistrationReceipt,
  PostDeployStateStore,
  SchemaShipStatus,
  ShipRunRecord,
  ShipRunState,
} from "./types.js";

export function schemaStatusFor(state: ShipRunState): SchemaShipStatus {
  switch (state) {
    case "SHIPPED":
      return "passed";
    case "ROLLED_BACK":
      return "rolled_back";
    case "WATCHING":
    case "WATCH_PAUSED":
      return "running";
    case "AWAITING_PROD_ROLLBACK_APPROVAL":
    case "KEPT_LIVE":
    case "FAILED":
      return "failed";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/**
 * In-memory stand-in for `state.db` ship receipts.
 * Logical `state` uses Task 181 vocabulary (`SHIPPED`). `schemaStatus` is the
 * value that fits today's `ship_runs.status` CHECK constraint.
 */
export class InMemoryCasBlobStore implements CasBlobStore {
  readonly blobs: { readonly id: string; readonly hash: string; readonly kind: string; readonly text: string }[] =
    [];

  async put(input: CasPutInput): Promise<{ readonly id: string; readonly hash: string }> {
    const hash = sha256(input.text);
    const id = `cas-${hash.slice(0, 16)}`;
    this.blobs.push({ id, hash, kind: input.kind, text: input.text });
    return { id, hash };
  }
}

export class InMemoryPostDeployStore implements PostDeployStateStore {
  private readonly runs = new Map<string, ShipRunRecord>();
  private readonly registrations: ExternalRegistrationReceipt[] = [];

  saveShipRun(record: ShipRunRecord): void {
    this.runs.set(record.id, record);
  }

  getShipRun(id: string): ShipRunRecord | undefined {
    return this.runs.get(id);
  }

  insertRegistration(receipt: ExternalRegistrationReceipt): void {
    this.registrations.push(receipt);
  }

  registrationsFor(shipRunId: string): readonly ExternalRegistrationReceipt[] {
    return this.registrations.filter((receipt) => receipt.shipRunId === shipRunId);
  }
}
