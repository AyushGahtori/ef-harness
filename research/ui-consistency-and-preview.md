# Research: consistent UI across parallel workers, and point-to-fix previews

Question: without designer references, how can several workers build screens that look like one product, and how can a developer point at a running UI element to request a change? Design that uses this: [UI design system](../ui-design-system.md).

## Design tokens and component kits

- **Design tokens** store visual decisions (colors, type, spacing) as named values in one source. The W3C Design Tokens Community Group publishes a vendor-neutral JSON format. [Design Tokens format](https://www.designtokens.org/)
- **Style Dictionary** turns one token file into CSS variables, Tailwind config and other outputs, so themes are generated, not hand-edited. [Style Dictionary](https://styledictionary.com/)
- **shadcn/ui** copies component source into the project instead of installing a package, which makes restyling with tokens straightforward. [shadcn/ui](https://ui.shadcn.com/)
- **Storybook-style catalogs** render every component and state in isolation; teams use them as the visual reference. Our `/__styleguide` page is a lightweight version built in Phase 0. [Storybook](https://storybook.js.org/)

## Enforcing consistency in code

| Rule | Tool |
|---|---|
| No arbitrary Tailwind values (`p-[13px]`) or raw hex colors | ESLint Tailwind plugin rules; custom rules |
| Only token values for CSS properties | Stylelint `declaration-strict-value` plugin |
| Use kit components, not look-alikes | Import restrictions plus a duplicate-component check |
| Accessibility basics | axe-core in browser tests. [axe-core](https://github.com/dequelabs/axe-core) |
| Minimum target size | WCAG 2.2 success criterion 2.5.8 (24 × 24 CSS px). [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| Pixel regressions | Playwright `toHaveScreenshot` against approved baselines. [Visual comparisons](https://playwright.dev/docs/test-snapshots) |
| Layout geometry | Bounding boxes from Playwright; ARIA snapshots can include boxes (`boxes: true`, v1.60). [Locator API](https://playwright.dev/docs/api/class-locator) |

Vision-model design review is useful as advice; its judgments aren't stable enough to block acceptance on their own.

## Point at an element, find its source

- Tools such as **LocatorJS** and **click-to-component** let a developer click an element in a running React app and jump to the component's source. [LocatorJS](https://www.locatorjs.com/) · [click-to-component](https://github.com/ericclemmons/click-to-component)
- Newer React versions removed the old internal source fields these tools relied on, so a reliable approach is a dev-only build plugin that adds a source attribute (file and line) to each JSX element. Phase 0 adds it to development builds only.
- IDE browsers already let developers select page elements and attach them to an AI chat; the App tab applies the same gesture and adds task ownership from the graph.

## To measure

- Cross-screen spacing and header differences with and without the style guide reference, on a 6-screen app built by 3 parallel workers.
- How often vision review flags a real inconsistency versus noise.
