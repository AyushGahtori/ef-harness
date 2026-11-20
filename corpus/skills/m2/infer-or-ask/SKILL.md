---
id: infer-or-ask
version: 1
status: draft
description: Decide whether a requirement value is stated, safely derivable, delegated, or must be asked. Use when resolving discovery criteria, when a worker or planner meets a missing product decision, or when a steer may change a settled decision.
tools: none
---

# Infer or ask

You are deciding whether you may fill in a product decision yourself or must ask. A wrong guess becomes code, tests and wasted work. A needless question costs the developer's attention. Follow these rules exactly; the kernel will reject anything that breaks them.

## The four answers

| Status | Use only when | Example |
|---|---|---|
| `explicit` | A current, unretracted user statement establishes this exact value | “Email the totals” → channel = email |
| `derived` | A listed inference rule applies and all its premises are resolved facts | “Staff open the link on their phones” → menu page must work on a phone browser |
| `delegated` | The user handed this choice to the harness within stated limits, and you pick inside them | “Choose a free local database” → SQLite, with the reason recorded |
| `missing` / `partial` / `conflict` | Anything else | “Email the totals” → recipient = missing |

A settled value is stored with basis `explicit`, `derived` or `delegated`; `missing`, `partial` and `conflict` are statuses of an unsettled criterion, not bases.

## Rules

1. **Quote, don't paraphrase.** Every `explicit` or `derived` value cites the exact user span (turn ID and offsets). Your own earlier summary is never evidence.
2. **Meaning, not keywords.** The quote must establish the value. “Open the link on a phone” does not establish offline support, a native app, or phone checkout.
3. **Negation and retraction win.** “Maybe printing… actually scrap printing” establishes nothing about printing. Keep digits and negations exactly as spoken.
4. **Recommendations are not answers.** A suggested option becomes a decision only when the user accepts it, or when it is chosen inside an explicit delegation.
5. **Costly or hard-to-reverse choices need the user.** Paid services, identity provider, data retention, deleting data, legal or compliance duties: `explicit` or an explicit, bounded delegation only. Never `derived`.
6. **One criterion at a time.** If one sentence settles the channel but not the recipient, credit the channel and mark the recipient `missing`.
7. **Two readings means ask.** If “the kitchen wants a printed list” could mean *add print* or *replace email*, list both readings and return `conflict`. Never pick one silently.
8. **Today is not tomorrow.** In an existing repo, code describes current behavior. The user's request describes the change. A mismatch is a planned change until the user says otherwise.

## When you must ask

Ask one concrete question in the user's own words:

- Name the decision and why it matters in one short clause.
- Offer the applicable options, a recommendation if one is clearly safer, and “something else”.
- If two readings change behavior, show both fairly.

> “After 11, can staff change their own orders, can only the manager edit them, or is the list final? (The kitchen list is printed at 11, so this decides what it shows.)”

## Output

Return one object per criterion you were given. Do not invent criteria; propose new gaps separately with their source.

```json
{
  "criterionId": "delivery.recipient",
  "status": "missing",
  "value": null,
  "evidence": [],
  "rule": null,
  "premises": [],
  "delegation": null,
  "missingDetail": "Who receives the emailed totals",
  "question": "Who should receive the kitchen totals email: the shift lead, the whole kitchen, or someone else?"
}
```

## Self-check before returning

- Every `explicit` value has a quote that a stranger would agree establishes it.
- Every `derived` value names an allowlisted rule and resolved premises, with no circular support.
- No costly choice is `derived`.
- Nothing is credited from a retracted or superseded span.
