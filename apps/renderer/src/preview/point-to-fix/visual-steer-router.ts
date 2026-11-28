import { VisualSteerV1Schema } from "@ef-harness/shared-contracts";
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

export interface VisualSteerCodeIndex {
  filesReferencing(componentFile: string): readonly string[];
  fileForUnsourcedPick?(pick: PickContextBundle): string | null;
}

export interface VisualSteerDaemonPort {
  route(instruction: string, pick: PickContextBundle): VisualSteerRouteResult;
}

export interface VisualSteerRouterOptions {
  readonly workspaceRoot: string;
  readonly nodeIdPrefix?: string;
  readonly daemon?: VisualSteerDaemonPort;
  readonly codeIndex?: VisualSteerCodeIndex;
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
  readonly #daemon: VisualSteerDaemonPort | null;
  readonly #codeIndex: VisualSteerCodeIndex | null;

  constructor(options: VisualSteerRouterOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#nodeIdPrefix = options.nodeIdPrefix ?? "ptf";
    this.#daemon = options.daemon ?? null;
    this.#codeIndex = options.codeIndex ?? null;
  }

  route(instruction: string, pick: PickContextBundle): VisualSteerRouteResult {
    if (this.#daemon) return this.#daemon.route(instruction, pick);
    const primaryFile = this.#resolvePrimaryFile(pick) ?? this.#codeIndex?.fileForUnsourcedPick?.(pick) ?? null;
    if (!primaryFile) {
      return { accepted: false, reason: "source file is not in the code index", writeScope: [] };
    }
    const validation = validateEfSourceInWorkspace(primaryFile, this.#workspaceRoot);
    if (!validation.ok) {
      return {
        accepted: false,
        ...(validation.reason !== undefined ? { reason: validation.reason } : {}),
        writeScope: [],
      };
    }
    const scopedFile = validation.normalized ?? primaryFile;
    const references = this.#codeIndex?.filesReferencing(scopedFile) ?? [];
    const sharedPrimitive = isSharedPrimitivePath(scopedFile) || GLOBAL_INTENT_PATTERN.test(instruction);
    const localOnly = /\b(only here|just this|this screen)\b/i.test(instruction);
    const needsQuestion = sharedPrimitive && !localOnly;
    const screenCount = references.length;
    const scopePrompt = needsQuestion
      ? screenCount > 0
        ? `This changes shared Button across ${screenCount} screens — Change only here or update the shared design system?`
        : "Change only here or update the shared design system?"
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
    const parsed = VisualSteerV1Schema.safeParse(steer);
    if (!parsed.success || !("target" in parsed.data)) {
      return { accepted: false, reason: "visual-steer@1 output was rejected", writeScope: [] };
    }
    return {
      accepted: true,
      steer: parsed.data,
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