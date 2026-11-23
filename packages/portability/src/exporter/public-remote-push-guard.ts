import { HarnessStatePushBlockedError } from "./errors.js";
import type {
  GitHubAuthConnectorPort,
  GitHubRepoVisibility,
  HarnessStatePushPreference,
} from "./types.js";

export const PUBLIC_HARNESS_STATE_WARNING =
  "This repository is PUBLIC. Pushing 'harness-state' makes your specs, decisions, and design history publicly readable on GitHub (secrets remain excluded and sealed checks are encrypted). Are you sure?";

export const PRIVATE_FIRST_PUSH_PROMPT =
  "Sync harness-state branch to private remote 'origin' for backup & cross-device sync?";

export interface PushGuardDecision {
  readonly allow: boolean;
  readonly prompted: boolean;
  readonly warning?: string;
  readonly reason: string;
}

export class PublicRemotePushGuard {
  private preferences = new Map<string, HarnessStatePushPreference>();

  constructor(private readonly auth: GitHubAuthConnectorPort) {}

  getPreference(remote: string): HarnessStatePushPreference | undefined {
    return this.preferences.get(remote);
  }

  setPreference(remote: string, preference: HarnessStatePushPreference): void {
    this.preferences.set(remote, preference);
  }

  async evaluatePush(
    remote: string,
    owner: string,
    repo: string,
    opts: { readonly explicitOptIn?: boolean },
  ): Promise<PushGuardDecision> {
    const visibility = await this.auth.remoteVisibility(owner, repo);
    const existing = this.preferences.get(remote);

    if (visibility.visibility === "public") {
      if (!existing?.harnessStatePushAllowed) {
        if (!opts.explicitOptIn) {
          return {
            allow: false,
            prompted: false,
            warning: PUBLIC_HARNESS_STATE_WARNING,
            reason: "public_remote_off_by_default",
          };
        }
        this.preferences.set(remote, {
          remote,
          harnessStatePushAllowed: true,
          askedOnce: true,
        });
        return {
          allow: true,
          prompted: true,
          warning: PUBLIC_HARNESS_STATE_WARNING,
          reason: "public_explicit_opt_in",
        };
      }
      return { allow: true, prompted: false, reason: "public_previously_opted_in" };
    }

    if (!existing?.askedOnce) {
      this.preferences.set(remote, {
        remote,
        harnessStatePushAllowed: Boolean(opts.explicitOptIn),
        askedOnce: true,
      });
      return {
        allow: Boolean(opts.explicitOptIn),
        prompted: true,
        warning: PRIVATE_FIRST_PUSH_PROMPT,
        reason: "private_first_push_prompt",
      };
    }

    return {
      allow: existing.harnessStatePushAllowed,
      prompted: false,
      reason: existing.harnessStatePushAllowed ? "private_allowed" : "private_declined",
    };
  }

  async assertPushAllowed(
    remote: string,
    owner: string,
    repo: string,
    opts: { readonly explicitOptIn?: boolean },
  ): Promise<void> {
    const decision = await this.evaluatePush(remote, owner, repo, opts);
    if (!decision.allow) {
      throw new HarnessStatePushBlockedError(decision.warning ?? decision.reason);
    }
  }

  static formatVisibility(visibility: GitHubRepoVisibility): string {
    return `${visibility.owner}/${visibility.repo} (${visibility.visibility})`;
  }
}