import { RehydrationError } from "./errors.js";

export class AgeSealedChecksDecryptor {
  constructor(private readonly identity: string | null) {}

  canDecrypt(): boolean {
    return this.identity !== null;
  }

  async decryptFile(content: string, filePath: string): Promise<string> {
    if (!this.identity) {
      throw new RehydrationError("sealed_decrypt_failed", `no age key for ${filePath}`);
    }
    const age = await import("age-encryption");
    const decoded = content.includes("BEGIN AGE ENCRYPTED FILE")
      ? age.armor.decode(content)
      : Buffer.from(content, "base64");
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(this.identity);
    const plaintext = await decrypter.decrypt(decoded, "text");
    return typeof plaintext === "string" ? plaintext : new TextDecoder().decode(plaintext);
  }
}