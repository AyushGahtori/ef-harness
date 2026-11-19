# Research: verifying real apps, not just pure functions

Question: how can acceptance checks be written before a screen, route, auth flow, migration or AI feature exists, stay robust to refactors, and handle non-exact behavior? Design that uses this: [verification for real apps](../verification-for-real-apps.md).

## Locate things the way users do

- Playwright recommends user-facing locators (`getByRole` with an accessible name, `getByLabel`, `getByText`) and explicit test IDs only when needed; CSS and XPath are discouraged because the DOM changes. [Locators](https://playwright.dev/docs/locators) · [Best practices](https://playwright.dev/docs/best-practices)
- **ARIA snapshots** assert the accessibility tree as YAML (`toMatchAriaSnapshot`); templates can be partial; matching is order-sensitive. [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- Testing Library's guiding principle: “The more your tests resemble the way your software is used, the more confidence they can give you.” [Guiding principles](https://testing-library.com/docs/guiding-principles)

Consequence: a button's accessible name is a product decision the planner can fix before implementation, and tests based on it survive refactors.

## Contracts for non-UI entry points

| Kind | Practice | Tool |
|---|---|---|
| HTTP APIs | Contract-first with OpenAPI; property-based API tests generated from the schema | [Schemathesis](https://schemathesis.io/) |
| Service boundaries | Consumer-driven contract tests | [Pact](https://docs.pact.io/) |
| Pure logic | Property-based tests with generated inputs and saved seeds | [fast-check](https://fast-check.dev/) |
| Test strength | Mutation testing finds checks that don't catch changes | [Stryker](https://stryker-mutator.io/) |

## External services in tests

| Service | Local substitute |
|---|---|
| OAuth / OpenID Connect | Mock identity providers, e.g. `mock-oauth2-server` |
| Email | Captured-mail servers such as Mailpit. [Mailpit](https://mailpit.axllent.org/) |
| Payments | Provider test modes and mock servers (e.g. `stripe-mock`) |
| HTTP APIs in general | Record and replay (e.g. Polly.js, nock) |

## Database migrations

- **Expand and contract (parallel change):** add the new structure, migrate data and readers, then remove the old structure in a later step. Makes risky schema changes reversible and safe to deploy. [ParallelChange](https://martinfowler.com/bliki/ParallelChange.html)
- Migration tests run against a fixture at the previous schema with edge-case data, using the real database engine, and assert data preservation explicitly.

## Hidden checks and hints

- Held-back examples prevent hard-coding to visible tests, the same reason benchmarks keep private test sets.
- Disclosing a *fresh* example derived from the same rule gives the worker concrete debugging material without revealing the held-back case; property generators make producing such examples cheap.

## Non-deterministic outputs (AI features)

- **LLM-as-a-judge** agrees well with human preferences on many tasks but has known biases: position bias, verbosity bias and self-preference (Zheng et al., 2023, arXiv:2306.05685). Mitigations: a judge different from the generator, rubric-based scoring, multiple samples, a stated threshold.
- Eval frameworks such as promptfoo run eval sets with assertions and model-graded rubrics. [promptfoo](https://www.promptfoo.dev/)
- Replaying recorded model responses keeps ordinary CI deterministic and free.

## Visual checks

- Pixel comparison (`toHaveScreenshot`) needs approved baselines and masks for dynamic content. [Visual comparisons](https://playwright.dev/docs/test-snapshots)
- Accessibility audits with axe-core catch contrast, label and role problems automatically. [axe-core](https://github.com/dequelabs/axe-core)

## To measure

- False failures caused by locators after refactors: role-based versus CSS selectors.
- Retries saved by the hint ladder compared with “rule ID only”.
- Judge agreement with the developer on 30 AI-feature outputs.
