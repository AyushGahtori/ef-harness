import { stateV2Sql } from "@ef-harness/db";

/**
 * Pointer metadata (`handoff_artifacts`, `role_mailbox`, and the mailbox tables)
 * is the state v2 migration. Payloads are not SQLite blobs.
 * `cas_blobs`, `graph_edges`, and `contract_owners` are not created.
 */
export const HANDOFF_DDL = stateV2Sql();
