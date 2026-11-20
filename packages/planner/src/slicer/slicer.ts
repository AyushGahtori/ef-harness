import { hashCanonical } from "./canonical.js";
import { BandTokenBudgeter, shouldPointer, type BudgetItem } from "./budget.js";
import { collectSlice } from "./collect.js";
import { OversizedMustAutoSplitGuard } from "./guard.js";
import { BriefLayoutCompiler, type LayoutModel } from "./layout.js";
import { assertWorkerBriefPacket, buildWorkerBriefPacket } from "./packet.js";
import { RULE_CATALOG, type RuleSpec } from "./rules.js";
import { LocalSkillSelector } from "./skills.js";
import { compareText, countTokens } from "./tokens.js";
import {
  fieldString,
  KB_PULL_TOOL_IDS,
  LEVEL_BUDGETS,
  normalizeLevel,
  type BriefManifest,
  type CompiledBrief,
  type PinnedItem,
  type ProjectPrefix,
  type SkillRecord,
  type SliceGraph,
  type SliceItem,
  type SliceNode,
  type SliceRequest,
  type TokenBreakdown,
  type WorkerLevel,
} from "./types.js";

export interface NodeVersionReader {
  getNodeAsOf(id: string, version: number): SliceNode | null;
}

export class KnowledgePacketSlicer {
  private readonly budgeter = new BandTokenBudgeter();
  private readonly guard = new OversizedMustAutoSplitGuard();
  private readonly layout = new BriefLayoutCompiler();
  private readonly skills = new LocalSkillSelector();

  constructor(private readonly catalog: readonly RuleSpec[] = RULE_CATALOG) {}

  compile(graph: SliceGraph, request: SliceRequest): CompiledBrief {
    const level = normalizeLevel(request.level ?? graph.level);
    const collected = collectSlice(graph, this.catalog);
    const must = collected.items.filter((item) => item.band === "must");
    const refusal = this.guard.inspect({
      taskId: graph.taskId,
      level,
      sources: must.map((item) => ({ id: item.id, title: item.title, tokens: countTokens(item.text) })),
    });
    if (refusal) throw refusal;

    const role = request.role ?? fieldString(graph.nodes.find((node) => node.id === graph.taskId)?.fields ?? {}, "role") ?? "leaf-worker";
    const selected = this.skills.selectForTask({
      role,
      touches: collected.effectiveTags,
      skills: request.skills ?? [],
    });
    const shouldPool = [
      ...collected.items.filter((item) => item.band === "should"),
      ...selected.selected.map((skill) => skillItem(skill)),
      ...(level === "senior" ? failureItems(graph, must) : []),
    ];
    const featureCould = collected.items.filter((item) => item.band === "could");
    const baseCould = [...toolItems(), ...featureCould];
    const baseTokens = countTokens(this.render(level, request.project, collected, must, [], baseCould));
    const budget = this.budgeter.remainingShouldBudget(level, baseTokens);
    const ranked = shouldPool.map((item) => ({ item, budget: budgetOf(item) }));
    const trimmed = this.budgeter.trimShould(
      ranked.map((row) => row.budget),
      budget,
    );
    let kept = trimmed.kept.flatMap((entry) => {
      const source = ranked.find((row) => row.budget.id === entry.id);
      if (!source) return [];
      return [applyExcerpt(source.item, entry)];
    });
    let dropped = trimmed.trimmed.flatMap((entry) => {
      const source = ranked.find((row) => row.budget.id === entry.id);
      return source ? [source.item] : [];
    });
    let could = mergeCould(baseCould, dropped);
    let text = this.render(level, request.project, collected, must, kept, could);
    while (countTokens(text) > LEVEL_BUDGETS[level].targetMax && kept.length > 0) {
      const removed = kept[kept.length - 1];
      if (!removed) break;
      kept = kept.slice(0, -1);
      dropped = [...dropped, removed];
      could = mergeCould(baseCould, dropped);
      text = this.render(level, request.project, collected, must, kept, could);
    }
    const total = countTokens(text);
    if (total > LEVEL_BUDGETS[level].hardCeiling) {
      const overflow = this.guard.inspect({
        taskId: graph.taskId,
        level,
        sources: [...must.map((item) => ({ id: item.id, title: item.title, tokens: countTokens(item.text) })), { id: "rendered", title: "rendered", tokens: total }],
      });
      throw overflow ?? new Error(`compiled brief exceeds the ${level} hard ceiling`);
    }
    const regions = this.layout.regions(text);
    const breakdown: TokenBreakdown = {
      prefix: regions.prefix,
      start: regions.start,
      middle: regions.middle,
      end: regions.end,
      must: this.budgeter.bandTokens(must),
      should: this.budgeter.bandTokens(kept),
      could: this.budgeter.bandTokens(could),
      total,
    };
    const included = [...must, ...kept];
    const manifest = this.manifest({
      graph,
      request,
      level,
      goal: collected.goal,
      writeScope: collected.writeScope,
      readScope: collected.readScope,
      included,
      trimmed: dropped,
      could,
      breakdown,
      text,
    });
    const packet = buildWorkerBriefPacket({
      level,
      must,
      should: kept,
      could,
      taskId: graph.taskId,
      attemptId: request.attemptId ?? null,
      epoch: graph.epoch,
      briefVersion: graph.nodes.find((node) => node.id === graph.taskId)?.version ?? 1,
      baseBranch: graph.baseBranch,
      baseCommit: graph.baseCommit,
      goal: collected.goal,
      writeScope: collected.writeScope,
      readScope: collected.readScope,
      hiddenChecks: collected.hiddenChecks,
    });
    assertWorkerBriefPacket(packet);
    return {
      level,
      text,
      manifest,
      packet,
      leaks: collected.leaks,
      must,
      should: kept,
      could,
      trimmed: dropped,
      effectiveTags: collected.effectiveTags,
      matchedRuleIds: must.filter((item) => item.kind === "rule").map((item) => item.id),
    };
  }

