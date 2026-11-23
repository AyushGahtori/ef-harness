export async function encryptAgePayload(recipient: string, plaintext: string): Promise<string> {
  const age = await import("age-encryption");
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(plaintext);
  return age.armor.encode(ciphertext);
}