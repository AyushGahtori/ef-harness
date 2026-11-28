import {
  containsProdMarker,
  isDatabaseUrl,
  isLiveTwilio,
  isProdTaggedAwsKey,
  isTestLikeScope,
  isUnconditionalLiveSecret,
  matchesConfiguredProdHost,
  sendGridProductionPrefix,
  stripeLivePrefix,
  stripeLiveRefusalMessage,
  stripePublishableLivePrefix,
  stripeRestrictedLivePrefix,
} from "./patterns.js";
import type { EnvScope } from "./types.js";
import { LiveKeyRefusedError } from "./types.js";

export interface GuardInput {
  readonly value: string;
  readonly envScope: EnvScope;
  readonly injectionTarget?: EnvScope | "preview" | "worker";
  readonly name?: string;
  readonly providerHint?: string;
  readonly taggedProd?: boolean;
  readonly pairedWithLiveSecret?: boolean;
  readonly explicitTestOverride?: boolean;
  readonly stripeLivemode?: boolean;
  readonly storedEnvScope?: EnvScope;
}

export type GuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: string; readonly message: string };

export class LiveKeyTestRefusalGuard {
  private readonly prodHostnames: readonly string[];

  constructor(options?: { readonly prodHostnames?: readonly string[] }) {
    this.prodHostnames = options?.prodHostnames ?? [];
  }

  inspect(input: GuardInput): GuardDecision {
    const target = input.injectionTarget ?? input.envScope;
    if (!isTestLikeScope(target)) return { allowed: true };
    const taggedProd = input.taggedProd === true;
    const paired = input.pairedWithLiveSecret === true;

    if (input.stripeLivemode === true || input.value.startsWith(stripeLivePrefix())) {
      return refuse("stripe_live", stripeLiveRefusalMessage());
    }
    if (input.value.startsWith(stripeRestrictedLivePrefix())) {
      return refuse(
        "stripe_restricted_live",
        "Refused to inject a Stripe restricted live key into the local test environment — please supply a Stripe test key or use the built-in local Stripe mock.",
      );
    }
    if (input.value.startsWith(stripePublishableLivePrefix()) && (paired || isUnconditionalLiveSecret(input.value))) {
      return refuse(
        "stripe_publishable_paired",
        "Refused to inject a Stripe publishable live key paired with a live secret into the local test environment — please supply Stripe test keys or use the built-in local Stripe mock.",
      );
    }
    if (input.value.startsWith(sendGridProductionPrefix())) {
      return refuse(
        "sendgrid_production",
        "Refused to inject a production SendGrid key into the local test environment — supply a test key or the local mock.",
      );
    }
    if (isLiveTwilio(input.value, input.providerHint, taggedProd)) {
      return refuse(
        "twilio_live",
        "Refused to inject a live Twilio credential into the local test environment — supply Twilio test credentials or the local mock.",
      );
    }
    if (isProdTaggedAwsKey(input.value, taggedProd, input.name)) {
      return refuse(
        "aws_prod",
        "Refused to inject a production AWS access key into the local test environment — supply a test key or the local mock.",
      );
    }
    if (isDatabaseUrl(input.value)) {
      const configured = matchesConfiguredProdHost(input.value, this.prodHostnames);
      if (configured) {
        return refuse(
          "prod_database",
          "Refused to inject a production database URL into the local test environment — the host matches a configured production database. Supply a local or test database.",
        );
      }
      if (containsProdMarker(input.value) && input.explicitTestOverride !== true) {
        return refuse(
          "prod_database",
          "Refused to inject a production database URL into the local test environment — the host looks like production. Supply a local or test database, or set an explicit test override.",
        );
      }
    }
    if (
      (input.storedEnvScope === "prod" || input.envScope === "prod") &&
      (target === "test" || target === "dev" || target === "preview")
    ) {
      return refuse(
        "prod_scope",
        "Refused to inject a production-scoped secret into the local test environment.",
      );
    }
    return { allowed: true };
  }

  inspectMany(inputs: readonly GuardInput[]): GuardDecision[] {
    const batchHasLiveSecret = inputs.some((item) => isUnconditionalLiveSecret(item.value));
    return inputs.map((input) =>
      this.inspect({
        ...input,
        pairedWithLiveSecret: input.pairedWithLiveSecret === true || batchHasLiveSecret,
      }),
    );
  }

  assertAllowed(input: GuardInput): void {
    const decision = this.inspect(input);
    if (!decision.allowed) throw new LiveKeyRefusedError(decision.code, decision.message);
  }
}

function refuse(code: string, message: string): GuardDecision {
  return { allowed: false, code, message };
}
