import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROMPT_CONTRACTS,
  PROMPT_CONTRACT_IDS,
  PROMPT_MODEL_LEVELS,
  TOUCHES_TAGS,
  UnknownPromptContractError,
  getPromptContract,
  parseContractOutput,
} from "../../src/prompts/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function inventoryEntries(markdown: string): { id: string; level: string; stage: string }[] {
  const start = markdown.indexOf("## Inventory");
  const rest = markdown.slice(start);
  const next = rest.indexOf("\n## ", 3);
  const section = rest.slice(0, next);
  const entries: { id: string; level: string; stage: string }[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const head = cells[0] ?? "";
    if (cells.length < 4 || head === "#" || head.includes("---")) continue;
    const ids = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
    for (const id of ids) {
      entries.push({ id, level: cells[2] ?? "", stage: cells[3] ?? "" });
    }
  }
  return entries;
}

describe("PROMPT_CONTRACTS inventory", () => {
  const entries = inventoryEntries(
    fs.readFileSync(path.join(root, "prompt-contracts.md"), "utf8"),
  );

  it("matches all 32 contracts in prompt-contracts.md", () => {
    expect(entries).toHaveLength(32);
    expect(Object.keys(PROMPT_CONTRACTS)).toHaveLength(32);
    expect(PROMPT_CONTRACT_IDS).toEqual(entries.map((entry) => entry.id));
    for (const entry of entries) {
      const contract = PROMPT_CONTRACTS[entry.id as keyof typeof PROMPT_CONTRACTS];
      expect(contract, entry.id).toBeDefined();
      expect(contract.contractId).toBe(entry.id);
      expect(contract.level).toBe(entry.level);
      expect(contract.stage).toBe(entry.stage);
      expect(contract.output).toBeTruthy();
    }
  });

  it("flags only oracle-author and entailment-checker as independent families", () => {
    const flagged = PROMPT_CONTRACT_IDS.filter((id) => PROMPT_CONTRACTS[id].independentFamily);
    expect(flagged).toEqual(["oracle-author@1", "entailment-checker@1"]);
  });

  it("maps each inventory level onto a default model level", () => {
    expect(PROMPT_MODEL_LEVELS).toEqual(["Cheap", "Mid", "Senior", "Manager", "Junior\u2013Senior"]);
    for (const id of PROMPT_CONTRACT_IDS) {
      const contract = PROMPT_CONTRACTS[id];
      if (contract.level === "Cheap / Mid") {
        expect(contract.defaultLevel).toBe("Cheap");
        expect(contract.allowedLevels).toEqual(["Cheap", "Mid"]);
      } else if (contract.level === "The task author's level") {
        expect(contract.defaultLevel).toBe("task-author");
        expect(contract.allowedLevels).toEqual([...PROMPT_MODEL_LEVELS]);
      } else if (contract.level.startsWith("Junior")) {
        expect(contract.defaultLevel).toBe("Junior\u2013Senior");
      } else if (contract.level.startsWith("Cheap")) {
        expect(contract.defaultLevel).toBe("Cheap");
      } else if (contract.level.startsWith("Mid")) {
        expect(contract.defaultLevel).toBe("Mid");
      } else if (contract.level.startsWith("Senior")) {
        expect(contract.defaultLevel).toBe("Senior");
      } else if (contract.level.startsWith("Manager")) {
        expect(contract.defaultLevel).toBe("Manager");
      } else {
        throw new Error(`unmapped level for ${id}`);
      }
      expect(contract.toolAccess === "none" || contract.toolAccess === "scoped").toBe(true);
    }
  });

  it("throws UnknownPromptContractError for an unknown id or a downgraded version", () => {
    expect(() => getPromptContract("opening-review@0")).toThrow(UnknownPromptContractError);
    expect(() => getPromptContract("not-a-contract@1")).toThrow(UnknownPromptContractError);
    try {
      getPromptContract("opening-review@0");
      throw new Error("lookup returned");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPromptContractError);
      expect((error as UnknownPromptContractError).contractId).toBe("opening-review@0");
      expect(error).not.toBe(PROMPT_CONTRACTS["opening-review@1"]);
    }
    expect(getPromptContract("opening-review@1")).toBe(PROMPT_CONTRACTS["opening-review@1"]);
  });

  it("parses one fenced object with the registered schema", () => {
    const text = '```json\n{"blocked":true,"reason":"The quote is missing."}\n```';
    expect(parseContractOutput("batch-resolve@1", text)).toEqual({
      blocked: true,
      reason: "The quote is missing.",
    });
  });
});

describe("touches tags", () => {
  it("matches the 28 closed tags in v1-knowledge-corpus.md", () => {
    const markdown = fs.readFileSync(path.join(root, "v1-knowledge-corpus.md"), "utf8");
    const start = markdown.indexOf("## Touches tags");
    const rest = markdown.slice(start);
    const section = rest.slice(0, rest.indexOf("\n## ", 3));
    const tags = section
      .split(/\r?\n/)
      .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("Group"))
      .flatMap((line) => [...line.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1] ?? ""));
    expect(tags).toEqual([...TOUCHES_TAGS]);
    expect(TOUCHES_TAGS).toHaveLength(28);
  });
});
