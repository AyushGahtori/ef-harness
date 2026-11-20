import { TierENotInV1Error } from "./errors.js";

export interface RemoteExecutionTarget {
  readonly kind: "ssh_docker" | "harness_runner" | "cloud_sandbox";
  readonly id: string;
}

export interface RemoteGitTransfer {
  readonly mechanism: "git";
  readonly baseCommit: string;
  readonly patches: readonly string[];
}

export interface RemoteSecretDirective {
  readonly mode: "secret_free";
}

export interface RemoteUsdLedgerEntry {
  readonly currency: "usd";
  readonly amount: number;
  readonly targetId: string;
  readonly attemptId: string;
}

export interface RemoteExecutionRequest {
  readonly target: RemoteExecutionTarget;
  readonly transfer: RemoteGitTransfer;
  readonly secrets: RemoteSecretDirective;
  readonly networkPolicy: "same_as_local";
  readonly attemptId: string;
}

export interface RemoteExecutionProvider {
  readonly tier: "E";
  readonly v1Coupling: "none";
  listTargets(): Promise<readonly RemoteExecutionTarget[]>;
  transferViaGit(transfer: RemoteGitTransfer): Promise<{ readonly pushedRef: string }>;
  execute(request: RemoteExecutionRequest): Promise<{ readonly receiptRef: string }>;
  recordUsd(entry: RemoteUsdLedgerEntry): void;
}

export class UnimplementedRemoteExecutionProvider implements RemoteExecutionProvider {
  readonly tier = "E" as const;
  readonly v1Coupling = "none" as const;

  listTargets(): Promise<readonly RemoteExecutionTarget[]> {
    return Promise.reject(new TierENotInV1Error());
  }

  transferViaGit(transfer: RemoteGitTransfer): Promise<{ readonly pushedRef: string }> {
    if (transfer.mechanism !== "git") return Promise.reject(new TierENotInV1Error());
    return Promise.reject(new TierENotInV1Error());
  }

  execute(request: RemoteExecutionRequest): Promise<{ readonly receiptRef: string }> {
    if (request.secrets.mode !== "secret_free" || request.networkPolicy !== "same_as_local") {
      return Promise.reject(new TierENotInV1Error());
    }
    return Promise.reject(new TierENotInV1Error());
  }

  recordUsd(entry: RemoteUsdLedgerEntry): void {
    if (entry.currency !== "usd") throw new TierENotInV1Error();
    throw new TierENotInV1Error();
  }
}
