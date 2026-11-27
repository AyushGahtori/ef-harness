import fs from "node:fs";
import { SecretRedactor } from "@ef-harness/shared-contracts";
import { sameSha256 } from "../views-shared/digest.js";
import { nodeAuditText, unifiedDiff } from "./diff.js";
import { SafeDeleteRenameHandler, impactFromEdges } from "./delete-rename.js";
import { canonicalJson, cloneFields, sameJson } from "./hash.js";
import { loadManifest, plansFromManifest, viewFilePath, writeCanonicalViews, type ViewFilePlan } from "./manifest.js";
import { parseViewFile, type ParsedNodeBlock, type ParsedViewFile, type UnmarkedSection } from "./markers.js";
import { DocImportError } from "./model.js";
import { schemaBanners, structuredFieldCount, validateEfFields } from "./schema.js";
import { ImportConflictCardBuilder } from "./conflict-card.js";
import { ThreeWayNodeMerger, type FieldDecision, type ThreeWayPlan } from "./three-way.js";
import { syntaxBanner } from "./yaml.js";
import type {
  AcceptedMutation,
  ChangeClass,
  DeleteConfirmation,
  DocImportModel,
  DocImportRequest,
  DocImportV1,
  EdgeMutation,
  ExportPauseLock,
  FieldMap,
  GraphNode,
  ImportConfirmation,
  ImportConflictCard,
  ImportSession,
  KnowledgeGraphRepo,
  MangledMarkerConfirmation,
  ManifestFileRecord,
  MoveConfirmation,
  NodeMutation,
  NodeStatus,
  Resolution,
  RevisionFeedPort,
  SchemaBanner,
  SyntaxBanner,
  ViewManifest,
  ViewManifestHashScanner,
} from "./types.js";
import { MARKDOWN_ACTOR, MARKDOWN_SOURCE, NODE_KINDS, NODE_STATUSES } from "./types.js";

export interface ImporterDependencies {
  readonly graph: KnowledgeGraphRepo;
  readonly pause: ExportPauseLock;
  readonly scanner: ViewManifestHashScanner;
  readonly model: DocImportModel;
  readonly revisions: RevisionFeedPort;
  readonly viewsRoot: string;
  readonly clock?: () => number;
}

interface FileFacts {
  filePath: string;
  featureId: string | null;
  efFile: string;
  title: string;
  nodeIds: string[];
}

interface NodeWork {
  filePath: string;
  nodeId: string;
  remote: GraphNode;
  base: GraphNode;
  localTitle: string;
  localProse: string;
  localFields: FieldMap;
  plan: ThreeWayPlan;
  doc: DocImportV1 | null;
  conflicts: ImportConflictCard[];
  confirmation: ImportConfirmation | null;
}

interface MangledWork {
  card: MangledMarkerConfirmation;
  heading: string;
  prose: string;
  fields: FieldMap;
  remote: GraphNode;
  base: GraphNode;
}

interface FreshWork {
  card: ImportConfirmation;
  filePath: string;
  heading: string;
  prose: string;
  fields: FieldMap;
  doc: DocImportV1;
}

interface SessionBody {
  id: string;
  original: ViewManifest;
  files: Map<string, FileFacts>;
  works: NodeWork[];
  deletions: DeleteConfirmation[];
  moves: MoveConfirmation[];
  mangled: MangledWork[];
  fresh: FreshWork[];
  syntaxErrors: SyntaxBanner[];
  schemaErrors: SchemaBanner[];
  modelErrors: SchemaBanner[];
  blockedBatch: boolean;
  resolutions: Resolution[];
  deltaPaths: Set<string>;
  settledFiles: Set<string>;
  committedChangeSetId: string | null;
  committedRevision: number | null;
  autoCommittedFiles: string[];
}

const ID_SPECS: Record<string, { prefix: string; width: number }> = {
  decision: { prefix: "D-", width: 4 },
  spec_item: { prefix: "SI-", width: 3 },
  edge_case: { prefix: "EC-", width: 3 },
  rule: { prefix: "R", width: 2 },
  journey: { prefix: "J", width: 2 },
  contract: { prefix: "C-", width: 3 },
  arch_node: { prefix: "A", width: 4 },
  research_fact: { prefix: "RS-", width: 1 },
  plan: { prefix: "P", width: 2 },
  feature: { prefix: "F", width: 2 },
  task: { prefix: "T", width: 2 },
  check: { prefix: "AC-", width: 2 },
  waiver: { prefix: "W", width: 1 },
  ccr: { prefix: "CCR-", width: 2 },
  source: { prefix: "SRC-", width: 2 },
  asset: { prefix: "AS-", width: 2 },
  comment: { prefix: "CM-", width: 2 },
};

/**
 * Imports direct Markdown edits.
 * Structured ef-fields merge with no model call. Prose and unmarked sections go through doc-import@1.
 * Export stays paused until the file commits or the user discards the disk edit.
 */
export class MarkdownDirectEditImporter {
  private readonly sessions = new Map<string, SessionBody>();
  private sequence = 0;
  private readonly merger = new ThreeWayNodeMerger();
  private readonly cards = new ImportConflictCardBuilder();
  private readonly safety = new SafeDeleteRenameHandler();

  constructor(private readonly deps: ImporterDependencies) {}

