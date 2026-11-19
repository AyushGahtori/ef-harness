# Codex Windows sandbox reuse evaluation

Verdict: reuse OpenAI Codex's pinned `codex-mxc-sandbox` Rust helper for Tier A, and do not copy the unelevated restricted-token backend forward as if it enforced network or secret reads. Tier C in this harness stays a write boundary with an advisory network policy. Tier B stays a separate, explicitly consented admin setup. AppContainer is not a tier.

## License

The Codex repository at `openai/codex` is Apache-2.0. Apache-2.0 allows this harness to reuse and modify that code, including inside a distributed helper binary, if the Apache notice, the license text, and change notices stay with the reused source. It also includes a patent grant from the contributors.

Codex's MXC launcher depends on Microsoft's `mxc` project (`microsoft/mxc`, crate surface used as `mxc-sdk`). That repository is MIT. MIT and Apache-2.0 can be shipped together: keep the MIT copyright notice with the MXC sources. Neither license is an obstacle to reuse. Neither license removes the need to pin a commit instead of tracking `main`.

This spike does not vendor either tree and does not add an npm package. Task 041 should build a helper from a reviewed pin. The tag `rust-v0.162.1` is a concrete Codex revision whose `codex-rs/mxc-sandbox` sources were inspected for this evaluation. Re-pin to the commit reviewed at integration time.

## What was inspected

- `codex-rs/mxc-sandbox`: native launch, availability probe, and the note that policy conversion is portable while execution requires a usable process security environment and never enters MXC's ACL fallbacks.
- `codex-rs/windows-sandbox-rs`: `CreateRestrictedToken` with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED`, restricting SIDs ordered as capability SID, logon SID, then Everyone (`S-1-1-0`), `SetEntriesInAclW` default DACL, and `CreateProcessAsUserW`.
- Capability SIDs are random `S-1-5-21-...` strings, not real local users.
- Codex's own elevated setup creates `CodexSandboxOffline` and `CodexSandboxOnline`. This harness uses `EFHarnessSandboxOffline` and `EFHarnessSandboxOnline` and must not reuse those Codex account names.
- Current Codex availability is `mxc_sdk::v1::probe` requiring `base_container_api_present`. An older revision called `BaseContainerRunner::is_process_security_environment_usable`. A build-number check alone is not the probe Codex trusts.

## Maintenance burden

`codex-mxc-sandbox` is a Rust crate inside a large workspace (edition 2024). It is not an npm package. Building it pulls `mxc-sdk`, Windows crate bindings, and a pinned `tracelogging = 1.2.3` because newer tracelogging imports an apiset the GNU Windows toolchain does not ship. The helper is Windows-only. Codex's sandbox types move quickly, so a floating git dependency would break Task 041 without a local change.

The maintenance cost of reuse is a pinned Rust build that produces one small launcher binary. The maintenance cost of a from-scratch N-API binding is reimplementing the FlatBuffer `SandboxSpec` (`SBOX`), path precedence, deny-path capability checks, and the process-security-environment versus AppContainer choice. That second cost is higher and it is easier to get wrong in a way that fails open. This spike therefore does not call `Experimental_CreateProcessInSandbox` with a hand-built buffer.

Recommended dependency intent for Task 041, recorded in the handoff and not in root `package.json`:

- Helper name: `ef-mxc-launch`
- Source: `openai/codex` crate `codex-rs/mxc-sandbox`, pin a reviewed commit (starting point: tag `rust-v0.162.1`)
- Transitive SDK: `microsoft/mxc` (`mxc-sdk`), MIT, pinned with the Codex lockfile
- Build: Rust, Windows only, no node-gyp and no root `package.json` edit
- Fallback if the pin becomes unusable: call `processmodel.dll` `Experimental_CreateProcessInSandbox` only through that same MXC SDK, still not through an empty specification

## MXC API surface

The OS entry point is `Experimental_CreateProcessInSandbox` in `processmodel.dll`, loaded with `LOAD_LIBRARY_SEARCH_SYSTEM32`. Microsoft documents it as experimental. The call takes an application name, command line, creation flags, an optional environment, a current directory, `STARTUPINFOW`, an identity string, and a FlatBuffer sandbox specification whose file identifier is `SBOX`. There is no public header. A successful `GetProcAddress` only means the export exists. The OS can still reject a later call, including with `ERROR_CALL_NOT_IMPLEMENTED`, if the feature is disabled.

Codex's launcher:

- Refuses permissive learning mode.
- Asks `SecurityEnvironmentApi` whether native deny paths are supported before sending a policy that denies reads. If the build cannot enforce them, launch fails closed.
- Spawns through `BaseContainerRunner`, which creates the child suspended, puts it in a kill-on-close job, and resumes it.
- Does not edit host ACLs, create users, or request elevation for the MXC path.
- Treats loopback as bidirectional. Managed networking requires `allow_local_binding = true` and dedicated proxy ports. Direct non-loopback egress is denied. An effective `allow_local_binding = false` is a configuration error, not a silent downgrade.
- Expands deny-read globs to concrete paths before launch. The same snapshot rule is documented for Linux and for the elevated Windows backend: a file created after start is not in the list.
- Stops remaining child processes when the foreground command exits. The older restricted-token backends do not. `harness.start_service` cannot depend on an MXC foreground command leaving a dev server behind. Those processes belong to the environment job from Task 040 and Task 049.

On this machine the spike loaded `processmodel.dll` from System32 and resolved the export. It still did not launch a payload. A malformed specification can fail open, and this spike has no FlatBuffer builder. Tier A execution stays unavailable with reason `mxc_requires_pinned_helper` even when the build and the export are present. Build eligibility remains the documented gate: Windows 11 24H2 `26100.9278` and 25H2 `26200.9278`, with the DLL probe as a second gate. `26100.9277` is not eligible. Windows 10 is not eligible.

## Policy grants versus filesystem ACLs

MXC grants are policy records in the sandbox specification, not DACLs written onto the developer's tree. Equivalent paths and symlink or junction aliases take the strictest access, and a more specific path overrides an ancestor. That is the model `execution-capacity.md` asks the spike to prefer: policy grants, no permission storm, no durable ACE left on the worktree.

The restricted-token and sandbox-user backends are ACL backends. A random capability SID receives an inheritable allow on the writable root and a deny on `.git`. Writes pass only when both the normal token and the restricting-SID check allow them (`WRITE_RESTRICTED`). Reads do not consult that restricting list, which is why Tier C cannot claim `secretReadsDenied`. Changing the writable set means rewriting ACLs. Doing that recursively over an existing `node_modules` is the slow path; an inheritable ACE on an empty slot is the fast path. The spike measures that delta.

Codex's unelevated network control is environment-only (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `GIT_SSH_COMMAND`). Their own write-up says a process can ignore the environment and open a socket. This spike's red-team probe does that with `net.connect` and must not report the socket as blocked unless the OS returns `EPERM` or `EACCES`. Firewall enforcement needs a different user, which is Tier B, and only after explicit admin consent.

## What not to reuse as a primary path

- AppContainer, including MXC's older AppContainer dispatcher. Codex's MXC helper refuses it. Developer tools are the wrong shape for a fixed capability profile.
- The unelevated token as a substitute for Tier A or Tier B network policy.
- Codex's read-only "deny read" ACLs on the unelevated token. Codex fails that backend closed when deny-read overrides are present, because `WRITE_RESTRICTED` is not authoritative for reads.
- Host ACL edits as the MXC implementation. Policy in the specification is the grant model.
- A silent unsandboxed retry when `Experimental_CreateProcessInSandbox` or `CreateProcessAsUserW` fails.

## Tier C prototype that did run

The live prototype on this machine follows the Codex token shape without taking a Codex dependency:

- `CreateRestrictedToken` with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED`
- Restricting SIDs: synthetic `S-1-5-21-...`, the logon SID, Everyone
- `SetEntriesInAclW` default DACL and `SeChangeNotifyPrivilege`
- `CreateProcessAsUserW` on `WinSta0\Default`, suspended, then `AssignProcessToJobObject`, then `ResumeThread`
- Job flag `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` plus the basic UI restriction flags
- Inheritable modify for the capability SID on the scratch worktree, deny-write on `.git`, and a deny-write on the hard-linked store file
- Explicit environment: `HOME`, `USERPROFILE`, `TEMP`, `TMP`, and `XDG_CACHE_HOME` inside the attempt; proxy variables aimed at `127.0.0.1:9`; no `GH_TOKEN`

