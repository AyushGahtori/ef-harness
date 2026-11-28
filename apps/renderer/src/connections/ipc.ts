import {
  ConnectionsSaveKeyParamsSchema,
  ConnectionsUsageParamsSchema,
  publicUsageReceipt,
  type UsageReceiptInput,
} from "@ef-harness/shared-contracts";
import type { ConnectionKeyHandoff } from "./secrets.js";

export interface ConnectionsMessagePort {
  postMessage(message: {
    jsonrpc: "2.0";
    id: number;
    method: "connections.saveKey" | "connections.usage";
    params: unknown;
  }): void;
}

export function connectionKeyHandoff(port: ConnectionsMessagePort, projectId: string, label: string): ConnectionKeyHandoff {
  let id = 1;
  return {
    save(raw, provider) {
      const params = ConnectionsSaveKeyParamsSchema.parse({
        projectId,
        label,
        rawKey: raw,
        provider,
      });
      port.postMessage({ jsonrpc: "2.0", id, method: "connections.saveKey", params });
      id += 1;
      return { vaultRef: "pending-ipc" };
    },
  };
}

export function postUsageReceipts(port: ConnectionsMessagePort, receipts: readonly UsageReceiptInput[]): void {
  const params = ConnectionsUsageParamsSchema.parse({
    op: "insert",
    receipts: receipts.map((receipt) => publicUsageReceipt(receipt)),
  });
  port.postMessage({ jsonrpc: "2.0", id: 1, method: "connections.usage", params });
}
