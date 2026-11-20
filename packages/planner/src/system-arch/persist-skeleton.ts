import { PHASE0_FOUNDATION, type SystemSkeleton } from "./types.js";
import type { EdgeDraft, NodeDraft } from "./state-db.js";

export interface SkeletonGraph {
  readonly nodes: readonly NodeDraft[];
  readonly edges: readonly EdgeDraft[];
}

export function skeletonDraft(
  skeleton: SystemSkeleton,
  seededIds: ReadonlySet<string>,
  observedIds: ReadonlySet<string> = new Set(),
): SkeletonGraph {
  const nodes: NodeDraft[] = [];
  const ids = new Set(seededIds);
  const featureIds = new Set(skeleton.feature_map.map((feature) => feature.id));
  const addNode = (node: NodeDraft): void => {
    nodes.push(node);
    ids.add(node.id);
  };

  for (const component of skeleton.components) {
    addNode(
      node(component.id, "arch_node", component.name, component.boundary, {
        feature: PHASE0_FOUNDATION,
        basis: observedIds.has(component.id) && component.action === "keep" ? "observed" : "derived",
        arch_role: "module",
        canonical_name: component.name,
        boundary: component.boundary,
        action: component.action,
      }),
    );
  }

  for (const item of skeleton.stack) {
    const id = `stack:${slug(item.name)}`;
    addNode(
      node(id, "arch_node", item.name, `${item.name} ${item.version}. ${item.boundary}`, {
        feature: PHASE0_FOUNDATION,
        basis: "derived",
        arch_role: "stack",
        canonical_name: slug(item.name),
        version: item.version,
        boundary: item.boundary,
      }),
    );
  }

  addNode(
    node("arch:topology", "arch_node", "Repository layout", topologyText(skeleton), {
      feature: PHASE0_FOUNDATION,
      basis: "derived",
      arch_role: "topology",
      directories: skeleton.topology.directories,
      packages: skeleton.topology.packages,
    }),
  );

  addNode(
    node("arch:auth", "arch_node", "Auth, tenant, and session", authText(skeleton), {
      feature: PHASE0_FOUNDATION,
      basis: "derived",
      arch_role: "auth",
      owner: PHASE0_FOUNDATION,
      model: skeleton.auth.model,
      tenant: skeleton.auth.tenant,
      session: skeleton.auth.session,
      contract_id: skeleton.auth.contract_id,
    }),
  );

  addNode(
    node("arch:conventions", "arch_node", "Shared conventions", conventionText(skeleton), {
      feature: PHASE0_FOUNDATION,
      basis: "derived",
      arch_role: "convention",
      error_envelope: skeleton.error_envelope,
      response_convention: skeleton.response_convention,
    }),
  );

  if (skeleton.env_manifest.length > 0) {
    addNode(
      node("arch:env-manifest", "arch_node", "Environment manifest", "Shared environment names", {
        feature: PHASE0_FOUNDATION,
        basis: "derived",
        arch_role: "convention",
        names: skeleton.env_manifest.map((item) => ({ kind: "env_var", value: item.name })),
      }),
    );
  }

  for (const feature of skeleton.feature_map) {
    const missingDeps = feature.depends_on.filter((id) => !ids.has(id) && !featureIds.has(id));
    const names = skeleton.routes
      .filter((route) => route.owner === feature.id)
      .map((route) => ({ kind: route.kind, value: route.value }));
    const fields: Record<string, unknown> = {
      feature: feature.id,
      basis: "derived",
      arch_role: "feature",
      owner: feature.id,
      owns: feature.owns,
    };
    if (names.length > 0) fields.names = names;
    if (missingDeps.length > 0) fields.depends_on = missingDeps;
    addNode(node(feature.id, "feature", feature.title, feature.title, fields));
  }

  for (const entity of skeleton.entities) {
    const missing = unresolved([entity.owner], ids);
    addNode(
      node(entity.id, "arch_node", entity.table, `${entity.table} owned by ${entity.owner}`, {
        feature: entity.owner,
        basis: "derived",
        arch_role: "entity",
        owner: entity.owner,
        table: entity.table,
        canonical_name: entity.table,
        columns: entity.fields.map((field) => ({
          name: field.name,
          type: field.type,
          nullable: field.nullable,
        })),
        relations: entity.relations,
        names: [
          { kind: "db_table", value: entity.table },
          ...entity.fields.map((field) => ({ kind: "db_column", value: `${entity.table}.${field.name}` })),
        ],
        ...(missing.length > 0 ? { unresolved_refs: missing } : {}),
      }),
    );
  }

  const contracts = [...skeleton.contracts];
  if (!contracts.some((contract) => contract.id === skeleton.auth.contract_id)) {
    contracts.push({
      id: skeleton.auth.contract_id,
      producer: PHASE0_FOUNDATION,
      consumers: [skeleton.feature_map[0]?.id ?? PHASE0_FOUNDATION],
      schema: `${skeleton.auth.model}; ${skeleton.auth.session}`,
    });
  }
  for (const contract of contracts) {
    const missing = unresolved([contract.producer, ...contract.consumers], ids);
    addNode(
      node(contract.id, "contract", contract.id, contract.schema, {
        feature: contract.producer,
        basis: "derived",
        owner: contract.producer,
        schema_text: contract.schema,
        auth_contract: contract.id === skeleton.auth.contract_id || contract.id.includes("auth"),
        ...(missing.length > 0 ? { unresolved_refs: missing } : {}),
      }),
    );
  }

  for (const rule of skeleton.rules) {
    if (ids.has(rule.id)) continue;
    addNode(
      node(rule.id, "rule", rule.id, rule.text, {
        feature: PHASE0_FOUNDATION,
        basis: "explicit",
        system_rule: true,
        scope_predicate: rule.scope_predicate,
        check_kind: rule.check_kind,
      }),
    );
  }

  for (const seam of skeleton.seams) {
    const missing = unresolved([seam.from, seam.to, seam.contract_id], ids);
    addNode(
      node(seam.id, "arch_node", seam.id, `${seam.from} to ${seam.to} via ${seam.contract_id}`, {
        feature: seam.from,
        basis: "derived",
        arch_role: "seam",
        owner: seam.from,
        contract_id: seam.contract_id,
        ...(missing.length > 0 ? { unresolved_refs: missing } : {}),
      }),
    );
  }

  for (const diagram of skeleton.diagrams) {
    addNode(
      node(diagram.id, "arch_node", diagram.id, diagram.source, {
        feature: PHASE0_FOUNDATION,
        basis: "derived",
        arch_role: "diagram",
        diagram_kind: diagram.kind,
      }),
    );
  }

  for (const adr of skeleton.adrs) {
    const missing = unresolved(adr.justified_by, ids);
    addNode(
      node(adr.id, "decision", adr.title, adr.choice, {
        feature: PHASE0_FOUNDATION,
        basis: "derived",
        arch_role: "adr",
        adr: true,
        justified_by: adr.justified_by,
        ...(missing.length > 0 ? { unresolved_refs: missing } : {}),
      }),
    );
  }

  for (const event of skeleton.events) {
    const missing = unresolved([event.owner], ids);
    addNode(
      node(event.id, "arch_node", event.name, event.name, {
        feature: event.owner,
        basis: "derived",
        arch_role: "event",
        owner: event.owner,
        names: [{ kind: "event", value: event.name }],
        ...(missing.length > 0 ? { unresolved_refs: missing } : {}),
      }),
    );
  }

  const edges: EdgeDraft[] = [];
  const seen = new Set<string>();
  const addEdge = (src: string, type: string, dst: string): void => {
    if (!ids.has(src) || !ids.has(dst)) return;
    const key = `${src}\u0000${type}\u0000${dst}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ src, type, dst });
  };

  for (const feature of skeleton.feature_map) {
    for (const dependency of feature.depends_on) addEdge(feature.id, "depends_on", dependency);
    for (const requirement of feature.requirements) addEdge(feature.id, "implements", requirement);
  }
  for (const entity of skeleton.entities) {
    addEdge(entity.id, "belongs_to", entity.owner);
    for (const relation of entity.relations) addEdge(entity.id, "depends_on", relation.target);
  }
  for (const contract of contracts) {
    addEdge(contract.producer, "produces_contract", contract.id);
    for (const consumer of contract.consumers) addEdge(consumer, "consumes_contract", contract.id);
  }
  for (const seam of skeleton.seams) addEdge(seam.id, "belongs_to", seam.contract_id);
  for (const adr of skeleton.adrs) {
    for (const source of adr.justified_by) addEdge(adr.id, "justified_by", source);
  }
  for (const event of skeleton.events) addEdge(event.id, "belongs_to", event.owner);

  return { nodes, edges };
}

function node(
  id: string,
  kind: string,
  title: string,
  text: string,
  fields: Record<string, unknown>,
): NodeDraft {
  const owner = typeof fields.owner === "string" ? fields.owner : null;
  if (owner === null) return { id, kind, title, text, fields };
  return { id, kind, title, text, fields, ownerRole: owner };
}

function unresolved(refs: readonly string[], ids: ReadonlySet<string>): string[] {
  return refs.filter((id) => !ids.has(id));
}

function topologyText(skeleton: SystemSkeleton): string {
  const directories = skeleton.topology.directories.join(", ");
  const packages = skeleton.topology.packages.map((item) => `${item.name} ${item.path} ${item.runtime}`).join("; ");
  return `Directories: ${directories}. Packages: ${packages}.`;
}

function authText(skeleton: SystemSkeleton): string {
  return `${skeleton.auth.model} for tenant ${skeleton.auth.tenant}. Session: ${skeleton.auth.session}.`;
}

function conventionText(skeleton: SystemSkeleton): string {
  return [
    ...skeleton.conventions,
    `Errors: ${skeleton.error_envelope}`,
    `Responses: ${skeleton.response_convention}`,
  ].join(" ");
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
