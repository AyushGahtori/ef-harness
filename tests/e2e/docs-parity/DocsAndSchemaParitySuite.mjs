import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKS,
  formatIssues,
  runAllChecks,
  defaultRoot,
} from "../../../scripts/verify-docs-diagrams.mjs";

const suiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export class DocsAndSchemaParitySuite {
  /**
   * @param {string} [root]
   */
  constructor(root = defaultRoot()) {
    this.root = root;
  }

  runAll() {
    return runAllChecks(this.root);
  }

  /**
   * @param {keyof typeof CHECKS} name
   */
  runCheck(name) {
    const fn = CHECKS[name];
    if (!fn) throw new Error(`unknown parity check: ${name}`);
    return fn(this.root);
  }

  runCli() {
    const script = path.join(suiteRoot, "scripts", "verify-docs-diagrams.mjs");
    const result = spawnSync(process.execPath, [script, "--root", this.root], {
      cwd: suiteRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  static formatIssues(issues) {
    return formatIssues(issues);
  }

  static defaultRoot() {
    return suiteRoot;
  }
}

export { CHECKS, runAllChecks, formatIssues };