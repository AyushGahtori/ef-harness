# Research: question catalogs and how deep to interview

Question: how do established practices decide how many requirements questions to ask, and how do they let depth vary with project size and risk? Design that uses this: [discovery depth and catalog](../discovery-depth-and-catalog.md).

## Precedents for “depth depends on stakes”

| Precedent | Idea we reuse |
|---|---|
| **OWASP ASVS** levels 1–3 | One requirement catalog; the level chosen for the app decides which requirements apply. Our project stage (Prototype, MVP, Production) works the same way. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) |
| **ISO/IEC 25010** quality model | A standard list of quality characteristics (performance, security, usability, reliability…) is a good checklist for cross-cutting packs. [ISO 25000 portal](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) |
| **Architecture Decision Records** | Record each significant decision with context and consequences; our catalog options carry consequences in the same spirit. [ADR (Nygard)](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) |
| **Shape Up “appetite”** | Decide how much time a problem deserves before shaping it. The stage chip is the interview's appetite. [Shape Up](https://basecamp.com/shapeup/1.2-chapter-03) |

## Selecting the next questions

Choosing questions that cover the most still-open criteria is a **maximum coverage** problem. The greedy algorithm (pick the best, remove what it covers, repeat) is the standard approach and is provably within about 63% (1 − 1/e) of the best possible coverage (Nemhauser, Wolsey and Fisher, 1978). The existing selector in [architecture ideas](../architecture-ideas.md) already uses it; the interrogation guard adds an *impact × uncertainty* filter on top so low-value questions aren't asked.

## Recommendations and defaults

- Good defaults reduce effort without hiding choices; showing the recommended option preselected with consequences is a common pattern in setup wizards.
- Bulk acceptance is safe only if the user can see what was accepted afterwards; hence the *Chosen for you* list.
- High-stakes items (money, personal data, identity, irreversible changes) are commonly excluded from bulk defaults in consent and security guidance; our must-ask list follows that.

## Catalog maintenance

- Version each question; never change the meaning of an existing ID.
- Track per question: how often asked, how often its answer changed a build decision, how often users found it unhelpful. Retire questions that rarely matter.

## To measure

- Questions shown per project by stage, with and without Autopilot.
- How often a delegated (autopilot) choice is later changed by the developer.
- Decisions missed compared with a human interviewer on the same sample projects.
