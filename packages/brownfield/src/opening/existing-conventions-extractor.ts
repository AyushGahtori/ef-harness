import type { GitLogPort, L0StackSnapshot, RepoFileReaderPort } from "./contracts.js";
import { estimateTokens, type ConventionsCard } from "./types.js";

const CONVENTIONS_TOKEN_LIMIT = 600;

export interface ConventionsExtractorDeps {
  readonly files: RepoFileReaderPort;
  readonly git: GitLogPort;
}

export class ExistingConventionsExtractor {
  constructor(private readonly deps: ConventionsExtractorDeps) {}

  extract(snapshot: L0StackSnapshot): ConventionsCard {
    const lines: string[] = ["## Observed repo conventions", ""];

    const prettier = this.findConfig(snapshot, /\.prettierrc/i);
    if (prettier) {
      const body = this.deps.files.readText(prettier);
      const indent = body?.includes('"tabWidth": 2') || body?.includes("'tabWidth': 2") ? "2 spaces" : "detected";
      const quotes = body?.includes("singleQuote") && !body.includes('"singleQuote": false') ? "single quotes" : "default";
      lines.push(`- **Formatting:** Prettier (${indent}, ${quotes}) via \`${prettier}\``);
    }

    const eslint = this.findConfig(snapshot, /eslint\.config/i);
    if (eslint) {
      lines.push(`- **Lint:** ESLint flat config at \`${eslint}\``);
    }

    const tsconfig = this.findConfig(snapshot, /tsconfig(\.base)?\.json$/i);
    if (tsconfig) {
      const body = this.deps.files.readText(tsconfig) ?? "";
      const strict = /"strict"\s*:\s*true/.test(body) ? "strict" : "non-strict";
      const paths = /"@\/\*"/.test(body) ? "`@/*` path alias" : "no `@/*` alias detected";
      lines.push(`- **TypeScript:** ${strict}; ${paths} (\`${tsconfig}\`)`);
    }

    const colocated = this.deps.files.listPathsMatching("src").filter((p) => /\.(test|spec)\.tsx?$/.test(p));
    const dunder = this.deps.files.listPathsMatching("__tests__");
    const testStyle =
      colocated.length >= dunder.length
        ? "colocated `*.test.ts` / `*.spec.ts`"
        : "centralized `__tests__/`";
    lines.push(`- **Tests:** ${testStyle} with ${snapshot.testRunners.join(", ") || "unknown runner"}`);

    const componentsUi = this.deps.files.listPathsMatching("src/components/ui");
    if (componentsUi.length > 0) {
      lines.push(`- **UI primitives:** reuse \`src/components/ui/*\` (${componentsUi.length} files)`);
    }

    const apiHandlers = this.deps.files
      .listPathsMatching("src")
      .filter((p) => /route\.ts$|handler\.ts$|hono/i.test(p));
    if (apiHandlers.length > 0) {
      lines.push(`- **API handlers:** follow existing handler layout (e.g. \`${apiHandlers[0]}\`)`);
    }

    const commits = this.deps.git.recentCommitSubjects(12);
    const conventional = commits.filter((s) => /^(feat|fix|chore|refactor|docs)(\(.+\))?:/.test(s)).length;
    if (commits.length > 0) {
      const style = conventional >= Math.ceil(commits.length / 2) ? "conventional commits" : "mixed";
      lines.push(`- **Commits:** ${style} (sample: \`${commits[0]}\`)`);
    }

  if (snapshot.orms.length > 0) {
    lines.push(`- **Data layer:** ${snapshot.orms.join(", ")} idioms; match existing query patterns`);
  }

  let markdown = lines.join("\n");
  let tokens = estimateTokens(markdown);
  while (tokens > CONVENTIONS_TOKEN_LIMIT && lines.length > 3) {
    lines.pop();
    markdown = lines.join("\n");
    tokens = estimateTokens(markdown);
  }

    return {
      markdown,
      estimatedTokens: tokens,
      basis: "observed",
    };
  }

  private findConfig(snapshot: L0StackSnapshot, pattern: RegExp): string | null {
    return snapshot.configFiles.find((p) => pattern.test(p)) ?? null;
  }
}