  reconcile(): ImportSession {
    const original = loadManifest(this.deps.viewsRoot);
    const session = this.blankSession(original);
    const deltas = this.deps.scanner.scan(this.deps.viewsRoot, original);
    for (const delta of deltas) {
      this.deps.pause.acquire(delta.filePath, "disk_delta");
      session.deltaPaths.add(delta.filePath);
    }
    if (deltas.length === 0) return this.publish(session);

    const knownIds = new Set(this.deps.graph.listNodeIds());
    const parsedByFile = new Map<string, ParsedViewFile | null>();
    for (const delta of deltas) {
      const text = readIfExists(this.deps.viewsRoot, delta.filePath);
      if (text === null) {
        parsedByFile.set(delta.filePath, null);
        continue;
      }
      const parsed = parseViewFile(text);
      parsedByFile.set(delta.filePath, parsed);
      this.collectParseErrors(session, delta.filePath, parsed, knownIds);
      const facts = this.factsFor(delta.filePath, parsed, original);
      session.files.set(delta.filePath, facts);
    }
    for (const file of original.files) {
      if (!session.files.has(file.filePath)) session.files.set(file.filePath, factsFromRecord(file));
    }

    session.blockedBatch = session.syntaxErrors.length > 0 || session.schemaErrors.length > 0;
    if (!session.blockedBatch) {
      this.planEdits(session, parsedByFile, original, knownIds);
      this.settle(session);
    }
    return this.publish(session);
  }

  commitResolved(sessionId: string, resolutions: readonly Resolution[]): ImportSession {
    const session = this.requireSession(sessionId);
    session.resolutions.push(...resolutions);
    if (!session.blockedBatch) this.settle(session);
    return this.publish(session);
  }

  discard(sessionId: string, filePaths?: readonly string[]): ImportSession {
    const session = this.requireSession(sessionId);
    const targets = new Set(filePaths ?? this.pendingFiles(session));
    const plans = plansFromManifest(session.original).filter((plan) => targets.has(plan.filePath));
    if (plans.length > 0) {
      writeCanonicalViews({
        graph: this.deps.graph,
        viewsRoot: this.deps.viewsRoot,
        files: plans,
        exportedAt: this.now(),
        previous: loadManifest(this.deps.viewsRoot),
      });
    }
    for (const filePath of targets) {
      this.deps.pause.release(filePath);
      session.settledFiles.add(filePath);
    }
    session.works = session.works.filter((work) => !targets.has(work.filePath));
    session.deletions = session.deletions.filter((card) => !targets.has(card.filePath));
    session.moves = session.moves.filter((card) => !targets.has(card.fromFile) && !targets.has(card.toFile));
    session.mangled = session.mangled.filter((work) => !targets.has(work.card.filePath));
    session.fresh = session.fresh.filter((work) => !targets.has(work.filePath));
    return this.publish(session);
  }

