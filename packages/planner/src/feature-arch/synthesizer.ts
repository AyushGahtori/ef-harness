import { normalizeSpace, sha256, unique } from "./canonical.js";
import { applyCollisionPolicy } from "./collisions.js";
import { DeterministicArchConsistencyGate } from "./consistency-gate.js";
import { parseFeatureArchitectV1 } from "./feature-architect-schema.js";
import { makeNode } from "./graph.js";
import { issue } from "./issues.js";
import { ArchDocumentSharder } from "./sharder.js";
import { ScreenSpecSignoff } from "./signoff.js";
import { seamById } from "./seams.js";
import { ScreenSpecGenerator } from "./screen-spec.js";
import { SkeletonLockEnforcer } from "./skeleton-lock.js";
import { ObservedCodeRealityAnchor } from "./reality-anchor.js";
import { LowFiWireframeRenderer } from "./wireframe.js";
import {
  FEATURE_ARCH_PAPERWORK_SHARE,
  type AnchorSubstitution,
  type ArchIssue,
  type CcrProposal,
  type EdgeType,
  type FeatureArchitectV1,
  type FeatureInput,
  type GraphEdge,
  type GraphNode,
  type HandlingEntry,
  type ObservedReality,
  type SchemaDelta,
  type ScreenContext,
  type ScreenSpec,
  type SynthesisRequest,
  type SynthesisResult,
  type WireframePair,
} from "./types.js";

interface HoistedRule {
  id: string;
  text: string;
  featureIds: string[];
}

export class JitFeatureArchitectureSynthesizer {
  private readonly screens = new ScreenSpecGenerator();
  private readonly wireframes = new LowFiWireframeRenderer();
  private readonly sharder = new ArchDocumentSharder();
  private readonly gate = new DeterministicArchConsistencyGate();
  private readonly locks = new SkeletonLockEnforcer();
  private readonly anchor = new ObservedCodeRealityAnchor();
  private readonly signoff = new ScreenSpecSignoff();

  synthesize(request: SynthesisRequest): SynthesisResult {
    const waveIssue = this.waveIssue(request.mergedWave, request.targetWave);
    if (waveIssue) return this.rejected(request, [waveIssue], [], null, [], 0, this.ceiling(request) ?? 0);
    const ceiling = this.ceiling(request);
    if (ceiling === null) {
      return this.rejected(
        request,
        [issue("invalid_budget", "waveTokenBudget must be a finite number >= 0.")],
        [],
        null,
        [],
        0,
        0,
      );
    }
    if (request.features.length === 0) {
      return this.rejected(request, [issue("empty_wave", "A wave needs at least one feature.")], [], null, [], 0, ceiling);
    }
    if (request.targetWave >= 2 && !request.integrationRoot) {
      return this.rejected(
        request,
        [issue("missing_integration_reality", "Wave N+1 feature architecture requires the merged harness/integration tree.")],
        [],
        null,
        [],
        0,
        ceiling,
      );
    }

    let observed: ObservedReality | null = null;
    if (request.targetWave >= 2 && request.integrationRoot) {
      const scanned = this.anchor.scan(request.integrationRoot);
      if (!scanned.ok) {
        return this.rejected(
          request,
          [issue("missing_integration_reality", scanned.reason)],
          [],
          null,
          [],
          0,
          ceiling,
        );
      }
      observed = scanned.reality;
    }

    const issues: ArchIssue[] = [];
    const anchored: AnchorSubstitution[] = [];
    let working = request.features.map((feature) => ({
      ...feature,
      writePaths: feature.writePaths.map((item) => item),
    }));
    if (observed) {
      working = working.map((feature) => {
        const bound = this.anchor.bind(feature, observed as ObservedReality);
        anchored.push(...bound.substitutions);
        issues.push(...bound.issues);
        return bound.feature;
      });
    }
    const collision = applyCollisionPolicy(working, request.collisionPolicy ?? "reject");
    working = collision.features;
    const hoisted = collectHoisted(working);
    const ccrs = this.locks.check(
      working.flatMap((feature) => feature.schemaDeltas),
      request.skeleton,
    ).ccrProposals;

    const built = this.build(
      request,
      working,
      observed,
      hoisted,
      collision.hoistedFeatureIds,
      collision.sharedWritePaths,
      anchored,
      issues,
    );
    issues.push(
      ...this.gate.check({
        nodes: built.nodes,
        edges: built.edges,
        skeleton: request.skeleton,
        existingNames: request.existingNames ?? [],
      }).issues,
    );
    const shardSet = this.sharder.shard(built.nodes);
    if (shardSet.duplicatedNodeIds.length > 0 || shardSet.overCeiling.length > 0) {
      issues.push(
        issue(
          "shard_invariant",
          `Document shards duplicated ${shardSet.duplicatedNodeIds.join(", ") || "none"} and exceeded the ceiling at ${shardSet.overCeiling.join(", ") || "none"}.`,
        ),
      );
    }
    const paperworkTokens = shardSet.shards.reduce((sum, shard) => sum + shard.tokens, 0);
    if (paperworkTokens > ceiling) {
      issues.push(
        issue(
          "paperwork_budget",
          `Feature architecture paperwork is ${paperworkTokens} tokens, above the 5% ceiling of ${ceiling}.`,
        ),
      );
    }
    if (issues.length > 0) {
      return this.rejected(
        request,
        issues,
        anchored,
        observed,
        collision.sharedWritePaths,
        paperworkTokens,
        ceiling,
        ccrs,
      );
    }
    const signoff = built.specs.flatMap((spec) => {
      const wireframe = built.wireframes.find((item) => item.screenId === spec.id);
      return wireframe ? [this.signoff.revision(spec, wireframe)] : [];
    });
    return {
      status: "accepted",
      persisted: true,
      issues: [],
      wave: request.targetWave,
      anchored,
      observed,
      architectOutputs: built.outputs,
      nodes: built.nodes,
      edges: built.edges,
      shards: shardSet.shards,
      wireframes: built.wireframes,
      screenSpecs: built.specs,
      signoff,
      paperworkTokens,
      paperworkCeiling: ceiling,
      ccrProposals: ccrs,
      sharedWritePaths: collision.sharedWritePaths,
    };
  }

