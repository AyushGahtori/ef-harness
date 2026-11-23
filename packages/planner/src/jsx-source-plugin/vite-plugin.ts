import { transformJsxWithSourceTags } from "./transform.js";
import type { DevOnlyJsxSourceTagPluginOptions, JsSourceBuildMode, ViteCompatiblePlugin } from "./types.js";

function resolveProduction(mode?: JsSourceBuildMode): boolean {
  if (mode === "production") return true;
  if (mode === "development") return false;
  return process.env.NODE_ENV === "production";
}

export function createDevOnlyJsxSourceTagPlugin(
  options: DevOnlyJsxSourceTagPluginOptions = {},
): ViteCompatiblePlugin {
  const rootDir = options.rootDir;
  return {
    name: "ef-dev-only-jsx-source-tag",
    enforce: "pre",
    transform(code, id) {
      const production = resolveProduction(options.mode);
      if (production) {
        return null;
      }
      const tagOpts =
        rootDir === undefined
          ? { production: false as const }
          : { production: false as const, rootDir };
      const next = transformJsxWithSourceTags(code, id, tagOpts);
      if (next === code) {
        return null;
      }
      return { code: next, map: null };
    },
  };
}

/** Task 161 export name from IMPLEMENTATION_TASKS.md */
export const DevOnlyJsxSourceTagPlugin = createDevOnlyJsxSourceTagPlugin;