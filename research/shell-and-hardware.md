# Research: machine limits on Windows and dictation vocabulary

Question: what can a desktop app measure about memory, GPU and disk on Windows to avoid overloading a laptop, and how can Whisper be biased toward a project's vocabulary? Design: [app shell and governor](../app-shell-and-governor.md).

## Measuring the machine

| Signal | Windows API |
|---|---|
| Physical memory, commit charge | [GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex) |
| System low-memory signal | [CreateMemoryResourceNotification](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-creatememoryresourcenotification) |
| Per-job resource accounting | [Job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) |
| GPU memory budget per adapter | [IDXGIAdapter3::QueryVideoMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo) |

## Saving disk

- pnpm keeps one content-addressable store and hard-links packages into projects, so many worktrees share the same files on one drive. [pnpm motivation](https://pnpm.io/motivation)
- Windows 11 Dev Drive (ReFS-based) is designed for developer workloads such as repositories and package caches. [Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)

## Dictation vocabulary

- Whisper's prompt is limited to 224 tokens; longer prompts keep only the last 224, so important terms belong at the end. [Whisper prompting guide](https://developers.openai.com/cookbook/examples/whisper_prompting_guide) · [whisper.cpp prompt handling](https://github.com/ggerganov/whisper.cpp/pull/1981)
- whisper.cpp applies the initial prompt only to the first window unless `--carry-initial-prompt` prepends it to every window. [whisper.cpp PR 3395](https://github.com/ggml-org/whisper.cpp/pull/3395)
- Prompting with domain terms and correcting known misspellings in post-processing are both recommended for jargon. [Whisper prompting guide](https://developers.openai.com/cookbook/examples/whisper_prompting_guide)

## To measure

- Memory peak per consumer type on 16 GB and 32 GB laptops.
- Time from orange pressure to recovery without user-visible failures.
- Word error rate on project phrases with and without vocabulary prompts.
