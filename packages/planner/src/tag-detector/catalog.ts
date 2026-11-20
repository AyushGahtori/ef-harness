import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { StaticRuleLintGate } from "./lint.js";
import { m2StagePort } from "./m2-stage-port.js";
import { rulesSeamsDir } from "./paths.js";
import type { StageCatalog } from "./stage-coherence.js";
import { CatalogValidationError, parseCrossCuttingDocument, type CrossCuttingRule } from "./rules.js";
import { parseSeamDocument, type SeamTemplate } from "./seams.js";

export interface RulesSeamsCatalog {
  readonly rules: readonly CrossCuttingRule[];
  readonly seams: readonly SeamTemplate[];
  readonly stageCatalog: StageCatalog;
}

function readYaml(filePath: string): unknown {
  return parse(fs.readFileSync(filePath, "utf8"), { uniqueKeys: true });
}

export class RulesSeamsCatalogLoader {
  constructor(private readonly directory: string = rulesSeamsDir()) {}

  loadRules(): readonly CrossCuttingRule[] {
    let rules: CrossCuttingRule[];
    try {
      rules = parseCrossCuttingDocument(
        readYaml(path.join(this.directory, "cross-cutting-rules.yaml")),
      );
    } catch (error) {
      if (error instanceof CatalogValidationError) throw error;
      throw new CatalogValidationError([error instanceof Error ? error.message : String(error)]);
    }
    const lint = new StaticRuleLintGate().lintRules(rules, { inventory: true });
    if (!lint.ok) throw new CatalogValidationError(lint.violations);
    return rules;
  }

  loadSeams(): readonly SeamTemplate[] {
    let seams: SeamTemplate[];
    try {
      seams = parseSeamDocument(readYaml(path.join(this.directory, "seam-templates.yaml")));
    } catch (error) {
      throw new CatalogValidationError([error instanceof Error ? error.message : String(error)]);
    }
    const lint = new StaticRuleLintGate().lintSeams(seams, { inventory: true });
    if (!lint.ok) throw new CatalogValidationError(lint.violations);
    return seams;
  }

  /**
   * Task 075/076 question packs are not on this branch. The stage self-test
   * reads the local 44-question port until those catalogs are integrated.
   */
  loadStageCatalog(): StageCatalog {
    return m2StagePort();
  }

  load(): RulesSeamsCatalog {
    return {
      rules: this.loadRules(),
      seams: this.loadSeams(),
      stageCatalog: this.loadStageCatalog(),
    };
  }
}
