import path from "node:path";

export interface AclEntryPlan {
  readonly path: string;
  readonly sid: string;
  readonly rights: "modify" | "deny_write";
  readonly inheritance: "container_and_object";
  readonly target: "worktree" | "temp" | "git" | "node_modules";
}

export interface TierCAclPlan {
  readonly emptyWorktreeRequired: true;
  readonly nodeModulesReadOnly: true;
  readonly gitWriteDenied: true;
  readonly grants: readonly AclEntryPlan[];
  readonly denies: readonly AclEntryPlan[];
}

export function planTierCAcls(input: {
  readonly worktreePath: string;
  readonly tempPath: string;
  readonly sid: string;
}): TierCAclPlan {
  const grant = (target: AclEntryPlan["target"], folder: string): AclEntryPlan => ({
    path: folder,
    sid: input.sid,
    rights: "modify",
    inheritance: "container_and_object",
    target,
  });
  const deny = (target: AclEntryPlan["target"], folder: string): AclEntryPlan => ({
    path: folder,
    sid: input.sid,
    rights: "deny_write",
    inheritance: "container_and_object",
    target,
  });
  return {
    emptyWorktreeRequired: true,
    nodeModulesReadOnly: true,
    gitWriteDenied: true,
    grants: [grant("worktree", input.worktreePath), grant("temp", input.tempPath)],
    denies: [
      deny("git", path.join(input.worktreePath, ".git")),
      deny("node_modules", path.join(input.worktreePath, "node_modules")),
    ],
  };
}