  private blankSession(original: ViewManifest): SessionBody {
    this.sequence += 1;
    const session: SessionBody = {
      id: `import-${String(this.sequence)}`,
      original,
      files: new Map(),
      works: [],
      deletions: [],
      moves: [],
      mangled: [],
      fresh: [],
      syntaxErrors: [],
      schemaErrors: [],
      modelErrors: [],
      blockedBatch: false,
      resolutions: [],
      deltaPaths: new Set(),
      settledFiles: new Set(),
      committedChangeSetId: null,
      committedRevision: null,
      autoCommittedFiles: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private requireSession(sessionId: string): SessionBody {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown import session ${sessionId}`);
    return session;
  }

  private collectParseErrors(
    session: SessionBody,
    filePath: string,
    parsed: ParsedViewFile,
    knownIds: ReadonlySet<string>,
  ): void {
    for (const error of parsed.syntaxErrors) {
      session.syntaxErrors.push({
        filePath,
        line: error.line,
        message: error.message,
        banner: error.code === "unsafe" ? `Unsafe YAML on line ${String(error.line)}: anchors and aliases are not allowed` : syntaxBanner(error.line),
      });
    }
    const seen = new Set<string>();
    for (const node of parsed.nodes) {
      if (seen.has(node.nodeId)) {
        session.syntaxErrors.push({
          filePath,
          line: node.startLine,
          message: `duplicate ef:node id ${node.nodeId}`,
          banner: syntaxBanner(node.startLine),
        });
      }
      seen.add(node.nodeId);
      if (node.yamlError) {
        session.syntaxErrors.push({
          filePath,
          line: node.yamlError.line,
          message: node.yamlError.message,
          banner:
            node.yamlError.code === "unsafe"
              ? `Unsafe YAML on line ${String(node.yamlError.line)}: anchors and aliases are not allowed`
              : syntaxBanner(node.yamlError.line),
        });
        continue;
      }
      if (!knownIds.has(node.nodeId)) {
        session.schemaErrors.push({
          filePath,
          nodeId: node.nodeId,
          line: node.startLine,
          message: `unknown node id "${node.nodeId}"`,
        });
        continue;
      }
      if (node.fields) {
        session.schemaErrors.push(
          ...schemaBanners(filePath, node.nodeId, validateEfFields(node.fields, knownIds, node.keyLines)),
        );
      }
    }
    for (const section of parsed.unmarked) {
      if (!section.yamlError || section.fields) continue;
      if (section.yamlError.message === "missing ef-fields block") continue;
      session.syntaxErrors.push({
        filePath,
        line: section.yamlError.line,
        message: section.yamlError.message,
        banner:
          section.yamlError.code === "unsafe"
            ? `Unsafe YAML on line ${String(section.yamlError.line)}: anchors and aliases are not allowed`
            : syntaxBanner(section.yamlError.line),
      });
    }
  }

  private planEdits(
    session: SessionBody,
    parsedByFile: ReadonlyMap<string, ParsedViewFile | null>,
    original: ViewManifest,
    knownIds: ReadonlySet<string>,
  ): void {
    const locations = new Map<string, string[]>();
    for (const [filePath, parsed] of parsedByFile) {
      if (!parsed) continue;
      for (const node of parsed.nodes) {
        const list = locations.get(node.nodeId) ?? [];
        list.push(filePath);
        locations.set(node.nodeId, list);
      }
    }
    const home = new Map(original.nodes.map((node) => [node.nodeId, node.filePath]));
    const moved = new Set<string>();
    for (const [nodeId, found] of locations) {
      const origin = home.get(nodeId);
      if (!origin || found.length !== 1) continue;
      const destination = found[0];
      if (!destination || destination === origin) continue;
      if (!parsedByFile.has(origin)) continue;
      const originParsed = parsedByFile.get(origin);
      if (originParsed === undefined) continue;
      if (originParsed?.nodes.some((node) => node.nodeId === nodeId)) continue;
      moved.add(nodeId);
      const fromFacts = session.files.get(origin);
      const toFacts = session.files.get(destination);
      session.moves.push(
        this.safety.moveCard({
          nodeId,
          fromFile: origin,
          toFile: destination,
          fromFeatureId: fromFacts?.featureId ?? null,
          toFeatureId: toFacts?.featureId ?? null,
        }),
      );
    }

    for (const [filePath, parsed] of parsedByFile) {
      const recordIds = original.nodes.filter((node) => node.filePath === filePath).map((node) => node.nodeId);
      if (parsed === null) {
        for (const nodeId of recordIds) {
          if (moved.has(nodeId)) continue;
          const remote = this.deps.graph.getNode(nodeId);
          if (!remote) continue;
          session.deletions.push(
            this.safety.removalCard({
              filePath,
              nodeId,
              title: remote.title,
              impact: impactFromEdges(nodeId, this.deps.graph.listCurrentEdges()),
            }),
          );
        }
        continue;
      }
      const present = new Set(parsed.nodes.map((node) => node.nodeId));
      const missing = recordIds.filter((nodeId) => !present.has(nodeId) && !moved.has(nodeId));
      const unmarked = parsed.unmarked.map((section, index) => ({
        heading: section.heading,
        index,
        previousNodeId: neighborId(parsed.nodes, index, -1),
        nextNodeId: neighborId(parsed.nodes, index, 1),
      }));
      const mangledCards = this.safety.matchMangled(
        missing.map((nodeId) => {
          const remote = this.deps.graph.getNode(nodeId);
          const order = recordIds;
          const at = order.indexOf(nodeId);
          return {
            nodeId,
            title: remote?.title ?? nodeId,
            filePath,
            previousNodeId: at > 0 ? (order[at - 1] ?? null) : null,
            nextNodeId: at >= 0 && at < order.length - 1 ? (order[at + 1] ?? null) : null,
          };
        }),
        unmarked,
      );
      const consumed = new Set(mangledCards.map((card) => card.heading));
      for (const card of mangledCards) {
        const section = parsed.unmarked.find((item) => item.heading === card.heading);
        const remote = this.deps.graph.getNode(card.nodeId);
        const base = this.baseNode(original, card.nodeId, remote);
        if (!section || !remote || !base) continue;
        session.mangled.push({
          card,
          heading: section.heading,
          prose: section.prose,
          fields: section.fields ?? cloneFields(base.fields),
          remote,
          base,
        });
      }
      for (const nodeId of missing) {
        if (mangledCards.some((card) => card.nodeId === nodeId)) continue;
        const remote = this.deps.graph.getNode(nodeId);
        if (!remote) continue;
        session.deletions.push(
          this.safety.removalCard({
            filePath,
            nodeId,
            title: remote.title,
            impact: impactFromEdges(nodeId, this.deps.graph.listCurrentEdges()),
          }),
        );
      }
      for (const node of parsed.nodes) {
        if (!knownIds.has(node.nodeId) || node.yamlError || !node.fields) continue;
        const remote = this.deps.graph.getNode(node.nodeId);
        if (!remote) continue;
        const base = this.baseNode(original, node.nodeId, remote, node.rev);
        const localFields = stripExportEnvelope(node.fields, remote);
        this.addNodeWork(session, filePath, node.nodeId, remote, base, node.title, node.prose, localFields, knownIds);
        const record = original.nodes.find((item) => item.filePath === filePath && item.nodeId === node.nodeId);
        const work = session.works.find((item) => item.filePath === filePath && item.nodeId === node.nodeId);
        if (record && work && !sameSha256(record.contentSha256, node.baseHash)) {
          work.conflicts.push(staleBaseCard(filePath, node.nodeId, record.contentSha256, node.baseHash, remote.contentHash));
        }
      }
      parsed.unmarked.forEach((section, index) => {
        if (consumed.has(section.heading)) return;
        if (section.yamlError && section.yamlError.message !== "missing ef-fields block") return;
        this.addFresh(session, filePath, section, index, knownIds);
      });
    }
  }

  private addNodeWork(
    session: SessionBody,
    filePath: string,
    nodeId: string,
    remote: GraphNode,
    base: GraphNode,
    localTitle: string,
    localProse: string,
    localFields: FieldMap,
    knownIds: ReadonlySet<string>,
  ): void {
    const plan = this.merger.plan({
      baseFields: base.fields,
      localFields,
      remoteFields: remote.fields,
      baseProse: strip(base.text),
      localProse,
      remoteProse: strip(remote.text),
      baseTitle: base.title,
      localTitle,
      remoteTitle: remote.title,
    });
    let doc: DocImportV1 | null = null;
    if (plan.prose === "local") {
      doc = this.invokeModel(session, filePath, nodeId, {
        baseProse: strip(base.text),
        editedProse: localProse,
        currentFields: cloneFields(remote.fields),
        validNodeIds: [...knownIds].sort(),
      });
    }
    const conflicts: ImportConflictCard[] = [];
    for (const decision of plan.fields) {
      if (decision.kind === "conflict") conflicts.push(this.cards.fieldCard(filePath, nodeId, decision));
    }
    if (plan.prose === "conflict") {
      conflicts.push(this.cards.textCard(filePath, nodeId, "prose", strip(base.text), localProse, strip(remote.text)));
    }
    if (plan.title === "conflict") {
      conflicts.push(this.cards.textCard(filePath, nodeId, "title", base.title, localTitle, remote.title));
    }
    const confirmation = confirmationFor(filePath, nodeId, null, doc);
    session.works.push({
      filePath,
      nodeId,
      remote,
      base,
      localTitle,
      localProse,
      localFields,
      plan,
      doc,
      conflicts,
      confirmation,
    });
  }

  private addFresh(
    session: SessionBody,
    filePath: string,
    section: UnmarkedSection,
    index: number,
    knownIds: ReadonlySet<string>,
  ): void {
    if (section.fields) {
      const issues = validateEfFields(section.fields, knownIds, section.keyLines);
      if (issues.length > 0) {
        session.schemaErrors.push(...schemaBanners(filePath, null, issues));
        session.blockedBatch = true;
        return;
      }
    }
    const doc = this.invokeModel(session, filePath, null, {
      baseProse: "",
      editedProse: `## ${section.heading}\n\n${section.prose}`.trim(),
      currentFields: section.fields ? cloneFields(section.fields) : {},
      validNodeIds: [...knownIds].sort(),
    });
    if (!doc || doc.blocked) return;
    const card: ImportConfirmation = {
      cardId: `new:${filePath}:${String(index)}:${section.heading}`,
      kind: "new_node",
      filePath,
      nodeId: null,
      heading: section.heading,
      message: `New unmarked section "${section.heading}" needs confirmation before it becomes an explicit node.`,
      changeClass: "semantic",
      proposals: doc.proposals,
      actions: ["confirm", "reject"],
    };
    session.fresh.push({ card, filePath, heading: section.heading, prose: section.prose, fields: section.fields ?? {}, doc });
  }