  private ceiling(request: SynthesisRequest): number | null {
    if (!Number.isFinite(request.waveTokenBudget) || request.waveTokenBudget < 0) return null;
    return Math.floor(request.waveTokenBudget * FEATURE_ARCH_PAPERWORK_SHARE);
  }

  private waveIssue(mergedWave: number, targetWave: number): ArchIssue | null {
    if (!Number.isInteger(mergedWave) || mergedWave < 0 || !Number.isInteger(targetWave) || targetWave < 1) {
      return issue("invalid_wave", "mergedWave must be an integer >= 0 and targetWave an integer >= 1.");
    }
    if (targetWave !== mergedWave + 1) {
      return issue(
        "premature_wave",
        `Feature architecture is only synthesized one wave ahead (wave ${mergedWave + 1}). Wave ${targetWave} is premature.`,
      );
    }
    return null;
  }

  private rejected(
    request: SynthesisRequest,
    issues: ArchIssue[],
    anchored: AnchorSubstitution[],
    observed: ObservedReality | null,
    sharedWritePaths: SynthesisResult["sharedWritePaths"],
    paperworkTokens: number,
    paperworkCeiling: number,
    ccrProposals: CcrProposal[] = [],
  ): SynthesisResult {
    return {
      status: "rejected",
      persisted: false,
      issues,
      wave: request.targetWave,
      anchored,
      observed,
      architectOutputs: [],
      nodes: [],
      edges: [],
      shards: [],
      wireframes: [],
      screenSpecs: [],
      signoff: [],
      paperworkTokens,
      paperworkCeiling,
      ccrProposals,
      sharedWritePaths,
    };
  }

