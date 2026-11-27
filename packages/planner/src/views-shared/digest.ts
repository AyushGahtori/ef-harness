import { toPrefixedSha256 } from "@ef-harness/shared-contracts";

/** Normalize a bare or prefixed digest. Invalid text is returned unchanged. */
export function asPrefixedSha256(value: string): string {
  try {
    return toPrefixedSha256(value);
  } catch {
    return value;
  }
}

/** True when both strings are the same SHA-256 digest, with or without the `sha256:` prefix. */
export function sameSha256(left: string, right: string): boolean {
  const prefixedLeft = asPrefixedSha256(left);
  const prefixedRight = asPrefixedSha256(right);
  if (prefixedLeft.startsWith("sha256:") && prefixedRight.startsWith("sha256:")) {
    return prefixedLeft === prefixedRight;
  }
  return left === right;
}
