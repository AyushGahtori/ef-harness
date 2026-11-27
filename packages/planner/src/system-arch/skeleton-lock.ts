import { readString, type ArchitectureStore, type GraphNode } from "./state-db.js";

/** Read surface shared by system architecture and feature architecture. */
export interface SkeletonLockReader {
  getMeta(key: string): string | null;
  listNodes(): readonly GraphNode[];
  getNode(id: string): GraphNode | null | undefined;
}

export type SkeletonMutation =
  | {
      readonly kind: "add_table";
      readonly table: string;
      readonly owner: string;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "add_column";
      readonly table: string;
      readonly column: string;
      readonly columnType: string;
      readonly nullable: boolean;
      readonly hasDefault: boolean;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "add_endpoint";
      readonly path: string;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "add_event";
      readonly name: string;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "change_type";
      readonly table: string;
      readonly column: string;
      readonly fromType: string;
      readonly toType: string;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "rename";
      readonly target: string;
      readonly fromName: string;
      readonly toName: string;
      readonly wave: number;
      readonly ccrId?: string;
    }
  | {
      readonly kind: "delete";
      readonly target: string;
      readonly wave: number;
      readonly ccrId?: string;
    };

export interface LockDecision {
  readonly allowed: boolean;
  readonly classification: "unlocked" | "additive" | "breaking";
  readonly route: "none" | "ccr" | "revision";
  readonly reason: string;
  readonly ccrTask: "Task-112";
  readonly revisionTask: "Task-087";
}

export class SkeletonLockEnforcer {
  lock(store: ArchitectureStore, now = Date.now()): void {
    const stamped = store
      .listNodes()
      .filter((node) => node.status === "active" && isLockedElement(node))
      .map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        status: node.status as "active",
        ownerRole: node.fields.owner === undefined ? null : String(node.fields.owner),
        fields: { ...node.fields, skeleton_locked: true },
      }));
    if (stamped.length > 0) {
      store.commitChangeSet(
        {
          author: "system-architect@1",
          summary: "lock system skeleton",
          nodes: stamped,
        },
        now,
      );
    }
    store.setMeta("skeleton_locked", "true");
  }

  evaluate(store: SkeletonLockReader, mutation: SkeletonMutation): LockDecision {
    if (store.getMeta("skeleton_locked") !== "true") {
      return decision(true, "unlocked", "none", `Wave ${mutation.wave} is before the skeleton lock.`);
    }
    const breaking = isBreaking(store, mutation);
    if (!breaking) {
      return decision(true, "additive", "none", `Wave ${mutation.wave} ${mutation.kind} is additive on the locked skeleton.`);
    }
    const ccrId = "ccrId" in mutation ? mutation.ccrId?.trim() : undefined;
    if (ccrId) {
      return decision(
        true,
        "breaking",
        "ccr",
        `Wave ${mutation.wave} ${mutation.kind} is breaking and is routed through CCR ${ccrId} (Task-112) or Revision Task-087.`,
      );
    }
    return decision(
      false,
      "breaking",
      "ccr",
      `Wave ${mutation.wave} ${describe(mutation)} is a breaking mutation of a locked skeleton element. Route it through CCR Task-112 or Revision Task-087.`,
    );
  }
}

function isLockedElement(node: GraphNode): boolean {
  const role = readString(node.fields, "arch_role");
  if (role === "entity" || role === "auth" || role === "topology" || role === "convention") return true;
  if (node.kind === "contract" && (node.id.includes("auth") || node.fields.auth_contract === true)) return true;
  return false;
}

function isBreaking(store: SkeletonLockReader, mutation: SkeletonMutation): boolean {
  if (mutation.kind === "add_table" || mutation.kind === "add_endpoint" || mutation.kind === "add_event") return false;
  if (mutation.kind === "add_column") {
    if (!tableIsLocked(store, mutation.table)) return false;
    return !mutation.nullable && !mutation.hasDefault;
  }
  if (mutation.kind === "change_type") return tableIsLocked(store, mutation.table);
  if (mutation.kind === "rename" || mutation.kind === "delete") return targetIsLocked(store, mutation.target);
  return false;
}

function tableIsLocked(store: SkeletonLockReader, table: string): boolean {
  return store.listNodes().some((node) => {
    if (node.status !== "active" || node.fields.skeleton_locked !== true) return false;
    return readString(node.fields, "table") === table || readString(node.fields, "canonical_name") === table;
  });
}

function targetIsLocked(store: SkeletonLockReader, target: string): boolean {
  const node = store.getNode(target);
  if (node && node.status === "active" && node.fields.skeleton_locked === true) return true;
  return tableIsLocked(store, target);
}

function describe(mutation: SkeletonMutation): string {
  if (mutation.kind === "change_type") return `change_type ${mutation.table}.${mutation.column} from ${mutation.fromType} to ${mutation.toType}`;
  if (mutation.kind === "rename") return `rename ${mutation.fromName} to ${mutation.toName}`;
  if (mutation.kind === "delete") return `delete ${mutation.target}`;
  if (mutation.kind === "add_column") return `add required column ${mutation.table}.${mutation.column}`;
  return mutation.kind;
}

function decision(
  allowed: boolean,
  classification: LockDecision["classification"],
  route: LockDecision["route"],
  reason: string,
): LockDecision {
  return { allowed, classification, route, reason, ccrTask: "Task-112", revisionTask: "Task-087" };
}
