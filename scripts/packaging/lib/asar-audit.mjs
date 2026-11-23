import asar from "./asar-runtime.mjs";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_PATH_RE =
  /(^|\/)(\.env(\.|$)|.*\.env$)|(^|\/)tests\/|__styleguide|data-ef-source|(^|\/)fixtures\/secrets\//i;
const PRIVATE_KEY_RE = /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i;

/**
 * @param {string} asarPath
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function auditAsarFile(asarPath) {
  const issues = [];
  if (!fs.existsSync(asarPath)) {
    return { ok: false, issues: [`missing asar: ${asarPath}`] };
  }
  const files = asar.listPackage(asarPath);
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    if (FORBIDDEN_PATH_RE.test(normalized)) {
      issues.push(`forbidden path in asar: ${normalized}`);
      continue;
    }
    let buf;
    try {
      buf = asar.extractFile(asarPath, file);
    } catch {
      continue;
    }
    if (buf && buf.length < 512 * 1024) {
      const text = buf.toString("utf8");
      if (PRIVATE_KEY_RE.test(text)) {
        issues.push(`private key material in asar: ${normalized}`);
      }
      if (text.includes("data-ef-source=")) {
        issues.push(`dev-only data-ef-source tag in asar: ${normalized}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * @param {string} target asar file or win-unpacked directory
 */
export function resolveAsarPath(target) {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat?.isFile() && target.endsWith(".asar")) return target;
  if (stat?.isDirectory()) {
    const nested = path.join(target, "resources", "app.asar");
    if (fs.existsSync(nested)) return nested;
  }
  throw new Error(`could not resolve app.asar under ${target}`);
}