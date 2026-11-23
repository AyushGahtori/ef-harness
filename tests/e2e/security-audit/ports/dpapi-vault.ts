/** Local port for Task 120 WindowsDpapiSecretsVault. */

export class WindowsDpapiSecretsVault {
  private readonly sealed = new Map<string, string>();

  store(name: string, plain: string): string {
    const payload = Buffer.from(plain, "utf8");
    const sealed = Buffer.from(payload.map((byte, index) => byte ^ (0x3d + (index % 11))));
    const stored = `dpapi:${sealed.toString("base64url")}`;
    if (stored.includes(plain)) throw new Error("vault stored plaintext");
    this.sealed.set(name, stored);
    return stored;
  }

  retrieve(name: string): string {
    const stored = this.sealed.get(name);
    if (!stored?.startsWith("dpapi:")) throw new Error("missing secret");
    const body = stored.slice("dpapi:".length);
    const sealed = Buffer.from(body, "base64url");
    const plain = Buffer.from(sealed.map((byte, index) => byte ^ (0x3d + (index % 11))));
    return plain.toString("utf8");
  }

  injectRuntimeOnly(name: string, target: Record<string, string>): Record<string, string> {
    const value = this.retrieve(name);
    return { ...target, [name]: value };
  }
}