  reconstruct(reader: NodeVersionReader, manifest: BriefManifest): string {
    const must: SliceItem[] = [];
    const should: SliceItem[] = [];
    const could: SliceItem[] = [];
    for (const pinned of manifest.pinnedItems) {
      const item = materialize(reader, pinned);
      if (item.band === "must") must.push(item);
      else if (item.band === "should") should.push(item);
      else could.push(item);
    }
    return this.layout.compile({
      level: manifest.level,
      project: manifest.project,
      goal: manifest.goal,
      writeScope: manifest.writeScope,
      readScope: manifest.readScope,
      must,
      should,
      could,
    });
  }

  private render(
    level: WorkerLevel,
    project: ProjectPrefix,
    collected: { goal: string; writeScope: readonly string[]; readScope: readonly string[] },
    must: readonly SliceItem[],
    should: readonly SliceItem[],
    could: readonly SliceItem[],
  ): string {
    const model: LayoutModel = {
      level,
      project,
      goal: collected.goal,
      writeScope: collected.writeScope,
      readScope: collected.readScope,
      must,
      should,
      could,
    };
    return this.layout.compile(model);
  }

  private manifest(input: {
    readonly graph: SliceGraph;
    readonly request: SliceRequest;
    readonly level: WorkerLevel;
    readonly goal: string;
    readonly writeScope: readonly string[];
    readonly readScope: readonly string[];
    readonly included: readonly SliceItem[];
    readonly trimmed: readonly SliceItem[];
    readonly could: readonly SliceItem[];
    readonly breakdown: TokenBreakdown;
    readonly text: string;
  }): BriefManifest {
    const pinnedItems = [...input.included.map((item) => pin(item)), ...input.could.map((item) => pin(item))];
    const nodeVersions: Record<string, number> = {};
    const nodeHashes: Record<string, string> = {};
    for (const item of input.included) {
      nodeVersions[item.id] = item.version;
      nodeHashes[item.id] = item.contentHash;
    }
    const skills = input.included
      .filter((item) => item.kind === "skill")
      .map((item) => ({ id: item.id, sha256: item.contentHash }))
      .sort((left, right) => compareText(left.id, right.id));
    const nodes = input.included
      .map((item) => ({ contentHash: item.contentHash, id: item.id, version: item.version }))
      .sort((left, right) => compareText(left.id, right.id));
    const sliceSha256 = hashCanonical({
      level: input.level,
      nodes,
      skills,
      taskId: input.graph.taskId,
    });
    return {
      includedNodeIds: [...input.included.map((item) => item.id)].sort(compareText),
      trimmedShouldIds: [...input.trimmed.map((item) => item.id)].sort(compareText),
      couldIndexIds: [...input.could.map((item) => item.id)].sort(compareText),
      tokenBreakdown: input.breakdown,
      sliceSha256,
      level: input.level,
      taskId: input.graph.taskId,
      nodeVersions,
      nodeHashes,
      pinnedItems,
      project: input.request.project,
      writeScope: input.writeScope,
      readScope: input.readScope,
      goal: input.goal,
      briefText: input.text,
      attemptId: input.request.attemptId ?? null,
    };
  }
}

