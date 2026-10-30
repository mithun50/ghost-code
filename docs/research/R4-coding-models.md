# R4: Local coding models worth shipping

Checked 2026-10-30 against the live Ollama library pages and the Hugging Face API.
Every Ollama tag and size below was read from `https://ollama.com/library/<model>/tags`.
Scores come from the Ollama model page or the model card (sources in R1 section 5).
Vendor-only claims and image-only scores are marked.

Selection rule: open weights, downloadable (not `:cloud`), tool calling, built or
tuned for coding or agents, and fits a laptop or a single consumer GPU.

## Tier 1. Small: 16 GB RAM laptops, 8 GB GPUs (5-8 GB download)

| Model | Ollama pull | Download | Context | Why it's here | Weak spots |
|---|---|---|---|---|---|
| Ornith 1.5 9B | `ornith-1.5:9b` | 6.6 GB | 256K | Newest Ornith, "self-improving" models built for agentic coding | Scores only in images (UNVERIFIED). License UNVERIFIED |
| Ornith 9B | `ornith:9b-q4_K_M` | 5.6 GB | 256K | Built for agentic coding, MIT, smallest good option | Scores only in images (UNVERIFIED) |
| Gemma 4 E4B | `gemma4:e4b-it-qat` | 6.1 GB | 128K | Google QAT quant (better quality at 4-bit). LiveCodeBench v6 52.0 | Tau2 tool use 42.2: weak on long multi-file tasks |
| Nemotron 3.5 Bolt E4B | `nemotron-3.5-bolt:e4b` | 7.2 GB | 128K | NVIDIA, "for local coding, reasoning, and tool use". Ships a DFlash draft model, so speculative decoding is built in | No coding scores published. OpenMDW license |

Downloads:
- https://ollama.com/library/ornith-1.5 · GGUF: https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF
- https://ollama.com/library/ornith · GGUF: https://huggingface.co/ornith-ai/Ornith-1.0-9B-GGUF
- https://ollama.com/library/gemma4 · GGUF: https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf
- https://ollama.com/library/nemotron-3.5-bolt · GGUF: https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF

## Tier 2. Medium: 32 GB RAM laptops, 16 GB GPUs (14-19 GB download)

| Model | Ollama pull | Download | Context | Active params | Why it's here | Weak spots |
|---|---|---|---|---|---|---|
| gpt-oss 20B | `gpt-oss:20b` | 14 GB | 128K | MoE | Fastest good model on a 16 GB GPU: 111-205 tok/s measured. Apache-2.0 | Coding scores UNVERIFIED |
| Gemma 4 26B A4B | `gemma4:26b-a4b-it-qat` | 16 GB | 256K | 3.8B (MoE) | LiveCodeBench 77.1, Tau2 68.2: strong tool use for its speed | |
| Muse Glimmer 30B | `muse-glimmer:30b-q4_K_M` | 18 GB | 128K | not stated | Meta, Apache-2.0, tuned for tool use and failure recovery. SWE-bench Verified 76.0, Pro 51.2. A `-dflash` tag (20 GB) adds speculative decoding | Slow on CPU if it's dense |
| Qwen3.6 27B Coding | `qwen3.6:27b-coding` | 18 GB | 256K | 27B (dense) | Base 27B: SWE-bench Verified 77.2, Terminal-Bench 2.1 60.7 (the highest here). `-mtp` tag adds multi-token prediction | Dense: needs a GPU for usable speed |

Downloads:
- https://ollama.com/library/gpt-oss · GGUF: https://huggingface.co/ggml-org/gpt-oss-20b-GGUF
- https://ollama.com/library/gemma4 · GGUF: https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf
- https://ollama.com/library/muse-glimmer · GGUF: https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF
- https://ollama.com/library/qwen3.6 · GGUF: https://huggingface.co/unsloth/Qwen3.6-27B-GGUF

## Tier 3. Large MoE: 32 GB+ RAM, or a GPU plus RAM offload (about 23 GB download)

About 3B active parameters each, so they run at small-model speed with 30B-class quality.
These are the best choice for CPU-only 32 GB machines.

| Model | Ollama pull | Download | Context | Active | Why it's here | Weak spots |
|---|---|---|---|---|---|---|
| Qwen3.6 35B A3B Coding | `qwen3.6:35b-a3b-coding` | 23 GB | 256K | 3B | Base model SWE-bench Verified 73.4, Terminal-Bench 2.0 51.5, LiveCodeBench v6 80.4. Apache-2.0. `-mtp-q4_K_M` tag adds multi-token prediction | Coding variant's own scores UNVERIFIED |
| Ornith 1.5 35B | `ornith-1.5:35b` | 23 GB | 256K | 3B | Agentic-coding family, same size class | Scores UNVERIFIED |
| Flint 40B | `flint:40b-a2b-qat-int4` | 23 GB | 256K | about 2.5B | Recursive, Apache-2.0, built for coding agents. Vendor claims SWE-bench Verified 74.2 | Vendor-only numbers; its Pro score above its Verified score is suspicious. No official GGUF on Hugging Face, use Ollama |

Downloads:
- https://ollama.com/library/qwen3.6 · GGUF: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF (MTP build: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF)
- https://ollama.com/library/ornith-1.5 · GGUF: https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF
- https://ollama.com/library/flint

## Recommended defaults

| Machine | Default | Backup |
|---|---|---|
| 16 GB RAM, CPU only | `ornith-1.5:9b` | `gemma4:e4b-it-qat` |
| 8 GB NVIDIA GPU | `ornith-1.5:9b` (fully on GPU) | `nemotron-3.5-bolt:e4b` |
| 32 GB RAM, CPU only | `qwen3.6:35b-a3b-coding` | `gemma4:26b-a4b-it-qat` |
| 16 GB GPU | `gpt-oss:20b` | `gemma4:26b-a4b-it-qat` |
| 24 GB+ GPU | `qwen3.6:27b-coding` | `muse-glimmer:30b-q4_K_M` |
| Apple 16 GB | `gemma4:e4b-it-qat` | `ornith-1.5:9b` |
| Apple 32 GB+ | `qwen3.6:35b-a3b-coding` | `gpt-oss:20b` |

Benchmark all of these on GhostBench-Web before final picks. Ornith's and gpt-oss's
coding scores are unverified, and Ornith is a default in two rows.

## Left out, and why

| Model | Reason |
|---|---|
| `beam`, `glm-5.3-flash`, `deepseek-v4.1-flash` | Cloud-only in Ollama (`:cloud` tags only) |
| `qwen3.8-flash-next` | Smallest download is 120 GB |
| `qwen3-coder:30b` | Superseded by Qwen3.6 at the same size |
| `gemma4:e2b` | Tau2 tool use 24.5, too weak for agent work |
| `lfm3:1.7b`, `bonsai-2` | No coding scores. bonsai-2 is a ternary vision model |
| Uncensored or "abliterated" GGUF repos | Unofficial modifications. Use official or unsloth/ggml-org builds |
| `nimble`, `nimble-v3` (Bespoke Labs 9B), `tev1` (Together AI 0.8B/4B) | Decision models, not coding models. Worth testing as Laya alternatives that run inside Ollama with no Python |
