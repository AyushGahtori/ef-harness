import { validateEfSourceInWorkspace } from "./source-path.js";
import type {
  ElementPickContext,
  PickContextBundle,
  VisualSteerRouteResult,
  VisualSteerTargetKind,
  VisualSteerV1Output,
} from "./types.js";

const SHARED_PRIMITIVE_PATHS = [
  "src/components/ui/button.tsx",
  "design/tokens.json",
] as const;

const GLOBAL_INTENT_PATTERN =
  /\b(all|every|global|primary buttons?|shared|everywhere|token)\b/i;

export interface VisualSteerRouterOptions {
  readonly workspaceRoot: string;
  readonly nodeIdPrefix?: string;
}

function inferTargetKind(instruction: string): VisualSteerTargetKind {
  if (/\b(align|gap|padding|margin|flex|grid|width|height)\b/i.test(instruction)) {
    return "layout";
  }
  if (/\b(color|font|purple|orange|green|style)\b/i.test(instruction)) {
    return "style";
  }
  if (/\b(label|text|copy|title|placeholder)\b/i.test(instruction)) {
    return "copy";
  }
  return "behavior";
}

function isSharedPrimitivePath(file: string | null | undefined): boolean {
  if (!file) return false;
  const norm = file.replaceAll("\\", "/").toLowerCase();
  return SHARED_PRIMITIVE_PATHS.some((p) => norm.endsWith(p.toLowerCase()));
}

function componentNameFromFile(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.[tj]sx?$/, "");
}

export class VisualSteerRouter {
  readonly #workspaceRoot: string;
  readonly #nodeIdPrefix: string;

  constructor(options: VisualSteerRouterOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#nodeIdPrefix = options.nodeIdPrefix ?? "ptf";
  }

  route(instruction: string, pick: PickContextBundle): VisualSteerRouteResult {
    const primaryFile = this.#resolvePrimaryFile(pick);
    if (primaryFile) {
      const validation = validateEfSourceInWorkspace(primaryFile, this.#workspaceRoot);
      if (!validation.ok) {
        return {
          accepted: false,
          ...(validation.reason !== undefined ? { reason: validation.reason } : {}),
          writeScope: [],
        };
      }
    }

    const scopedFile = primaryFile ?? "src/unknown/Unknown.tsx";
    const sharedPrimitive =
      isSharedPrimitivePath(scopedFile) || GLOBAL_INTENT_PATTERN.test(instruction);
    const localOnly = /\b(only here|just this|this screen)\b/i.test(instruction);

    const needsQuestion = sharedPrimitive && !localOnly;
    const scopePrompt = needsQuestion
      ? "This changes shared Button across 8 screens — Change only here or update shared design system?"
      : undefined;

    const steer: VisualSteerV1Output = {
      target: {
        kind: inferTargetKind(instruction),
        node_id: `${this.#nodeIdPrefix}-${hash(scopedFile)}`,
        file: scopedFile,
        component: componentNameFromFile(scopedFile),
      },
      intent: instruction.trim(),
      needs_question: needsQuestion,
      conflict: null,
    };

    return {
      accepted: true,
      steer,
      writeScope: [scopedFile],
      ...(scopePrompt !== undefined ? { scopePrompt } : {}),
    };
  }

  #resolvePrimaryFile(pick: PickContextBundle): string | null {
    if (pick.kind === "element") {
      return pick.efSource?.file ?? pick.ancestorSources[0]?.file ?? null;
    }
    const first = pick.intersectingElements.find((el: ElementPickContext) => el.efSource)?.efSource;
    return first?.file ?? null;
  }
}

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function createVisualSteerRouter(options: VisualSteerRouterOptions): VisualSteerRouter {
  return new VisualSteerRouter(options);
}