# Verification for real apps: screens, routes, migrations and AI features

[Verification and isolation](verification-and-isolation.md) works cleanly for a pure function like `toPrintRows`. Real apps add screens, API routes, auth callbacks, database migrations and model-powered features. This document extends the same principles (expectations set before implementation, red-before-green, held-back cases, a clean verifier) to those cases. Research: [testing real apps](research/testing-real-apps.md).

## Decisions in plain words

1. **The planner publishes how the product is *used*, not how it's *built*.** For a screen: the route, the button names, labels and headings a person sees. For an API: the path, method and schema. These are product decisions, so the worker sees them. The expected *results* stay with the verifier.
2. **Tests find things the way a person does.** “The button named Print”, not `#print-btn`. A refactor that keeps the visible behavior keeps passing.
3. **When a check can't be written up front, a blind binder writes the adapter after implementation.** It sees the inputs and the code, never the expected values.
4. **A failed hidden check gets a hint ladder, not three blind guesses.** Rule and failure type first, then a fresh disclosed example, then a stronger model or the task author.
5. **Fuzzy qualities get layered checks.** Structural checks block; screenshot comparisons block only after a human approves a baseline; model-judged quality is a scored gate with a stated threshold.

## UI: the interaction contract

Before a screen is built, the planner adds an **interaction contract** to the brief:

```yaml
contract: kitchen-list/ui@1
route: /kitchen
as: {role: kitchen_staff}            # seeded test identity
landmarks:
  - heading: "Kitchen totals"
  - table:   {name: "Totals by dish", columns: ["Dish", "Quantity"]}
actions:
  - button: "Print"                  # accessible name; location is free
states:
  empty:   {text: "No orders yet"}
  loading: {role: progressbar}
testids:                             # only where no user-facing name exists
  - kitchen-row                      # each table row, data-testid="kitchen-row"
```

| Who decides | What |
|---|---|
| Planner (visible to worker) | Route, accessible names, landmark structure, empty/loading/error text, test IDs where needed |
| Worker (free) | Component structure, CSS classes, file layout, markup |
| Verifier (hidden) | The seeded orders and the expected rows (“Soup · 2”, “Rice · 1”) |

The check uses Playwright's role and label locators:

```ts
await page.goto('/kitchen');
await page.getByRole('button', { name: 'Print' }).click();
await expect(page.getByRole('table', { name: 'Totals by dish' })).toMatchAriaSnapshot(expected);
```

**User-facing text comes from one copy catalog.** Every visible string in a contract (headings, button names, empty and error messages) is a key in a planner-owned message file generated before the task (`kitchen.loadError: "Couldn't load orders"`). Workers render text through the key, so they can't type a slightly different sentence, and checks look elements up by the catalog value. The catalog is linted when the planner writes it: unique names per screen, buttons named by their action, no empty or generic labels (“Click here”), and names that match their role.

**Text matching modes.** Each contract string has a match mode:

| Mode | Default for | Treats as equal |
|---|---|---|
| `normalized` | Everything unless stated | Differences in whitespace, case, quote and apostrophe styles, dash and separator characters (`·`, `-`, `–`, `|`) |
| `exact` | Legal text, brand names, prices | Nothing |
| `contains` | Long help text | The listed key phrase appears in the accessible name or text |

So “Couldn't load orders · Retry” and “Could not load orders - Retry” are still different (a different word), but with the copy catalog that difference can't arise. A genuinely missing control is always a contract mismatch.

**Contract mismatch vs wrong behavior.** If the verifier can't find “button Print”, that's a *contract mismatch*: the worker gets a plain message (“No button named Print on /kitchen”) because the contract is already visible to it. If the button exists but the table shows the wrong rows, that's a *behavior failure* and the hidden-check rules apply. These two never count against each other.

## Other entry points

| Kind | Contract published up front | How the verifier drives it |
|---|---|---|
| API route | OpenAPI path, method, request and response schemas, error codes | HTTP calls against the attempt's server; schema validation plus expected values |
| Auth callback | Routes, redirect targets, session properties (cookie is httpOnly, role claim present), failure behavior | A local mock identity provider issues codes; tests valid login, bad `state`, expired code, wrong role |
| Background job | Trigger (queue message or schedule), observable output (row, email captured, event) | Enqueue with a fake clock; assert on the captured outcome |
| CLI | Command, flags, exit codes, output format | Run in the attempt sandbox; compare structured output |
| Database migration | Target schema and data mapping rules (see below) | Fixture database at the previous schema |

## The blind binder

Some checks need code that can't be written before the implementation exists, for example *how to seed a cart into this app's store* or *which function receives a webhook*. Two modes:

| Mode | When | How it stays blind |
|---|---|---|
| **Contract-bound** (default) | Entry point is user-facing (route, button, endpoint, CLI) | No binder needed; the runner uses the contract directly |
| **Post-hoc binder** | Entry point depends on internal names | After the worker submits, a separate binder agent reads the candidate code and the inputs, writes a small adapter (seed state, call the function, capture the output). It never receives expected values. Kernel rules: the adapter may not import test expectations or modify product files. The trusted runner compares the adapter's observations with the hidden expectations. |

If the binder can't find a sensible entry point, that's a **binding defect** returned to the task author (the brief was underspecified), not a worker failure.

### Red-before-green with a post-hoc binder

A binder written after implementation may call names that don't exist on the base commit, so running it against the base would fail to compile. That isn't a meaningful “red”. The rules:

