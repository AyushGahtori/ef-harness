import { canonicalLockfile, dependenciesFromIntents, lockfileHash } from "./lockfile.js";
import type { InstallRequest, InstallResult, KernelPackageInstallerPort } from "./ports.js";

/**
 * Local kernel installer. It never spawns `npm` or `pnpm` and it never runs
 * package scripts. Unapproved names and an offline registry fail closed.
 */
export class LocalKernelPackageInstaller implements KernelPackageInstallerPort {
  readonly calls: InstallRequest[] = [];

  install(request: InstallRequest): InstallResult {
    this.calls.push(request);
    if (request.frozenLockfile !== true) {
      return fail("kernel installer requires pnpm install --frozen-lockfile");
    }
    if (request.offline) {
      return fail("offline registry: registry.npmjs.org unreachable");
    }
    for (const dep of request.dependencies) {
      if (!dep.approved) {
        return fail(`unapproved dependency: ${dep.name}@${dep.version}`);
      }
      if (!/^[a-z0-9@][a-z0-9._/-]*$/i.test(dep.name) || !/^\d+\.\d+\.\d+$/.test(dep.version)) {
        return fail(`unapproved dependency: ${dep.name}@${dep.version}`);
      }
    }
    const lockfileBody = canonicalLockfile(request.dependencies);
    return {
      ok: true,
      lockfileBody,
      lockfileHash: lockfileHash(lockfileBody),
      packageDependencies: dependenciesFromIntents(request.dependencies),
      error: null,
    };
  }
}

function fail(error: string): InstallResult {
  return { ok: false, lockfileBody: "", lockfileHash: "", packageDependencies: {}, error };
}
