import { KB_PULL_TOOL_IDS, type ProjectPrefix, type SliceItem, type WorkerLevel } from "./types.js";
import { OracleLeakError } from "./oracle.js";
import { compareText, countTokens } from "./tokens.js";

export interface LayoutModel {
  readonly level: WorkerLevel;
  readonly project: ProjectPrefix;
  readonly goal: string;
  readonly writeScope: readonly string[];
  readonly readScope: readonly string[];
  readonly must: readonly SliceItem[];
  readonly should: readonly SliceItem[];
  readonly could: readonly SliceItem[];
}

export interface LayoutRegions {
  readonly prefix: number;
  readonly start: number;
  readonly middle: number;
  readonly end: number;
  readonly total: number;
  readonly checklistStartsAt: number;
}

const START = "## START";
const MIDDLE = "## MIDDLE";
const END = "## END";
const CHECKLIST = "## Verification & Non-Negotiable Acceptance Checklist";

export class BriefLayoutCompiler {
  compile(model: LayoutModel): string {
    rejectSealed(model.must);
    rejectSealed(model.should);
    rejectSealed(model.could);
    const prefix = renderPrefix(model.project);
    const start = renderStart(model);
    const middle = renderMiddle(model);
    const end = renderEnd(model.must);
    return [prefix, start, middle, end].join("\n");
  }

  regions(text: string): LayoutRegions {
    const total = countTokens(text);
    const prefixEnd = text.indexOf(START);
    const startEnd = text.indexOf(MIDDLE);
    const middleEnd = text.indexOf(END);
    const checklist = text.indexOf(CHECKLIST);
    return {
      prefix: countTokens(prefixEnd < 0 ? "" : text.slice(0, prefixEnd)),
      start: countTokens(startEnd < 0 || prefixEnd < 0 ? "" : text.slice(prefixEnd, startEnd)),
      middle: countTokens(middleEnd < 0 || startEnd < 0 ? "" : text.slice(startEnd, middleEnd)),
      end: countTokens(middleEnd < 0 ? "" : text.slice(middleEnd)),
      total,
      checklistStartsAt: checklist < 0 ? -1 : countTokens(text.slice(0, checklist)),
    };
  }
}

function rejectSealed(items: readonly SliceItem[]): void {
  for (const item of items) {
    if (item.sealed || item.id.startsWith("sealed_oracle") || item.id.startsWith("hidden_check")) {
      throw new OracleLeakError(item.id);
    }
  }
}

function renderPrefix(project: ProjectPrefix): string {
  const rules = [...project.universalRules].sort(compareText);
  const lines = [
    `project: ${project.projectId}`,
    `stack: ${project.stackOverview}`,
    "universal:",
    ...rules.map((rule) => `- ${rule}`),
  ];
  return lines.join("\n");
}

function renderStart(model: LayoutModel): string {
  const rules = model.must.filter((item) => item.kind === "rule");
  const highlights = model.must.filter((item) => item.kind !== "task" && item.kind !== "scope");
  const lines = [
    START,
    `goal: ${model.goal}`,
    `write: ${model.writeScope.join(" ")}`,
    `read: ${model.readScope.join(" ")}`,
    "invariants:",
    ...rules.map((rule) => `- ${rule.id} ${rule.title} :: ${rule.reasons.join("; ")}\n${rule.text}`),
    "highlights:",
    ...highlights.filter((item) => item.kind !== "rule").map((item) => `- ${item.id} ${item.title}`),
  ];
  return lines.join("\n");
}

function renderMiddle(model: LayoutModel): string {
  const lines = [MIDDLE];
  const requirements = model.must.filter((item) => item.kind === "spec_item" || item.kind === "edge_case");
  const contracts = model.must.filter((item) => item.kind === "contract" || item.kind === "entity" || item.kind === "endpoint");
  const screens = model.must.filter((item) => item.kind === "screen");
  pushBlock(lines, "requirements", requirements, (item) => item.text);
  pushBlock(lines, "contracts", contracts, (item) => item.text);
  pushBlock(lines, "screens", screens, (item) => item.text);
  if (model.level === "senior") {
    const failures = model.should.filter((item) => item.kind === "failure_mode");
    pushBlock(lines, "failure-modes", failures, (item) => item.text);
  }
  const research = model.should.filter((item) => item.kind === "research_fact");
  const skills = model.should.filter((item) => item.kind === "skill");
  const stubs = model.should.filter((item) => item.kind === "contract");
  const cards = model.should.filter((item) => item.kind === "module_card");
  pushBlock(lines, "research", research, (item) => item.text);
  pushBlock(lines, "skills", skills, (item) => item.text);
  pushBlock(lines, "stubs", stubs, (item) => item.text);
  pushBlock(lines, "module-cards", cards, (item) => item.text);
  const could = model.could.length > 0 ? model.could : defaultCould();
  lines.push("could:");
  for (const item of could) lines.push(`- ${item.pointer ?? item.title}`);
  return lines.join("\n");
}

function renderEnd(must: readonly SliceItem[]): string {
  const checklist = must.filter((item) => item.kind !== "task" && item.kind !== "scope");
  const lines = [END, CHECKLIST];
  checklist.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.id} ${item.title}`);
  });
  return lines.join("\n");
}

function pushBlock(
  lines: string[],
  heading: string,
  items: readonly SliceItem[],
  body: (item: SliceItem) => string,
): void {
  if (items.length === 0) return;
  lines.push(`### ${heading}`);
  for (const item of items) {
    const text = body(item).trim();
    if (text) lines.push(text);
  }
}

function defaultCould(): SliceItem[] {
  return KB_PULL_TOOL_IDS.map((id) => ({
    id,
    kind: "tool",
    title: id,
    text: "",
    band: "could" as const,
    version: 1,
    contentHash: "",
    reasons: ["pull-catalog"],
    relevance: 0,
    contractRole: null,
    synthetic: true,
    pointer: id,
    excerpt: false,
    sealed: false,
  }));
}
