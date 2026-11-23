const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export const RECEIPT_COLUMNS = [
  "timestamp",
  "project",
  "taskId",
  "role",
  "connection",
  "model",
  "inputTokens",
  "cachedTokens",
  "outputTokens",
  "costOrWindowDelta",
  "pricingSource",
] as const;

export interface PublicReceipt {
  readonly timestamp: string;
  readonly project: string;
  readonly taskId: string;
  readonly role: string;
  readonly connection: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly costOrWindowDelta: string;
  readonly pricingSource: string;
}

export interface UsageView {
  readonly apiEstimatedMicroUsd: number;
  readonly apiEstimatedBadge: string;
  readonly apiProviderReportedMicroUsd: number;
  readonly apiProviderReportedBadge: string;
  readonly subscriptionWindowPercent: number;
  readonly copilotPremiumRequests: number;
  readonly localTokens: number;
  readonly localCloudSpendMicroUsd: number;
  readonly blendedTotal?: number;
}

export function buildUsageView(blend: boolean): UsageView {
  const view: UsageView = {
    apiEstimatedMicroUsd: 125_000,
    apiEstimatedBadge: "Estimated from published rates (table v1)",
    apiProviderReportedMicroUsd: 80_000,
    apiProviderReportedBadge: "Provider-reported (OpenRouter)",
    subscriptionWindowPercent: 42,
    copilotPremiumRequests: 3,
    localTokens: 1_200,
    localCloudSpendMicroUsd: 0,
  };
  if (!blend) return view;
  return {
    ...view,
    blendedTotal: view.apiEstimatedMicroUsd + view.subscriptionWindowPercent,
  };
}

export function currenciesSeparated(view: UsageView): boolean {
  if (view.localCloudSpendMicroUsd !== 0) return false;
  if (view.subscriptionWindowPercent < 0 || view.subscriptionWindowPercent > 100) return false;
  if (Object.prototype.hasOwnProperty.call(view, "blendedTotal")) return false;
  if (!view.apiEstimatedBadge.startsWith("Estimated")) return false;
  if (!view.apiProviderReportedBadge.startsWith("Provider-reported")) return false;
  return true;
}

export function neutralizeCell(value: string): string {
  const first = value[0];
  if (first !== undefined && FORMULA_TRIGGERS.has(first)) return `'${value}`;
  return value;
}

export function encodeRfc4180Cell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export class UsageReceiptsCsvExporter {
  export(records: readonly PublicReceipt[], day: string, unsafe = false): { readonly filename: string; readonly body: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("CSV day must be YYYY-MM-DD");
    const lines = [RECEIPT_COLUMNS.join(",")];
    for (const record of records) {
      const cells = RECEIPT_COLUMNS.map((column) => {
        const raw = cell(record, column);
        const safe = unsafe ? raw : neutralizeCell(raw);
        return encodeRfc4180Cell(safe);
      });
      lines.push(cells.join(","));
    }
    return { filename: `ef-harness-usage-${day}.csv`, body: `${lines.join("\r\n")}\r\n` };
  }
}

function cell(record: PublicReceipt, column: (typeof RECEIPT_COLUMNS)[number]): string {
  if (column === "inputTokens" || column === "cachedTokens" || column === "outputTokens") {
    return String(record[column]);
  }
  return record[column];
}

export function sampleReceipts(): PublicReceipt[] {
  return [
    {
      timestamp: "2026-11-23T10:00:00.000Z",
      project: "=1+1",
      taskId: 'T-1, "x"',
      role: "worker",
      connection: "+copilot",
      model: "@local",
      inputTokens: 10,
      cachedTokens: 0,
      outputTokens: 4,
      costOrWindowDelta: "-0",
      pricingSource: "Estimated from published rates (table v1)",
    },
  ];
}

export function csvIsSafe(body: string, records: readonly PublicReceipt[]): boolean {
  if (!body.includes("\r\n")) return false;
  if (body.includes("\n") && !body.includes("\r\n")) return false;
  const bannedColumns = new Set(["secret", "token", "vault", "apikey", "authorization"]);
  const header = body.split("\r\n")[0] ?? "";
  const headerNames = header.split(",").map((name) => name.toLowerCase());
  if (headerNames.some((name) => bannedColumns.has(name))) return false;
  for (const record of records) {
    for (const column of RECEIPT_COLUMNS) {
      const raw = cell(record, column);
      const first = raw[0];
      if (first === undefined || !FORMULA_TRIGGERS.has(first)) continue;
      if (!body.includes(`'${raw}`) && !body.includes(`"'${raw}`)) return false;
    }
  }
  return body.includes('"T-1, ""x"""');
}
