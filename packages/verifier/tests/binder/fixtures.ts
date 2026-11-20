import type { AcceptanceCheck, ContractEntrySpec } from "../../src/binder/index.js";

export const PRINT_SIGNATURE = "export function toPrintRows(totals: Totals): PrintRow[]";

export const ASYNC_PRINT_SIGNATURE =
  "export async function toPrintRows(totals: Totals): Promise<PrintRow[]>";

export const ROUTE_SIGNATURE =
  "export function postKitchenPrint(request: RouteRequest): RouteResponse";

export const JOB_SIGNATURE =
  "export async function runNightlyClose(payload: JobPayload): Promise<JobResult>";

export const PRINT_MODULE = "src/kitchen/to-print-rows.ts";

export const ORACLE = "HELD_BACK_ORACLE_9f3";

export function printEntry(overrides: Partial<ContractEntrySpec> = {}): ContractEntrySpec {
  return {
    kind: "exported_function",
    surface: "user_facing",
    name: "toPrintRows",
    exportName: "toPrintRows",
    signature: PRINT_SIGNATURE,
    modulePath: PRINT_MODULE,
    ...overrides,
  };
}

export function acceptanceCheck(overrides: Partial<AcceptanceCheck> = {}): AcceptanceCheck {
  return {
    checkId: "AC-31",
    checkVersion: "1",
    entries: [printEntry()],
    input: [{ dishId: "s", label: "Soup", quantity: 2 }],
    setupInstructions: "Seed the rows, call toPrintRows, and return orderedRows.",
    expected: { orderedRows: [{ label: "Soup", quantity: 2 }] },
    observationsSchema: { fields: [{ name: "orderedRows", type: "PrintRow[]" }] },
    adaptsInternalState: true,
    ...overrides,
  };
}

export function implementedPrint(rows = `[{ label: "Soup", quantity: 2 }]`): string {
  return `export interface Totals { readonly [key: string]: unknown }
export interface PrintRow { label: string; quantity: number }
export function toPrintRows(_totals: Totals): PrintRow[] {
  return ${rows};
}
`;
}

export function passingCandidate(): string {
  return `export interface Totals { readonly [key: string]: unknown }
export interface PrintRow { label: string; quantity: number }
export function toPrintRows(totals: Totals): PrintRow[] {
  const rows = totals as unknown as readonly { label: string; quantity: number }[];
  return rows.map((row) => ({ label: row.label, quantity: row.quantity }));
}
`;
}

export const CALLING_ADAPTER = `import { toPrintRows } from "../src/kitchen/to-print-rows";

export function observe(input: unknown): { orderedRows: unknown } {
  const orderedRows = toPrintRows(input as never);
  return { orderedRows };
}
`;

export function binderOutput(adapterSource: string = CALLING_ADAPTER): {
  output: unknown;
  adapterSource: string;
} {
  return {
    output: {
      entry_used: "toPrintRows",
      observations_schema: {
        fields: [{ name: "orderedRows", type: "PrintRow[]" }],
      },
    },
    adapterSource,
  };
}
