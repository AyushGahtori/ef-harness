# Research: running many sandboxed workers on one Windows machine

Question: what does each Windows isolation option cost per instance, what causes disk and antivirus storms, and which facts must be measured rather than assumed? Design: [execution capacity](../execution-capacity.md).

## Isolation costs

- Codex's MXC mode is described as “native process isolation without administrator-approved setup, additional Windows accounts, or local firewall rules”; it is not a virtual machine. Remaining child processes stop when the foreground command exits, which suits per-command execution. [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- The elevated mode uses two local sandbox users and firewall rules; commands run under restricted tokens of those users, again without a VM. [Codex Windows sandbox blog](https://openai.com/index/building-codex-windows-sandbox/)
- WSL2 runs one VM whose memory limit defaults to 50% of the host's RAM, configurable in `.wslconfig`; all containers share it. [WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

**Consequence:** per-sandbox overhead on tiers A–C is mostly the processes inside; on tier D it is dominated by one shared VM. The measurable waste is idle agent process trees, not the isolation itself.

## Disk and antivirus

- A trusted Dev Drive runs Microsoft Defender in performance mode: “open now, scan later”, with real-time protection still required. Microsoft describes this as better protection than folder exclusions, which block scanning entirely. [Defender performance mode](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-antivirus-performance-mode) · [Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)
- New files inherit inheritable access entries from their parent folder when created; changing a folder's inherited permissions later propagates to every existing child, which is the expensive operation to avoid. [Access control inheritance](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules)
- pnpm installs packages as hard links from one content-addressable store, so worktrees share files on the same drive. [pnpm motivation](https://pnpm.io/motivation) Hard links point to the same file, so writing through one changes all of them, which is why `node_modules` must be read-only in the sandbox.

## Runtimes that can host many sessions

- The Codex app-server protocol has thread start and resume operations, which suggests several threads per process; to be confirmed with measurements. [Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- The Copilot SDK manages sessions against a CLI server; whether many sessions per server behave well under load is to be confirmed. [Copilot SDK](https://github.com/github/copilot-sdk)

## To measure (sandbox spike)

| Metric | Why |
|---|---|
| Memory per idle wrapped agent, per tier | Sets the session-process cap |
| Sandbox launch latency p50/p95 per tier | Sets warm-pool size |
| Slot creation and reset time, NTFS vs Dev Drive | Sets the disk lane policy |
| Defender CPU during resets and installs | Validates the Dev Drive recommendation |
| UI input latency p95 at 1, 5, 10, 20 workers | The pass criterion for defaults |
