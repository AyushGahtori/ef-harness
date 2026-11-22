import { describe, expect, it } from "vitest";
import { WelcomeBackScreen } from "../../src/cockpit/welcome-back/index.js";
import type { WelcomeBackModel } from "../../src/cockpit/welcome-back/index.js";

describe("WelcomeBackScreen", () => {
  const screen = new WelcomeBackScreen();

  it("renders where we left off, what changed, and the three resume choices without starting work", () => {
    const view = screen.render(model());
    expect(view.skipped).toBe(false);
    expect(view.headings).toEqual([
      "Where we left off",
      "What changed while you were away",
      "Ready to continue",
    ]);
    expect(view.plainText).toContain("Welcome back to kitchen-app · last active Friday 18:40 (2 days ago)");
    expect(view.plainText).toContain("Phase: Wave 2 · ordering");
    expect(view.plainText).toContain("Why it stopped: budget");
    expect(view.plainText).toContain("3 tasks were interrupted by an unexpected shutdown — checkpoints recovered cleanly");
    expect(view.plainText).toContain(
      "Your repo is now on 'feature/experiment' — Sync harness base or keep building against 'main'?",
    );
    expect(view.plainText).toContain("You updated dependencies while away — Include in integration base?");
    expect(view.plainText).toContain("Include new dependency in harness/integration before resuming?");
    expect(view.plainText).toContain("ChatGPT allowance has reset!");
    expect(view.plainText).toContain("ChatGPT Plus allowance has reset — Ready to resume 6 remaining tasks");
    expect(view.plainText).toContain(
      "Looks like your commit 'fix cutoff tz' already resolved Task T-4 & Question Q-11 — Mark verified or Keep open?",
    );
    expect(view.plainText).toContain("Verify your commit against T-6's checks & mark done?");
    expect(view.plainText).toContain("You've been away more than 7 days");
    expect(view.autoStartWorkers).toBe(false);
    expect(view.autoEditFiles).toBe(false);
    expect(view.autoSpendTokens).toBe(false);
    expect(view.autoMutateGit).toBe(false);
    expect(view.requiresExplicitResume).toBe(true);
    expect(view.buttons.map((button) => button.label)).toEqual(["Resume Build", "Review Drift First", "Stay Paused"]);
    expect(screen.choose(view, "resume_build")).toMatchObject({ action: "Resume Build", runWorkers: false, mutateGit: false });
    expect(screen.choose(view, "review_drift_first")?.runWorkers).toBe(false);
    expect(screen.choose(view, "stay_paused")?.spendTokens).toBe(false);
  });

  it("skips the screen for an untouched new idle project", () => {
    const view = screen.render({ ...model(), showWelcome: false, blockedUntilResume: false, whatChanged: [] });
    expect(view.skipped).toBe(true);
    expect(view.buttons).toEqual([]);
    expect(view.requiresExplicitResume).toBe(false);
    expect(view.autoStartWorkers).toBe(false);
  });

  it("asks to locate a moved folder and keeps Resume disabled", () => {
    const view = screen.render({
      ...model(),
      folderMissing: true,
      whatChanged: ["Project folder moved — Locate folder"],
    });
    expect(view.plainText).toContain("Project folder moved — Locate folder");
    expect(view.buttons.find((button) => button.id === "locate_folder")?.enabled).toBe(true);
    expect(view.buttons.find((button) => button.id === "resume_build")?.enabled).toBe(false);
    expect(screen.choose(view, "resume_build")).toBeNull();
    expect(screen.choose(view, "locate_folder")).toMatchObject({ action: "Locate folder", editFiles: false });
  });
});

function model(): WelcomeBackModel {
  return {
    showWelcome: true,
    projectName: "kitchen-app",
    lastActiveLabel: "Friday 18:40 (2 days ago)",
    folderMissing: false,
    blockedUntilResume: true,
    whereWeLeftOff: ["Phase: Wave 2 · ordering", "Why it stopped: budget", "Parked: F12 print (~70% done)"],
    whatChanged: [
      "3 tasks were interrupted by an unexpected shutdown — checkpoints recovered cleanly",
      "Your repo is now on 'feature/experiment' — Sync harness base or keep building against 'main'?",
      "You updated dependencies while away — Include in integration base?",
      "Include new dependency in harness/integration before resuming?",
      "ChatGPT allowance has reset!",
      "ChatGPT Plus allowance has reset — Ready to resume 6 remaining tasks",
      "Looks like your commit 'fix cutoff tz' already resolved Task T-4 & Question Q-11 — Mark verified or Keep open?",
      "Verify your commit against T-6's checks & mark done?",
      "You've been away more than 7 days. Verify any expired OAuth tokens or upstream origin/main pulls before resuming.",
    ],
    readyLines: ["Remaining: 6 tasks — ordering, print", "Estimated cost $1.20 · window 5h"],
  };
}
