# Research: using a developer's existing AI subscription

Question: can a third-party desktop harness let a developer use the AI plan they already pay for (ChatGPT, Claude, Gemini, Copilot, Cursor) instead of an API key, and if so, does that spend their plan allowance or per-token API money? Checked November 2026. Policies change often; the harness keeps them in a versioned provider policy file.

Design that uses this: [provider connections](../provider-connections.md).

## The “redirect to the provider's site” trick

The sign-in the owner saw (an app sending them to OpenAI to approve usage) is **OAuth 2.0 with PKCE**: the app opens the provider's sign-in page in the browser, the user approves a named permission, and the provider redirects back to a local address with a one-time code. The app exchanges the code for tokens. The app never sees the password.

What those tokens spend depends entirely on the permission granted:

| Flow | What the token is | Spends |
|---|---|---|
| Sign in with ChatGPT with the `chatgpt.tokens.use.direct` scope | Access token usable on the Responses API | The user's **ChatGPT plan allowance** |
| “Continue with OpenRouter” | A newly minted OpenRouter API key | The user's OpenRouter **credits, per token** |
| GitHub OAuth → Copilot SDK | GitHub user token | The user's **Copilot plan** (premium requests) |
| Cursor `Cursor.auth.login()` | A user API key minted by browser login | The user's **Cursor plan usage pool** |

## Provider by provider

### OpenAI (ChatGPT Plus / Pro)

