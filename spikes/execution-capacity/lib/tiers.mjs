import { spawnCaptured } from "./spawn.mjs";

/**
 * @param {number} build
 * @param {number} ubr
 */
export function mxcBuildQualified(build, ubr) {
  if (build > 26200) return true;
  if (build === 26200) return ubr >= 9278;
  if (build === 26100) return ubr >= 9278;
  return false;
}

/**
 * @param {Record<string, unknown>} sample
 * @param {{ freeBytes: number }} host
 */
export async function probeTiers(sample, host) {
  const build = Number(sample.osBuild ?? 0);
  const ubr = Number(sample.osUbr ?? 0);
  const qualified = mxcBuildQualified(build, ubr);
  const wsl = await spawnCaptured("where.exe", ["wsl.exe"], { timeoutMs: 4000 });
  const docker = await spawnCaptured("where.exe", ["docker.exe"], { timeoutMs: 4000 });
  const tierDInstalled = wsl.code === 0 || docker.code === 0;
  const tierDReason = !tierDInstalled
    ? "wsl_and_docker_not_installed"
    : host.freeBytes < 6 * 1024 * 1024 * 1024
      ? "left_stopped_low_free_memory"
      : "not_launched_in_this_spike";
  return {
    tier_a: {
      available: false,
      osQualified: qualified,
      reason: qualified ? "mxc_api_not_bound" : "os_build_below_mxc",
    },
    tier_c: {
      available: false,
      reason: "restricted_token_process_not_launched",
    },
    tier_d: {
      available: false,
      wslFound: wsl.code === 0,
      dockerFound: docker.code === 0,
      reason: tierDReason,
    },
  };
}
