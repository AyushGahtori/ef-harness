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

export type ReceiptColumn = (typeof RECEIPT_COLUMNS)[number];

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

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function neutralizeCell(value: string): string {
  const first = value[0];
  if (first !== undefined && FORMULA_TRIGGERS.has(first)) return `'${value}`;
  return value;
}

export function encodeRfc4180Cell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function cell(record: PublicReceipt, column: ReceiptColumn): string {
  if (column === "inputTokens" || column === "cachedTokens" || column === "outputTokens") {
    return String(record[column]);
  }
  return record[column];
}

export interface CsvExport {
  readonly filename: string;
  readonly body: string;
}

export class UsageReceiptsCsvExporter {
  export(records: readonly PublicReceipt[], day: string): CsvExport {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Error("CSV day must be YYYY-MM-DD");
    }
    const lines = [RECEIPT_COLUMNS.join(",")];
    for (const record of records) {
      const encoded = RECEIPT_COLUMNS.map((column) => encodeRfc4180Cell(neutralizeCell(cell(record, column))));
      lines.push(encoded.join(","));
    }
    return {
      filename: `ef-harness-usage-${day}.csv`,
      body: `${lines.join("\r\n")}\r\n`,
    };
  }
}

export function parseRfc4180(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined) break;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