  private invokeModel(
    session: SessionBody,
    filePath: string,
    nodeId: string | null,
    request: DocImportRequest,
  ): DocImportV1 | null {
    try {
      return this.deps.model.complete(request);
    } catch (error) {
      const message = error instanceof DocImportError || error instanceof Error ? error.message : "doc-import@1 failed";
      session.modelErrors.push({ filePath, nodeId, line: null, message });
      return null;
    }
  }

  private settle(session: SessionBody): void {
    const pending = this.pendingFiles(session);
    const ready = [...session.deltaPaths].filter((filePath) => !pending.has(filePath) && !session.settledFiles.has(filePath));
    if (ready.length === 0) return;
    const readySet = new Set(ready);
    const mutations: NodeMutation[] = [];
    const edges: EdgeMutation[] = [];
    const accepted: AcceptedMutation[] = [];
    const summaries: string[] = [];
    const allocated = new Set(this.deps.graph.listNodeIds());
    const written = new Set<string>();

    for (const move of session.moves) {
      if (!readySet.has(move.fromFile) || !readySet.has(move.toFile)) continue;
      const choice = resolutionFor(session.resolutions, move.cardId);
      if (choice?.action !== "confirm_move") continue;
      this.applyMove(session, move, mutations, edges, accepted, summaries, written);
    }
    for (const deletion of session.deletions) {
      if (!readySet.has(deletion.filePath)) continue;
      const choice = resolutionFor(session.resolutions, deletion.cardId);
      if (choice?.action !== "deprecate") continue;
      const remote = this.deps.graph.getNode(deletion.nodeId);
      if (!remote) continue;
      if (written.has(deletion.nodeId)) continue;
      written.add(deletion.nodeId);
      mutations.push({ op: "retire", id: deletion.nodeId, expectedVersion: remote.version, status: "retired" });
      const facts = session.files.get(deletion.filePath);
      if (facts) facts.nodeIds = facts.nodeIds.filter((id) => id !== deletion.nodeId);
      const diff = unifiedDiff(remote.title, `${remote.title}\nstatus: retired`, deletion.nodeId);
      summaries.push(diff);
      accepted.push({
        nodeId: deletion.nodeId,
        filePath: deletion.filePath,
        changeClass: "retired",
        invalidateTasks: true,
        diff,
      });
    }
    for (const work of session.mangled) {
      if (!readySet.has(work.card.filePath)) continue;
      const choice = resolutionFor(session.resolutions, work.card.cardId);
      if (choice?.action === "create_new") {
        const created = this.mutationForNew(session, {
          filePath: work.card.filePath,
          heading: work.heading,
          prose: work.prose,
          fields: work.fields,
          doc: { blocked: false, changeClass: "semantic", proposals: [] },
          card: work.card as unknown as ImportConfirmation,
        }, allocated);
        if (created) {
          mutations.push(created.mutation);
          edges.push(...created.edges);
          accepted.push(created.accepted);
          summaries.push(created.diff);
        }
      }
    }
    for (const fresh of session.fresh) {
      if (!readySet.has(fresh.filePath)) continue;
      const choice = resolutionFor(session.resolutions, fresh.card.cardId);
      if (choice?.action !== "confirm") continue;
      const created = this.mutationForNew(session, fresh, allocated);
      if (!created) continue;
      mutations.push(created.mutation);
      edges.push(...created.edges);
      accepted.push(created.accepted);
      summaries.push(created.diff);
    }
    for (const work of session.works) {
      if (!readySet.has(work.filePath) || written.has(work.nodeId)) continue;
      const built = this.mutationForWork(session, work);
      if (built) written.add(work.nodeId);
      if (!built) continue;
      mutations.push(built.mutation);
      accepted.push(built.accepted);
      summaries.push(built.diff);
    }

    if (session.blockedBatch) return;
    if (mutations.length > 0 || edges.length > 0) {
      if (readyFilesContainSecrets(this.deps.viewsRoot, ready)) {
        session.schemaErrors.push({
          filePath: ready[0] ?? "",
          nodeId: null,
          line: null,
          message: "secret scan refused the markdown edit",
        });
        session.blockedBatch = true;
        return;
      }
      const changeSetId = `CS-MD-${String(this.sequence)}`;
      this.sequence += 1;
      const committed = this.deps.graph.commitChangeSet({
        id: changeSetId,
        origin: "markdown_edit",
        originRef: ready.slice().sort().join(","),
        author: MARKDOWN_ACTOR,
        summary: summaries.join("\n"),
        createdAt: this.now(),
        nodes: mutations,
        edges,
      });
      session.committedChangeSetId = committed.changeSetId;
      session.committedRevision = committed.rev;
      if (!committed.noop) {
        this.deps.revisions.accept({ changeSetId: committed.changeSetId, mutations: accepted });
      }
    }

    const plans: ViewFilePlan[] = ready
      .map((filePath) => session.files.get(filePath))
      .filter((facts): facts is FileFacts => facts !== undefined)
      .map((facts) => ({
        filePath: facts.filePath,
        featureId: facts.featureId,
        efFile: facts.efFile,
        title: facts.title,
        nodeIds: facts.nodeIds,
      }));
    if (plans.length > 0) {
      writeCanonicalViews({
        graph: this.deps.graph,
        viewsRoot: this.deps.viewsRoot,
        files: plans,
        exportedAt: this.now(),
        previous: loadManifest(this.deps.viewsRoot),
      });
    }
    for (const filePath of ready) {
      this.deps.pause.release(filePath);
      session.settledFiles.add(filePath);
      session.autoCommittedFiles.push(filePath);
    }
  }

