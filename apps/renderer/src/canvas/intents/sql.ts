/**
 * Canonical `impact_walk` text from schema/queries.sql.
 * The cycle-safe statement is that walk plus a visited-path guard and
 * `belongs_to` / `consumes`, matching Task 087 `ReverseImpactWalker.walkCombined`.
 */
export const CANONICAL_IMPACT_WALK_SQL = `WITH RECURSIVE impact(id, depth) AS (
  SELECT :start, 0
  UNION
  SELECT e.src, i.depth + 1
    FROM impact i
    JOIN edges e ON e.dst = i.id AND e.valid_to_rev IS NULL
    JOIN edge_types t ON t.type = e.type AND t.invalidates = 1
   WHERE i.depth < :max_depth
  LIMIT 5001
)
SELECT id, min(depth) AS depth FROM impact GROUP BY id;`;

export const CYCLE_SAFE_IMPACT_WALK_SQL = `WITH RECURSIVE impact(id, depth, seen) AS (
  SELECT :start, 0, char(1) || :start || char(1)
  UNION
  SELECT e.src, i.depth + 1, i.seen || e.src || char(1)
    FROM impact i
    JOIN edges e ON e.dst = i.id AND e.valid_to_rev IS NULL
    JOIN edge_types t ON t.type = e.type
      AND (t.invalidates = 1 OR t.type = 'belongs_to' OR t.type = 'consumes')
   WHERE i.depth < :max_depth
     AND instr(i.seen, char(1) || e.src || char(1)) = 0
  LIMIT 5001
)
SELECT id, min(depth) AS depth FROM impact GROUP BY id;`;
