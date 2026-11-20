import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "#%+,-.=@_";
const ALL = `${UPPER}${LOWER}${DIGIT}${SYMBOL}`;

function pick(alphabet: string): string {
  const index = randomInt(0, alphabet.length);
  return alphabet[index] ?? alphabet[0] ?? "A";
}

export function generateSandboxPassword(length = 40): string {
  if (!Number.isInteger(length) || length < 32 || length > 120) {
    throw new Error("Sandbox password length must be between 32 and 120");
  }
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const swap = randomInt(0, i + 1);
    const current = chars[i];
    const other = chars[swap];
    if (current === undefined || other === undefined) continue;
    chars[i] = other;
    chars[swap] = current;
  }
  return chars.join("");
}

export function passwordLooksStrong(password: string): boolean {
  return (
    password.length >= 32 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[#%+,\-.=@_]/.test(password) &&
    !password.includes("\0") &&
    !password.includes("\n") &&
    !password.includes("\r")
  );
}
