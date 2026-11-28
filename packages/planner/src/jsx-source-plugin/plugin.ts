import { projectRelative, tagJsxSource } from "./tagger.js";

export interface JsxSourcePluginOptions {
  readonly projectRoot: string;
  readonly mode?: string;
  readonly nodeEnv?: string;
}

export interface ViteResolvedConfig {
  readonly mode: string;
  readonly command: "build" | "serve";
}

export interface VitePluginLike {
  readonly name: string;
  readonly enforce: "pre";
  configResolved(config: ViteResolvedConfig): void;
  transform(code: string, id: string): { code: string; map: null } | null;
}

export interface BabelAttributeName {
  readonly type: string;
  readonly name?: string;
}

export interface BabelAttribute {
  readonly type: "JSXAttribute";
  readonly name: BabelAttributeName;
  readonly value: { readonly type: "StringLiteral"; readonly value: string };
}

export interface BabelOpeningElement {
  type: string;
  attributes: BabelAttribute[];
  loc: { readonly start: { readonly line: number; readonly column: number } } | null;
  name: BabelAttributeName;
}

export interface BabelNodePath {
  readonly node: BabelOpeningElement;
}

export interface BabelPluginState {
  readonly filename?: string;
  readonly file?: { readonly opts?: { readonly filename?: string } };
}

export interface BabelPluginObject {
  readonly name: string;
  readonly visitor: {
    JSXOpeningElement: (nodePath: BabelNodePath, state?: BabelPluginState) => void;
  };
}

export interface SwcSourcePlugin {
  readonly name: string;
  transform(code: string, id: string): string | null;
}

export function taggingEnabled(mode: string | undefined, nodeEnv: string | undefined): boolean {
  if (nodeEnv === "production") return false;
  if (mode === "production") return false;
  return true;
}

export function stripModuleId(id: string): string {
  const withoutVirtual = id.startsWith("\0") ? id.slice(1) : id;
  const query = withoutVirtual.indexOf("?");
  const hash = withoutVirtual.indexOf("#");
  let end = withoutVirtual.length;
  if (query >= 0) end = Math.min(end, query);
  if (hash >= 0) end = Math.min(end, hash);
  return withoutVirtual.slice(0, end);
}

function isTransformable(fileName: string, code: string): boolean {
  if (fileName.endsWith(".d.ts")) return false;
  if (/\.(tsx|jsx|vue)$/.test(fileName)) return true;
  if (!/\.(ts|js|mjs|cjs)$/.test(fileName)) return false;
  return /<[A-Za-z]/.test(code);
}

/**
 * Dev-only JSX source tagger for Vite, Babel, and SWC.
 * Production mode and NODE_ENV=production leave source bytes untouched.
 */
export class DevOnlyJsxSourceTagPlugin {
  readonly name = "ef-dev-only-jsx-source-tag" as const;
  private mode: string;
  private nodeEnv: string | undefined;

  constructor(private readonly options: JsxSourcePluginOptions) {
    this.mode = options.mode ?? "development";
    this.nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv;
  }

  get enabled(): boolean {
    return taggingEnabled(this.mode, this.nodeEnv);
  }

  setRuntime(mode: string, nodeEnv: string | undefined): void {
    this.mode = mode;
    this.nodeEnv = nodeEnv;
  }

  transform(code: string, id: string): { code: string; map: null } | null {
    if (!this.enabled) return null;
    const fileName = stripModuleId(id);
    const normalized = fileName.replaceAll("\\", "/");
    if (normalized.includes("/node_modules/")) return null;
    if (!isTransformable(normalized, code)) return null;
    const tagged = tagJsxSource(code, fileName, this.options.projectRoot);
    if (tagged === code) return null;
    return { code: tagged, map: null };
  }

  vite(): VitePluginLike {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Vite hook closures need stable plugin ref
    const plugin = this;
    return {
      name: this.name,
      enforce: "pre",
      configResolved(config) {
        const nodeEnv =
          config.mode === "production" || process.env.NODE_ENV === "production"
            ? "production"
            : process.env.NODE_ENV;
        plugin.setRuntime(config.mode, nodeEnv);
      },
      transform(code, id) {
        return plugin.transform(code, id);
      },
    };
  }

  babel(): () => BabelPluginObject {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Babel visitor needs stable plugin ref
    const plugin = this;
    return () => ({
      name: plugin.name,
      visitor: {
        JSXOpeningElement(nodePath, state) {
          if (!plugin.enabled) return;
          const node = nodePath.node;
          if (node.attributes.some((attr) => attr.name.name === "data-ef-source")) return;
          const filename = state?.file?.opts?.filename ?? state?.filename ?? "unknown.tsx";
          const loc = node.loc?.start;
          if (!loc) return;
          const relative = projectRelative(filename, plugin.options.projectRoot) ?? filename;
          const value = `${relative}:${loc.line}:${loc.column + 1}`;
          node.attributes.push({
            type: "JSXAttribute",
            name: { type: "JSXIdentifier", name: "data-ef-source" },
            value: { type: "StringLiteral", value },
          });
        },
      },
    });
  }

  swc(): SwcSourcePlugin {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- SWC transform needs stable plugin ref
    const plugin = this;
    return {
      name: this.name,
      transform(code, id) {
        const result = plugin.transform(code, id);
        return result ? result.code : null;
      },
    };
  }
}
