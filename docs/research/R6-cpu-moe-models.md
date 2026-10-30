# R6: CPU-only MoE coding models at 1-4 bit

Checked 2026-10-30. File sizes come from the Hugging Face API (`/api/models/<repo>/tree/main`),
with split files summed. Model descriptions and scores come from the model cards.
Speed figures are estimates until we measure them on team laptops (see "Speed" below).

## Rule: the model gets 65% of total RAM

| Total RAM | Model budget (65%) | Max file size (budget minus about 1.5 GB for KV cache and runtime) |
|---|---|---|
| 8 GB | 5.2 GB | about 3.7 GB |
| 12 GB | 7.8 GB | about 6.3 GB |
| 16 GB | 10.4 GB | about 8.9 GB |
| 24 GB | 15.6 GB | about 14.1 GB |
| 32 GB | 20.8 GB | about 19.3 GB |

The 1.5 GB reserve is an estimate for 16K context with a q8_0 KV cache. Measure it per
model with `/api/ps` (Ollama) or resident memory (llama.cpp) and correct it.

## Why MoE on CPU

On CPU, generation speed is limited by how many bytes of weights are read per token.
A MoE model only reads its active experts. Bytes per token is roughly
`active params x bits / 8`:

| Model | Active params | At about 2.5 bits | At about 4.5 bits |
|---|---|---|---|
| LFM2.5-8B-A1B | about 1B | 0.3 GB/token | 0.6 GB/token |
| LFM2.5-24B-A2B | about 2B | 0.6 GB/token | 1.1 GB/token |
| Qwen3.6-35B-A3B | about 3B | 0.9 GB/token | 1.7 GB/token |
| A dense 27B model | 27B | 8.4 GB/token | 15 GB/token |

Dual-channel DDR5 laptops give roughly 50-80 GB/s in practice (estimate), so a 27B dense
model reaches only a few tokens/sec, while 1-3B-active MoE models can reach 20-60 (estimate).
**Dense models over 9B are excluded for CPU-only machines.**

Caveat: 1-2 bit i-quants (IQ1, IQ2) need more compute to unpack on CPU, so the speedup from
smaller files is less than the table suggests. R5 covers the benchmarks.

## The list, by RAM tier

### 8 GB RAM (file up to about 3.7 GB)

| Model | Quant | File | Why | Source |
|---|---|---|---|---|
| LFM2.5-8B-A1B | UD-Q3_K_XL | 4.0 GB (tight) / UD-IQ3_XXS 3.3 GB | 1B active, built for on-device agents and tool chaining. The fastest real option on CPU | https://huggingface.co/unsloth/LFM2.5-8B-A1B-GGUF |
| Nemotron 3.5 Bolt E4B | UD-Q2_K_XL | 3.7 GB | Not MoE (4B effective) but strong tool use: BFCL-v3 68.5, Tau2 55.1 | https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF |
| Granite 4.0 H Tiny | Q4_K_M | 4.3 GB / UD-Q3_K_XL 3.2 GB | 7B MoE, Apache-2.0, IBM. No coding scores on card | https://huggingface.co/unsloth/granite-4.0-h-tiny-GGUF |

8 GB machines can run Ghost Code, but they won't build a full website reliably. Recommend BYOK.

### 12 GB RAM (file up to about 6.3 GB)

| Model | Quant | File | Why |
|---|---|---|---|
| Nemotron 3.5 Bolt E4B | UD-Q4_K_XL | 5.1 GB | Best tool-use scores in this size range |
| LFM2.5-8B-A1B | UD-Q4_K_XL | 5.4 GB | Fastest. Tool scores lower (BFCLv3 45.1) |

### 16 GB RAM (file up to about 8.9 GB), the main low-end target

| Model | Quant | File | Why | Source |
|---|---|---|---|---|
| **LFM2.5-24B-A2B** | UD-Q2_K_XL / UD-IQ3_XXS | 8.0 / 9.0 GB (IQ3 is tight) | 24B total, 2B active, "built for fast, private agents on-device". Card: 48.09 on LiveClaw vs 38.19 for Qwen3.6-35B-A3B | https://huggingface.co/unsloth/LFM2.5-24B-A2B-GGUF |
| Nemotron 3.5 Bolt E4B | UD-Q6_K_XL | 7.3 GB | Safer quality at higher bits | (above) |
| LFM2.5-8B-A1B | UD-Q6_K_XL | 7.7 GB | Fastest, near-lossless quant | (above) |

The 35B-A3B models do not fit a 16 GB machine inside the 65% budget. Their smallest
quant (UD-IQ1_M, 10.0 GB) is already over budget before the KV cache.

### 24 GB RAM (file up to about 14.1 GB)

