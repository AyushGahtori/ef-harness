# Foreign runtime protocol spike

Fake CLIs exercise every parser without vendor accounts. Live rows record only version and handshake results from installed binaries. No model turn is sent to a paid runtime.

Codex scheduling verdict: `session-process`.
Fake app-server multiplexed threads: yes.
Live multiplex confirmed: no (handshake rpc_error).

Unknown JSON-RPC notifications and stream-json event types are logged and ignored. Split UTF-8 chunks, non-JSON stdout banners, and malformed lines stay on the framing buffer and do not desynchronize later messages.

Live Codex app-server notifications logged and ignored: remoteControl/status/changed, account/updated, mcpServer/startupStatus/updated.

## OpenCode permission schema

last-matching glob wins; a string rule matches every resource; unmatched actions ask

Config keys: bash, read, edit, webfetch, websearch, external_directory, glob, grep, list.

Shell and web are denied by an ordered rule set: `bash` uses `{ "*": "deny" }` (last match wins), and `webfetch` / `websearch` are the string rule `deny`. Unmatched actions such as `edit` stay `ask` until a later rule matches.

## Pinned protocols

- acp: minimum observed version unpinned until a live binary is observed
- codex: minimum observed version 0.169.0
- copilot: minimum observed version 0.1.2
- claude: minimum observed version unpinned until a live binary is observed
- gemini: minimum observed version unpinned until a live binary is observed
- opencode: minimum observed version 1.17.12

## Runtime matrix

- acp: fake passed; live fake_only
- codex: fake passed; live ok (0.169.0, package-after-hung-command)
- copilot: fake passed; live ok (0.1.2, file-version)
- claude: fake passed; live not_installed
- gemini: fake passed; live not_installed
- opencode: fake passed; live ok (1.17.12, stdout)
