import fs from "node:fs";
import path from "node:path";

/**
 * Local model of the documented MXC/Windows deny-read rule: globs are expanded
 * to concrete paths when the sandboxed process starts. This does not claim the
 * kernel was measured.
 * @param {string} root
 * @param {string} suffix
 */
export function snapshotDenyRead(root, suffix) {
  /** @type {string[]} */
  const matched = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(suffix)) matched.push(full);
    }
  };
  walk(root);
  matched.sort();
  return {
    matched,
    evaluatedAt: "process-start",
    laterCreatesRemainReadable: true,
  };
}
