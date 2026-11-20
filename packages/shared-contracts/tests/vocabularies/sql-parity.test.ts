import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalAssetAbsolute } from "../../src/index.js";
import {
  CHANGE_CLASSES,
  EDGE_TYPES,
  EFFECT_STATES,
  FEATURE_STATES,
  HOLD_REASONS,
  INBOX_KINDS,
  NAME_KINDS,
  NODE_KINDS,
  PRIORITY_CLASSES,
  PROJECT_STATES,
  RETENTION_CLASSES,
  SETTLED_BASES,
  TASK_STATES,
} from "../../src/vocabularies/index.js";

function quotedList(body: string): string[] {
  return [...body.matchAll(/'([^']*)'/g)].map((hit) => {
    const value = hit[1];
    if (value === undefined) throw new Error("missing quoted SQL token");
    return value;
  });
}

function checkList(sql: string, pattern: RegExp): string[] {
  const match = pattern.exec(sql);
  const body = match?.[1];
  if (body === undefined) throw new Error(`missing CHECK ${pattern}`);
  return quotedList(body);
}

function pipeComment(sql: string, marker: string): string[] {
  const line = sql.split(/\r?\n/).find((entry) => entry.includes(marker));
  if (line === undefined) throw new Error(`missing comment ${marker}`);
  const comment = line.split("--").slice(1).join("--").trim();
  return comment
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "...");
}

function insertRows(sql: string, table: string): string[][] {
  const match = new RegExp(`INSERT INTO ${table} VALUES\\s*([\\s\\S]*?);`).exec(sql);
  const body = match?.[1];
  if (body === undefined) throw new Error(`INSERT INTO ${table} not found`);
  const rows: string[][] = [];
  for (const tuple of body.matchAll(/\(([^)]*)\)/g)) {
    const cells = tuple[1] ?? "";
    const parsed = [...cells.matchAll(/'([^']*)'|(-?\d+)/g)].map((cell) =>
      cell[1] !== undefined ? cell[1] : cell[2],
    );
    if (parsed.some((cell) => cell === undefined)) {
      throw new Error(`unparsed cell in ${table}`);
    }
    rows.push(parsed as string[]);
  }
  return rows;
}

function flag(value: string | undefined, table: string): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`${table} flag must be 0 or 1, got ${value ?? "missing"}`);
}

describe("schema/state.sql vocabulary parity", () => {
  const stateSql = fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8");
  const globalSql = fs.readFileSync(canonicalAssetAbsolute("globalSql"), "utf8");

  it("matches node_kinds, edge_types, task_states, feature_states, and project_states", () => {
    const nodeKinds = insertRows(stateSql, "node_kinds").map((row) => ({
      kind: row[0],
      isRequirement: flag(row[1], "node_kinds"),
    }));
    const edgeTypes = insertRows(stateSql, "edge_types").map((row) => ({
      type: row[0],
      invalidates: flag(row[1], "edge_types"),
    }));
    const taskStates = insertRows(stateSql, "task_states").map((row) => ({
      state: row[0],
      claimable: flag(row[1], "task_states"),
      done: flag(row[2], "task_states"),
      terminal: flag(row[3], "task_states"),
    }));
    const featureStates = insertRows(stateSql, "feature_states").map((row) => ({
      state: row[0],
      terminal: flag(row[1], "feature_states"),
    }));
    const projectStates = insertRows(stateSql, "project_states").map((row) => row[0]);

    expect(nodeKinds).toEqual(NODE_KINDS.map((row) => ({ ...row })));
    expect(edgeTypes).toEqual(EDGE_TYPES.map((row) => ({ ...row })));
    expect(taskStates).toEqual(TASK_STATES.map((row) => ({ ...row })));
    expect(featureStates).toEqual(FEATURE_STATES.map((row) => ({ ...row })));
    expect(projectStates).toEqual([...PROJECT_STATES]);
    expect(nodeKinds).toHaveLength(17);
    expect(edgeTypes).toHaveLength(14);
    expect(taskStates).toHaveLength(15);
    expect(featureStates).toHaveLength(13);
    expect(projectStates).toHaveLength(10);
    expect(taskStates.map((row) => row.state)).not.toContain("HELD");
  });

  it("matches the basis CHECK and the other closed lookup CHECK lists", () => {
    expect(checkList(stateSql, /CHECK \(basis IS NULL OR basis IN \(([^)]*)\)\)/)).toEqual([
      ...SETTLED_BASES,
    ]);
    expect(checkList(stateSql, /class\s+TEXT NOT NULL CHECK \(class IN \(([^)]*)\)\)/)).toEqual([
      ...CHANGE_CLASSES,
    ]);
    expect(
      checkList(
        stateSql,
        /CREATE TABLE effects[\s\S]*?state\s+TEXT NOT NULL CHECK \(state IN \(([^)]*)\)\)/,
      ),
    ).toEqual([...EFFECT_STATES]);
    expect(
      checkList(stateSql, /retention\s+TEXT NOT NULL CHECK \(retention IN \(([^)]*)\)\)/),
    ).toEqual([...RETENTION_CLASSES]);
    expect(
      checkList(globalSql, /priority_class TEXT NOT NULL CHECK \(priority_class IN \(([^)]*)\)\)/),
    ).toEqual([...PRIORITY_CLASSES]);
    expect(pipeComment(stateSql, "user_pause")).toEqual([...HOLD_REASONS]);
    expect(pipeComment(stateSql, "human_step")).toEqual([...INBOX_KINDS]);
  });

  it("keeps every explicitly named registry kind from the names comment", () => {
    const named = pipeComment(stateSql, "http_route");
    expect(named.length).toBeGreaterThan(0);
    for (const kind of named) {
      expect(NAME_KINDS).toContain(kind);
    }
  });
});