`CreateProcessWithTokenW` is only a recorded fallback if `CreateProcessAsUserW` fails. The successful launch on this host used `CreateProcessAsUserW`. A hand-sized default ACL built with `InitializeAcl` of 4096 bytes failed with Win32 1344 (`ERROR_ALLOTTED_SPACE_EXCEEDED`). `SetEntriesInAclW` is the call that works.

## Recommendation for Tasks 040-044

| Task | Decision |
| --- | --- |
| 040 | Job objects via `kernel32` `CreateJobObjectW`, `SetInformationJobObject` class 9 with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`), assign before grandchildren, UI restriction class 4. The spike's PowerShell helper proved kill-on-close. Production code should call the same APIs directly, not through a PowerShell process per command. |
| 041 | Pin `codex-mxc-sandbox` (or the MXC SDK it wraps) as `ef-mxc-launch`. Do not add it to root `package.json`. Fail closed when the export or the process security environment is missing. Do not call the API with an empty spec. |
| 042 | Keep `EFHarnessSandboxOffline` / `EFHarnessSandboxOnline`, inheritable ACEs on empty slots, and firewall rules behind one explicit admin consent. Do not create those users or rules from this spike. |
| 043 | Tier C flags are `fileWritesEnforced: true`, `secretReadsDenied: false`, `networkEnforced: false`. Non-NTFS, UNC, and network paths are Tier A or Tier D only. |
| 044 | Tier C's proxy variables are advisory. The allowlisting proxy is not a substitute for an OS network boundary on Tier C. |

PowerShell plus `Add-Type` is the spike harness because Task 003 cannot add a native npm dependency. It is not the production launcher. N-API is not required for Tier A if the Rust helper is pinned. N-API, or a small static Rust/C# helper, is appropriate for Task 040's job-object manager so the daemon does not start PowerShell for every command.