  private mutationForWork(
    session: SessionBody,
    work: NodeWork,
  ): { mutation: NodeMutation; accepted: AcceptedMutation; diff: string } | null {
    if (rejecting(session.resolutions, work.confirmation?.cardId)) return null;
    const fields = this.fieldsAfterResolution(session, work);
    if (!fields) return null;
    const title = textAfterResolution(session.resolutions, work, "title", work.base.title, work.localTitle, work.remote.title);
    const prose = textAfterResolution(session.resolutions, work, "prose", strip(work.base.text), work.localProse, strip(work.remote.text));
    let nextFields = fields;
    if (title !== work.remote.title) nextFields = this.safety.renameNames(nextFields, work.remote.title, title);
    const localEdit =
      title !== work.remote.title ||
      prose !== strip(work.remote.text) ||
      !sameJson(nextFields, work.remote.fields);
    if (localEdit) {
      const basis = work.plan.fields.find((decision) => decision.key === "basis");
      if (!basis || basis.kind !== "take_remote" || resolvedLocal(session.resolutions, work, "basis")) {
        nextFields.basis = "explicit";
      }
      nextFields.source = MARKDOWN_SOURCE;
    }
    if (title === work.remote.title && prose === strip(work.remote.text) && sameJson(nextFields, work.remote.fields)) {
      return null;
    }
    const issues = validateEfFields(nextFields, new Set(this.deps.graph.listNodeIds()), new Map());
    if (issues.length > 0) {
      session.schemaErrors.push(...schemaBanners(work.filePath, work.nodeId, issues));
      session.blockedBatch = true;
      return null;
    }
    const before = nodeAuditText({ title: work.base.title, prose: strip(work.base.text), fieldsJson: canonicalJson(work.base.fields) });
    const after = nodeAuditText({ title, prose, fieldsJson: canonicalJson(nextFields) });
    const diff = unifiedDiff(before, after, work.nodeId);
    const changeClass = classifyWork(work, title, prose, nextFields);
    return {
      mutation: {
        op: "update",
        id: work.nodeId,
        class: changeClass,
        expectedVersion: work.remote.version,
        title,
        text: prose,
        fields: nextFields,
        status: nextColumnStatus(work, nextFields, session.resolutions),
      },
      accepted: {
        nodeId: work.nodeId,
        filePath: work.filePath,
        changeClass,
        invalidateTasks: changeClass !== "cosmetic" && changeClass !== "clarifying",
        diff,
      },
      diff,
    };
  }