  private build(
    request: SynthesisRequest,
    features: readonly FeatureInput[],
    observed: ObservedReality | null,
    hoisted: readonly HoistedRule[],
    hoistedFeatureIds: readonly string[],
    sharedWritePaths: SynthesisResult["sharedWritePaths"],
    anchored: readonly AnchorSubstitution[],
    issues: ArchIssue[],
  ): {
    nodes: GraphNode[];
    edges: GraphEdge[];
    specs: ScreenSpec[];
    wireframes: WireframePair[];
    outputs: FeatureArchitectV1[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const specs: ScreenSpec[] = [];
    const wireframes: WireframePair[] = [];
    const outputs: FeatureArchitectV1[] = [];
    const ids = new Set<string>();
    const add = (node: GraphNode): void => {
      if (ids.has(node.id)) {
        issues.push(issue("duplicate_id", `Duplicate node id ${node.id}.`, { nodeId: node.id }));
        return;
      }
      ids.add(node.id);
      nodes.push(node);
    };
    const link = (src: string, type: EdgeType, dst: string): void => {
      edges.push({ src, type, dst });
    };

    for (const known of request.knownFeatureIds ?? []) {
      if (features.some((feature) => feature.id === known)) continue;
      add(
        makeNode({
          id: known,
          kind: "feature",
          title: known,
          text: `Known feature ${known} from an earlier wave.`,
          fields: {
            role: "feature",
            basis: "observed",
            featureSlug: "system",
            feature: known,
            ownerId: known,
            external: true,
          },
        }),
      );
    }
    for (const rule of hoisted) {
      add(
        makeNode({
          id: rule.id,
          kind: "rule",
          title: rule.id,
          text: rule.text,
          fields: {
            role: "hoisted_rule",
            basis: "derived",
            featureSlug: "system",
            feature: "phase0-foundation",
            owner: "phase0-foundation",
            ownerId: "phase0-foundation",
            featureIds: rule.featureIds,
            hoisted: true,
            classification: "cross_cutting",
          },
        }),
      );
    }
    for (const shared of sharedWritePaths) {
      add(
        makeNode({
          id: `SHARED-${sha256(shared.path.toLowerCase()).slice(0, 12)}`,
          kind: "arch_node",
          title: shared.path,
          text: `Shared module ${shared.path} is owned by phase0-foundation.`,
          fields: {
            role: "shared_file",
            basis: "derived",
            featureSlug: "system",
            feature: "phase0-foundation",
            owner: "phase0-foundation",
            ownerId: "phase0-foundation",
            writePath: shared.path,
          },
        }),
      );
    }
    for (const requirement of request.requirements) {
      const owner = features.find((feature) => feature.requirements.includes(requirement.id));
      add(
        makeNode({
          id: requirement.id,
          kind: "spec_item",
          title: requirement.id,
          text: requirement.text,
          fields: {
            role: "requirement",
            catalogRequirement: true,
            basis: "explicit",
            featureSlug: owner?.slug ?? "system",
            feature: owner?.id ?? "phase0-foundation",
            ownerId: owner?.id ?? "phase0-foundation",
          },
        }),
      );
    }

    const seenFeature = new Set<string>();
    const seenSlug = new Set<string>();
    for (const feature of features) {
      if (seenFeature.has(feature.id)) {
        issues.push(issue("duplicate_feature", `Feature id ${feature.id} is duplicated.`, { featureId: feature.id }));
        continue;
      }
      seenFeature.add(feature.id);
      if (seenSlug.has(feature.slug)) {
        issues.push(issue("duplicate_slug", `Feature slug ${feature.slug} is duplicated.`, { featureId: feature.id }));
      }
      seenSlug.add(feature.slug);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.slug)) {
        issues.push(issue("invalid_slug", `Feature ${feature.id} slug is not a lowercase slug.`, { featureId: feature.id }));
      }
      this.checkCompleteness(feature, hoistedFeatureIds, issues);
      const context: ScreenContext = {
        featureId: feature.id,
        featureSlug: feature.slug,
        surface: feature.surface,
        tags: feature.tags,
      };
      if (observed) context.observedPrimitives = unique(observed.components.map((item) => item.name));
      const generated = this.screens.generate(feature.screens, context);
      const featureSpecs = generated.ok ? generated.specs : [];
      if (!generated.ok) {
        for (const problem of generated.issues) {
          issues.push(issue("screen_spec", problem, { featureId: feature.id }));
        }
      }
      specs.push(...featureSpecs);
      for (const spec of featureSpecs) wireframes.push(this.wireframes.render(spec));

      const linked: string[] = [];
      const handling: HandlingEntry[] = [];
      const registered: { kind: string; name: string }[] = [];
      for (const spec of featureSpecs) {
        linked.push(spec.id);
        registered.push({ kind: "page_route", name: spec.route });
      }
      for (const endpoint of feature.endpoints) {
        linked.push(endpoint.id);
        registered.push({ kind: "http_route", name: `${endpoint.method} ${endpoint.path}` });
      }
      for (const delta of feature.schemaDeltas) {
        if (delta.op === "add_table") registered.push({ kind: "db_table", name: delta.table });
        if (delta.op === "add_column") {
          registered.push({ kind: "db_column", name: `${delta.table}.${delta.column.name}` });
        }
      }
      for (const [index] of feature.writePaths.entries()) linked.push(`FILE-${feature.id}-${index}`);
      for (const [index] of feature.schemaDeltas.entries()) linked.push(`SCHEMA-${feature.id}-${index}`);
      for (const [index, binding] of feature.seams.entries()) linked.push(`SEAM-${feature.id}-${binding.templateId}-${index}`);
      linked.push(`FLOW-${feature.id}`, `SM-${feature.id}`, `JOURNEY-${feature.id}`);
      for (const [index] of feature.failureModes.entries()) linked.push(`FAIL-${feature.id}-${index}`);
      for (const item of feature.specItems) linked.push(item.id);
      for (const item of feature.edgeCases) linked.push(item.id);
      for (const command of feature.cliCommands) linked.push(`CLI-${slugify(command.name)}`);
      for (const requirementId of feature.requirements) linked.push(requirementId);
      for (const rule of feature.rules) {
        if (!isHoisted(rule.text, hoisted)) linked.push(rule.id);
      }
      for (const rule of hoisted) {
        if (rule.featureIds.includes(feature.id)) linked.push(rule.id);
      }
      for (const shared of sharedWritePaths) {
        if (hoistedFeatureIds.includes(feature.id)) linked.push(`SHARED-${sha256(shared.path.toLowerCase()).slice(0, 12)}`);
      }
      if (observed) linked.push(`ANCHOR-${feature.id}`);

      add(
        makeNode({
          id: feature.id,
          kind: "feature",
          title: feature.title,
          text: `${feature.surface} feature ${feature.id} in wave ${request.targetWave}.`,
          fields: {
            role: "feature",
            basis: "derived",
            featureSlug: feature.slug,
            feature: feature.id,
            ownerId: feature.id,
            registeredNames: registered,
            ...(registered.length > 0
              ? { names: registered.map((item) => ({ kind: item.kind, value: item.name })) }
              : {}),
            linkedNodeIds: linked,
          },
        }),
      );
      for (const dependency of feature.dependsOn) link(feature.id, "depends_on", dependency);
      for (const requirementId of feature.requirements) {
        link(feature.id, "implements", requirementId);
        handling.push({ spec_item_or_edge_case: requirementId, node_id: feature.id });
      }
      for (const [index, writePath] of feature.writePaths.entries()) {
        const id = `FILE-${feature.id}-${index}`;
        add(
          makeNode({
            id,
            kind: "arch_node",
            title: writePath,
            text: `Owns ${writePath}.`,
            fields: {
              role: "file_boundary",
              basis: "derived",
              featureSlug: feature.slug,
              feature: feature.id,
              featureId: feature.id,
              ownerId: feature.id,
              writePath,
            },
          }),
        );
        link(id, "belongs_to", feature.id);
      }
      for (const [index, delta] of feature.schemaDeltas.entries()) {
        const id = `SCHEMA-${feature.id}-${index}`;
        const tableName = tableOf(delta);
        const observedColumns = observed?.tables.find((table) => table.name === tableName)?.columns.map((column) => column.name);
        const fields: Record<string, unknown> = {
          role: "schema_delta",
          basis: "derived",
          featureSlug: feature.slug,
          feature: feature.id,
          ownerId: feature.id,
          delta,
        };
        if (observedColumns) fields.observedColumns = observedColumns;
        add(
          makeNode({
            id,
            kind: "arch_node",
            title: id,
            text: describeDelta(delta),
            fields,
          }),
        );
        link(id, "belongs_to", feature.id);
      }
      for (const endpoint of feature.endpoints) {
        add(
          makeNode({
            id: endpoint.id,
            kind: "contract",
            title: `${endpoint.method} ${endpoint.path}`,
            text: `${endpoint.method} ${endpoint.path} request ${endpoint.request} response ${endpoint.response} errors ${endpoint.errors.join(", ")}.`,
            fields: {
              role: "contract",
              basis: "derived",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
              slug: slugify(endpoint.id),
              method: endpoint.method,
              path: endpoint.path,
              request: endpoint.request,
              response: endpoint.response,
              errors: endpoint.errors,
            },
          }),
        );
        link(feature.id, "produces_contract", endpoint.id);
      }
      for (const [index, binding] of feature.seams.entries()) {
        const template = seamById(binding.templateId);
        const sharedKind = binding.sharedKind ?? template?.shared[0] ?? "endpoint";
        const id = `SEAM-${feature.id}-${binding.templateId}-${index}`;
        add(
          makeNode({
            id,
            kind: "arch_node",
            title: template?.name ?? binding.templateId,
            text: `${binding.templateId} ${template?.name ?? "unknown"}. ${template?.contractShape ?? "Unknown seam template."} Shared ${sharedKind} ${binding.sharedName} with ${binding.peer}.`,
            fields: {
              role: "seam_binding",
              basis: "derived",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
              templateId: binding.templateId,
              sharedKind,
              sharedName: binding.sharedName,
              peer: binding.peer,
            },
          }),
        );
        link(id, "belongs_to", feature.id);
      }
      add(
        makeNode({
          id: `FLOW-${feature.id}`,
          kind: "arch_node",
          title: `Flow ${feature.id}`,
          text: `Sequence diagram for ${feature.id}.`,
          fields: {
            role: "flow",
            basis: "derived",
            featureSlug: feature.slug,
            feature: feature.id,
            ownerId: feature.id,
            mermaid: feature.sequenceMermaid,
            mermaidKind: "sequence",
          },
        }),
      );
      link(`FLOW-${feature.id}`, "belongs_to", feature.id);
      add(
        makeNode({
          id: `SM-${feature.id}`,
          kind: "arch_node",
          title: `States ${feature.id}`,
          text: `States ${feature.transitions.map((item) => `${item.from} to ${item.to} on ${item.event}`).join("; ")}. Failures ${feature.failureModes.join("; ")}.`,
          fields: {
            role: "state_machine",
            basis: "derived",
            featureSlug: feature.slug,
            feature: feature.id,
            ownerId: feature.id,
            mermaid: feature.stateMermaid,
            mermaidKind: "state",
            transitions: feature.transitions,
            failureModes: feature.failureModes,
          },
        }),
      );
      link(`SM-${feature.id}`, "belongs_to", feature.id);
      add(
        makeNode({
          id: `JOURNEY-${feature.id}`,
          kind: "journey",
          title: `Journey ${feature.id}`,
          text: feature.journey.join(" "),
          fields: {
            role: "journey",
            basis: "derived",
            featureSlug: feature.slug,
            feature: feature.id,
            ownerId: feature.id,
          },
        }),
      );
      link(`JOURNEY-${feature.id}`, "belongs_to", feature.id);
      for (const [index, failure] of feature.failureModes.entries()) {
        const id = `FAIL-${feature.id}-${index}`;
        add(
          makeNode({
            id,
            kind: "edge_case",
            title: failure,
            text: failure,
            fields: {
              role: "edge_case",
              basis: "explicit",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
            },
          }),
        );
        link(feature.id, "handles_edge_case", id);
        handling.push({ spec_item_or_edge_case: id, node_id: `SM-${feature.id}` });
      }
      for (const item of feature.specItems) {
        add(
          makeNode({
            id: item.id,
            kind: "spec_item",
            title: item.id,
            text: item.text,
            fields: {
              role: "spec_item",
              basis: "explicit",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
            },
          }),
        );
        link(feature.id, "implements", item.id);
        handling.push({ spec_item_or_edge_case: item.id, node_id: feature.id });
      }
      for (const item of feature.edgeCases) {
        add(
          makeNode({
            id: item.id,
            kind: "edge_case",
            title: item.id,
            text: item.text,
            fields: {
              role: "edge_case",
              basis: "explicit",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
            },
          }),
        );
        link(feature.id, "handles_edge_case", item.id);
        handling.push({ spec_item_or_edge_case: item.id, node_id: `SM-${feature.id}` });
      }
      for (const spec of featureSpecs) {
        add(
          makeNode({
            id: spec.id,
            kind: "arch_node",
            title: spec.title,
            text: screenText(spec),
            fields: {
              role: "screen_spec",
              basis: "derived",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
              slug: spec.slug,
              spec,
            },
          }),
        );
        link(spec.id, "belongs_to", feature.id);
      }
      for (const command of feature.cliCommands) {
        const id = `CLI-${slugify(command.name)}`;
        add(
          makeNode({
            id,
            kind: "arch_node",
            title: command.name,
            text: `${command.name}: ${command.summary}`,
            fields: {
              role: "cli_command",
              basis: "derived",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
              slug: slugify(command.name),
            },
          }),
        );
        link(id, "belongs_to", feature.id);
      }
      for (const rule of feature.rules) {
        if (isHoisted(rule.text, hoisted)) continue;
        const fields: Record<string, unknown> = {
          role: "rule",
          basis: "derived",
          featureSlug: feature.slug,
          feature: feature.id,
          ownerId: feature.id,
          featureIds: [feature.id],
          hoisted: false,
          classification: rule.crossCutting ? "cross_cutting" : "local",
        };
        if (rule.localReason) fields.reason = rule.localReason;
        add(makeNode({ id: rule.id, kind: "rule", title: rule.id, text: rule.text, fields }));
        link(feature.id, "obeys", rule.id);
      }
      for (const rule of hoisted) {
        if (!rule.featureIds.includes(feature.id)) continue;
        link(feature.id, "obeys", rule.id);
      }
      if (observed) {
        add(
          makeNode({
            id: `ANCHOR-${feature.id}`,
            kind: "arch_node",
            title: `Reality ${feature.id}`,
            text: anchorText(feature.id, anchored, observed),
            fields: {
              role: "reality_anchor",
              basis: "observed",
              featureSlug: feature.slug,
              feature: feature.id,
              ownerId: feature.id,
              bound: anchored.filter((item) => item.featureId === feature.id),
            },
          }),
        );
        link(`ANCHOR-${feature.id}`, "belongs_to", feature.id);
      }
      const output = architectOutput(feature, featureSpecs, handling, hoisted);
      const parsed = parseFeatureArchitectV1(output);
      if (!parsed.ok) {
        issues.push(issue("schema_invalid", parsed.issues.join("; "), { featureId: feature.id }));
      } else if ("blocked" in parsed.value) {
        issues.push(issue("schema_invalid", parsed.value.reason, { featureId: feature.id }));
      } else {
        outputs.push(parsed.value);
      }
    }
    return { nodes, edges, specs, wireframes, outputs };
  }

  private checkCompleteness(
    feature: FeatureInput,
    hoistedFeatureIds: readonly string[],
    issues: ArchIssue[],
  ): void {
    if (feature.writePaths.length === 0 && !hoistedFeatureIds.includes(feature.id)) {
      issues.push(issue("missing_write_path", `Feature ${feature.id} has no owned write path.`, { featureId: feature.id }));
    }
    if (feature.seams.length === 0) {
      issues.push(issue("missing_seam", `Feature ${feature.id} has no seam binding.`, { featureId: feature.id }));
    }
    if (feature.transitions.length === 0 || feature.failureModes.length === 0 || feature.journey.length === 0) {
      issues.push(
        issue("incomplete_feature", `Feature ${feature.id} needs a journey, state transitions, and failure modes.`, {
          featureId: feature.id,
        }),
      );
    }
    if (!feature.sequenceMermaid.trim() || !feature.stateMermaid.trim()) {
      issues.push(issue("incomplete_feature", `Feature ${feature.id} needs sequence and state diagrams.`, { featureId: feature.id }));
    }
    if ((feature.surface === "web" || feature.surface === "api") && feature.endpoints.length === 0) {
      issues.push(issue("missing_endpoint", `Feature ${feature.id} needs request, response, and error schemas.`, { featureId: feature.id }));
    }
    if (feature.surface === "cli" && feature.cliCommands.length === 0) {
      issues.push(issue("missing_cli", `Feature ${feature.id} needs a CLI command spec.`, { featureId: feature.id }));
    }
    if (feature.surface === "headless" && feature.endpoints.length === 0 && feature.cliCommands.length === 0) {
      issues.push(
        issue("missing_interface", `Feature ${feature.id} needs a CLI command or an API endpoint spec.`, {
          featureId: feature.id,
        }),
      );
    }
  }
}

