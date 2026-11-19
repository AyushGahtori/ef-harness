# UI design system and visual feedback

Several workers building screens in parallel will produce mismatched screens unless they share one visual system that exists *before* they start and is enforced *after* they finish. When the developer supplies no Figma or screenshots, the harness creates that system itself in Phase 0, renders it, and uses the rendering as the reference. Research: [UI consistency and preview](research/ui-consistency-and-preview.md).

## Decisions in plain words

1. **Tokens first, screens second.** Colors, type scale, spacing, radii and shadows are defined once as design tokens. Workers may only use tokens.
2. **One component kit.** Phase 0 builds the primitives (Button, Card, Input, Table, Dialog, Toast, page header…) and the app shell. Screen workers compose them; they don't create look-alikes.
3. **The style guide page is the reference picture.** Phase 0 renders every primitive and layout on a `/__styleguide` page and screenshots it. Those screenshots are the “reference crops” every UI brief carries when the developer supplied none.
4. **Consistency is checked by code, taste by a reviewer.** Lint rules and layout checks block mistakes. A vision-model review against the style guide is advisory.
5. **The developer steers by pointing.** In the App tab, the developer selects an element on the running app and says what to change. The harness knows which file and which task own it.

## Look-and-feel mini interview

Part of the Web frontend pack ([discovery depth](discovery-depth-and-catalog.md)). Every question has a recommended answer, so “Accept all” works.

| Question | Recommended default |
|---|---|
| Any site or app whose feel you like? (link or screenshot) | None; use a clean neutral style |
| Brand color? | Neutral slate with one accent (indigo) |
| Density: roomy, balanced or compact? | Balanced |
| Light, dark or both? | Both, following the system setting |
| Component library preference? | shadcn/ui on Tailwind (source copied into the repo, easy to restyle) |
| Font? | System UI stack (no font loading) |

For an existing repo, these answers are **extracted** from the code (Tailwind config, CSS variables, the existing component folder) and shown for confirmation instead of asked.

## Phase 0 design foundation

| Artifact | Content |
|---|---|
| `tokens.json` | Design tokens in the W3C Design Tokens format: color roles (background, surface, text, muted, accent, danger…), type scale (6 steps), spacing scale (4-px based), radii, shadows, motion durations. Light and dark sets. |
| Generated theme | CSS variables and Tailwind theme generated from the tokens. Not edited by hand. |
| Primitives | The kit components, each with variants and all states: default, hover, focus, disabled, loading, error. |
| Layout templates | App shell (nav + header + content), page header with an actions slot, list/detail, form page, empty state, error state. |
| `/__styleguide` | One page rendering every primitive, variant, state and template, in light and dark. |
| Reference crops | Screenshots of the style guide at desktop, tablet and phone widths, stored with the revision. |
| UI conventions | Lines like “page titles use the page header template”, “primary actions sit in the header actions slot”, “lists use Table, not custom grids”. |

## Screen briefs

Each UI task gets a **screen spec** rather than a picture:

```yaml
screen: kitchen-list
route: /kitchen
template: list-detail
regions:
  header: {title: "Kitchen totals", actions: [{button: "Print", variant: secondary}]}
  main:   {component: Table, columns: [Dish, Quantity], empty_state: "No orders yet"}
states: [loading, empty, populated, error]
density: balanced
references: [styleguide/table@desktop, styleguide/page-header@desktop]
```

The harness renders a quick low-fidelity wireframe from the spec (boxes and labels, no styling) so the developer can approve key screens in the plan preview if they want to. The accessible names in the spec (“Print”, “Kitchen totals”) are also the test contract ([verification for real apps](verification-for-real-apps.md#ui-the-interaction-contract)).

## Checks after a UI task

| Check | Kind | Blocks acceptance? |
|---|---|---|
| No raw colors, arbitrary pixel values or new fonts outside tokens | Lint (ESLint/Stylelint rules) | Yes |
| Uses kit primitives; no look-alike components | Lint on imports and a duplicate-component detector | Yes |
| Accessibility basics: labels, roles, contrast, focus order | axe-core in the browser test | Yes for serious issues |
| Layout sanity at three widths: nothing overflows, overlaps or falls off-screen; tap targets ≥ 24 px | Bounding-box checks in Playwright | Yes |
| Header height, page padding and spacing rhythm match other screens | Cross-screen measurement against the style guide | Warning |
| Looks consistent with the style guide | Senior vision-model review of screenshots vs reference crops | Advisory note on the task |
| Pixel diff | Only after the developer approves a baseline screenshot | Yes, once a baseline exists |

## Preview and point to fix

The **App** tab of the canvas runs the app from `harness/integration` (or a chosen feature branch) in an embedded browser with its own port and profile.

**Point mode** (toolbar button or shortcut): hovering outlines elements; clicking one captures:

- the route, the element's accessible role and name, and its DOM path;
- the component name and source location (`src/kitchen/KitchenCard.tsx:12`), available because Phase 0 adds a dev-only build plugin that tags elements with their source;
- a screenshot crop with the element highlighted, and its computed spacing and typography;
- the owning task and feature, looked up from path ownership in the graph.

The composer target becomes **Element: KitchenCard**. The developer can also drag a box on the screenshot to point at a gap between elements.

### Example: “make the kitchen card tighter and move Print to the header”

| Clause | Interpretation | Routed to |
|---|---|---|
| “make the kitchen card tighter” | Reduce KitchenCard padding by one spacing step (16 → 12 px) and gap between rows | F12's owner as a visual change; a small Mid task |
| “move Print to the header” | Put the Print button in the page-header actions slot; remove it from the card | Same owner; layout change to the screen spec |

Because tests find the button by role and name (“button Print”), moving it doesn't break the journey test. When the tasks finish, the App tab shows **before / after** screenshots side by side, and the developer accepts or says what's still off. Accepting updates the approved baseline.

### Routing visual bugs

| Selected element belongs to | Goes to | Note |
|---|---|---|
| A screen file owned by a feature task | That feature's owner | Normal change |
| A kit primitive or token | The design-system owner (integrator) | Preview shows “affects 7 screens” with thumbnails before applying |
| Third-party component | The owning feature, as a style override inside tokens | — |
| Unknown file (not in any task's scope) | Project planner | Brownfield code outside planned work |

## Edge cases

| Situation | Behavior |
|---|---|
| Developer supplies one screenshot mid-build | It becomes a reference crop for the screens it covers; the design owner checks whether tokens need to change and previews the effect before applying. |
| Two workers both want a new primitive (e.g. Badge) | Both send a request; the integrator builds one Badge in the kit; both tasks consume it. |
| Developer wants a one-off style (“make this red”) | Allowed through a token role (danger or accent) or a named local variant; raw values stay blocked. |
| App fails to start in the preview | Show the startup error with the owning task; the App tab offers the last good build. |
| Brownfield app with no design system | Extract what exists; offer a “consolidate tokens” task; never restyle the whole app unasked. |

[Diagram](ui-design-system.svg) · [Editable Mermaid](ui-design-system.mmd) · [Planning and crew](planning-and-crew.md) · [Interactive architecture](interactive-architecture.md) · [Verification for real apps](verification-for-real-apps.md) · [Research](research/ui-consistency-and-preview.md)
