export const EF_SOURCE_ATTR = "data-ef-source" as const;

export type JsSourceBuildMode = "development" | "production";

export interface DevOnlyJsxSourceTagPluginOptions {
  readonly mode?: JsSourceBuildMode;
  readonly rootDir?: string;
}

/** Minimal Vite-compatible plugin surface (no vite dependency in this package). */
export interface ViteCompatiblePlugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly apply?: "serve" | "build";
  transform?: (
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ) => { code: string; map?: null } | null | undefined | void;
}

export interface TransformJsxSourceTagsOptions {
  readonly production: boolean;
  readonly rootDir?: string;
}

export interface SourceTagInjection {
  readonly line: number;
  readonly column: number;
  readonly tag: string;
  readonly value: string;
}