function collectHoisted(features: readonly FeatureInput[]): HoistedRule[] {
  const groups = new Map<string, { text: string; featureIds: string[] }>();
  for (const feature of features) {
    for (const rule of feature.rules) {
      if (!rule.crossCutting) continue;
      const key = normalizeSpace(rule.text);
      const group = groups.get(key) ?? { text: rule.text.trim(), featureIds: [] };
      if (!group.featureIds.includes(feature.id)) group.featureIds.push(feature.id);
      groups.set(key, group);
    }
  }
  const hoisted: HoistedRule[] = [];
  for (const group of groups.values()) {
    if (group.featureIds.length < 2) continue;
    hoisted.push({
      id: `RULE-${sha256(normalizeSpace(group.text)).slice(0, 12)}`,
      text: group.text,
      featureIds: group.featureIds,
    });
  }
  return hoisted;
}

function isHoisted(text: string, hoisted: readonly HoistedRule[]): boolean {
  const key = normalizeSpace(text);
  return hoisted.some((rule) => normalizeSpace(rule.text) === key);
}

function architectOutput(
  feature: FeatureInput,
  screens: ScreenSpec[],
  handling: HandlingEntry[],
  hoisted: readonly HoistedRule[],
): FeatureArchitectV1 {
  return {
    flows: [{ id: `FLOW-${feature.id}`, steps: feature.journey.map((step) => step.trim()).filter((step) => step !== "") }],
    screens,
    state_machines: [
      {
        id: `SM-${feature.id}`,
        mermaid: feature.stateMermaid.trim(),
        transitions: feature.transitions,
        failureModes: feature.failureModes.map((item) => item.trim()).filter((item) => item !== ""),
      },
    ],
    internal_contracts: feature.endpoints.map((endpoint) => ({
      id: endpoint.id,
      request: endpoint.request,
      response: endpoint.response,
      errors: endpoint.errors,
    })),
    handling,
    hoisted_rules: hoisted
      .filter((rule) => rule.featureIds.includes(feature.id))
      .map((rule) => ({ id: rule.id, text: rule.text, classification: "cross_cutting" as const })),
  };
}

