# GhostCode

An offline-first AI coding agent for laptops.

GhostCode runs open models on the hardware you already own. It works with no
network, and your code stays on your machine. When the device is too small for
a local model, it switches to your own API key (BYOK).

- CLI: `ghostcode` (short alias `ghost`)
- Home directory: `~/.ghostcode` (env `GHOSTCODE_HOME`)
- Base: fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). GhostCode is not affiliated with or endorsed by DeepSeek.
- Local runtime: built-in [llama.cpp](https://github.com/ggml-org/llama.cpp) server, installed from the app (Ollama and LM Studio also work)
- Decision layer: [Laya](https://huggingface.co/convaiinnovations/laya) (Apache 2.0)

## Run it

Needs Node 24.9+ and pnpm 11 (`corepack enable` sets up pnpm). Windows, macOS and Linux.

```bash
cd harness
pnpm install
pnpm run build
pnpm ghostcode web
```

Open the URL it prints (port 3080). To use another port: `pnpm ghostcode web --port 3090`.

### Local model, one click

1. Click the model name under the message box, then **Manage**, then the **Local** tab.
2. GhostCode scans the computer (CPU, free RAM, GPU, free disk) and marks the recommended model.
3. Click **Install**. It downloads llama.cpp (about 36 MB) and the model with a progress bar, starts the server, measures its speed and selects it.

The default is **Qwen3.5 2B** (4-bit, 1.3 GB) with **Qwen3.5 0.8B** as a draft model for speculative decoding. On an Intel Core Ultra 5 laptop with Arc graphics it measured 23 tokens/s alone and 27 to 30 tokens/s with the draft. Model weights may use 67.5% of free RAM; bigger models are marked as needing more memory.

Every download is pinned to a Hugging Face revision and checked against its SHA-256. Interrupted downloads resume. Files go to `~/.ghostcode/local-models`.

### Laya, one click

Click the brain button in the composer, then **Install Laya**. It downloads `uv` if it is missing, creates a Python environment, installs `laya[serve]` (CPU build, about 700 MB) and the English checkpoint (807 MB), with a progress bar, then turns Laya on. Files go to `~/.ghostcode/laya`.

### Stop everything

```bash
pnpm ghostcode kill
```

Stops the GhostCode server, the local model server and Laya. The model server also stops when GhostCode exits, and a server left behind by a crash is stopped on the next start.

### Never leak, verify before escalating

Click the shield badge in the composer. See [docs/HURDLE.md](docs/HURDLE.md) for what it shows, the code behind it and a demo script.

## Docs

- [Architecture](docs/ARCHITECTURE.md): how the pieces fit, with diagrams
- [Hurdle: Never Leak, Verify Before Escalating](docs/HURDLE.md): what each hint maps to, and a demo script
- [Benchmarks](docs/BENCHMARK.md): Laya accuracy, local model speed, cloud vs local website build
- [Demo script and repo walkthrough](docs/DEMO_SCRIPT.md): talk track for judges
- [Clinic demo](demo/clinic/README.md): 100 synthetic patient records with Aadhaar, PAN and UPI, analysed on the laptop
- [AGENTS.md](AGENTS.md): instructions for coding agents working in this repo

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
