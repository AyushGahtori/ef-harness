export interface DestructiveSqlAnalysis {
  readonly destructive: boolean;
  readonly riskyRename: boolean;
  readonly requiresExpandThenContract: boolean;
  readonly reasons: readonly string[];
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Flags live-deploy blockers. `DROP TABLE`, `DROP COLUMN`, and a destructive
 * column type change are `destructive`. Renames also require expand-then-contract.
 */
export function analyzeMigrationSql(sql: string): DestructiveSqlAnalysis {
  const source = stripSqlComments(sql);
  const reasons: string[] = [];
  if (/\bDROP\s+TABLE\b/i.test(source)) reasons.push("DROP TABLE");
  if (/\bDROP\s+COLUMN\b/i.test(source)) reasons.push("DROP COLUMN");
  if (/\bALTER\s+COLUMN\b[\s\S]{0,80}\bTYPE\b/i.test(source) || /\bSET\s+DATA\s+TYPE\b/i.test(source)) {
    reasons.push("ALTER COLUMN TYPE");
  }
  const riskyRename = /\bRENAME\s+(COLUMN|TO)\b/i.test(source);
  if (riskyRename) reasons.push("RENAME");
  const destructive = reasons.some((reason) => reason !== "RENAME");
  return {
    destructive,
    riskyRename,
    requiresExpandThenContract: destructive || riskyRename,
    reasons,
  };
}
