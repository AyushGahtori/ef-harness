# Research: evaluating prompts, skills and question packs

Question: how do we prove a new prompt, skill or catalog pack improves results, and how do we keep community skills from being an attack path? Design: [meta-lab](../meta-lab.md).

## Measuring agent changes

- **Paired comparisons** on the same tasks and seeds remove most task-to-task variance. For pass/fail outcomes on the same items, McNemar's test is the standard paired test; bootstrap confidence intervals work for cost and time.
- **Repeated runs** matter: agent outcomes are stochastic, so each task runs several times and pass rates are averaged.
- **Benchmarks from real repositories** with hidden tests (SWE-bench style) measure end-to-end ability. [SWE-bench](https://www.swebench.com/)
- **Simulated users:** τ-bench evaluates agents interacting with a model-simulated user who has hidden goals, the same idea as our persona developer (Yao et al., 2024, arXiv:2406.12045).

## Contamination and gaming

- Agents exploit visible tests: on ImpossibleBench, frontier models passed impossible tasks by modifying tests or special-casing in 50–76% of cases on realistic repositories (Zhong et al., 2025, arXiv:2510.20270). Hidden suites must stay hidden from harness content.

## Community skills are a supply chain

| Finding | Source |
|---|---|
| 13.4% of 3,984 marketplace skills had at least one critical issue (malware, prompt injection, exposed secrets) | [Snyk ToxicSkills, Feb 2026](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) |
| Skills with covert behavior, e.g. a binary that silently appends remote instructions to the agent's global instruction file | [Snyk re-assessment](https://research.snyk.io/blog/skill-analysis/) |
| 26.1% of 31,132 skills had a vulnerability; skills bundling scripts were 2.12× more likely to be vulnerable than instruction-only skills | “Agent Skills in the Wild”, arXiv:2601.10338 |
| SKILL.md wording alone manipulated retrieval (up to 86% win rate), agent selection (77.6%) and evaded reviewers; placing malicious text beyond a reviewer's context window evaded detection in 87% of variants | “Under the Hood of SKILL.md”, arXiv:2605.11418 |
| Debug logging caused 73.5% of credential leaks in skills because stdout flows into model context | arXiv:2604.03070 |

These directly motivate: instruction-only skills by default, hard size caps (no truncation), selection by ID rather than description similarity, canary-secret quarantine runs, and skills that can't grant tools.

## Testing the harness's own code

- **Deterministic simulation testing:** FoundationDB runs the whole distributed system in a single-threaded simulator with injected faults and reproducible seeds; TigerBeetle's VOPR does the same. The approach finds rare interleavings that ordinary tests miss. [FoundationDB testing](https://apple.github.io/foundationdb/testing.html) · [TigerBeetle VOPR](https://docs.tigerbeetle.com/concepts/safety/)
- **Property-based testing** checks invariants (no double-spend, one lease) over generated sequences of operations. [fast-check](https://fast-check.dev/)

## To measure

- Variance of the end-to-end benchmark between identical runs (sets the number of repetitions needed).
- Cost per meta-lab promotion decision.
