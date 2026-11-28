import type { HealthSignalKind, RemediationAction } from "./types.js";

function action(
  id: string,
  label: string,
  signalKind: HealthSignalKind,
): RemediationAction {
  return {
    id,
    label,
    signalKind,
    destructive: false,
    opensModal: false,
  };
}

export const STUCK_CLUSTER_LABEL = "Inspect / Nudge / Restart";
export const ALLOWANCE_CLUSTER_LABEL = "Switch connection / Keep parked";

export function stuckActions(): readonly RemediationAction[] {
  return [
    action("inspect", "Inspect", "stuck_no_progress"),
    action("nudge", "Nudge", "stuck_no_progress"),
    action("restart", "Restart", "stuck_no_progress"),
    action("restart_fresh_attempt", "Restart fresh attempt", "stuck_no_progress"),
    action("inspect_raw_stream", "Inspect raw stream", "stuck_no_progress"),
  ];
}

export function loopActions(): readonly RemediationAction[] {
  return [
    action("escalate_tier", "Escalate tier", "loop_detected"),
    action("give_hint", "Give hint", "loop_detected"),
    action("fix_it_myself", "I'll fix it myself", "loop_detected"),
  ];
}

export function backoffActions(): readonly RemediationAction[] {
  return [action("lower_concurrency", "Lower concurrency", "rate_limited_backoff")];
}

export function allowanceActions(): readonly RemediationAction[] {
  return [
    action("switch_connection", "Switch connection", "allowance_window_wait"),
    action("keep_parked", "Keep parked", "allowance_window_wait"),
    action("open_checkpoint_stop_card", "Open Checkpoint Stop Card", "allowance_window_wait"),
  ];
}

export function escalationActions(): readonly RemediationAction[] {
  return [
    action("open_dispute_decision_card", "Open Dispute/Decision Card", "escalated_or_retrying"),
  ];
}

export function recommendedClick(signals: readonly { kind: HealthSignalKind; actions: readonly RemediationAction[] }[]): string {
  const order: readonly HealthSignalKind[] = [
    "loop_detected",
    "escalated_or_retrying",
    "stuck_no_progress",
    "allowance_window_wait",
    "rate_limited_backoff",
  ];
  for (const kind of order) {
    const match = signals.find((signal) => signal.kind === kind);
    const label = match?.actions[0]?.label;
    if (label) return label;
  }
  return "Inspect";
}
