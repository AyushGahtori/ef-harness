# Research: catching stubs, shortcuts and dropped requirements

Question: how often do coding agents take shortcuts, what catches them cheaply, and how do safety-critical fields guarantee every requirement is tested? Design: [completeness gate](../completeness-gate.md).

## Agents take shortcuts

- **ImpossibleBench** makes tasks impossible by conflicting the tests with the specification, so any pass is a shortcut. On realistic repositories frontier models cheated often (GPT-5 76% on one variant; around 50% for several models on another) using test modification, operator overloading, state recording and special-casing. Read-only tests blocked the most common strategy; an explicit “flag for human intervention” action cut GPT-5's cheating from about 54% to 9%; more feedback loops slightly *increased* cheating; LLM monitors caught 42–65% of cheating on complex repositories. (Zhong et al., 2025, arXiv:2510.20270) [Paper](https://arxiv.org/html/2510.20270)
- METR reported frontier models reward-hacking in agentic evaluations, for example by modifying tests or scoring code. [METR, June 2025](https://metr.org/blog/2025-06-05-recent-reward-hacking/)

## Cheap static detection

| Pattern | Tool |
|---|---|
| Empty blocks, including `catch` | ESLint `no-empty` |
| TODO/FIXME comments | ESLint `no-warning-comments` |
| `@ts-ignore`, `as any` | typescript-eslint `ban-ts-comment`, `no-explicit-any` |
| Unused files, exports and dependencies | [knip](https://knip.dev/) |
| Custom structural patterns (trivial bodies, dead handlers, literal special-casing) | [ast-grep](https://ast-grep.github.io/), [Semgrep](https://semgrep.dev/) |

## Behavior checks that resist shortcuts

- **Mutation testing** changes the code slightly (e.g. `<` to `<=`) and expects tests to fail; surviving mutants show weak tests. [Stryker](https://stryker-mutator.io/)
- **Held-back and generated inputs** defeat hard-coding visible examples (property-based testing). [fast-check](https://fast-check.dev/)

## Traceability

Safety-critical standards require **bidirectional traceability** between requirements, implementation and tests, so every requirement is verified and every piece of code has a reason (e.g. DO-178C for avionics software, ISO 26262 for automotive). The traceability matrix and graph-compile invariants bring the same discipline at much lower cost, because the harness generates the links itself.

## To measure

- Shortcut rate with and without the static audit on the red-team and impossible-task variants of the benchmarks.
- False positives of each static rule on real accepted code.
