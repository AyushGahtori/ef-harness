# Windows sandbox spike report

Generated: 2026-11-19T12:26:11.572Z
Host build: 26200.9974
Elevation: admin group false, elevated false.

## Tier matrix

| Tier | Available to execute | Reason | File writes | Secret reads | Network |
| --- | --- | --- | --- | --- | --- |
| A | no | mxc_requires_pinned_helper | Enforced | Enforced | Enforced; loopback allowed |
| B | no | requires one-time admin consent | Enforced | Enforced | Enforced |
| C | yes | write_restricted_token | Enforced | Not enforced for paths the user can read | Advisory only (proxy environment variables) |
| D | no | wsl_installed_no_distro | Enforced | Enforced | Enforced; also gives Linux parity with CI |

Tier C is advisory/restricted. It must not be described as denying secret reads or enforcing network policy. Its network control is the proxy environment variables only. A raw TCP socket ignores those variables.

## Tier A MXC

Build eligible: true. Export present: true. Launcher linked: false.
Experimental_CreateProcessInSandbox is exported. The spike does not call it without a compiled SBOX FlatBuffer.

Documented child-process behavior: Remaining child processes stop when the foreground command exits.
Empirical child-process observation: not measured; the experimental API was not called.
Documented deny-read timing: Deny-read globs use the files that match when each sandboxed process starts. A file created later is not in that snapshot.
Local snapshot check: a file created after the snapshot was outside the start-time match list. This is the documented timing, not a kernel MXC measurement.

`harness.start_service` cannot rely on a process started under MXC surviving the foreground command. Detached dev servers have to be owned by the environment job, not by the foreground `harness.run` process.

## Tier B

Offline user present: false. Online user present: false. Setup: requires one-time admin consent.
No firewall rule was created or changed. Elevated Tier B execution requires the explicit opt-in `--allow-elevated-tier-b-test`, and this spike still does not mutate firewall rules when that flag is absent.

## Tier C execution

Launch API: CreateProcessAsUserW. Exit code: 0.
Worktree write: wrote. Attempt temp write: wrote.
Outside write: EPERM. .git/HEAD write: EPERM.
Canary read: read. Raw TCP: CONNECTED.
HOME: C:\Users\Ayush\AppData\Local\Temp\ef-harness-task-003-5AGzLv\work\home. GH_TOKEN present: false. HTTP_PROXY: http://127.0.0.1:9.
Hard link write: EPERM. Host could write the same file after the sandbox ACE was removed: true.
Sleeper dead within 1000 ms of job close: true.
Native tools inside the restricted token:
- self: sandboxed-primary v24.16.0
- node: status 0, v24.16.0
- git: status 0, git version 2.54.0.windows.1
- pnpm: status 0, 10.34.9

## ACL inheritance benchmark

Empty-slot inheritable ACE: 13.68 ms, existing files touched: false.
Recursive icacls over 10000 files: 13719.37 ms.
Latency delta (recursive minus empty slot): 13705.69 ms.
A file created after the empty-slot grant showed the inherited SID: true.
Current-user deny ACE on a hard-linked store file blocked the node_modules path: true (EPERM), same file true, nlink 2.

## Job object

Handle close killed the node/powershell/node tree in 0 ms. Orphans: 0. Within 1000 ms: true.
Killing the handle owner killed the same shape of tree in 29 ms. Orphans: 0. Within 1000 ms: true.

## Red team

| Tier | Test | Expected blocked | Actually blocked | Exit | Status | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| A | read-secret | true | false |  | not_run | not_run: mxc_requires_pinned_helper |
| A | write-outside | true | false |  | not_run | not_run: mxc_requires_pinned_helper |
| A | mutate-git-head | true | false |  | not_run | not_run: mxc_requires_pinned_helper |
| A | raw-tcp | true | false |  | not_run | not_run: mxc_requires_pinned_helper |
| A | background-sleeper | true | false |  | not_run | not_run: mxc_requires_pinned_helper |
| B | read-secret | true | false |  | not_run | not_run: requires one-time admin consent |
| B | write-outside | true | false |  | not_run | not_run: requires one-time admin consent |
| B | mutate-git-head | true | false |  | not_run | not_run: requires one-time admin consent |
| B | raw-tcp | true | false |  | not_run | not_run: requires one-time admin consent |
| B | background-sleeper | true | false |  | not_run | not_run: requires one-time admin consent |
| C | read-secret | false | false | 0 | pass | read synthetic canary outside the worktree; Tier C does not deny reads the user can already perform |
| C | write-outside | true | true | 0 | pass | write outside worktree code=EPERM |
| C | mutate-git-head | true | true | 0 | pass | mutate .git/HEAD code=EPERM |
| C | raw-tcp | false | false | 0 | pass | direct net.connect 1.1.1.1:443 ignored HTTP_PROXY; code=CONNECTED |
| C | background-sleeper | true | true | 0 | pass | sleeper pid 17208 died after JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
| D | read-secret | true | false |  | not_run | not_run: wsl_installed_no_distro |
| D | write-outside | true | false |  | not_run | not_run: wsl_installed_no_distro |
| D | mutate-git-head | true | false |  | not_run | not_run: wsl_installed_no_distro |
| D | raw-tcp | true | false |  | not_run | not_run: wsl_installed_no_distro |
| D | background-sleeper | true | false |  | not_run | not_run: wsl_installed_no_distro |

The read target was a synthetic canary under the scratch directory. The probe refuses any path with a `.ssh` segment and does not open the developer profile.

## Filesystem ACL capability

Workspace C:\Users\Ayush\Desktop\ef-wt\task-003-spike-windows-sandbox: ntfs, ACL capable true.
UNC sample: unc, recommended tiers A, D. Move the project to a local NTFS or Dev Drive, or use Tier A or Tier D only.
FAT32 sample: fat32, recommended tiers A, D.
Tier B and Tier C need NTFS or ReFS on a local disk. UNC, network, FAT32, and exFAT paths should force Tier A or Tier D, or ask to move the project.

## AppContainer

AppContainer is not a primary tier. It is a capability profile for one known application package, and Node, Git, and pnpm are not written for that profile: they load arbitrary tool DLLs, spawn compilers, and read toolchain directories the profile does not grant. Codex's MXC path refuses the older AppContainer fallback and requires the process security environment. This spike checks those tools under the write-restricted token instead, and does not launch an AppContainer.

## Window station and input injection

CreateDesktop succeeded: true. SendInput isolated by that call: false.
UIPI only blocks a lower-integrity sender from delivering window messages to a higher-integrity window. A Tier C write-restricted token is still the developer's medium-integrity user, so UIPI does not stop SendInput into the developer's windows. JOB_OBJECT_UILIMIT_HANDLES and the other job UI limits block clipboard, global atoms, and some USER handle reuse; they do not retarget the input desktop. Stopping injection requires a separate window station and desktop whose DACL excludes the sandbox identity. CreateDesktop on WinSta0 can succeed for the interactive user and still leave SendInput on the real desktop. CreateWindowStation for a private station is often denied without extra privileges. Tier B, running as a different user on a private desktop, is the tier that can make that boundary real.

## Codex reuse

See `spikes/windows-sandbox/CODEX_EVAL.md`. Recommendation: reuse a pinned `codex-mxc-sandbox` helper for Tier A policy launch. Do not treat the unelevated restricted token as a network or secret-read boundary.

## Cleanup

Scratch leftovers after the run: 0.
