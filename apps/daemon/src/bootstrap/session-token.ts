import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Compare session tokens without leaking the raw string through `===`. */
export function timingSafeTokenEqual(left: string, right: string): boolean {
  const a = crypto.createHash("sha256").update(left, "utf8").digest();
  const b = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Replace `session.token` before the pipe starts listening.
 * Write a temp file, remove the previous token, then rename.
 */
export function writeSessionToken(file: string, token: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.session.token.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, token, { encoding: "utf8", mode: 0o600 });
  fs.rmSync(file, { force: true });
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
    if (!fs.existsSync(file)) throw error;
  }
}

export function readSessionToken(file: string): string {
  return fs.readFileSync(file, "utf8").trim();
}
