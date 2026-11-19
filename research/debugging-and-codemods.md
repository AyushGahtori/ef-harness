# Research: finding mystery bugs and making repo-wide changes safely

Question: what proven techniques help an automated system find the cause of an intermittent, cross-layer bug, and how are large mechanical changes done without missing files? Design: [investigations and sweeps](../investigations-and-sweeps.md).

## Reproduce first

- A failing test before a fix is standard debugging practice and the basis of regression testing. For browser-specific bugs, Playwright runs Chromium, Firefox and WebKit; its WebKit build approximates Safari's engine (not identical to shipped Safari, so final confirmation may need a real Safari). [Playwright browsers](https://playwright.dev/docs/browsers)
- Playwright's trace viewer records network, console, DOM snapshots and actions for each run, which allows comparing passing and failing runs. [Trace viewer](https://playwright.dev/docs/trace-viewer)

## Localize

- **`git bisect run`** automatically finds the commit that introduced a failure by running a test script on a binary search of history. An exit code of 125 tells Git the commit can't be tested and should be skipped, which keeps unrelated build breaks from being blamed. [git-bisect](https://git-scm.com/docs/git-bisect)
- **Characterization tests** record what existing code actually does before changing it, so a refactor can prove behavior is unchanged (Feathers, *Working Effectively with Legacy Code*, 2004).
- **Delta debugging** systematically shrinks a failing input to a minimal one (Zeller and Hildebrandt, 2002, “Simplifying and Isolating Failure-Inducing Input”, IEEE TSE).
- **Scientific debugging:** state a hypothesis, design an experiment that distinguishes it, record the result (Zeller, *Why Programs Fail*). The hypothesis log implements this.

## The Safari example

Cookie `SameSite` behavior differs on cross-site top-level navigations: `Strict` cookies aren't sent when returning from another site, `Lax` cookies are sent on top-level GET navigations. Safari's tracking prevention adds further restrictions. [MDN SameSite](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value)

## Mechanical changes at scale

| Tool | Use |
|---|---|
| Official codemods (e.g. `npx @next/codemod`) | Framework upgrades maintained by the framework. [Next.js codemods](https://nextjs.org/docs/app/guides/upgrading/codemods) |
| TypeScript language service rename, ts-morph | Compiler-accurate symbol renames. [ts-morph](https://ts-morph.com/) |
| jscodeshift | Scripted AST transforms for JavaScript/TypeScript. [jscodeshift](https://github.com/facebook/jscodeshift) |
| ast-grep | Pattern-based structural search and rewrite across languages. [ast-grep](https://ast-grep.github.io/) |
| OpenRewrite | Large-scale automated refactoring recipes (Java and others). [OpenRewrite](https://docs.openrewrite.org/) |

Large organizations run such changes as *large-scale changes*: automated tools for the bulk, compiler and test results as the checklist, and sharding into independently verifiable pieces (Google's “Large-Scale Changes” chapter in *Software Engineering at Google*, 2020).

## To measure

- Investigation success rate and cost on the 10 seeded bugs.
- Sweep leftovers found by the scan after the checklist reached zero (should be zero).
