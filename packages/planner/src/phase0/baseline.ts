import fs from "node:fs";
import path from "node:path";

import { NodeCommandRunner } from "./command-runner.js";
import type { BaselineReport, BaselineTestHealthPort } from "./ports.js";

/** Local port for `Task 170`. Known failures are the quarantine list; other tests must pass. */
export class LocalBaselineTestHealthRunner implements BaselineTestHealthPort {
  constructor(private readonly knownFailures: readonly string[]) {}

  async run(repoPath: string): Promise<BaselineReport> {
    const legacy = path.join(repoPath, "src", "legacy.mjs");
    let legacyStatus: "pass" | "fail" = "fail";
    if (fs.existsSync(legacy)) {
      const result = await new NodeCommandRunner().run(
        { id: "legacy", display: "node src/legacy.mjs", argv: ["node", "src/legacy.mjs"] },
        repoPath,
      );
      legacyStatus = result.exitCode === 0 ? "pass" : "fail";
    }
    return {
      results: [
        ...this.knownFailures.map((id) => ({ id, status: "fail" as const, preExisting: true })),
        { id: "legacy-unit", status: legacyStatus, preExisting: false },
      ],
    };
  }
}
