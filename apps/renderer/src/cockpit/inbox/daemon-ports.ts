import type { HonestyBadge } from "./types.js";
import type {
  HumanStepCheck,
  HumanStepProbePort,
  PreloadSecretIpc,
  StaleReplyInput,
  StaleReplyReconciler,
  StaleReplyResult,
  VaultPutRequest,
  VaultPutResult,
} from "./ports.js";

/** Preload JSON-RPC. The renderer never opens state.db or imports node built-ins. */
export interface InboxRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function daemonSecretIpc(rpc: InboxRpc, projectId: string): PreloadSecretIpc {
  return {
    async put(request: VaultPutRequest): Promise<VaultPutResult> {
      const result = (await rpc.request("storeSecret", {
        projectId,
        envScope: request.envScope,
        name: request.name,
        value: request.value,
      })) as { ok?: boolean; secretId?: string; message?: string };
      if (result.ok && result.secretId) return { ok: true, secretId: result.secretId };
      return { ok: false, code: "live_key_refused", message: result.message ?? "secret was not stored" };
    },
    async probe(): Promise<{ readonly ok: boolean; readonly message: string }> {
      return { ok: false, message: "probe the secret from the daemon vault" };
    },
    async useLocalMock(): Promise<{ readonly ok: true }> {
      return { ok: true };
    },
  };
}

export function daemonHumanStepProbe(rpc: InboxRpc): HumanStepProbePort {
  return {
    async checkAgain(stepId: string): Promise<HumanStepCheck> {
      const result = (await rpc.request("runProbe", { stepId })) as {
        outcome?: string;
        diagnosis?: string;
        badge?: HonestyBadge;
      };
      const outcome = result.outcome === "pass" ? "pass" : "fail";
      return {
        outcome,
        diagnosis: result.diagnosis ?? "",
        badge: result.badge === "Verified" || result.badge === "Attested" ? result.badge : outcome === "pass" ? "Verified" : "Attested",
      };
    },
  };
}

export function daemonStaleReplyReconciler(rpc: InboxRpc): StaleReplyReconciler {
  return {
    receive(card: StaleReplyInput, reply: { readonly optionsVersion: number; readonly optionId: string }): Promise<StaleReplyResult> {
      return rpc.request("reconcile", {
        questionId: reply.optionId,
        optionsVersion: card.optionsVersion,
        optionId: reply.optionId,
        status: card.status,
      }).then((value) => toReply(value));
    },
  };
}

function toReply(value: unknown): StaleReplyResult {
  if (!value || typeof value !== "object") return { outcome: "fresh" };
  const record = value as { outcome?: string; prompt?: string };
  if (record.outcome === "needs_choice") {
    return {
      outcome: "needs_choice",
      prompt: record.prompt ?? "Already resolved — Keep or Change?",
      choices: ["keep", "change"],
    };
  }
  return { outcome: "fresh" };
}
