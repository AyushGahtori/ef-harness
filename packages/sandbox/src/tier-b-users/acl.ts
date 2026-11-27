import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DeveloperHomeAclError, EmptySlotMissingError, EmptySlotNotEmptyError, SlotGrantMissingError, TierBError } from "./errors.js";
import { canonicalizeAbsolute, comparablePath, isSameOrInside } from "./paths.js";
import type { AccessDecision, AclAce, AclCommand, AclPort, SlotGrant } from "./types.js";

const HOME_SECRET_NAMES = [".ssh", ".aws", ".azure", ".gnupg", ".npmrc", ".gemini"] as const;

export function capabilitySidForSlot(slotPath: string): string {
  const digest = createHash("sha256").update(comparablePath(slotPath)).digest();
  const first = digest.readUInt32BE(0);
  const second = digest.readUInt32BE(4);
  const third = digest.readUInt32BE(8);
  return `S-1-5-21-${first}-${second}-${third}`;
}

export function grantRelaxesDeveloperHome(target: string, userProfile: string): string | null {
  const profile = canonicalizeAbsolute(userProfile);
  const resolved = canonicalizeAbsolute(target);
  if (comparablePath(resolved) === comparablePath(profile)) return "profile_root";
  for (const name of HOME_SECRET_NAMES) {
    if (isSameOrInside(resolved, path.join(profile, name))) return name;
  }
  return null;
}

function assertNotRecursive(args: readonly string[]): void {
  if (args.includes("/T") || args.includes("/t")) {
    throw new TierBError("recursive_acl", "Recursive ACL propagation is forbidden");
  }
}

function icaclsCommand(ace: AclAce): AclCommand {
  const rights = ace.rights === "DENY_WRITE" ? "(OI)(CI)(WD,AD,WA,WEA,DC,D)" : `(OI)(CI)(${ace.rights})`;
  const flag = ace.type === "deny" ? "/deny" : "/grant:r";
  const args = [ace.target, flag, `*${ace.sid}:${rights}`];
  assertNotRecursive(args);
  return { program: "icacls", args, recursive: false, ace };
}

function icaclsRemoveGrant(ace: AclAce): AclCommand {
  const args = [ace.target, "/remove:g", `*${ace.sid}`];
  assertNotRecursive(args);
  return { program: "icacls", args, recursive: false, ace };
}

export class EmptySlotAclManager {
  private readonly grants = new Map<string, SlotGrant>();
  private readonly revoked = new Map<string, SlotGrant>();
  private readonly applied: AclCommand[] = [];

  constructor(
    private readonly options: {
      readonly accountSid: string;
      readonly acl: AclPort;
      readonly userProfile: string;
      readonly tempDirForSlot?: (slotPath: string) => string;
    },
  ) {}

  onEmptySlotCreated(slotPath: string): void {
    this.applyEmptyDirectoryGrant(slotPath, "slot");
    const tempDir = this.options.tempDirForSlot?.(slotPath);
    if (tempDir) this.applyEmptyDirectoryGrant(tempDir, "temp");
  }

  ensureEmptyGrant(target: string, role: "slot" | "temp"): SlotGrant {
    const existing = this.grantFor(target);
    if (existing) return existing;
    return this.applyEmptyDirectoryGrant(target, role);
  }

  applyStoreReadOnly(storeRoot: string, sid = this.options.accountSid): AclCommand {
    return this.applyAce(canonicalizeAbsolute(storeRoot), sid, "allow", "RX", "store_readonly");
  }

  applyGitWriteDeny(gitDir: string, sid = this.options.accountSid): AclCommand {
    return this.applyAce(canonicalizeAbsolute(gitDir), sid, "deny", "DENY_WRITE", "git_deny_write");
  }

  reverifyStorageRoot(root: string): {
    readonly root: string;
    readonly walkedChildren: 0;
    readonly recursive: false;
    readonly inheritableAcePresent: boolean;
    readonly applied: boolean;
  } {
    const resolved = canonicalizeAbsolute(root);
    this.assertHomeUntouched(resolved);
    const present = this.options.acl.list(resolved).some((ace) => this.isUserModify(ace));
    if (!present) {
      this.applyAce(resolved, this.options.accountSid, "allow", "M", "sandbox_user");
    }
    return {
      root: resolved,
      walkedChildren: 0,
      recursive: false,
      inheritableAcePresent: true,
      applied: !present,
    };
  }

  assertDeveloperHomeUntouched(): void {
    for (const command of this.applied) {
      if (command.ace.type !== "allow") continue;
      if (command.args.includes("/remove:g")) continue;
      const reason = grantRelaxesDeveloperHome(command.ace.target, this.options.userProfile);
      if (reason) throw new DeveloperHomeAclError(command.ace.target, reason);
    }
  }

