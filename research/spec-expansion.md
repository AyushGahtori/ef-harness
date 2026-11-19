# Research: expanding a short interview into a complete specification

Question: what systematic techniques generate the missing details of a specification (states, permissions, failures, boundaries) and detect contradictions among them? Design: [spec expansion](../spec-expansion.md).

## Writing requirements consistently

**EARS** (Easy Approach to Requirements Syntax) defines a few templates (ubiquitous, event-driven *When*, state-driven *While*, unwanted behavior *If… then*, optional *Where*) with clauses in a fixed order. Its authors report that unwanted behavior “is a major source of omissions in early requirements”, which is why it has its own pattern. [EARS guide](https://alistairmavin.com/ears/) · (Mavin et al., RE 2009)

## Generating the missing cells

| Technique | What it enumerates |
|---|---|
| CRUD / access-control matrix | Every entity × operation × role |
| Statecharts and state-transition tables | Every state, event and forbidden transition (Harel, 1987, “Statecharts”) |
| Equivalence partitioning and boundary-value analysis | Representative and edge values for every input (standard test design, e.g. ISTQB syllabus) |
| Decision tables | Combinations of conditions and their outcomes |
| Failure mode checklists for APIs | HTTP status classes per endpoint; timeouts and retries |

These are mechanical once the model of entities, roles and screens exists, which is why most expansion costs no tokens.

## Finding contradictions

- **Feature models and constraint solving:** product-line engineering expresses option compatibility (“requires”, “excludes”) as propositional formulas and uses SAT solvers to find invalid combinations (Batory, 2005, “Feature Models, Grammars, and Propositional Formulas”). The catalog's `conflicts_with` and `requires` rules are the same idea.
- **SMT solvers** such as Z3 handle numeric and time constraints and can report a minimal unsatisfiable core (the smallest conflicting set). Z3 has a WebAssembly build usable from TypeScript. [Z3](https://github.com/Z3Prover/z3) · [z3-solver on npm](https://www.npmjs.com/package/z3-solver)
- **Model-checked pairs only:** checking every pair of requirements with a model is quadratic and expensive; restricting to pairs that share entities or rules keeps it bounded.

## Defaults as policy

Design systems and platform guidelines (e.g. inline form validation, standard empty states) provide defensible defaults. Recording each default as `defaulted` with its policy ID keeps them reviewable rather than hidden.

## To measure

- Gold decisions recovered by expansion on the benchmark projects.
- Contradictions introduced by Autopilot defaults and how many the deterministic layers catch before the model layer.
- Spec items per feature versus defects found later.