function materialize(reader: NodeVersionReader, pinned: PinnedItem): SliceItem {
  let title = pinned.title;
  let text = pinned.text ?? "";
  if (!pinned.synthetic && !pinned.excerpt) {
    const node = reader.getNodeAsOf(pinned.id, pinned.version);
    if (!node) throw new Error(`missing pinned node ${pinned.id}@${pinned.version}`);
    if (node.contentHash !== pinned.contentHash) {
      throw new Error(`pinned hash mismatch for ${pinned.id}@${pinned.version}`);
    }
    title = node.title;
    text = node.text;
  }
  return {
    id: pinned.id,
    kind: pinned.kind,
    title,
    text,
    band: pinned.band,
    version: pinned.version,
    contentHash: pinned.contentHash,
    reasons: pinned.reasons,
    relevance: pinned.relevance,
    contractRole: pinned.contractRole,
    synthetic: pinned.synthetic,
    pointer: pinned.pointer,
    excerpt: pinned.excerpt,
    sealed: false,
  };
}

function pin(item: SliceItem, band: SliceItem["band"] = item.band): PinnedItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    band,
    version: item.version,
    contentHash: item.contentHash,
    reasons: item.reasons,
    relevance: item.relevance,
    contractRole: item.contractRole,
    synthetic: item.synthetic || item.excerpt,
    pointer: item.band === "should" && band === "could" ? shouldPointer(item) : item.pointer,
    excerpt: item.excerpt,
    text: item.text,
  };
}

function budgetOf(item: SliceItem): BudgetItem {
  return {
    id: item.id,
    kind: item.kind,
    relevance: item.relevance,
    text: item.text,
    tokens: countTokens(item.text),
  };
}

function applyExcerpt(item: SliceItem, budget: BudgetItem): SliceItem {
  if (budget.text === item.text) return item;
  return { ...item, text: budget.text, excerpt: true };
}

function skillItem(skill: SkillRecord): SliceItem {
  return {
    id: skill.skillId,
    kind: "skill",
    title: skill.skillId,
    text: skill.text,
    band: "should",
    version: 1,
    contentHash: skill.sha256,
    reasons: ["vetted-skill"],
    relevance: 80,
    contractRole: null,
    synthetic: true,
    pointer: null,
    excerpt: false,
    sealed: false,
  };
}

function failureItems(graph: SliceGraph, must: readonly SliceItem[]): SliceItem[] {
  const items: SliceItem[] = [];
  for (const item of must) {
    if (item.kind !== "contract" && item.kind !== "entity" && item.kind !== "endpoint") continue;
    const node = graph.nodes.find((candidate) => candidate.id === item.id);
    const text = node ? fieldString(node.fields, "failureModes") : null;
    if (!text) continue;
    items.push({
      ...item,
      id: `${item.id}#failure`,
      kind: "failure_mode",
      band: "should",
      text,
      relevance: 70,
      contractRole: null,
      synthetic: true,
      pointer: null,
      excerpt: false,
      sealed: false,
    });
  }
  return items;
}

function toolItems(): SliceItem[] {
  return KB_PULL_TOOL_IDS.map((id) => ({
    id,
    kind: "tool",
    title: id,
    text: "",
    band: "could" as const,
    version: 1,
    contentHash: hashCanonical({ id }),
    reasons: ["pull-catalog"],
    relevance: 0,
    contractRole: null,
    synthetic: true,
    pointer: id,
    excerpt: false,
    sealed: false,
  }));
}

function mergeCould(base: readonly SliceItem[], trimmed: readonly SliceItem[]): SliceItem[] {
  const pointers = trimmed.map((item) => ({
    ...item,
    band: "could" as const,
    text: "",
    pointer: shouldPointer(item),
    sealed: false,
  }));
  const merged = [...base, ...pointers];
  const seen = new Set<string>();
  const unique: SliceItem[] = [];
  for (const item of merged) {
    const key = item.pointer ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
