import { TIER_ORDER } from "./capabilities.mjs";

export const APPCONTAINER_DECISION = {
  selected: false,
  primaryTier: false,
  reason:
    "AppContainer is not a primary tier. It is a capability profile for one known application package, and Node, Git, and pnpm are not written for that profile: they load arbitrary tool DLLs, spawn compilers, and read toolchain directories the profile does not grant. Codex's MXC path refuses the older AppContainer fallback and requires the process security environment. This spike checks those tools under the write-restricted token instead, and does not launch an AppContainer.",
};

export const DESKTOP_CONSTRAINT =
  "UIPI only blocks a lower-integrity sender from delivering window messages to a higher-integrity window. A Tier C write-restricted token is still the developer's medium-integrity user, so UIPI does not stop SendInput into the developer's windows. JOB_OBJECT_UILIMIT_HANDLES and the other job UI limits block clipboard, global atoms, and some USER handle reuse; they do not retarget the input desktop. Stopping injection requires a separate window station and desktop whose DACL excludes the sandbox identity. CreateDesktop on WinSta0 can succeed for the interactive user and still leave SendInput on the real desktop. CreateWindowStation for a private station is often denied without extra privileges. Tier B, running as a different user on a private desktop, is the tier that can make that boundary real.";

function cell(value) {
  return String(value ?? "").replaceAll("|", "/");
}

function redteamStatus(row) {
  if (String(row.detail).startsWith("not_run")) return "not_run";
  return row.actuallyBlocked === row.expectedBlocked ? "pass" : "fail";
}

/**
 * @param {Record<string, any>} report
 */
