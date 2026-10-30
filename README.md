# GhostCode

An offline-first AI coding agent for laptops and phones.

GhostCode runs open models on the hardware you already own. It works with no
network, and your code stays on your machine. When the device is too small for
a local model, it switches to your own API key (BYOK).

- CLI: `ghostcode` (short alias `ghost`)
- Home directory: `~/.ghostcode` (env `GHOSTCODE_HOME`)
- Base: fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). GhostCode is not affiliated with or endorsed by DeepSeek.
- Local runtime: [Ollama](https://github.com/ollama/ollama) / [llama.cpp](https://github.com/ggml-org/llama.cpp)
- Decision layer: [Laya](https://huggingface.co/convaiinnovations/laya) (Apache 2.0)

## Layout

```text
ghostcode/
  README.md                     this file
  docs/
    IMPLEMENTATION_PLAN.md      phases, owners, tasks, acceptance criteria
    research/
      R1-ollama-model-download.md   track: how Ollama finds, downloads, stores models
      R2-ollama-runtime.md          track: how Ollama runs models, how GhostCode calls them
      R3-laya-integration.md        track: how Laya plugs into the agent loop
      hardware.md                   team test devices
  harness/                      the forked and rebranded harness
```

Start with `docs/IMPLEMENTATION_PLAN.md`.

Note: the AfterHours pitch deck calls this project "EdgeForge". Rename the deck
title to GhostCode before submission, or keep EdgeForge as the pitch name.
