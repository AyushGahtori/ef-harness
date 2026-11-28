import {
  ARCHIVED_POPOVER,
  CANONICAL_NODE_TYPES,
  CHOSEN_FOR_YOU,
  SCREEN_STATES,
  canonicalType,
} from "./types.js";
import type {
  BoxChatIntent,
  CanvasNode,
  CheckNode,
  PopoverAction,
  PopoverField,
  PopoverModel,
  PremiseLink,
} from "./types.js";

export class NodeTypePopoverRegistry {
  readonly canonicalTypes = CANONICAL_NODE_TYPES;

  resolve(typeName: string): ReturnType<typeof canonicalType> {
    return canonicalType(typeName);
  }

  describe(node: CanvasNode): PopoverModel {
    const model = describeNode(node);
    return { ...model, canonical: canonicalType(node.type) };
  }

  archived(nodeId: string): PopoverModel {
    return {
      archived: true,
      nodeId,
      canonical: null,
      title: ARCHIVED_POPOVER,
      fields: [],
      links: [],
      actions: [closeAction()],
      thumbnailAlt: null,
    };
  }
}

export function popoverOmitsSealedSource(model: PopoverModel, source: string): boolean {
  if (source.length === 0) return true;
  const values = [
    model.title,
    ...model.fields.map((field) => `${field.label} ${field.value}`),
    ...model.links.map((link) => link.label),
    ...model.actions.map((action) => action.label),
  ];
  return values.every((value) => !value.includes(source));
}

export function modelText(model: PopoverModel): string {
  return [
    model.title,
    ...model.fields.map((field) => `${field.label} ${field.value}`),
    ...model.links.map((link) => link.label),
    ...model.actions.map((action) => action.label),
    model.thumbnailAlt ?? "",
  ].join("\n");
}

function describeNode(node: CanvasNode): Omit<PopoverModel, "canonical"> {
  switch (node.type) {
    case "project":
    case "scope":
      return shell(node, [
        evidence(node),
        field("Stage", node.stage),
        field("Readiness", `${node.readinessDone}/${node.readinessTotal}`),
      ], [], [sibling("edit-stage", "Edit stage / View readiness", "Task 155", "editStage")], null);
    case "decision":
      return describeDecision(node);
    case "requirement":
      return shell(node, [
        evidence(node),
        field("EARS", node.ears),
        field("oracle_sketch", node.oracleSketch),
        field("Linked feature", node.linkedFeature),
        field("Linked tasks", node.linkedTasks.join(", ")),
        field("Status", node.status),
      ], [], [
        intent("edit", "Edit", "change"),
        sibling("split", "Split", "Task 156", "splitRequirement"),
        intent("explain", "Explain impact", "explain_impact"),
      ], null);
    case "feature":
      return shell(node, [
        evidence(node),
        field("Wave", String(node.wave)),
        field("Runtime", node.runtime),
        field("Task progress", `${node.tasksDone}/${node.tasksTotal}`),
      ], [], [
        intent("add-requirement", "Add requirement", "add_child"),
        sibling("pause-feature", "Pause feature", "Task 156", "pauseFeature"),
        sibling("undo-feature", "Undo feature", "Task 129", "analyze"),
        sibling("open-preview", "Open preview", "Task 160", "openPreview"),
      ], null);
    case "entity":
      return shell(node, [
        evidence(node),
        field("Fields", node.fields.join(", ")),
        field("Owner feature", node.ownerFeature),
        field("Touches", node.touches.join(", ")),
        field("Lock", node.locked ? "Locked" : "Unlocked"),
      ], [], [
        intent("add-field", "Add field", "add_child"),
        sibling("view-relations", "View relations", "Task 153", "viewRelations"),
      ], null);
    case "contract":
    case "api_endpoint":
      return shell(node, [
        evidence(node),
        field("Method", node.method),
        field("Route", node.route),
        field("Event schema", node.eventSchema),
        field("Owner", node.owner),
        field("Consumers", node.consumers.map((item) => item.label).join(", ")),
        field("Skeleton lock", node.skeletonLocked ? "locked" : "unlocked"),
      ], node.consumers, [
        sibling("propose-ccr", "Propose CCR", "Task 112", "propose"),
        sibling("view-schema", "View schema", "Task 112", "viewSchema"),
      ], null);
    case "screen_spec":
      return shell(node, [
        evidence(node),
        field("Route", node.route),
        field("Permitted roles", node.roles.join(", ")),
        field("UI states", screenChecklist(node.states)),
        field("Wireframe", node.wireframeLabel),
      ], [], [
        sibling("open-wireframe", "Open wireframe", "Task 084", "openWireframe"),
        sibling("open-live-preview", "Open Live Preview", "Task 160", "openLivePreview"),
      ], `Low-fi wireframe: ${node.wireframeLabel}`);
    case "cross_cutting_rule":
      return shell(node, [
        evidence(node),
        field("Rule", node.ruleId),
        field("Imperative", node.imperative),
        field("Tag scope", `${node.tagScope}: ${node.tags.join(", ")}`),
        field("Matched tasks", String(node.matchedTaskCount)),
      ], [], [
        sibling("show-matched", "Show matched tasks", "Task 153", "showMatchedTasks"),
        intent("edit-rule", "Edit rule", "change"),
      ], null);
    case "seam":
      return shell(node, [
        evidence(node),
        field("Connected features", node.features.join(", ")),
        field("Surfaces", node.surfaces.join(", ")),
        field("Seam template contract", node.templateContract),
        field("Failure modes", node.failureModes.join(", ")),
      ], [], [sibling("inspect-seam-tests", "Inspect seam tests", "Task 156", "inspectSeamTests")], null);
    case "research_fact":
      return shell(node, [
        evidence(node),
        field("Claim", node.claim),
        field("Doc quote", node.docQuote),
        field("Source URL", node.sourceUrl),
        field("docVersion", node.docVersion),
        field("Verification", node.dtsVerified ? "d.ts verified" : "d.ts not verified"),
      ], [], [
        sibling("refresh-fact", "Refresh fact", "Task 082", "refreshFact"),
        sibling("open-source", "Open source", "Task 082", "openSource"),
      ], null);
    case "task":
      return shell(node, [
        evidence(node),
        field("Worker", `${node.agentId} · ${node.shortTitle}`),
        field("Level", node.level),
        field("Lane", node.lane),
        field("Hold", node.hold.length > 0 ? node.hold : "none"),
        field("Write scope", node.writeScope.join(", ")),
      ], [], [
        sibling("open-worker", "Open Worker Inspector", "Task 126", "show"),
        sibling("pause", "Pause", "Task 126", "pause"),
        sibling("fixed-it", "I fixed it myself", "Task 126", "fixedItMyself"),
      ], null);
    case "check":
    case "oracle":
      return describeCheck(node);
    case "conflict":
      return shell(node, [
        evidence(node),
        field("Conflicting nodes", `${node.left.label} ↔ ${node.right.label}`),
        field("Z3 minimal UNSAT core", node.unsatCore),
        field("Counterexample", node.counterexample),
      ], [node.left, node.right], [
        sibling("resolve", "Resolve conflict now", "Task 081", "resolveConflict"),
      ], null);
    case "brand_asset":
      return shell(node, [
        evidence(node),
        field("Thumbnail", node.thumbnailLabel),
        field("License", node.licenseStatus),
      ], [], [sibling("swap-asset", "Swap asset", "Task 099", "swapAsset")], `Brand asset thumbnail: ${node.thumbnailLabel}`);
    case "brownfield_module":
      return shell(node, [
        evidence(node),
        field("Module level", node.level),
        field("file_rank", String(node.fileRank)),
        field("Exports", node.exports.join(", ")),
        field("Callers", node.callers.join(", ")),
      ], [], [sibling("inspect-callers", "Inspect callers", "Task 168", "inspectCallers")], null);
    default: {
      const unexpected: never = node;
      throw new Error(`Unsupported canvas node type: ${String(unexpected)}`);
    }
  }
}

