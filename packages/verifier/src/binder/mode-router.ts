import { parseSignature } from "./signature.js";
import type { ContractEntrySpec } from "./types.js";
import type { BinderMode } from "./types.js";

export interface ModeRouteInput {
  entry: ContractEntrySpec;
  adaptsInternalState?: boolean;
  adaptsInternalCall?: boolean;
}

const DIRECT_KINDS = new Set<ContractEntrySpec["kind"]>([
  "route",
  "ui_button",
  "openapi",
  "cli",
  "exported_function",
]);

/**
 * Contract-bound is the default for a user-facing or directly declared entry.
 * Post-hoc blind-binder@1 runs only for internal setup/seeding or internal call wiring.
 */
export class BinderModeRouter {
  route(input: ModeRouteInput): BinderMode {
    if (input.adaptsInternalState || input.adaptsInternalCall) return "post_hoc";
    const entry = input.entry;
    if (
      entry.surface === "internal" ||
      entry.kind === "internal_setup" ||
      entry.kind === "internal_call"
    ) {
      return "post_hoc";
    }
    if (!DIRECT_KINDS.has(entry.kind) || entry.signature.trim().length === 0) {
      return "post_hoc";
    }
    if (entry.kind === "exported_function") {
      const parsed = parseSignature(entry.signature);
      if (!parsed || parsed.name !== entry.exportName) return "post_hoc";
    }
    return "contract_bound";
  }
}