1. **The entry point is named before coding.** The task's contract declares *what* is called: an exported signature (`toPrintRows(totals: Totals): PrintRow[]`), a route, a command, a job name. The binder decides only *how* to set up state and call it, and may call only declared entry points plus setup helpers (seeding, store creation).
2. **The base gets contract stubs.** For red-before-green, the kernel generates a stub module from the declared signatures (correct types, returning an empty value or throwing a “not implemented” marker) and runs the binder and check against the base with the stubs.
3. **Only a behavioral failure counts as red:** a failed assertion or the “not implemented” marker. A compile error, missing module or binder crash means the binding is broken; it goes to the binder or task author, and the check isn't locked until a real red is observed.
4. **Setup helpers the binder uses must exist at the base or be part of Phase 0.** A binder needing a helper the worker just invented is a binding defect: the contract should have declared it.

## When a worker fails a hidden check

Retries count only when the worker received new information.

| Attempt fails | Worker receives | Why |
|---|---|---|
| 1st | The rule ID and its text, plus the failure *type*: wrong value, missing item, extra item, wrong order, exception, timeout | Enough to re-read the rule without exposing the test input |
| 2nd | A **fresh disclosed example**: a new input generated from the same rule (from the planner's spare pool or a property generator) with its expected output and the candidate's actual output. The original held-back case stays hidden. | Concrete debugging material that can't be hard-coded to pass the hidden case |
| 3rd | No more retries at this level. The task moves up one level with the full history, **or** goes to its author if the evidence suggests the brief is unclear | Stops blind guessing |

**Signals that skip the ladder**

- The same failure fingerprint twice in a row → go straight to step 3.
- Two different workers fail the same rule in the same way → author review (likely an unclear brief or a wrong expectation).
- Worker disputes the case with a counterexample → author decides ([verification and isolation](verification-and-isolation.md)).

The ladder position, last failure fingerprint and disclosed examples are stored per task in `verification_state`, survive new attempts and reset when the brief changes (`record_hidden_failure` in [queries.sql](schema/queries.sql), tested). Each rule keeps a pool of at least three hidden examples. When one is disclosed as a fresh example, it moves to the visible set and another stays hidden.

## Things that aren't exact

### Visual layout

| Layer | Check | Blocks? |
|---|---|---|
| Structure | ARIA snapshot of the region; expected landmarks and order | Yes |
| Geometry | No overflow or overlap, inside the viewport at three widths, aligned within 2 px of the template, minimum tap size | Yes |
| Accessibility | axe-core: contrast, labels, focus | Serious issues yes |
| Tokens | Lint: no raw colors or arbitrary spacing ([UI design system](ui-design-system.md)) | Yes |
| Pixels | `toHaveScreenshot` against an approved baseline, dynamic regions masked, small threshold | Only after the developer approves a baseline |
| Taste | Vision-model review against the style guide | Advisory |

### Database migrations preserving data

1. Build a fixture database at the **previous** schema and fill it with synthetic edge data: nulls, Unicode, maximum lengths, duplicates, boundary dates, orphan-looking rows.
2. Run the migration in a Tier 3 environment.
3. Assert: row counts per table; checksums of columns that shouldn't change; each transformation rule on sample rows; constraints and indexes valid; the app's read path works on migrated data.
4. Run it again to prove it's safe to re-run (or that it refuses cleanly).
5. If a down-migration exists, round-trip and compare.
6. For risky changes (renames, type changes, drops), require the expand-then-contract pattern: add new, copy, switch reads, and only later remove old.

### Timing and concurrency

The contract requires an injectable clock for time rules. Tests use fake timers for exact boundaries (10:44:59, 10:45:00, 10:45:01 in the stated time zone). Performance checks use repeated measurements with a tolerance and a stated dataset size. Concurrency checks run the same action from two clients and assert the documented outcome.

### AI-powered features

Split the feature into a deterministic shell and the model's output:

| Part | How it's verified |
|---|---|
| Shell: prompt assembly, parsing, schema validation, retries, fallbacks, cost limits | Exact tests with a **stub model** that returns scripted outputs, including malformed ones |
| Output properties: valid schema, required facts present, length limits, no forbidden content | Automatic checks on recorded outputs |
| Quality | An **eval set** written by the planner from the requirements (10–30 cases). A judge model, different from the generating model, scores each output against a rubric. The gate is a stated threshold (e.g. at least 8 of 10 pass, no critical failure), run on several samples |
| Regression in CI | Recorded responses are replayed so ordinary test runs are deterministic and free |

Judged quality is shown as a score with its threshold, never as a plain green tick. The developer can tighten or loosen the threshold as a product decision.

### External services

Use the service's own test mode or a local emulator (payment test mode or mock server, a captured-email server for mail, a mock identity provider). Record the differences from the live service; a separately authorized live check covers what remains.

## Edge cases

| Situation | Behavior |
|---|---|
| The developer renames “Print” to “Print list” | A product change: the contract and its checks update through a revision; the worker isn't blamed. |
| Two buttons share the name “Print” | Contract validation at planning flags the ambiguity; the planner adds a region or a test ID. |
| A judge model is unavailable | Quality gate stays pending; the task is “verified except quality”, shown clearly; dependents may proceed only if the developer allows. |
| A migration fixture is too slow to build | Reduce to a smaller synthetic template that still covers every rule; record the reduction. |
| Flaky browser test | Re-run in fresh state; a disagreeing run marks the test unstable and routes it to its owner. |

[Diagram](verification-for-real-apps.svg) · [Editable Mermaid](verification-for-real-apps.mmd) · [Verification and isolation](verification-and-isolation.md) · [UI design system](ui-design-system.md) · [Planning and crew](planning-and-crew.md) · [Research](research/testing-real-apps.md)