  private mutationForNew(
    session: SessionBody,
    fresh: FreshWork,
    allocated: Set<string>,
  ): { mutation: NodeMutation; edges: EdgeMutation[]; accepted: AcceptedMutation; diff: string } | null {
    const doc = fresh.doc;
    if (doc.blocked) return null;
    const proposal = doc.proposals.find((item) => item.kind === "new_node") ?? null;
    const kind = proposal?.node_type && isNodeKind(proposal.node_type) ? proposal.node_type : "spec_item";
    const id = allocateId(kind, [...allocated]);
    allocated.add(id);
    const facts = session.files.get(fresh.filePath);
    const fields: FieldMap = cloneFields(fresh.fields);
    for (const pair of proposal?.fields ?? []) fields[pair.key] = pair.value;
    fields.basis = "explicit";
    fields.source = MARKDOWN_SOURCE;
    if (facts?.featureId && fields.feature === undefined) fields.feature = facts.featureId;
    const issues = validateEfFields(fields, new Set([...allocated, ...this.deps.graph.listNodeIds()]), new Map());
    if (issues.length > 0) {
      session.schemaErrors.push(...schemaBanners(fresh.filePath, null, issues));
      session.blockedBatch = true;
      return null;
    }
    const text = proposal?.text ?? fresh.prose;
    const diff = unifiedDiff("", nodeAuditText({ title: fresh.heading, prose: text, fieldsJson: canonicalJson(fields) }), id);
    if (facts && !facts.nodeIds.includes(id)) facts.nodeIds.push(id);
    const edges: EdgeMutation[] = [];
    if (facts?.featureId && this.deps.graph.getNode(facts.featureId)) {
      edges.push({ op: "create", src: id, type: "belongs_to", dst: facts.featureId });
    }
    return {
      mutation: {
        op: "create",
        id,
        kind,
        title: fresh.heading,
        text,
        fields,
        status: "active",
      },
      edges,
      accepted: { nodeId: id, filePath: fresh.filePath, changeClass: "created", invalidateTasks: true, diff },
      diff,
    };
  }

  private applyMove(
    session: SessionBody,
    move: MoveConfirmation,
    mutations: NodeMutation[],
    edges: EdgeMutation[],
    accepted: AcceptedMutation[],
    summaries: string[],
    written: Set<string>,
  ): void {
    if (written.has(move.nodeId)) return;
    written.add(move.nodeId);
    const remote = this.deps.graph.getNode(move.nodeId);
    if (!remote) return;
    const from = session.files.get(move.fromFile);
    const to = session.files.get(move.toFile);
    if (from) from.nodeIds = from.nodeIds.filter((id) => id !== move.nodeId);
    if (to && !to.nodeIds.includes(move.nodeId)) to.nodeIds.push(move.nodeId);
    const fields = cloneFields(remote.fields);
    if (move.toFeatureId) fields.feature = move.toFeatureId;
    fields.basis = "explicit";
    fields.source = MARKDOWN_SOURCE;
    const work = session.works.find((item) => item.nodeId === move.nodeId);
    const title = work ? textAfterResolution(session.resolutions, work, "title", work.base.title, work.localTitle, work.remote.title) : remote.title;
    const prose = work
      ? textAfterResolution(session.resolutions, work, "prose", strip(work.base.text), work.localProse, strip(work.remote.text))
      : strip(remote.text);
    const merged = work ? (this.fieldsAfterResolution(session, work) ?? fields) : fields;
    if (move.toFeatureId) merged.feature = move.toFeatureId;
    merged.basis = "explicit";
    merged.source = MARKDOWN_SOURCE;
    if (title !== remote.title) {
      const renamed = this.safety.renameNames(merged, remote.title, title);
      for (const key of Object.keys(merged)) delete merged[key];
      Object.assign(merged, renamed);
    }
    mutations.push({
      op: "update",
      id: move.nodeId,
      class: "compatible",
      expectedVersion: remote.version,
      title,
      text: prose,
      fields: merged,
      status: remote.status,
    });
    for (const edge of this.deps.graph.listCurrentEdges()) {
      if (edge.src === move.nodeId && edge.type === "belongs_to") {
        edges.push({ op: "retire", src: edge.src, type: edge.type, dst: edge.dst });
      }
    }
    if (move.toFeatureId && this.deps.graph.getNode(move.toFeatureId)) {
      edges.push({ op: "create", src: move.nodeId, type: "belongs_to", dst: move.toFeatureId });
    }
    const diff = unifiedDiff(move.fromFile, move.toFile, move.nodeId);
    summaries.push(diff);
    accepted.push({
      nodeId: move.nodeId,
      filePath: move.toFile,
      changeClass: "compatible",
      invalidateTasks: true,
      diff,
    });
    if (work) work.filePath = move.toFile;
  }

  private fieldsAfterResolution(session: SessionBody, work: NodeWork): FieldMap | null {
    const decisions = work.plan.fields.map((decision) => applyFieldResolution(decision, work, session.resolutions));
    if (decisions.some((decision) => decision.kind === "conflict")) return null;
    const merged = this.merger.mergedFields({ ...work.plan, fields: decisions, hasConflict: false }, work.remote.fields);
    if (!merged) return null;
    if (work.confirmation && resolutionFor(session.resolutions, work.confirmation.cardId)?.action === "confirm" && work.doc && !work.doc.blocked) {
      for (const proposal of work.doc.proposals) {
        if (proposal.kind !== "update") continue;
        for (const pair of proposal.fields) merged[pair.key] = pair.value;
      }
    }
    return merged;
  }

  private pendingFiles(session: SessionBody): Set<string> {
    const pending = new Set<string>();
    if (session.blockedBatch) {
      for (const filePath of session.files.keys()) {
        if (!session.settledFiles.has(filePath)) pending.add(filePath);
      }
      return pending;
    }
    const consider = (filePath: string, cardId: string | null, open: boolean) => {
      if (!open) return;
      if (cardId && resolutionFor(session.resolutions, cardId)) return;
      pending.add(filePath);
    };
    for (const error of [...session.syntaxErrors, ...session.schemaErrors, ...session.modelErrors]) pending.add(error.filePath);
    for (const work of session.works) {
      if (session.settledFiles.has(work.filePath)) continue;
      for (const conflict of work.conflicts) consider(work.filePath, conflict.cardId, true);
      if (work.confirmation) consider(work.filePath, work.confirmation.cardId, true);
    }
    for (const card of session.deletions) consider(card.filePath, card.cardId, true);
    for (const card of session.moves) {
      const resolved = resolutionFor(session.resolutions, card.cardId);
      if (resolved) continue;
      pending.add(card.fromFile);
      pending.add(card.toFile);
    }
    for (const work of session.mangled) consider(work.card.filePath, work.card.cardId, true);
    for (const work of session.fresh) consider(work.filePath, work.card.cardId, true);
    for (const filePath of session.settledFiles) pending.delete(filePath);
    return pending;
  }

