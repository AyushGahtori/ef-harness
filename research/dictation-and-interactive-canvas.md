# Research: dictation, a clickable architecture canvas and binding answers

Question: how should speech become text without wasting model calls, how can a developer click a part of a diagram and talk about it, and how do we keep answers bound to the right question? Design that uses this: [interactive architecture](../interactive-architecture.md).

## Speech to text on the desktop

| Option | Notes |
|---|---|
| Browser Web Speech API | Chrome's implementation sends audio to Google's service. Inside Electron it isn't reliably available, so it can't be the default for a desktop app. [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) |
| Windows speech recognition (OS) | Free and local where the language pack is installed; quality varies |
| Local Whisper (whisper.cpp) | Runs on CPU or GPU, offline, word timestamps and token probabilities usable as confidence. [whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Cloud transcription APIs | Good quality; costs money; note that Sign in with ChatGPT plan usage does **not** support the transcription API |

Chosen default: local Whisper, with the OS recognizer as a lightweight fallback. Speech never costs model tokens.

**Why no live model graph during speech.** Updating a model-built graph on pauses would mean a model call per pause, visible flicker when the speaker revises (“actually, scratch that”), and wrong partial interpretations that the user then reacts to. Reading the full message once after Send lets the resolver handle retractions with full context. This follows the owner's decision to wait for the developer to finish and press Send.

**Confidence highlighting** uses only local signals: the recognizer's per-word confidence plus simple patterns for numbers, times, money, names and negations (the words most likely to change behavior if misheard).

## Clickable architecture canvas

- **React Flow** (xyflow) renders interactive node graphs in React with custom node components, selection, lasso and viewport control. [React Flow](https://reactflow.dev/)
- **ELK** (Eclipse Layout Kernel, `elkjs`) computes layered layouts for directed graphs, a good fit for architecture and dependency diagrams. [elkjs](https://github.com/kieler/elkjs)
- **Semantic zoom levels** follow the C4 model idea of looking at software at different levels (context, containers, components, code). [C4 model](https://c4model.com/)
- **Prior art for “select and chat”:** IDE browsers let a developer pick an element on a running page and attach it to an AI chat as context; the canvas applies the same gesture to architecture nodes.

## Binding answers to the right question

- Capture the focused target when input starts, not when it's sent. A question that appears mid-typing must not steal the answer.
- Validate the answer against the target's type (a time, an option ID, a database name). A mismatch is a cheap, deterministic signal that the answer was meant for something else.
- Keep separate drafts per target, as messaging apps keep drafts per conversation.

## Readability of progress numbers

A changing denominator is normal in requirements work, but a bare percentage that goes *down* after the user adds information feels like a bug. Showing counts with words and the reason for every change addresses this. To be tested with users, as the open-design list already proposes.

## To measure

- Word error rate on numbers and times with local Whisper on a typical laptop microphone.
- How often developers use box selection versus typing names.
- Mis-binding rate between focused questions and selected boxes in scripted sessions.
