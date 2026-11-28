import type { BranchProtectionSnapshot, ShipStrategy, ShipMode } from "./types.js";
import type { GitHubRateAwareQueue } from "./rate-queue.js";

export interface BranchProtectionPolicyReaderOptions {
  readonly queue: GitHubRateAwareQueue;
  readonly owner: string;
  readonly repo: string;
}

export class BranchProtectionPolicyReader {
  constructor(private readonly options: BranchProtectionPolicyReaderOptions) {}

  async read(branch: string): Promise<BranchProtectionSnapshot> {
    const protection = await this.fetchProtection(branch);
    const ruleset = await this.fetchRuleset(branch);
    return mergeProtection(branch, protection, ruleset);
  }

  async chooseShipStrategy(input: {
    readonly defaultBranch: string;
    readonly multiContributor: boolean;
    readonly directModeExplicit?: boolean;
  }): Promise<ShipStrategy> {
    const protection = await this.read(input.defaultBranch);
    const protectedMain = protection.protected || protection.requiredPullRequest;
    if (protectedMain || input.multiContributor) {
      const reason = protectedMain
        ? `Branch '${input.defaultBranch}' is protected — shipping via Pull Request`
        : "Multi-contributor repository — default safe PR mode";
      return { mode: "pr", reason, protection };
    }
    if (input.directModeExplicit) {
      return {
        mode: "direct",
        reason: "Solo unprotected repository — developer chose Direct Push Mode",
        protection,
      };
    }
    return {
      mode: "pr",
      reason: "Default safe PR mode for unprotected solo repository",
      protection,
    };
  }

  private async fetchProtection(branch: string): Promise<Partial<BranchProtectionSnapshot>> {
    const response = await this.options.queue.request({
      method: "GET",
      path: `/repos/${this.options.owner}/${this.options.repo}/branches/${encodeURIComponent(branch)}/protection`,
    });
    if (response.status === 403 || response.status === 404) {
      return { protected: false };
    }
    if (response.status >= 400) {
      return { protected: false };
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      return { protected: true };
    }
    const requiredPr = body.required_pull_request_reviews as
      | { required_approving_review_count?: number }
      | undefined;
    const requiredStatus = body.required_status_checks as { contexts?: string[] } | undefined;
    return {
      protected: true,
      requiredPullRequest: Boolean(requiredPr),
      requiredApprovingReviewCount: requiredPr?.required_approving_review_count ?? 0,
      requiredStatusChecks: requiredStatus?.contexts ?? [],
      linearHistoryRequired: Boolean(body.required_linear_history),
      signedCommitsRequired: Boolean(body.required_signatures),
      forcePushForbidden: body.allow_force_pushes === false,
    };
  }

  private async fetchRuleset(branch: string): Promise<boolean> {
    const response = await this.options.queue.request({
      method: "GET",
      path: `/repos/${this.options.owner}/${this.options.repo}/rules/branches/${encodeURIComponent(branch)}`,
    });
    return response.status < 400 && response.body.length > 2;
  }
}

function mergeProtection(
  branch: string,
  protection: Partial<BranchProtectionSnapshot>,
  ruleset: boolean,
): BranchProtectionSnapshot {
  return {
    branch,
    protected: Boolean(protection.protected),
    requiredPullRequest: Boolean(protection.requiredPullRequest),
    requiredApprovingReviewCount: protection.requiredApprovingReviewCount ?? 0,
    requiredStatusChecks: protection.requiredStatusChecks ?? [],
    linearHistoryRequired: Boolean(protection.linearHistoryRequired),
    signedCommitsRequired: Boolean(protection.signedCommitsRequired),
    forcePushForbidden: protection.forcePushForbidden ?? true,
    rulesetEnforced: ruleset,
  };
}

export function shipModeAllowsDirectPush(mode: ShipMode, protection: BranchProtectionSnapshot): boolean {
  if (protection.requiredPullRequest || protection.protected) return false;
  return mode === "direct";
}