export function renderReport(report) {
  const lines = [];
  lines.push("# Windows sandbox spike report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Host build: ${report.host.osBuild || "unknown"}`);
  lines.push(`Elevation: admin group ${report.host.adminGroup}, elevated ${report.host.elevated}.`);
  lines.push("");
  lines.push("## Tier matrix");
  lines.push("");
  lines.push("| Tier | Available to execute | Reason | File writes | Secret reads | Network |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const tier of TIER_ORDER) {
    const row = report.tiers[tier];
    lines.push(`| ${tier} | ${row.available ? "yes" : "no"} | ${cell(row.reason)} | ${cell(row.fileWrites)} | ${cell(row.secretReads)} | ${cell(row.network)} |`);
  }
  lines.push("");
  lines.push("Tier C is advisory/restricted. It must not be described as denying secret reads or enforcing network policy. Its network control is the proxy environment variables only. A raw TCP socket ignores those variables.");
  lines.push("");
  lines.push("## Tier A MXC");
  lines.push("");
  lines.push(`Build eligible: ${report.mxc.buildEligible}. Export present: ${report.mxc.exportPresent}. Launcher linked: ${report.mxc.launcherLinked}.`);
  lines.push(report.mxc.detail || "");
  lines.push("");
  lines.push(`Documented child-process behavior: ${report.mxc.documentedChildTermination}`);
  lines.push(`Empirical child-process observation: ${report.mxc.empiricalChildTermination === null ? "not measured; the experimental API was not called" : report.mxc.empiricalChildTermination}.`);
  lines.push(`Documented deny-read timing: ${report.mxc.documentedDenyReadTiming}`);
  lines.push(`Local snapshot check: ${report.denyReadSnapshot.laterFileWasOutsideSnapshot ? "a file created after the snapshot was outside the start-time match list" : "snapshot check failed"}. This is the documented timing, not a kernel MXC measurement.`);
  lines.push("");
  lines.push("`harness.start_service` cannot rely on a process started under MXC surviving the foreground command. Detached dev servers have to be owned by the environment job, not by the foreground `harness.run` process.");
  lines.push("");
  lines.push("## Tier B");
  lines.push("");
  lines.push(`Offline user present: ${report.tierB.offline}. Online user present: ${report.tierB.online}. Setup: ${report.tierB.setup}.`);
  lines.push("No firewall rule was created or changed. Elevated Tier B execution requires the explicit opt-in `--allow-elevated-tier-b-test`, and this spike still does not mutate firewall rules when that flag is absent.");
  lines.push("");
  lines.push("## Tier C execution");
  lines.push("");
  if (!report.tierC.ran) {
    lines.push(`Tier C did not execute: ${report.tierC.reason}`);
  } else {
    lines.push(`Launch API: ${report.tierC.launchApi}. Exit code: ${report.tierC.exitCode}.`);
    lines.push(`Worktree write: ${report.tierC.inside}. Attempt temp write: ${report.tierC.temp}.`);
    lines.push(`Outside write: ${report.tierC.outside}. .git/HEAD write: ${report.tierC.git}.`);
    lines.push(`Canary read: ${report.tierC.canary}. Raw TCP: ${report.tierC.tcp}.`);
    lines.push(`HOME: ${report.tierC.home}. GH_TOKEN present: ${report.tierC.ghToken}. HTTP_PROXY: ${report.tierC.httpProxy}.`);
    lines.push(`Hard link write: ${report.tierC.hardlink}. Host could write the same file after the sandbox ACE was removed: ${report.tierC.hostWriteAfter}.`);
    lines.push(`Sleeper dead within 1000 ms of job close: ${report.tierC.sleeperDead}.`);
    lines.push("Native tools inside the restricted token:");
    for (const [name, tool] of Object.entries(report.tierC.tools || {})) {
      if (tool.version) {
        lines.push(`- ${name}: ${tool.role} ${tool.version}`);
      } else {
        lines.push(`- ${name}: status ${tool.status}, ${tool.stdout || tool.stderr || tool.code || ""}`);
      }
    }
  }
  lines.push("");
  lines.push("## ACL inheritance benchmark");
  lines.push("");
  lines.push(`Empty-slot inheritable ACE: ${report.acl.emptySlotMs} ms, existing files touched: ${report.acl.emptySlotTouchedExistingFiles}.`);
  lines.push(`Recursive icacls over ${report.acl.fileCount} files: ${report.acl.recursiveMs} ms.`);
  lines.push(`Latency delta (recursive minus empty slot): ${report.acl.deltaMs} ms.`);
  lines.push(`A file created after the empty-slot grant showed the inherited SID: ${report.acl.inheritedAceVisible}.`);
  lines.push(`Current-user deny ACE on a hard-linked store file blocked the node_modules path: ${report.hardlink.blocked} (${report.hardlink.writeCode}), same file ${report.hardlink.sameFile}, nlink ${report.hardlink.nlink}.`);
  lines.push("");
  lines.push("## Job object");
  lines.push("");
  lines.push(`Handle close killed the node/powershell/node tree in ${report.job.close.elapsedMs} ms. Orphans: ${report.job.close.orphans.length}. Within 1000 ms: ${report.job.close.withinBudget}.`);
  lines.push(`Killing the handle owner killed the same shape of tree in ${report.job.crash.elapsedMs} ms. Orphans: ${report.job.crash.orphans.length}. Within 1000 ms: ${report.job.crash.withinBudget}.`);
  lines.push("");
  lines.push("## Red team");
  lines.push("");
  lines.push("| Tier | Test | Expected blocked | Actually blocked | Exit | Status | Detail |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.redteam) {
    lines.push(`| ${row.tier} | ${row.testId} | ${row.expectedBlocked} | ${row.actuallyBlocked} | ${row.exitCode === null ? "" : row.exitCode} | ${redteamStatus(row)} | ${cell(row.detail)} |`);
  }
  lines.push("");
  lines.push("The read target was a synthetic canary under the scratch directory. The probe refuses any path with a `.ssh` segment and does not open the developer profile.");
  lines.push("");
  lines.push("## Filesystem ACL capability");
  lines.push("");
  lines.push(`Workspace ${report.filesystem.workspace.path}: ${report.filesystem.workspace.kind}, ACL capable ${report.filesystem.workspace.aclCapable}.`);
  lines.push(`UNC sample: ${report.filesystem.unc.kind}, recommended tiers ${report.filesystem.unc.recommendedTiers.join(", ")}. ${report.filesystem.unc.prompt || ""}`);
  lines.push(`FAT32 sample: ${report.filesystem.fat32.kind}, recommended tiers ${report.filesystem.fat32.recommendedTiers.join(", ")}.`);
  lines.push("Tier B and Tier C need NTFS or ReFS on a local disk. UNC, network, FAT32, and exFAT paths should force Tier A or Tier D, or ask to move the project.");
  lines.push("");
  lines.push("## AppContainer");
  lines.push("");
  lines.push(APPCONTAINER_DECISION.reason);
  lines.push("");
  lines.push("## Window station and input injection");
  lines.push("");
  lines.push(`CreateDesktop succeeded: ${report.desktop.createDesktop}. SendInput isolated by that call: ${report.desktop.sendInputIsolated}.`);
  lines.push(DESKTOP_CONSTRAINT);
  lines.push("");
  lines.push("## Codex reuse");
  lines.push("");
  lines.push("See `spikes/windows-sandbox/CODEX_EVAL.md`. Recommendation: reuse a pinned `codex-mxc-sandbox` helper for Tier A policy launch. Do not treat the unelevated restricted token as a network or secret-read boundary.");
  lines.push("");
  lines.push("## Cleanup");
  lines.push("");
  lines.push(`Scratch leftovers after the run: ${report.cleanup.leftovers.length}.`);
  return `${lines.join("\n")}\n`;
}
