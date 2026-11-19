# Research: prior art for the animated office

Question: has anyone shown AI agents as characters in an office or town, what did they use, and what makes an ambient animated view useful rather than distracting? Design that uses this: [office view](../office-view.md).

## Closest prior art

| Project | What it does | Takeaways |
|---|---|---|
| **Pixel Agents** | VS Code extension and standalone app: each Claude Code session becomes a pixel-art character in an office. Characters walk to desks, type while editing, read while searching, and show a speech bubble when waiting for input or permission. Sub-agents get their own characters; usage and context bars; office layout editor; character wardrobe. Observes Claude Code's JSONL transcripts rather than an API. [Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) · [GitHub](https://github.com/pixel-agents-hq/pixel-agents) · [site](https://pixel-agents.com/) | Proves the metaphor works for coding agents and that passive event observation is enough. Our version adds ranks, rooms mapped to system parts, the CEO inbox, verification and merge flow, and multiple vendors. |
| **AI Town** (a16z) | MIT-licensed starter kit for a virtual town of AI characters; PixiJS rendering, Convex backend. [GitHub](https://github.com/a16z-infra/ai-town) | PixiJS handles this kind of tile-and-sprite scene well. |
| **Generative Agents / Smallville** | Research sandbox where 25 agents live in a tile-map town (Park et al., 2023, arXiv:2304.03442) | Tile maps with named areas give agents meaningful places to go. |
| **ChatDev** | A “virtual software company” where agents play CEO, CTO, programmer and tester, with a visualizer for their conversations (Qian et al., 2023, arXiv:2307.07924) | The company metaphor maps naturally onto software roles. |
| **MetaGPT** | Agents assigned product manager, architect and engineer roles with standard operating procedures (Hong et al., 2023, arXiv:2308.00352) | Role hierarchy helps people understand who decides what. |

## Tools

| Need | Tool |
|---|---|
| 2D rendering | PixiJS. [pixijs.com](https://pixijs.com/) |
| Tile maps with named areas | Tiled map editor (JSON export). [mapeditor.org](https://www.mapeditor.org/) |
| Pixel sprites and animation | Aseprite (sprite sheets + JSON) |
| Higher-fidelity animated characters with state machines | Rive. [rive.app](https://rive.app/) |
| Office tile and character packs | Paid and free packs exist; check commercial license terms before shipping |

## Making ambient views helpful

- **Calm technology:** information can live at the edge of attention and move to the center only when needed (Weiser and Brown, 1995). The office is a peripheral display; the paper on the CEO's desk is the move to the center.
- **Interruptions are expensive:** after an interruption people take substantial time to return to the original task and work faster under more stress (Mark, Gudith and Klocke, CHI 2008).
- **Batching helps:** delivering notifications in batches a few times a day improved well-being and reduced stress in a field study (Fitz et al., 2019, *Computers in Human Behavior*).
- **Respect reduced motion:** honor the OS `prefers-reduced-motion` setting. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

## Risks

- **Decoration that lies** is worse than no animation. Every animation must be backed by a real state, with lag bounded.
- **Performance:** keep CPU low when idle and stop rendering when hidden.
- **Art licensing and trademarks:** use original or licensed art; avoid vendor logos on characters.

## To measure

- Time to find “which task is waiting on me” in Office versus Board.
- Whether developers keep the Office open after the first week.
