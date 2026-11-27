import { assembleDocument } from "./assemble.js";
import { CSV_EDGE_ROWS, CSV_HEAD_ROWS } from "./limits.js";
import type { NormalizedDocument, RawBlock } from "./types.js";

type ColumnType = "integer" | "number" | "boolean" | "date" | "string" | "unknown";

interface CsvSchemaSummary {
  readonly delimiter: "," | "\t";
  readonly headerColumns: readonly string[];
  readonly columns: readonly { readonly name: string; readonly inferredType: ColumnType }[];
  readonly totalRows: number;
  readonly sampledRows: number;
}

export class CsvTsvConverter {
  convert(bytes: Uint8Array, fileName: string, sourceHash: string, kind: "csv" | "tsv"): NormalizedDocument {
    const text = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
    const delimiter = kind === "tsv" ? "\t" : ",";
    const scanned = scanDelimited(text, delimiter);
    const summary = summarize(scanned.headers, scanned.types, scanned.totalRows, delimiter);
    const blocks: RawBlock[] = [
      {
        kind: "schema",
        text: summaryText(summary),
        locator: {
          type: "csv",
          headerColumns: summary.headerColumns,
          rowStart: 1,
          rowEnd: Math.max(1, summary.totalRows),
        },
      },
    ];
    for (const row of scanned.samples) {
      blocks.push({
        kind: "paragraph",
        text: row.line,
        locator: {
          type: "csv",
          headerColumns: summary.headerColumns,
          rowStart: row.index,
          rowEnd: row.index,
        },
      });
    }
    return assembleDocument({
      sourceHash,
      fileName,
      mediaType: kind,
      blocks,
      warnings: [],
      ocrDerived: false,
      stats: { totalRows: scanned.totalRows },
    });
  }
}

interface SampleRow {
  readonly index: number;
  readonly line: string;
}

function scanDelimited(
  text: string,
  delimiter: "," | "\t",
): {
  readonly headers: readonly string[];
  readonly types: readonly ColumnType[];
  readonly totalRows: number;
  readonly samples: readonly SampleRow[];
} {
  const table = parseTable(text, delimiter);
  const header = table[0] ?? [];
  const types: ColumnType[] = header.map(() => "unknown");
  const first: SampleRow[] = [];
  const edge: SampleRow[] = [];
  let total = 0;
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? [];
    if (cells.length === 1 && cells[0] === "") continue;
    total += 1;
    cells.forEach((cell, column) => {
      const current = types[column] ?? "string";
      types[column] = widen(current, cell);
    });
    const sample = { index: total, line: cells.join(delimiter) };
    if (first.length < CSV_HEAD_ROWS) first.push(sample);
    edge.push(sample);
    if (edge.length > CSV_EDGE_ROWS) edge.shift();
  }
  const seen = new Set<number>();
  const samples: SampleRow[] = [];
  for (const row of [...first, ...edge]) {
    if (seen.has(row.index)) continue;
    seen.add(row.index);
    samples.push(row);
  }
  return { headers: header, types, totalRows: total, samples };
}

function parseTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function infer(value: string): ColumnType {
  if (value === "") return "string";
  if (/^(?:true|false)$/i.test(value)) return "boolean";
  if (/^-?\d+$/.test(value)) return "integer";
  if (/^-?\d+\.\d+$/.test(value)) return "number";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  return "string";
}

function widen(current: ColumnType, value: string): ColumnType {
  if (value === "") return current === "unknown" ? "string" : current;
  const next = infer(value);
  if (current === "unknown" || current === next) return next;
  if (current === "string" || next === "string") return "string";
  if (
    (current === "integer" && next === "number") ||
    (current === "number" && next === "integer")
  ) {
    return "number";
  }
  return "string";
}

function summarize(
  headers: readonly string[],
  types: readonly ColumnType[],
  totalRows: number,
  delimiter: "," | "\t",
): CsvSchemaSummary {
  return {
    delimiter,
    headerColumns: headers,
    columns: headers.map((name, index) => ({
      name,
      inferredType: types[index] === "unknown" || types[index] === undefined ? "string" : types[index],
    })),
    totalRows,
    sampledRows: Math.min(totalRows, CSV_HEAD_ROWS + CSV_EDGE_ROWS),
  };
}

function summaryText(summary: CsvSchemaSummary): string {
  const columns = summary.columns.map((column) => `${column.name} (${column.inferredType})`).join(", ");
  return `columns: ${columns}; rows: ${summary.totalRows}`;
}
