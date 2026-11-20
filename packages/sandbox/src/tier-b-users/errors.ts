export class TierBError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConsentRequiredError extends TierBError {
  constructor(action: "provision" | "unprovision") {
    super(
      "consent_required",
      `Tier B ${action} runs only after an explicit Settings sandbox setup confirmation and a UAC accept.`,
    );
  }
}

export class TierBUnavailableError extends TierBError {
  constructor(readonly missingComponents: readonly string[]) {
    super(
      "tier_b_unavailable",
      `Tier B is not available (${missingComponents.join(", ") || "unprovisioned"}). Refusing to run unsandboxed.`,
    );
  }
}

export class VolumeRejectedError extends TierBError {
  constructor(
    readonly target: string,
    readonly guidance: string,
  ) {
    super("volume_rejected", `${guidance} (${target})`);
  }
}

export class EmptySlotNotEmptyError extends TierBError {
  constructor(
    readonly target: string,
    readonly entryCount: number,
  ) {
    super(
      "empty_slot_not_empty",
      `Refusing inheritable ACL on ${target}: it already has ${entryCount} entries. ACLs are applied only to an empty folder.`,
    );
  }
}

export class EmptySlotMissingError extends TierBError {
  constructor(readonly target: string) {
    super("empty_slot_missing", `Slot folder does not exist: ${target}`);
  }
}

export class SlotGrantMissingError extends TierBError {
  constructor(readonly target: string) {
    super(
      "slot_grant_missing",
      `No empty-slot ACL grant is recorded for ${target}. Create the slot through onEmptySlotCreated before checkout.`,
    );
  }
}

export class DeveloperHomeAclError extends TierBError {
  constructor(
    readonly target: string,
    readonly reason: string,
  ) {
    super("developer_home_acl", `Tier B will not grant sandbox users access to ${target} (${reason}).`);
  }
}

export class TierBModeSRequiredError extends TierBError {
  readonly mode = "stripped" as const;
  readonly homeAclMutations = 0;

  constructor(readonly vendor: string) {
    super(
      "file_login_on_tier_b",
      `${vendor} keeps its login in the developer profile. Tier B routes it to Mode S and does not change home-folder permissions.`,
    );
  }
}

export class TierBCommandTimeoutError extends TierBError {
  readonly reason = "timeout" as const;

  constructor(readonly timeoutMs: number) {
    super("timeout", `Tier B command exceeded ${timeoutMs}ms`);
  }
}

export class CreateProcessAsUserError extends TierBError {
  readonly api = "CreateProcessAsUserW" as const;

  constructor(
    readonly win32Error: number,
    message: string,
    readonly edrHint: string,
  ) {
    super("create_process_as_user_failed", message);
  }
}

export class ProvisionFailedError extends TierBError {
  constructor(
    readonly win32Error: number,
    readonly summary: string,
    readonly fallbackTiers: readonly ("A" | "D" | "C")[],
  ) {
    super("provision_failed", summary);
  }
}

export class TierBPoolError extends TierBError {
  constructor(readonly poolSize: number) {
    super("warm_pool_exhausted", `Tier B warm pool has no idle logon session (${poolSize} in use).`);
  }
}
