export function livePrefix(): string {
  return ["sk", "_live_"].join("");
}

export function syntheticLiveKey(): string {
  return `${livePrefix()}synthetic_test_${"0".repeat(16)}`;
}

export function entropyToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < 48; index += 1) {
    out += alphabet[(index * 17 + 11) % alphabet.length] ?? "A";
  }
  return out;
}

export function vaultValue(): string {
  return `vault/canary+value=${"0123456789abcdef"}`;
}

export function fixtureMarker(): string {
  return ["test-fixture", "-not-secret"].join("");
}

export function pemBlock(): string {
  const begin = ["-----", "BEGIN", " ", "PRIVATE", " ", "KEY-----"].join("");
  const end = ["-----", "END", " ", "PRIVATE", " ", "KEY-----"].join("");
  return `${begin}\n${"A".repeat(32)}\n${end}\n`;
}
