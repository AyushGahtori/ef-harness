import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DeveloperHomeAclError,
  EmptySlotNotEmptyError,
  SANDBOX_OFFLINE_ACCOUNT,
  VOLUME_GUIDANCE,
  evaluateCrossWorktreeRead,
  probeTierBForPath,
} from "../../src/tier-b-users/index.js";
import { harness, makeTree, removeLater } from "./fixture.js";

describe("empty-slot ACL manager", () => {
  it("grants one inheritable modify ACE on an empty slot and refuses a populated directory", () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      rig.acl.onEmptySlotCreated(tree.slot);
      expect(fs.readdirSync(tree.slot)).toEqual([]);
      const userAces = rig.aclPort.commands.filter(
        (command) => command.ace.role === "sandbox_user" && command.ace.target === tree.slot,
      );
      expect(userAces).toHaveLength(1);
      expect(userAces[0]?.ace.rights).toBe("M");
      expect(userAces[0]?.ace.inheritance).toBe("(OI)(CI)");
      expect(userAces[0]?.recursive).toBe(false);
      expect(userAces[0]?.args.includes("/T")).toBe(false);
      expect(rig.aclPort.commands.some((command) => command.ace.role === "slot_capability")).toBe(true);
      const tempAces = rig.aclPort.commands.filter((command) => command.ace.target === tree.temp);
      expect(tempAces.length).toBeGreaterThan(0);
      fs.writeFileSync(path.join(tree.otherSlot, "already.txt"), "populated");
      const before = rig.aclPort.commands.length;
      expect(() => rig.acl.onEmptySlotCreated(tree.otherSlot)).toThrow(EmptySlotNotEmptyError);
      expect(rig.aclPort.commands).toHaveLength(before);
    } finally {
      removeLater(tree.root);
    }
  });

  it("keeps the pnpm store read-only, denies .git writes, and does not walk children when storage moves", () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      fs.writeFileSync(path.join(tree.store, "package"), "hardlink");
      const store = rig.acl.applyStoreReadOnly(tree.store);
      expect(store.ace.rights).toBe("RX");
      expect(store.recursive).toBe(false);
      expect(store.args.includes("/T")).toBe(false);
      fs.mkdirSync(path.join(tree.slot, ".git"));
      const git = rig.acl.applyGitWriteDeny(path.join(tree.slot, ".git"));
      expect(git.ace.type).toBe("deny");
      expect(git.ace.rights).toBe("DENY_WRITE");
      expect(git.recursive).toBe(false);
      fs.writeFileSync(path.join(tree.build, "kept.txt"), "existing");
      const report = rig.acl.reverifyStorageRoot(tree.build);
      expect(report.walkedChildren).toBe(0);
      expect(report.recursive).toBe(false);
      expect(report.inheritableAcePresent).toBe(true);
      expect(report.applied).toBe(true);
      const again = rig.acl.reverifyStorageRoot(tree.build);
      expect(again.applied).toBe(false);
      rig.acl.assertDeveloperHomeUntouched();
    } finally {
      removeLater(tree.root);
    }
  });

  it("never grants the developer profile or a secret folder", () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      expect(() => rig.acl.onEmptySlotCreated(tree.profile)).toThrow(DeveloperHomeAclError);
      fs.mkdirSync(path.join(tree.profile, ".ssh"));
      expect(() => rig.acl.ensureEmptyGrant(path.join(tree.profile, ".ssh"), "slot")).toThrow(DeveloperHomeAclError);
    } finally {
      removeLater(tree.root);
    }
  });

  it("removes a slot grant with icacls /remove:g and regrants a populated directory", () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      rig.acl.onEmptySlotCreated(tree.slot);
      const grant = rig.acl.requireSlotGrant(tree.slot);
      fs.writeFileSync(path.join(tree.slot, "checked-out.txt"), "files");
      rig.acl.revokeSlotGrant(tree.slot);
      const removed = rig.aclPort.commands.filter((command) => command.args.includes("/remove:g"));
      expect(removed.map((command) => command.args[2])).toEqual([`*${grant.accountSid}`, `*${grant.capabilitySid}`]);
      expect(removed.every((command) => command.args[1] === "/remove:g" && command.recursive === false)).toBe(true);
      expect(removed.every((command) => !command.args.includes("/T") && !command.args.includes("/t"))).toBe(true);
      expect(rig.acl.grantFor(tree.slot)).toBeNull();
      expect(rig.aclPort.list(tree.slot).some((ace) => ace.type === "allow" && ace.rights === "M")).toBe(false);
      const restored = rig.acl.regrantSlot(tree.slot);
      expect(restored.capabilitySid).toBe(grant.capabilitySid);
      expect(rig.acl.requireSlotGrant(tree.slot).accountSid).toBe(grant.accountSid);
      const userGrants = rig.aclPort.commands.filter(
        (command) => command.ace.target === tree.slot && command.args.includes("/grant:r") && command.ace.sid === grant.accountSid,
      );
      expect(userGrants).toHaveLength(2);
      rig.acl.assertDeveloperHomeUntouched();
    } finally {
      removeLater(tree.root);
    }
  });

  it("denies a read of another slot when the restricted capability SID differs", () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      rig.acl.onEmptySlotCreated(tree.slot);
      const other = rig.acl.ensureEmptyGrant(tree.otherSlot, "slot");
      const reader = rig.acl.requireSlotGrant(tree.slot);
      const target = path.join(tree.otherSlot, "secret.txt");
      fs.writeFileSync(target, "nope");
      const decision = evaluateCrossWorktreeRead({
        readerCapabilitySid: reader.capabilitySid,
        readerPaths: [reader.slotPath, tree.temp],
        target,
        grants: [reader, other],
      });
      expect(decision.allowed).toBe(false);
      expect(decision.ruleId).toBe("cross_worktree_capability");
      const own = evaluateCrossWorktreeRead({
        readerCapabilitySid: reader.capabilitySid,
        readerPaths: [reader.slotPath],
        target: reader.slotPath,
        grants: [reader, other],
      });
      expect(own.allowed).toBe(true);
      expect(other.capabilitySid).not.toBe(reader.capabilitySid);
      expect(other.accountSid).toBe(reader.accountSid);
    } finally {
      removeLater(tree.root);
    }
  });
});

describe("volume probe", () => {
  it("rejects UNC and FAT32 and accepts NTFS and Dev Drive", () => {
    const unc = probeTierBForPath("\\\\server\\share\\proj", { fileSystem: "NTFS", unc: false, devDrive: false });
    expect(unc.accepted).toBe(false);
    expect(unc.kind).toBe("unc");
    expect(unc.guidance).toBe(VOLUME_GUIDANCE);
    const fat = probeTierBForPath("D:\\proj", { fileSystem: "FAT32", unc: false, devDrive: false });
    expect(fat.accepted).toBe(false);
    expect(fat.kind).toBe("fat32");
    expect(fat.guidance).toBe(VOLUME_GUIDANCE);
    const ntfs = probeTierBForPath("D:\\proj", { fileSystem: "NTFS", unc: false, devDrive: false });
    expect(ntfs.accepted).toBe(true);
    const dev = probeTierBForPath("E:\\proj", { fileSystem: "ReFS", unc: false, devDrive: true });
    expect(dev.accepted).toBe(true);
    expect(dev.kind).toBe("dev_drive");
    expect(SANDBOX_OFFLINE_ACCOUNT).toBe("EFHarnessSandboxOffline");
  });
});
