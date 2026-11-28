import {
  PHASE_LABEL,
  type BannerPresentation,
  type CenterTab,
  type PhaseTransition,
  type UserActivity,
} from "./types.js";

export interface BannerAnnounceResult {
  readonly shown: boolean;
  readonly banner: BannerPresentation | null;
  readonly activity: UserActivity;
  readonly activeTab: CenterTab;
  readonly composerText: string;
  readonly composerFocused: boolean;
  readonly inspecting: boolean;
  readonly focusStolen: false;
  readonly activeTabChanged: false;
  readonly llmCalls: 0;
}

export interface BannerKeyResult {
  readonly consumed: boolean;
  readonly accepted: boolean;
  readonly transition: PhaseTransition | null;
}

const STAY_LABEL = "Stay here" as const;

/**
 * A calm top-of-center toast. Announcing a phase never changes the active tab,
 * moves focus, or touches composer text. The layout changes only after an
 * explicit Switch click, or Enter when the user is not typing or inspecting.
 */
export class NonDisruptivePhaseSwitchBanner {
  private current: BannerPresentation | null = null;
  private readonly dismissed = new Set<string>();

  announce(transition: PhaseTransition, activity: UserActivity): BannerAnnounceResult {
    if (transition.from === transition.to || this.dismissed.has(transition.id)) {
      return this.echo(activity, false, this.current);
    }
    const copy = bannerCopy(transition);
    this.current = {
      visible: true,
      blocking: false,
      placement: "top-of-center",
      ariaLive: "polite",
      message: copy.message,
      switchLabel: copy.switchLabel,
      stayLabel: STAY_LABEL,
      acceptKey: "Enter",
      focusStolen: false,
      activeTabChanged: false,
      llmCalls: 0,
      transition,
    };
    return this.echo(activity, true, this.current);
  }

  view(): BannerPresentation | null {
    return this.current;
  }

  /** One click on the banner's switch action. Does not itself change layout. */
  accept(): PhaseTransition | null {
    const transition = this.current?.transition ?? null;
    this.current = null;
    return transition;
  }

  stay(): void {
    if (this.current) {
      this.dismissed.add(this.current.transition.id);
    }
    this.current = null;
  }

  handleKey(key: string, activity: UserActivity): BannerKeyResult {
    if (this.current === null) {
      return { consumed: false, accepted: false, transition: null };
    }
    if (activity.composerFocused || activity.typing || activity.inspecting) {
      return { consumed: false, accepted: false, transition: null };
    }
    if (key !== "Enter") {
      return { consumed: false, accepted: false, transition: null };
    }
    const transition = this.accept();
    return { consumed: true, accepted: transition !== null, transition };
  }

  private echo(
    activity: UserActivity,
    shown: boolean,
    banner: BannerPresentation | null,
  ): BannerAnnounceResult {
    return {
      shown,
      banner: shown ? banner : null,
      activity,
      activeTab: activity.activeTab,
      composerText: activity.composerText,
      composerFocused: activity.composerFocused,
      inspecting: activity.inspecting,
      focusStolen: false,
      activeTabChanged: false,
      llmCalls: 0,
    };
  }
}

function bannerCopy(transition: PhaseTransition): { message: string; switchLabel: string } {
  const planReady =
    transition.to === "plan" &&
    (transition.reason === "discovery-ready-for-plan" || transition.from === "discover");
  if (planReady) {
    return {
      message: "Plan is ready to review → Switch to Plan",
      switchLabel: "Switch to Plan",
    };
  }
  const shipReady =
    transition.to === "ship" &&
    (transition.reason === "completion-wave-ready-for-ship" || transition.from === "build");
  if (shipReady) {
    return {
      message: "Build complete — Ready to Ship → Switch to Ship",
      switchLabel: "Switch to Ship",
    };
  }
  const label = PHASE_LABEL[transition.to];
  return {
    message: `Switch to the ${label} layout?`,
    switchLabel: `Switch to ${label}`,
  };
}
