import { createHash, randomBytes } from "node:crypto";
import type { ProtectedSecret, SecretProtector } from "./types.js";

export function sandboxUserCanDecryptDeveloperDpapi(): false {
  return false;
}

export class MemorySecretProtector implements SecretProtector {
  private readonly secrets = new Map<string, { readonly secret: ProtectedSecret; readonly plaintext: string }>();

  protect(account: string, plaintext: string, ownerSid: string): ProtectedSecret {
    const blob = `dpapi:${ownerSid}:${createHash("sha256").update(plaintext).update(ownerSid).digest("hex")}:${randomBytes(8).toString("hex")}`;
    const secret: ProtectedSecret = { account, protection: "dpapi", ownerSid, blob };
    this.secrets.set(account, { secret, plaintext });
    return secret;
  }

  unprotect(secret: ProtectedSecret, callerSid: string): string | null {
    if (callerSid !== secret.ownerSid) return null;
    const stored = this.secrets.get(secret.account);
    if (!stored || stored.secret.blob !== secret.blob) return null;
    return stored.plaintext;
  }

  delete(account: string): void {
    this.secrets.delete(account);
  }

  list(): readonly string[] {
    return [...this.secrets.keys()];
  }
}