- **Route:** Sign in with ChatGPT, “ChatGPT plan usage” capability. Open-source and locally hosted apps can self-serve; paid or remotely hosted apps must apply through an interest form. [SIWC docs](https://developers.openai.com/siwc/token-sharing-open-source)
- **Registration:** first sign-in uses `client_id=dynamic_agent_client` with an `agent_name_hint` and a stable, persisted `ext_agent_host_id` per machine; the callback returns the issued `client_id` to reuse. No client secret.
- **Scope check:** after the exchange, check for `chatgpt.tokens.use.direct`. Without it, keep the sign-in but mark plan usage disabled and offer another billing path.
- **Limits:** users set a per-app weekly limit (10–100%) in ChatGPT settings. Plus has a five-hour limit shared across *all* apps using the plan; Pro does not.
- **Errors:** `subscription_sharing_usage_limit_exceeded` (429) pauses plan requests; OpenAI never silently switches billing. No remaining-allowance endpoint for these tokens.
- **Preview limitations:** Responses API only, `store: false`, `stream: true`; function/custom tools supported in namespaces; `max_output_tokens`, `temperature`, `previous_response_id` and hosted tools (file search, code interpreter, hosted MCP) are not supported. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- **Codex app-server** can use the same token (`ACCESS_TOKEN`, restart on refresh, `thread/resume`). Its own ChatGPT login exposes `account/rateLimits/read` and `account/rateLimits/updated`. [Codex app-server](https://developers.openai.com/codex/app-server)

### Anthropic (Claude Pro / Max)

- **No third-party plan login.** “Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users.” Products using the Agent SDK should use API keys. [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- **Allowed exception:** an end user signing in to the **unmodified Claude Code binary** with their own subscription, including where a product runs Claude Code. Running Claude Code inside a product requires accepting Anthropic's Commercial Terms, not modifying the binary, not removing its login methods, and not paying for or reselling the user's usage. Sign-in must complete through Anthropic's own flow.
- Plan limits assume “ordinary, individual usage of Claude Code and the Agent SDK”.

### Google (Gemini, Google AI Pro / Ultra, Antigravity)

- **No third-party plan login.** “Using third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication to access our backend services is a direct violation…” Supported path for third-party agents: AI Studio or Vertex API keys. [Gemini CLI FAQ](https://geminicli.com/docs/resources/faq/)
- **Enforcement is real:** in February 2026 Google banned accounts that used third-party tools or proxies against Antigravity quotas, which also cut off Gemini CLI. Second violations are permanent. [gemini-cli discussion #20632](https://github.com/google-gemini/gemini-cli/discussions/20632)
- **Allowed pattern:** the user's own installed Gemini CLI, which owns its Google login, driven over its official ACP mode (`gemini --acp`). Zed hosts Gemini CLI this way; “Gemini CLI owns its own authentication.” Headless runs reuse an existing cached login. [Gemini CLI ACP mode](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md) · [Zed external agents](https://zed.dev/docs/ai/external-agents) · [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
- The harness must never read Gemini CLI's credential files. Offer this route off by default with a clear warning.

### GitHub Copilot

- **Officially supported.** Create a GitHub OAuth App, pass each user's token as `gitHubToken`; “Copilot usage is billed to each user's subscription.” [Copilot SDK GitHub OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)
- **Usage visibility:** per-call tokens and premium-request multiplier; `session.usage.getMetrics`; `account.getQuota` returns entitlement, used requests, `remainingPercentage` and `resetDate`. [Usage and billing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)
- Also BYOK (bring your own API key) through the same SDK.

### Cursor

- `@cursor/sdk` runs Cursor's agent locally or in the cloud with `CURSOR_API_KEY`; `Cursor.auth.login()` opens the Cursor website login and mints a user key (90 days by default). `run.usage` gives live tokens; `Agent.getUsage()` gives the billed record, where `chargedCents` is 0 for plan-included usage. Local-agent usage is rolling out per account. [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- Plans include a weekly usage pool for Cursor's own models; third-party models are billed at API list price from prepaid credit on higher plans (Cursor docs, “Models & Pricing” page).

### OpenRouter

- PKCE flow: `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`, then `POST /api/v1/auth/keys` returns a user-controlled key. Localhost callbacks allowed; optional credit `limit` and reset interval on created keys. Billed to the user's credits per token. [OpenRouter OAuth](https://openrouter.ai/docs/guides/overview/auth/oauth)

## Plan value versus API prices

Providers publish no token quota for plans. Independent estimates (workload-dependent, full utilization):

| Plan | Price | API-equivalent per month (estimate) | Source |
|---|---|---|---|
| ChatGPT Plus | $20 | ~$210–285 (11–14×) | [comparison note](https://suhailmohebi.com/notes/claude-code-vs-codex-pricing/) combining SemiAnalysis and InventiveHQ measurements |
| Claude Pro | $20 | ~$1,180 (historical measurement) | same note |
| ChatGPT Pro $100 | $100 | One developer's real 30-day Codex use priced at $745 | [flaviocopes.com](https://flaviocopes.com/ai-subscription-vs-api-pricing/) |

Takeaways: the owner's intuition is right; plan routes are worth far more than the same dollars of API. Caching dominates agent costs, so naive estimates overstate API cost by an order of magnitude. OpenAI states that API prices should not be used to estimate plan-included usage.

## What this means for distribution

| If the harness ships as… | ChatGPT plan route | Claude Code route | Gemini CLI route |
|---|---|---|---|
| Open source, runs locally | Self-serve | Allowed with Commercial Terms; user's own login | User's own install; warn |
| Paid desktop app | Apply via OpenAI's interest form | Same conditions | Same; higher risk |
| Hosted service | Interest form; remote hosting rules | Hosted sandbox rules apply | Not recommended |

**Owner decision (16 November 2026):** open-source app that runs locally first, the path with the most plan routes available today. Claude Code and Gemini CLI routes ship off by default. **Update (17 November 2026):** the Claude plan route is withdrawn. Anthropic's compliance page says developers “may not collect, store, or intermediate Claude.ai credentials or session tokens” and that subscription OAuth is for ordinary use of Claude Code and Anthropic's own apps; `claude setup-token` tokens are for Claude Code in CI and scripts. Claude is used with Console API keys. [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) · [Authentication](https://code.claude.com/docs/en/authentication)

## Verify before shipping

- Re-read each provider's terms at release; pin minimum CLI versions.
- Measure real ChatGPT plan burn per worker-hour on Plus and Pro to set default weekly-share estimates.
- Confirm Gemini CLI headless/ACP behavior with a cached Google login on Windows.
