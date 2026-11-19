# Research: planning, foundations and choosing a crew

Question: how should a planner sequence shared foundations before parallel work, show the plan before spending, and choose how many workers and which models to use? Design that uses this: [planning and crew](../planning-and-crew.md).

## Foundations before parallel work

- **Walking skeleton:** build a tiny end-to-end implementation that links the main architectural components first, then grow features on it. Phase 0 is a walking skeleton plus shared contracts. (Alistair Cockburn, *Crystal Clear*.)
- **Generators** such as `create-next-app` or Nx generators show that scaffolding is mechanical when the decisions are made up front, which is why a low-effort model can carry out Phase 0 recipes.
- Pinning all planned dependencies in one change avoids lockfile conflicts between parallel workers, which are the most common merge conflict in JavaScript projects.

## Show the plan before applying it

- **Terraform `plan` / `apply`:** show exactly what will change and what it will cost (in resources) before applying. The plan preview borrows this two-step pattern. [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- Coding agents commonly offer a “plan mode” that drafts a plan for approval before editing.

## Scheduling parallel tasks

- **Critical path method:** the longest chain of dependent work decides the minimum finish time.
- **List scheduling / HEFT:** rank tasks by the length of work remaining after them (“upward rank”) and assign each to the resource giving the earliest finish. Simple, well studied and good in practice for task graphs on heterogeneous resources (Topcuoglu, Hariri and Wu, 2002, IEEE TPDS).
- **Amdahl's law:** the sequential part of the work limits speed-up, so adding workers beyond the graph's width doesn't help.
- **Brooks's law** applies to coordination cost: more parallel workers mean more integration work, which is why width is capped by the graph and by integration capacity, not maximized.

## Picking models per task

- **Model cascades (FrugalGPT):** try a cheaper model first and escalate when quality checks fail; large savings at similar quality on many tasks (Chen, Zaharia and Zou, 2023, arXiv:2305.05176).
- **Learned routing (RouteLLM):** route each query to a strong or weak model based on predicted difficulty (Ong et al., 2024, arXiv:2406.18665).
- Our design uses both ideas with a twist: the clean verifier is the quality check, and expected cost includes the chance of failing (cost ÷ pass probability), so a cheaper model that often fails can be the expensive choice.

## Concurrency against rate limits

**AIMD** (additive increase, multiplicative decrease) is the classic congestion-control rule from TCP: add one slot after success, halve on congestion. It converges fairly and is easy to reason about (Chiu and Jain, 1989). Used per connection in [provider pacing](../provider-connections.md#budgeting-with-allowance-instead-of-dollars).

## To measure

- Estimate accuracy (cost and time) before and after calibration on 10 projects.
- Pass rate by task class and level, to set default pass probabilities.
- Integration rework as width grows: find the point where more workers stop helping.
