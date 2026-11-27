import { computeRequestHash } from "@ef-harness/shared-contracts";

import type { ComputeRequestHash } from "./types.js";

/**
 * Idempotency digest from Task 007. `sha256:` plus the SHA-256 of canonical
 * NFC JSON. A repeated `op_id` with a different digest is a conflict.
 */
export const defaultComputeRequestHash: ComputeRequestHash = (request) => computeRequestHash(request);