  private factsFor(filePath: string, parsed: ParsedViewFile | null, original: ViewManifest): FileFacts {
    const record = original.files.find((file) => file.filePath === filePath);
    if (record && parsed === null) return factsFromRecord(record);
    return {
      filePath,
      featureId: parsed?.featureId ?? record?.featureId ?? null,
      efFile: parsed?.efFile ?? record?.efFile ?? filePath.replace(/\.md$/, ""),
      title: parsed?.title || record?.title || filePath,
      nodeIds: record ? [...record.nodeIds] : [],
    };
  }

  private baseNode(original: ViewManifest, nodeId: string, remote: GraphNode | null, markerRev?: number): GraphNode {
    const record = original.nodes.find((node) => node.nodeId === nodeId);
    const version = markerRev ?? record?.nodeVersion ?? remote?.version ?? 1;
    return this.deps.graph.getNodeVersion(nodeId, version) ?? remote ?? unreachable(nodeId);
  }

  private publish(session: SessionBody): ImportSession {
    const pending = this.pendingFiles(session);
    return {
      id: session.id,
      committedChangeSetId: session.committedChangeSetId,
      committedRevision: session.committedRevision,
      locksHeld: this.deps.pause.heldFiles(),
      conflicts: session.works.filter((work) => pending.has(work.filePath)).flatMap((work) => work.conflicts.filter((card) => !resolutionFor(session.resolutions, card.cardId))),
      confirmations: [
        ...session.works
          .filter((work) => pending.has(work.filePath) && work.confirmation && !resolutionFor(session.resolutions, work.confirmation.cardId))
          .map((work) => work.confirmation)
          .filter((card): card is ImportConfirmation => card !== null),
        ...session.fresh.filter((work) => pending.has(work.filePath) && !resolutionFor(session.resolutions, work.card.cardId)).map((work) => work.card),
      ],
      deletions: session.deletions.filter((card) => pending.has(card.filePath) && !resolutionFor(session.resolutions, card.cardId)),
      moves: session.moves.filter((card) => !resolutionFor(session.resolutions, card.cardId) && (pending.has(card.fromFile) || pending.has(card.toFile))),
      mangled: session.mangled.filter((work) => pending.has(work.card.filePath) && !resolutionFor(session.resolutions, work.card.cardId)).map((work) => work.card),
      syntaxErrors: session.syntaxErrors,
      schemaErrors: session.schemaErrors,
      modelErrors: session.modelErrors,
      autoCommittedFiles: [...session.autoCommittedFiles],
      pendingFiles: [...pending].sort(),
      blockedBatch: session.blockedBatch,
    };
  }

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }
}

function confirmationFor(
  filePath: string,
  nodeId: string | null,
  heading: string | null,
  doc: DocImportV1 | null,
): ImportConfirmation | null {
  if (!doc || doc.blocked || doc.changeClass !== "semantic") return null;
  if (structuredFieldCount(doc.proposals) === 0) return null;
  const keys = doc.proposals.flatMap((proposal) => proposal.fields.map((field) => field.key));
  return {
    cardId: `semantic:${filePath}:${nodeId ?? heading ?? "prose"}`,
    kind: "semantic_fields",
    filePath,
    nodeId,
    heading,
    message: `Semantic change in ${filePath} for ${nodeId ?? "a new section"} affects ${keys.join(", ") || "structured fields"}. Confirm before import.`,
    changeClass: "semantic",
    proposals: doc.proposals,
    actions: ["confirm", "reject"],
  };
}

function applyFieldResolution(decision: FieldDecision, work: NodeWork, resolutions: readonly Resolution[]): FieldDecision {
  if (decision.kind !== "conflict") return decision;
  const cardId = `conflict:${work.filePath}:${work.nodeId}:${decision.key}`;
  const choice = resolutionFor(resolutions, cardId);
  if (!choice) return decision;
  if (choice.action === "keep_current") {
    if (!decision.remote.present) return { kind: "delete_remote", key: decision.key };
    return { kind: "take_remote", key: decision.key, value: decision.remote.value ?? null };
  }
  if (choice.action === "edit_merged") return { kind: "take_local", key: decision.key, value: choice.value };
  if (!decision.local.present) return { kind: "delete_local", key: decision.key };
  return { kind: "take_local", key: decision.key, value: decision.local.value ?? null };
}

function textAfterResolution(
  resolutions: readonly Resolution[],
  work: NodeWork,
  kind: "prose" | "title",
  base: string,
  local: string,
  remote: string,
): string {
  const decision = kind === "prose" ? work.plan.prose : work.plan.title;
  const choice = resolutionFor(resolutions, `conflict:${work.filePath}:${work.nodeId}:${kind}`);
  if (choice?.action === "keep_current") return remote;
  if (choice?.action === "keep_mine") return local;
  if (choice?.action === "edit_merged" && typeof choice.value === "string") return choice.value;
  if (work.confirmation && resolutionFor(resolutions, work.confirmation.cardId)?.action === "reject") return remote;
  if (work.confirmation && resolutionFor(resolutions, work.confirmation.cardId)?.action === "confirm") return local;
  if (decision === "local") return local;
  if (decision === "remote" || decision === "unchanged") return remote === "" ? base : remote;
  return remote;
}

