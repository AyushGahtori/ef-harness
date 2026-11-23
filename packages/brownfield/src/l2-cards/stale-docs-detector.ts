import type { L0GroundTruthPort } from "./ports.js";
import {
  STALE_DOC_AGE_DAYS,
  STALE_DOC_CHURN_THRESHOLD,
  type StaleDocFinding,
} from "./types.js";

const PATH_RE =
  /`((?:src|app|packages|lib|docs)\/[\w./-]+\.\w+)`|(src\/[\w./-]+\.\w+)|(POST|GET|PUT|DELETE)\s+(\/[\w./-]+)|`npm run ([\w:-]+)`|process\.env\.([A-Z0-9_]+)/gi;

const MS_PER_DAY = 86_400_000;

export interface StaleDocsDetectorOptions {
  readonly l0: L0GroundTruthPort;
  readonly docs: readonly { readonly path: string; readonly content: string }[];
  readonly symbolNames?: ReadonlySet<string>;
}

export class StaleDocsDetector {
  analyze(options: StaleDocsDetectorOptions): StaleDocFinding[] {
    const paths = options.l0.existingPaths();
    const scripts = options.l0.npmScripts();
    const symbols = options.symbolNames ?? new Set<string>();
    const findings: StaleDocFinding[] = [];

    for (const doc of options.docs) {
      const evidence: string[] = [];
      let broken = false;

      for (const match of doc.content.matchAll(PATH_RE)) {
        const fileRef = match[1] ?? match[2];
        if (fileRef && !paths.has(fileRef.replaceAll("\\", "/"))) {
          broken = true;
          evidence.push(`${doc.path} references ${fileRef} (not found in live repo)`);
        }
        const route = match[4];
        if (route && !symbols.has(route) && !this.routeExists(route, symbols)) {
          broken = true;
          evidence.push(`${doc.path} references ${route} (not found in code symbols)`);
        }
        const script = match[5];
        if (script && !scripts.has(script)) {
          broken = true;
          evidence.push(`${doc.path} mentions npm run ${script} (missing from package scripts)`);
        }
      }

      const docAgeMs = options.l0.docLastModifiedMs(doc.path);
      if (docAgeMs !== null) {
        const ageDays = (Date.now() - docAgeMs) / MS_PER_DAY;
        if (ageDays > STALE_DOC_AGE_DAYS) {
          for (const fileRef of this.citedPaths(doc.content)) {
            const churn = options.l0.churnByPath().get(fileRef) ?? 0;
            const codeMtime = options.l0.codeLastModifiedMs(fileRef);
            if (
              churn >= STALE_DOC_CHURN_THRESHOLD &&
              codeMtime !== null &&
              codeMtime > docAgeMs
            ) {
              broken = true;
              evidence.push(
                `${doc.path} untouched ${Math.floor(ageDays)}d while ${fileRef} changed ${churn} times`,
              );
            }
          }
        }
      }

      findings.push({
        docPath: doc.path,
        status: broken ? "likely_stale" : "fresh",
        evidence,
      });
    }
    return findings;
  }

  private citedPaths(content: string): string[] {
    const out: string[] = [];
    for (const match of content.matchAll(PATH_RE)) {
      const fileRef = match[1] ?? match[2];
      if (fileRef) out.push(fileRef.replaceAll("\\", "/"));
    }
    return out;
  }

  private routeExists(route: string, symbols: ReadonlySet<string>): boolean {
    for (const sym of symbols) {
      if (sym.includes(route)) return true;
    }
    return false;
  }
}