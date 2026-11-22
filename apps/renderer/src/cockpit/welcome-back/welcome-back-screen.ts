import type { WelcomeActionId, WelcomeBackModel, WelcomeButton, WelcomeChoice } from "./model.js";

export interface WelcomeBackView {
  readonly skipped: boolean;
  readonly title: string;
  readonly headings: readonly string[];
  readonly whereWeLeftOff: readonly string[];
  readonly whatChanged: readonly string[];
  readonly readyToContinue: readonly string[];
  readonly buttons: readonly WelcomeButton[];
  readonly plainText: string;
  readonly autoStartWorkers: false;
  readonly autoEditFiles: false;
  readonly autoSpendTokens: false;
  readonly autoMutateGit: false;
  readonly requiresExplicitResume: boolean;
}

const WHERE = "Where we left off";
const CHANGED = "What changed while you were away";
const READY = "Ready to continue";

/**
 * Calm cold-open summary. Rendering never starts workers, edits files,
 * spends tokens, or mutates Git. Those stay behind an explicit Resume.
 */
export class WelcomeBackScreen {
  render(model: WelcomeBackModel): WelcomeBackView {
    return renderWelcomeBack(model);
  }

  choose(view: WelcomeBackView, id: WelcomeActionId): WelcomeChoice | null {
    const button = view.buttons.find((item) => item.id === id);
    if (!button || !button.enabled) return null;
    return {
      action: button.label,
      runWorkers: false,
      editFiles: false,
      spendTokens: false,
      mutateGit: false,
    };
  }
}

export function renderWelcomeBack(model: WelcomeBackModel): WelcomeBackView {
  if (!model.showWelcome) {
    return {
      skipped: true,
      title: "",
      headings: [],
      whereWeLeftOff: [],
      whatChanged: [],
      readyToContinue: [],
      buttons: [],
      plainText: "",
      autoStartWorkers: false,
      autoEditFiles: false,
      autoSpendTokens: false,
      autoMutateGit: false,
      requiresExplicitResume: false,
    };
  }
  const title = `Welcome back to ${model.projectName} · last active ${model.lastActiveLabel}`;
  const buttons = model.folderMissing
    ? [
        button("locate_folder", "Locate folder", true),
        button("review_drift_first", "Review Drift First", true),
        button("stay_paused", "Stay Paused", true),
        button("resume_build", "Resume Build", false),
      ]
    : [
        button("resume_build", "Resume Build", true),
        button("review_drift_first", "Review Drift First", true),
        button("stay_paused", "Stay Paused", true),
      ];
  const headings = [WHERE, CHANGED, READY] as const;
  const plain = [
    title,
    "",
    WHERE,
    ...model.whereWeLeftOff,
    "",
    CHANGED,
    ...model.whatChanged,
    "",
    READY,
    ...model.readyLines,
    buttons.map((item) => `[${item.label}${item.enabled ? "" : " disabled"}]`).join("  "),
  ].join("\n");
  return {
    skipped: false,
    title,
    headings: [...headings],
    whereWeLeftOff: model.whereWeLeftOff,
    whatChanged: model.whatChanged,
    readyToContinue: model.readyLines,
    buttons,
    plainText: plain,
    autoStartWorkers: false,
    autoEditFiles: false,
    autoSpendTokens: false,
    autoMutateGit: false,
    requiresExplicitResume: model.blockedUntilResume,
  };
}

function button(
  id: WelcomeButton["id"],
  label: WelcomeButton["label"],
  enabled: boolean,
): WelcomeButton {
  return { id, label, enabled };
}
