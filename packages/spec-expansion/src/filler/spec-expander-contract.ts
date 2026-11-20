import type { SpecExpanderCell } from "./types.js";

/**
 * Local port of Task 009 `SpecExpanderV1Schema`.
 * Per-cell failures are reported separately so a vague sibling does not drop
 * a valid cell. The whole payload fails only when it is not JSON or has no cells array.
 * Swap this parser for the Zod schema once `@ef-harness/shared-contracts` exports it.
 */

const EARS_TEXT_PATTERN =
  /^(?:when\s+.+,\s+|while\s+.+,\s+|if\s+.+,\s+then\s+|where\s+.+,\s+)?the\s+\S.+\bshall\b\s+\S.+$/i;

export interface ParsedExpander {
  readonly ok: boolean;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly cells: readonly SpecExpanderCell[];
  readonly cellProblems: ReadonlyMap<string, readonly string[]>;
  readonly documentProblems: readonly string[];
}

export function parseSpecExpanderOutput(raw: string): ParsedExpander {
  const jsonText = extractJson(raw);
  if (jsonText === null) {
    return emptyParse(["model output did not contain a JSON object"]);
  }
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return emptyParse(["model output was not valid JSON"]);
  }
  if (!isRecord(value)) return emptyParse(["model output was not a JSON object"]);
  if (value.blocked === true) {
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    if (reason.length === 0) return emptyParse(["blocked exit is missing a reason"]);
    return {
      ok: false,
      blocked: true,
      blockReason: reason,
      cells: [],
      cellProblems: new Map(),
      documentProblems: [reason],
    };
  }
  if (!Array.isArray(value.cells)) return emptyParse(["spec-expander output is missing cells"]);
  const extraTop = Object.keys(value).filter((key) => key !== "cells");
  if (extraTop.length > 0) {
    return emptyParse([`unexpected keys on spec-expander output: ${extraTop.join(", ")}`]);
  }
  const cells: SpecExpanderCell[] = [];
  const cellProblems = new Map<string, readonly string[]>();
  for (let index = 0; index < value.cells.length; index += 1) {
    const parsed = parseCell(value.cells[index], index);
    if (parsed.cell) cells.push(parsed.cell);
    if (parsed.problems.length > 0) {
      cellProblems.set(parsed.id, parsed.problems);
    }
  }
  return {
    ok: cellProblems.size === 0,
    blocked: false,
    blockReason: null,
    cells,
    cellProblems,
    documentProblems: [],
  };
}

function parseCell(
  value: unknown,
  index: number,
): { id: string; cell: SpecExpanderCell | null; problems: string[] } {
  const fallback = `index:${String(index)}`;
  if (!isRecord(value)) {
    return { id: fallback, cell: null, problems: ["cell was not an object"] };
  }
  const problems: string[] = [];
  const keys = Object.keys(value);
  const allowed = new Set([
    "cell_id",
    "value",
    "basis",
    "status",
    "ears_text",
    "oracle_sketch",
    "risk",
    "premises",
  ]);
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (unexpected.length > 0) problems.push(`unexpected keys: ${unexpected.join(", ")}`);
  const cellId = typeof value.cell_id === "string" ? value.cell_id.trim() : "";
  const id = cellId.length > 0 && !/\s/.test(cellId) ? cellId : fallback;
  if (cellId.length === 0 || /\s/.test(cellId)) problems.push("cell_id must be a non-blank id");
  const basis = value.basis === null || value.basis === "proposed" ? value.basis : undefined;
  const status = value.status === null || value.status === "asked" ? value.status : undefined;
  if (basis === undefined) problems.push("basis must be proposed or null");
  if (status === undefined) problems.push("status must be asked or null");
  const proposed = basis === "proposed";
  const asked = status === "asked";
  if (basis !== undefined && status !== undefined && proposed === asked) {
    problems.push("set basis proposed or status asked, and never both");
  }
  let cellValue: string | null = null;
  if (value.value === null) cellValue = null;
  else if (typeof value.value === "string" && value.value.trim().length > 0) cellValue = value.value.trim();
  else problems.push("value must be a non-blank string or null");
  if (proposed && cellValue === null) problems.push("a proposed cell needs a value");
  if (asked && cellValue !== null) problems.push("an asked cell leaves the value unset");
  const ears = typeof value.ears_text === "string" ? value.ears_text.trim() : "";
  const oracle = typeof value.oracle_sketch === "string" ? value.oracle_sketch.trim() : "";
  if (ears.length === 0) problems.push("ears_text must be non-blank");
  else if (!EARS_TEXT_PATTERN.test(ears)) problems.push("ears_text must be one EARS sentence");
  if (oracle.length === 0) problems.push("oracle_sketch must be non-blank");
  const risk = value.risk === "low" || value.risk === "medium" || value.risk === "high" ? value.risk : null;
  if (!risk) problems.push("risk must be low, medium, or high");
  const premises: string[] = [];
  if (!Array.isArray(value.premises)) problems.push("premises must be an array of ids");
  else {
    for (const premise of value.premises) {
      if (typeof premise !== "string" || premise.trim().length === 0 || /\s/.test(premise)) {
        problems.push("premises must be an array of ids");
        break;
      }
      premises.push(premise.trim());
    }
  }
  if (problems.length > 0 || !risk || basis === undefined || status === undefined) {
    return { id, cell: null, problems };
  }
  return {
    id,
    problems,
    cell: {
      cell_id: cellId,
      value: cellValue,
      basis,
      status,
      ears_text: ears,
      oracle_sketch: oracle,
      risk,
      premises,
    },
  };
}

function emptyParse(documentProblems: string[]): ParsedExpander {
  return {
    ok: false,
    blocked: false,
    blockReason: null,
    cells: [],
    cellProblems: new Map(),
    documentProblems,
  };
}

function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