function resolvedLocal(resolutions: readonly Resolution[], work: NodeWork, key: string): boolean {
  const choice = resolutionFor(resolutions, `conflict:${work.filePath}:${work.nodeId}:${key}`);
  return choice?.action === "keep_mine" || choice?.action === "edit_merged";
}

function rejecting(resolutions: readonly Resolution[], cardId: string | undefined): boolean {
  if (!cardId) return false;
  return resolutionFor(resolutions, cardId)?.action === "reject";
}

function resolutionFor(resolutions: readonly Resolution[], cardId: string): Resolution | undefined {
  return [...resolutions].reverse().find((resolution) => resolution.cardId === cardId);
}

function classifyWork(work: NodeWork, title: string, prose: string, fields: FieldMap): ChangeClass {
  const doc = work.doc;
  const proseChanged = prose !== strip(work.remote.text);
  const titleChanged = title !== work.remote.title;
  const fieldKeys = changedFieldKeys(work.remote.fields, fields).filter((key) => key !== "basis" && key !== "source" && key !== "names");
  if (
    doc &&
    !doc.blocked &&
    doc.changeClass === "cosmetic" &&
    structuredFieldCount(doc.proposals) === 0 &&
    proseChanged &&
    fieldKeys.length === 0 &&
    !titleChanged
  ) {
    return "cosmetic";
  }
  if (titleChanged && !proseChanged && fieldKeys.length === 0) return "clarifying";
  if (fieldKeys.some((key) => key === "cutoff_time" || key === "bounds" || key === "numeric_bounds")) return "breaking";
  if (doc && !doc.blocked && doc.changeClass === "semantic") return "breaking";
  return "compatible";
}

function changedFieldKeys(before: FieldMap, after: FieldMap): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !sameJson(before[key] ?? null, after[key] ?? null) || hasKey(before, key) !== hasKey(after, key));
}

function hasKey(map: FieldMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function nextColumnStatus(work: NodeWork, fields: FieldMap, resolutions: readonly Resolution[]): NodeStatus {
  const decision = work.plan.fields.find((item) => item.key === "status");
  const localStatusChange =
    decision?.kind === "take_local" ||
    decision?.kind === "delete_local" ||
    resolvedLocal(resolutions, work, "status");
  if (!localStatusChange) return work.remote.status;
  const status = fields.status;
  if (typeof status === "string" && isNodeStatus(status)) return status;
  return work.remote.status;
}

function isNodeStatus(value: string): value is NodeStatus {
  return (NODE_STATUSES as readonly string[]).includes(value);
}

function strip(value: string): string {
  return value.replace(/\n$/, "");
}

function factsFromRecord(file: ManifestFileRecord): FileFacts {
  return {
    filePath: file.filePath,
    featureId: file.featureId,
    efFile: file.efFile,
    title: file.title,
    nodeIds: [...file.nodeIds],
  };
}

function neighborId(nodes: readonly ParsedNodeBlock[], index: number, direction: -1 | 1): string | null {
  const node = nodes[index + direction];
  return node?.nodeId ?? null;
}

function isNodeKind(value: string): boolean {
  return NODE_KINDS.includes(value as (typeof NODE_KINDS)[number]);
}

function allocateId(kind: string, ids: readonly string[]): string {
  const spec = ID_SPECS[kind] ?? { prefix: "A", width: 4 };
  const pattern = new RegExp(`^${spec.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const match = pattern.exec(id);
    if (!match?.[1]) continue;
    max = Math.max(max, Number(match[1]));
  }
  return `${spec.prefix}${String(max + 1).padStart(spec.width, "0")}`;
}

function readIfExists(viewsRoot: string, filePath: string): string | null {
  const absolute = viewFilePath(viewsRoot, filePath);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, "utf8");
}

function unreachable(nodeId: string): never {
  throw new Error(`missing base snapshot for ${nodeId}`);
}

const EXPORT_ENVELOPE_KEYS = ["id", "kind", "status", "owner", "links"] as const;

/** Drop exporter mirror keys that are not stored on the graph node. */
function stripExportEnvelope(local: FieldMap, remote: GraphNode): FieldMap {
  const next = cloneFields(local);
  for (const key of EXPORT_ENVELOPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(remote.fields, key)) continue;
    if (key === "id" && next.id === remote.id) delete next.id;
    else if (key === "kind" && next.kind === remote.kind) delete next.kind;
    else if (key === "status" && next.status === remote.status) delete next.status;
    else if (key === "owner" && next.owner === null) delete next.owner;
    else if (key === "links" && Array.isArray(next.links) && next.links.length === 0) delete next.links;
  }
  return next;
}

function staleBaseCard(
  filePath: string,
  nodeId: string,
  manifestHash: string,
  markerHash: string,
  currentHash: string,
): ImportConflictCard {
  return {
    cardId: `conflict:${filePath}:${nodeId}:base_hash`,
    kind: "field",
    filePath,
    nodeId,
    field: "base_hash",
    base: manifestHash,
    basePresent: true,
    yourEdit: markerHash,
    yourEditPresent: true,
    currentDb: currentHash,
    currentDbPresent: true,
    actions: ["keep_mine", "keep_current", "edit_merged"],
    summary: `Stale base_hash for ${nodeId}. The Markdown opener does not match the exported manifest hash.`,
  };
}

function readyFilesContainSecrets(viewsRoot: string, filePaths: readonly string[]): boolean {
  const redactor = new SecretRedactor();
  for (const filePath of filePaths) {
    const text = readIfExists(viewsRoot, filePath);
    if (text && redactor.scanForSecrets(text).length > 0) return true;
  }
  return false;
}
