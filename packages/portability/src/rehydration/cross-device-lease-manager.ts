import fs from "node:fs";
import path from "node:path";

import type { GitCommandPort, LeaseDocument, OpenModeDecision, ProjectOpenMode } from "./types.js";
import { HARNESS_STATE_BRANCH } from "./types.js";
import { serializeLease } from "./yaml-format.js";
import { assertHarnessStatePushAllowed, formatForceWithLeasePush } from "./force-push-guard.js";
import { LeaseTakeoverRaceError } from "./errors.js";
import { listTreePaths, readBlobAtPath } from "./git-commands.js";
import { parseLease } from "./yaml-format.js";

export interface LocalLeaseContext {
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly writerEpoch: number;
}

export interface TakeoverLeaseRequest {
  readonly repoPath: string;
  readonly remote: string;
  readonly local: LocalLeaseContext;
  readonly expectedRemoteSha: string;
}

export interface TakeoverLeaseResult {
  readonly mode: ProjectOpenMode;
  readonly newEpoch: number;
  readonly pushed: boolean;
  readonly remoteSha: string | null;
  readonly leaseYaml: string;
}

export class CrossDeviceLeaseManager {
  constructor(private readonly git: GitCommandPort) {}

  readRemoteLease(repoPath: string): LeaseDocument {
    const text = readBlobAtPath(repoPath, HARNESS_STATE_BRANCH, "lease.yaml");
    if (!text) {
      throw new Error("lease.yaml missing on harness-state");
    }
    return parseLease(text);
  }

  evaluateOpenMode(local: LocalLeaseContext, remote: LeaseDocument): OpenModeDecision {
    if (remote.deviceId === local.deviceId && remote.epoch === local.writerEpoch) {
      return {
        mode: "writer",
        message: "Active single writer on this device",
        remoteEpoch: remote.epoch,
        localEpoch: local.writerEpoch,
      };
    }
    if (remote.epoch > local.writerEpoch) {
      return {
        mode: "read_only_fenced",
        message: `Control was taken over by '${remote.holder}' — paused safely to prevent conflicts`,
        remoteEpoch: remote.epoch,
        localEpoch: local.writerEpoch,
      };
    }
    if (remote.deviceId !== local.deviceId) {
      const lastSeen = remote.heartbeat;
      return {
        mode: "read_only_viewer",
        message: `Currently active on '${remote.holder}' (last seen ${lastSeen}) — Viewing read-only · Take over editing`,
        remoteEpoch: remote.epoch,
        localEpoch: local.writerEpoch,
      };
    }
    return {
      mode: "read_only_viewer",
      message: "Lease mismatch — read-only until takeover",
      remoteEpoch: remote.epoch,
      localEpoch: local.writerEpoch,
    };
  }

  buildTakeoverLease(local: LocalLeaseContext, remote: LeaseDocument, revision: number): LeaseDocument {
    return {
      deviceId: local.deviceId,
      holder: local.deviceLabel,
      epoch: remote.epoch + 1,
      heartbeat: new Date().toISOString(),
      revision,
      buildActive: false,
    };
  }

  commitTakeover(repoPath: string, local: LocalLeaseContext, expectedRemoteSha: string): TakeoverLeaseResult {
    const remote = this.readRemoteLease(repoPath);
    const actualRemoteSha = this.git.readRef(repoPath, HARNESS_STATE_BRANCH);
    if (actualRemoteSha !== expectedRemoteSha) {
      throw new LeaseTakeoverRaceError(expectedRemoteSha, actualRemoteSha ?? "missing");
    }

    const lease = this.buildTakeoverLease(local, remote, remote.revision);
    const leaseYaml = serializeLease(lease);
    fs.writeFileSync(path.join(repoPath, "lease.yaml"), leaseYaml, "utf8");
    this.git.run(["config", "user.email", "foundation@ef-harness.local"], repoPath);
    this.git.run(["config", "user.name", "EF Harness"], repoPath);
    const add = this.git.run(["add", "lease.yaml"], repoPath);
    if (add.status !== 0) {
      throw new Error(`lease add failed: ${add.stdout}`);
    }
    const commit = this.git.run(["commit", "-m", `takeover epoch ${lease.epoch}`], repoPath);
    if (commit.status !== 0) {
      throw new Error(`lease commit failed: ${commit.stdout}`);
    }

    return {
      mode: "writer",
      newEpoch: lease.epoch,
      pushed: false,
      remoteSha: this.git.readRef(repoPath, HARNESS_STATE_BRANCH),
      leaseYaml,
    };
  }

  pushTakeover(request: TakeoverLeaseRequest): TakeoverLeaseResult {
    const committed = this.commitTakeover(request.repoPath, request.local, request.expectedRemoteSha);

    const pushLine = formatForceWithLeasePush(request.remote, "harness-state", request.expectedRemoteSha);
    assertHarnessStatePushAllowed(pushLine);
    const pushArgs = pushLine.replace(/^git\s+/, "").split(/\s+/);
    const push = this.git.run(pushArgs, request.repoPath);
    if (push.status !== 0) {
      throw new LeaseTakeoverRaceError(
        request.expectedRemoteSha,
        this.git.readRef(request.repoPath, HARNESS_STATE_BRANCH) ?? "missing",
      );
    }

    return { ...committed, pushed: true };
  }

  assertStaleEpochFenced(localEpoch: number, remoteEpoch: number): ProjectOpenMode {
    if (remoteEpoch > localEpoch) return "read_only_fenced";
    return "writer";
  }

  listHarnessStatePaths(repoPath: string): readonly string[] {
    return listTreePaths(repoPath, HARNESS_STATE_BRANCH);
  }
}