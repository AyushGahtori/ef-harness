import { createRequire } from "node:module";
import path from "node:path";

import type { SealedHiddenCheck } from "./types.js";
import { repositoryRoot } from "./repository-root.js";

type AgeModule = {
  armor: { encode: (file: Uint8Array) => string };
  Encrypter: new () => {
    addRecipient: (recipient: string) => void;
    encrypt: (file: Uint8Array | string) => Promise<Uint8Array>;
  };
  generateX25519Identity: () => Promise<string>;
  identityToRecipient: (identity: string) => Promise<string>;
};

function loadAgeModule(): AgeModule {
  const requireFrom = createRequire(path.join(repositoryRoot(), "package.json"));
  return requireFrom("age-encryption") as AgeModule;
}

export interface AgeRecipientKeys {
  readonly publicKey: string;
  readonly identitySecret: string;
}

export async function generateAgeRecipientKeys(): Promise<AgeRecipientKeys> {
  const age = loadAgeModule();
  const identitySecret = await age.generateX25519Identity();
  const publicKey = await age.identityToRecipient(identitySecret);
  return { publicKey, identitySecret };
}

export class AgeSealedChecksEncryptor {
  constructor(private readonly recipientPublicKey: string) {}

  async encryptCheck(check: SealedHiddenCheck): Promise<string> {
    const age = loadAgeModule();
    const encrypter = new age.Encrypter();
    encrypter.addRecipient(this.recipientPublicKey);
    const ciphertext = await encrypter.encrypt(check.contentJson);
    return age.armor.encode(ciphertext);
  }

  checksSealedPath(featureId: string): string {
    return `checks-sealed/${featureId}.age`;
  }
}