function describeDecision(node: Extract<CanvasNode, { type: "decision" }>): Omit<PopoverModel, "canonical"> {
  const fields: PopoverField[] = [
    evidence(node),
    field("Settled value", node.settledValue),
    field("Basis", node.basis),
  ];
  const links: PremiseLink[] = [];
  const actions: PopoverAction[] = [
    intent("correct", "Correct (misheard)", "correct_misheard"),
    intent("change", "Change", "change"),
    intent("explain", "Explain impact", "explain_impact"),
  ];
  if (node.basis === "explicit") {
    fields.push(field("Verbatim quote", node.verbatimQuote), field("Locator", node.turnLocator));
  } else if (node.basis === "derived") {
    links.push(...node.premises);
    fields.push(field("Premises", node.premises.map((item) => item.label).join(", ")));
  } else {
    fields.push(field("Recommendation", CHOSEN_FOR_YOU));
    actions.unshift(sibling("override", "Override choice", "Task 156", "overrideChoice"));
  }
  return shell(node, fields, links, actions, null);
}

function describeCheck(node: CheckNode): Omit<PopoverModel, "canonical"> {
  const activeRetry = node.sealed && node.featureBuilding;
  const fields: PopoverField[] = [evidence(node)];
  if (activeRetry) {
    const status = node.pending ? "Pending" : node.verdict;
    fields.push(field("Summary", `Sealed check · ${node.caseCount} cases · ${node.family} · ${status}`));
  } else if (node.sealed) {
    fields.push(
      field("Summary", `Sealed — ${node.caseCount} diverse examples`),
      field("Verdict", node.verdict),
      field("Checked at", node.verdictAt),
    );
  } else {
    fields.push(
      field("Summary", node.visibleSummary),
      field("Verdict", node.verdict),
      field("Checked at", node.verdictAt),
    );
  }
  return shell(node, fields, [], [
    sibling("run-check", "Run check", "Task 126", "runCheck"),
    sibling("view-receipt", "View receipt", "Task 126", "viewReceipt"),
  ], null);
}

function shell(
  node: CanvasNode,
  fields: readonly PopoverField[],
  links: readonly PremiseLink[],
  actions: readonly PopoverAction[],
  thumbnailAlt: string | null,
): Omit<PopoverModel, "canonical"> {
  return {
    archived: false,
    nodeId: node.id,
    title: node.label,
    fields,
    links,
    actions: [pinAction(), ...actions],
    thumbnailAlt,
  };
}

function screenChecklist(states: readonly string[]): string {
  return SCREEN_STATES.map((state) => (states.includes(state) ? `${state} ✓` : `${state} — missing`)).join(", ");
}

function evidence(node: CanvasNode): PopoverField {
  return field("Evidence", `${node.evidence.quote} · ${node.evidence.locator}`);
}

function field(label: string, value: string): PopoverField {
  return { label, value };
}

function pinAction(): PopoverAction {
  return { id: "pin", label: "Pin to Inspector", kind: "pin", tokens: 0 };
}

function closeAction(): PopoverAction {
  return { id: "close", label: "Close", kind: "close", tokens: 0 };
}

function intent(id: string, label: string, name: BoxChatIntent): PopoverAction {
  return { id, label, kind: "intent", intent: name, tokens: 0 };
}

function sibling(id: string, label: string, siblingTask: string, method: string): PopoverAction {
  return { id, label, kind: "sibling", sibling: siblingTask, method, tokens: 0 };
}