| Model | Quant | File | Why | Source |
|---|---|---|---|---|
| **Qwen3.6-35B-A3B** | UD-IQ3_XXS | 13.2 GB | Base SWE-bench Verified 73.4, Terminal-Bench 2.0 51.5. Apache-2.0. Card highlights frontend and repo-level coding | https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF |
| Ornith 1.0 35B (MoE) | UD-IQ3_XXS | 13.7 GB | MIT, post-trained for agentic coding on Qwen 3.5 | https://huggingface.co/unsloth/Ornith-1.0-35B-GGUF |
| Gemma 4 26B A4B | UD-IQ4_XS | 13.6 GB | LiveCodeBench 77.1, Tau2 68.2. 4-bit, so less quality loss | https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF |
| Qwen3-Coder-30B-A3B | UD-IQ3_XXS | 12.8 GB | Older coding model, Aider Polyglot 60.9 at 4-bit | https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF |
| LFM2.5-24B-A2B | UD-Q4_K_XL | 14.9 GB (tight) | Faster, 2B active | (above) |

### 32 GB RAM (file up to about 19.3 GB)

| Model | Quant | File | Why |
|---|---|---|---|
| **Qwen3.6-35B-A3B** | UD-Q3_K_XL / UD-IQ4_XS | 16.8 / 17.7 GB | Best quality per GB in this tier |
| Ornith 1.0 35B | UD-IQ4_XS | 17.8 GB | MIT alternative |
| Gemma 4 26B A4B | UD-Q4_K_XL | 17.0 GB | Strongest tool use for its speed |
| Flint 40B (A2.5B) | UD-Q3_K_XL | 18.5 GB | Apache-2.0, built for coding agents. Vendor-only scores | 
| Qwen-AgentWorld-35B-A3B | UD-IQ4_XS | 17.8 GB | Apache-2.0, trained on MCP tool calling, terminal, SWE and web. No scores on the card |

Flint: https://huggingface.co/unsloth/flint-GGUF · AgentWorld: https://huggingface.co/unsloth/Qwen-AgentWorld-35B-A3B-GGUF

## Defaults for the recommender

| RAM | Best fit | Faster | Smarter (if user accepts tight memory) |
|---|---|---|---|
| 8 GB | Nemotron Bolt E4B UD-Q2_K_XL (3.7 GB) | LFM2.5-8B-A1B UD-IQ3_XXS (3.3 GB) | none, suggest BYOK |
| 12 GB | Nemotron Bolt E4B UD-Q4_K_XL (5.1 GB) | LFM2.5-8B-A1B UD-Q4_K_XL (5.4 GB) | LFM2.5-24B-A2B UD-IQ2_XXS (7.5 GB, over budget) |
| 16 GB | LFM2.5-24B-A2B UD-Q2_K_XL (8.0 GB) | LFM2.5-8B-A1B UD-Q6_K_XL (7.7 GB) | Qwen3.6-35B-A3B UD-IQ1_M (10.0 GB, over budget) |
| 24 GB | Qwen3.6-35B-A3B UD-IQ3_XXS (13.2 GB) | LFM2.5-24B-A2B UD-Q4_K_XL (14.9 GB) | Gemma 4 26B UD-IQ4_XS (13.6 GB) |
| 32 GB | Qwen3.6-35B-A3B UD-IQ4_XS (17.7 GB) | LFM2.5-24B-A2B UD-Q4_K_XL (14.9 GB) | Flint 40B UD-Q3_K_XL (18.5 GB) |

"Over budget" options appear only behind a warning that other apps may slow down.

## Ollama pull syntax for these

Ollama can pull Hugging Face GGUFs by repo and quant tag, for example
`ollama pull hf.co/unsloth/LFM2.5-24B-A2B-GGUF:UD-Q2_K_XL`. R5 verifies the exact syntax,
split-file support and progress streaming. Ollama library tags also exist for
`lfm2.5`, `granite4` and `qwen3-coder-next`, but the library mostly ships Q4 and Q8 quants,
so the 1-3 bit quants come from Hugging Face.

## Open questions (test on team laptops)

1. Tokens/sec of IQ2/IQ3 vs Q4 for each model on each team CPU.
2. Tool calling and code-editing quality at 2-bit. Run GhostBench-Web on the 16 GB defaults
   before trusting them.
3. Whether LFM2.5 models work with Ollama's chat template and tool calling via `hf.co` pulls.
4. Licenses: LFM2.5 uses the LFM Open License (card says "other"); check commercial terms.
   Gemma 4 license unverified.

## Left out

- Qwen3-Coder-Next (80B, 3B active): smallest quant is 18.9 GB (1-bit). Only for 32 GB+ and untested at 1-bit.
- Qwen3.8-27B and other dense 27-31B models: too slow on CPU at any bit width.
- Granite 4.0 H Small (32B, 9B active): too many active parameters for CPU speed.
- Uncensored or abliterated repos.