function screenText(spec: ScreenSpec): string {
  return [
    `Screen ${spec.title} at ${spec.route} for ${spec.roles.join(", ")}.`,
    `Template ${spec.templateId}.`,
    `States ${spec.states.join(", ")}.`,
    `Labels ${spec.labels.map((label) => `${label.id}=${label.text}`).join("; ")}.`,
    `Copy ${spec.copyConstraints.join(" ")}`,
    `Keyboard ${spec.keyboardOrder.join(", ") || "none"}.`,
    `Endpoints ${spec.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(", ")}.`,
  ].join(" ");
}

function anchorText(featureId: string, anchored: readonly AnchorSubstitution[], reality: ObservedReality): string {
  const parts: string[] = [];
  for (const item of anchored) {
    if (item.featureId !== featureId) continue;
    parts.push(`Bound ${item.kind} ${item.actualName} in ${item.file}.`);
  }
  for (const table of reality.tables) {
    parts.push(
      `Observed table ${table.name} columns ${table.columns.map((column) => `${column.name} ${column.type}`).join(", ")}.`,
    );
  }
  if (reality.components.length > 0) {
    parts.push(`Observed components ${reality.components.map((item) => item.name).join(", ")}.`);
  }
  return parts.join(" ") || "Observed merged tree.";
}

function describeDelta(delta: SchemaDelta): string {
  switch (delta.op) {
    case "add_table":
      return `Add table ${delta.table} with columns ${delta.columns.map((column) => column.name).join(", ")}.`;
    case "add_column":
      return `Add column ${delta.table}.${delta.column.name} ${delta.column.type}.`;
    case "drop_column":
      return `Drop column ${delta.table}.${delta.column}.`;
    case "rename_column":
      return `Rename column ${delta.table}.${delta.from} to ${delta.to}.`;
    case "change_type":
      return `Change ${delta.table}.${delta.column} to ${delta.toType}.`;
    case "drop_table":
      return `Drop table ${delta.table}.`;
    default: {
      const unreachable: never = delta;
      return unreachable;
    }
  }
}

function tableOf(delta: SchemaDelta): string {
  return delta.table;
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "item";
}
