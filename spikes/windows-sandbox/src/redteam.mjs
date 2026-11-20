import { REDTEAM_TEST_IDS, TIER_ORDER } from "./capabilities.mjs";

const EXPECTED = {
  A: true,
  B: true,
  D: true,
};

/**
 * @param {string} tier
 * @param {string} testId
 */
export function expectedBlocked(tier, testId) {
  if (tier === "C" && (testId === "read-secret" || testId === "raw-tcp")) return false;
  if (tier === "C") return true;
  return EXPECTED[tier] === true;
}

/**
 * @param {string} tier
 * @param {string} testId
 * @param {boolean} expected
 * @param {boolean} actuallyBlocked
 * @param {number | null} exitCode
 * @param {string} detail
 */
export function redteamRow(tier, testId, expected, actuallyBlocked, exitCode, detail) {
  return {
    tier,
    testId,
    expectedBlocked: expected,
    actuallyBlocked,
    exitCode,
    detail,
  };
}

export function notRunRows(tier, detail) {
  return REDTEAM_TEST_IDS.map((testId) => redteamRow(
    tier,
    testId,
    expectedBlocked(tier, testId),
    false,
    null,
    `not_run: ${detail}`,
  ));
}

function accessBlocked(attempt) {
  return Boolean(attempt && attempt.ok === false && (attempt.code === "EPERM" || attempt.code === "EACCES"));
}

/**
 * @param {Record<string, any>} raw
 * @param {number | null} exitCode
 * @param {{ alive: number[] } | null} sleeperDead
 */
export function tierCRows(raw, exitCode, sleeperDead) {
  const readBlocked = raw.read?.code === "REFUSED_REAL_SSH" ? false : accessBlocked(raw.read);
  const tcpBlocked = raw.tcp?.blocked === true;
  const sleeperBlocked = Boolean(sleeperDead && sleeperDead.alive.length === 0);
  const rows = [
    redteamRow("C", "read-secret", false, readBlocked, exitCode, raw.read?.ok
      ? "read synthetic canary outside the worktree; Tier C does not deny reads the user can already perform"
      : `read failed code=${raw.read?.code || "unknown"}`),
    redteamRow("C", "write-outside", true, accessBlocked(raw.outside), exitCode, `write outside worktree code=${raw.outside?.code || (raw.outside?.ok ? "wrote" : "unknown")}`),
    redteamRow("C", "mutate-git-head", true, accessBlocked(raw.git), exitCode, `mutate .git/HEAD code=${raw.git?.code || (raw.git?.ok ? "wrote" : "unknown")}`),
    redteamRow("C", "raw-tcp", false, tcpBlocked, exitCode, `direct net.connect 1.1.1.1:443 ignored HTTP_PROXY; code=${raw.tcp?.code || "unknown"}`),
    redteamRow("C", "background-sleeper", true, sleeperBlocked, exitCode, sleeperBlocked
      ? `sleeper pid ${raw.sleeperPid} died after JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
      : `sleeper pid ${raw.sleeperPid} still alive`),
  ];
  return rows;
}

export function honestyProblems(tiers, rows) {
  /** @type {string[]} */
  const problems = [];
  if (tiers?.C?.networkEnforced !== false) problems.push("Tier C reported networkEnforced");
  if (tiers?.C?.secretReadsDenied !== false) problems.push("Tier C reported secretReadsDenied");
  for (const row of rows) {
    if (typeof row.actuallyBlocked !== "boolean") problems.push(`${row.tier} ${row.testId} actuallyBlocked is not boolean`);
    if (row.detail.startsWith("not_run") && row.actuallyBlocked) {
      problems.push(`${row.tier} ${row.testId} claimed blocked without running`);
    }
    if (row.tier === "C" && (row.testId === "read-secret" || row.testId === "raw-tcp") && row.actuallyBlocked) {
      problems.push(`Tier C claimed ${row.testId} was blocked`);
    }
    if (!row.detail.startsWith("not_run") && row.actuallyBlocked !== row.expectedBlocked) {
      problems.push(`${row.tier} ${row.testId} expected ${row.expectedBlocked} but observed ${row.actuallyBlocked}`);
    }
  }
  for (const tier of TIER_ORDER) {
    for (const testId of REDTEAM_TEST_IDS) {
      if (!rows.some((row) => row.tier === tier && row.testId === testId)) {
        problems.push(`missing red-team row ${tier} ${testId}`);
      }
    }
  }
  return problems;
}
