import { LOCAL_PORTS } from "./types.js";

/** Local port of the 10 seam templates from Task 077. */
export const SEAM_CATALOG_SOURCE = LOCAL_PORTS.seamTemplates;

export type SeamSharedKind = "entity" | "endpoint" | "event";

export interface SeamTemplateRecord {
  id: string;
  name: string;
  left: string;
  right: string;
  shared: readonly SeamSharedKind[];
  contractShape: string;
}

export const SEAM_TEMPLATES: readonly SeamTemplateRecord[] = [
  {
    id: "S-01",
    name: "Auth Middleware ↔ Protected API Route",
    left: "Auth Middleware",
    right: "Protected API Route",
    shared: ["endpoint"],
    contractShape:
      "Session-check middleware wraps each protected route and passes caller, role, and tenant id, or a denial when the session is missing or expired.",
  },
  {
    id: "S-02",
    name: "Web Client Form/State ↔ Backend API Contract",
    left: "Web Client Form/State",
    right: "Backend API Contract",
    shared: ["endpoint"],
    contractShape:
      "A typed endpoint client maps each response status onto field errors or the shared error banner.",
  },
  {
    id: "S-03",
    name: "Backend Service ↔ Relational DB / Migration",
    left: "Backend Service",
    right: "Relational DB / Migration",
    shared: ["entity"],
    contractShape:
      "Each write runs in one transaction through a repository interface and rolls back on partial failure or unique conflict.",
  },
  {
    id: "S-04",
    name: "External Webhook Provider ↔ Signature Verifier & Queue",
    left: "External Webhook Provider",
    right: "Signature Verifier & Queue",
    shared: ["event"],
    contractShape:
      "The verifier checks the provider signature, then the queue stores the event id so a replay is a no-op.",
  },
  {
    id: "S-05",
    name: "File Upload UI ↔ Presigned/Local Storage & Scanner",
    left: "File Upload UI",
    right: "Presigned/Local Storage & Scanner",
    shared: ["entity"],
    contractShape:
      "The upload contract returns a storage URL and metadata only after type, size, and scanner checks pass.",
  },
  {
    id: "S-06",
    name: "Transactional Email / Notification Trigger ↔ Mailer/Queue",
    left: "Transactional Email / Notification Trigger",
    right: "Mailer/Queue",
    shared: ["event"],
    contractShape:
      "A message template contract names the trigger, recipient, and idempotency key handed to the mailer queue.",
  },
  {
    id: "S-07",
    name: "Scheduled Job / Cutoff Timer ↔ Business State Mutation",
    left: "Scheduled Job / Cutoff Timer",
    right: "Business State Mutation",
    shared: ["entity"],
    contractShape:
      "The job payload names the cutoff instant and the identity the worker uses when it mutates business state.",
  },
  {
    id: "S-08",
    name: "Payment Checkout ↔ Order/Ledger Finalization",
    left: "Payment Checkout",
    right: "Order/Ledger Finalization",
    shared: ["entity"],
    contractShape:
      "Checkout start, the signed webhook, and the ledger write share one idempotency key and integer minor units.",
  },
  {
    id: "S-09",
    name: "Cache Layer ↔ Primary Store Invalidation",
    left: "Cache Layer",
    right: "Primary Store Invalidation",
    shared: ["entity"],
    contractShape:
      "A cache key derived from the entity id is invalidated in the same transaction that commits the primary write.",
  },
  {
    id: "S-10",
    name: "Realtime Stream/WebSocket ↔ Client Reconnect/Resync",
    left: "Realtime Stream/WebSocket",
    right: "Client Reconnect/Resync",
    shared: ["endpoint"],
    contractShape:
      "The stream contract sends a resume cursor. On reconnect the client requests every event after that cursor before showing live frames.",
  },
];

const BY_ID = new Map(SEAM_TEMPLATES.map((template) => [template.id, template]));

export function seamById(id: string): SeamTemplateRecord | undefined {
  return BY_ID.get(id);
}