  revokeSlotGrant(target: string): void {
    const resolved = canonicalizeAbsolute(target);
    const key = comparablePath(resolved);
    const grant = this.grants.get(key);
    if (!grant) return;
    this.issueRemove(resolved, grant.accountSid, "sandbox_user");
    this.issueRemove(resolved, grant.capabilitySid, "slot_capability");
    this.grants.delete(key);
    this.revoked.set(key, grant);
  }

  regrantSlot(target: string): SlotGrant {
    const current = this.grantFor(target);
    if (current) return current;
    const resolved = canonicalizeAbsolute(target);
    const key = comparablePath(resolved);
    const grant = this.revoked.get(key);
    if (!grant) throw new SlotGrantMissingError(target);
    this.assertHomeUntouched(resolved);
    if (!fs.existsSync(resolved)) throw new EmptySlotMissingError(resolved);
    this.applyAce(resolved, grant.accountSid, "allow", "M", "sandbox_user");
    this.applyAce(resolved, grant.capabilitySid, "allow", "M", "slot_capability");
    this.revoked.delete(key);
    this.grants.set(key, grant);
    return grant;
  }

  grantFor(target: string): SlotGrant | null {
    return this.grants.get(comparablePath(canonicalizeAbsolute(target))) ?? null;
  }

  requireSlotGrant(target: string): SlotGrant {
    const grant = this.grantFor(target);
    if (!grant) throw new SlotGrantMissingError(target);
    return grant;
  }

  commands(): readonly AclCommand[] {
    return this.applied;
  }

  private isUserModify(ace: AclAce): boolean {
    return ace.type === "allow" && ace.rights === "M" && ace.sid === this.options.accountSid && ace.inheritance === "(OI)(CI)" && ace.recursive === false;
  }

  private applyEmptyDirectoryGrant(target: string, role: "slot" | "temp"): SlotGrant {
    const resolved = canonicalizeAbsolute(target);
    this.assertHomeUntouched(resolved);
    if (!fs.existsSync(resolved)) {
      if (role === "slot") throw new EmptySlotMissingError(resolved);
      fs.mkdirSync(resolved, { recursive: true });
    }
    const entries = fs.readdirSync(resolved);
    if (entries.length !== 0) throw new EmptySlotNotEmptyError(resolved, entries.length);
    const capabilitySid = capabilitySidForSlot(resolved);
    this.applyAce(resolved, this.options.accountSid, "allow", "M", "sandbox_user");
    this.applyAce(resolved, capabilitySid, "allow", "M", "slot_capability");
    const grant: SlotGrant = {
      slotPath: resolved,
      accountSid: this.options.accountSid,
      capabilitySid,
      role,
    };
    this.grants.set(comparablePath(resolved), grant);
    return grant;
  }

  private assertHomeUntouched(target: string): void {
    const reason = grantRelaxesDeveloperHome(target, this.options.userProfile);
    if (reason) throw new DeveloperHomeAclError(target, reason);
  }

  private applyAce(
    target: string,
    sid: string,
    type: "allow" | "deny",
    rights: AclAce["rights"],
    role: AclAce["role"],
  ): AclCommand {
    const ace: AclAce = {
      target,
      sid,
      type,
      rights,
      inheritance: "(OI)(CI)",
      recursive: false,
      role,
    };
    const command = icaclsCommand(ace);
    this.options.acl.apply(command);
    this.applied.push(command);
    return command;
  }

  private issueRemove(target: string, sid: string, role: AclAce["role"]): void {
    const ace: AclAce = {
      target,
      sid,
      type: "allow",
      rights: "M",
      inheritance: "(OI)(CI)",
      recursive: false,
      role,
    };
    const command = icaclsRemoveGrant(ace);
    this.options.acl.apply(command);
    this.applied.push(command);
  }
}

export function evaluateCrossWorktreeRead(input: {
  readonly readerCapabilitySid: string;
  readonly readerPaths: readonly string[];
  readonly target: string;
  readonly grants: readonly SlotGrant[];
}): AccessDecision {
  const target = canonicalizeAbsolute(input.target);
  for (const readerPath of input.readerPaths) {
    if (isSameOrInside(target, readerPath)) {
      return { allowed: true, errno: null, ruleId: "slot_capability_match", access: "read" };
    }
  }
  for (const grant of input.grants) {
    if (!isSameOrInside(target, grant.slotPath)) continue;
    if (grant.capabilitySid !== input.readerCapabilitySid) {
      return { allowed: false, errno: "EACCES", ruleId: "cross_worktree_capability", access: "read" };
    }
  }
  return { allowed: false, errno: "EACCES", ruleId: "outside_granted_slots", access: "read" };
}
