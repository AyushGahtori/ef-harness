/**
 * Public verification pin for the bundled provider policy.
 * This is RFC 8032 Ed25519 test vector 1, not a production trust anchor.
 * Release wiring replaces the pin and re-signs provider-policy.json.
 */
export const PINNED_POLICY_KEY_ID = "rfc8032-test-1";

export const PINNED_POLICY_PUBLIC_KEY_HEX =
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

export function pinnedPolicyPublicKey(): Buffer {
  return Buffer.from(PINNED_POLICY_PUBLIC_KEY_HEX, "hex");
}
