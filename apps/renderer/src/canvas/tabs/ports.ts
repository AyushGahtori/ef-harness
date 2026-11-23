import type {
  CrewPreset,
  PricedLeaf,
  PlanSnapshot,
  ReviewGroup,
  ReviewSettleCommand,
  ReviewSettleResult,
} from "./types.js";

export interface EarsOracleInput {
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface EarsOracleResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export interface EarsOracleValidatorPort {
  validate(input: EarsOracleInput): EarsOracleResult;
}

export interface ProposedRequirementReviewQueuePort {
  groups(): readonly ReviewGroup[];
  approveAll(featureId: string, matrixId?: string): ReviewSettleResult;
  settle(command: ReviewSettleCommand): ReviewSettleResult;
}

export interface ScreenSpecInput {
  readonly id: string;
  readonly title: string;
  readonly states: readonly string[];
}

export interface LowFiWireframeRendererPort {
  render(spec: ScreenSpecInput): { readonly svg: string };
}

export interface VsCodeOpenerPort {
  open(absolutePath: string): void;
}

export interface ClipboardPort {
  write(text: string): void;
}

export interface InspectorSelection {
  readonly taskId: string;
  readonly host: "collapsible-shell" | "popout";
}

export interface WorkerInspectorPort {
  show(selection: InspectorSelection): void | Promise<void>;
}

export interface StartBuildPort {
  start(): void;
}

export interface ChosenForYouOverridePort {
  override(criterionId: string): void;
}

export interface InteractivePlanEditorPort {
  switchPreset(preset: CrewPreset, snapshot: PlanSnapshot): {
    readonly preset: CrewPreset;
    readonly leaves: readonly PricedLeaf[];
    readonly elapsedMs: number;
  };
}

export class LocalVsCodeOpener implements VsCodeOpenerPort {
  readonly commands: string[] = [];

  open(absolutePath: string): void {
    this.commands.push(`code ${absolutePath}`);
  }
}

export class LocalClipboard implements ClipboardPort {
  text = "";

  write(text: string): void {
    this.text = text;
  }
}

export class LocalWorkerInspector implements WorkerInspectorPort {
  shown: InspectorSelection | null = null;

  show(selection: InspectorSelection): void {
    this.shown = { taskId: selection.taskId, host: selection.host };
  }
}

export class LocalStartBuild implements StartBuildPort {
  calls = 0;

  start(): void {
    this.calls += 1;
  }
}

export class LocalChosenForYouOverride implements ChosenForYouOverridePort {
  readonly overridden: string[] = [];

  override(criterionId: string): void {
    this.overridden.push(criterionId);
  }
}
