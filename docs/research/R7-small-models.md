# R7: Small, fast models (<= 8B) for Ghost Code

Date: 2026-10-30. Sources: Hugging Face API (file trees, model cards) and ollama.com tag pages, fetched on this date.
File sizes are exact from `https://huggingface.co/api/models/<repo>/tree/main` (GB = 10^9 bytes).
Scores are copied from the model card at the cited URL and are the vendor's own numbers. UNVERIFIED means the claim was not confirmed from a card or tag page.

RAM budget: the model gets at most 65% of RAM, so 8 GB gives 5.2 GB and 16 GB gives 10.4 GB. That budget also has to hold the KV cache and runtime, so the weights should take up at most about 70% of it: roughly 3.6 GB on an 8 GB laptop and 7.3 GB on a 16 GB laptop.

Already-known models (LFM2.5-8B-A1B, Nemotron-3.5-Bolt-E4B, Gemma 4 E4B/E2B, Ornith 9B, Granite 4.0 H Tiny, LFM3-1.7B, Bonsai-2) were not re-researched. The comparison section refers to them.

## 1-3B band

| Model | GGUF repo | Ollama tag | Params | Q4_K_M | UD-Q4_K_XL | Q8_0 | Context | License | Card scores |
|---|---|---|---|---|---|---|---|---|---|
| LFM2.5-1.2B-Instruct (2026-01) | https://huggingface.co/unsloth/LFM2.5-1.2B-Instruct-GGUF | none found for 1.2B (library `lfm2.5` lists 8b and 24b) | 1.2B dense (hybrid conv/attention) | 0.73 GB | 0.73 GB | 1.25 GB | 32,768 | LFM Open License (HF tag "other") | BFCLv3 49.12, IFEval 86.23 (Qwen3-1.7B: 46.30 BFCLv3) |
| Qwen3.5-2B (2026-02) | https://huggingface.co/unsloth/Qwen3.5-2B-GGUF | `qwen3.5:2b` | 2B dense | 1.28 GB | 1.34 GB | 2.01 GB | 262,144 | Apache-2.0 | BFCL-V4 43.6, TAU2-Bench 48.8 |
| Granite 4.0 H 1B (2025-10) | https://huggingface.co/unsloth/granite-4.0-h-1b-GGUF | `granite4:1b-h` | ~1.5B hybrid Mamba-2 (exact count UNVERIFIED) | 0.90 GB | 0.91 GB | 1.56 GB | 128K (UNVERIFIED) | Apache-2.0 | BFCLv3 52.43 (from the LFM2.5-1.2B card's comparison table) |
| Qwen3.5-0.8B (2026-02) | https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF | `qwen3.5:0.8b` | 0.8B dense | 0.53 GB | 0.56 GB | 0.81 GB | 262,144 | Apache-2.0 | BFCL-V4 25.3, TAU2 11.6. Too weak for the agent model; usable only as a router or classifier |
| SmolLM3-3B (2025-07) | https://huggingface.co/unsloth/SmolLM3-3B-GGUF | none found | 3B dense | 1.92 GB | 1.94 GB | 3.28 GB | 64K, 128K with YaRN (UNVERIFIED) | Apache-2.0 | BFCL 92.3 (the card's own harness, not comparable to BFCL V4), LiveCodeBench v4 15.2 no-think / 30.0 think, HumanEval+ 30.48 |
| Llama 3.2 3B Instruct (2024, older) | https://huggingface.co/unsloth/Llama-3.2-3B-Instruct-GGUF | `llama3.2:3b` (UNVERIFIED) | 3.2B dense | 2.02 GB | 2.06 GB | 3.42 GB | 128K | Llama 3.2 Community | Superseded. Llama 3.2 1B scores BFCLv3 21.44 on the LFM2.5 card |

LFM2.5-1.2B writes Pythonic tool calls between `<|tool_call_start|>` and `<|tool_call_end|>` tokens by default. Ghost Code needs a parser for that format, or a system prompt asking for JSON, which the card says the model supports.

## 3-5B band

| Model | GGUF repo | Ollama tag | Params | Q4_K_M | UD-Q4_K_XL | Q8_0 | Context | License | Card scores |
|---|---|---|---|---|---|---|---|---|---|
| **Qwen3.5-4B** (2026-03) | https://huggingface.co/unsloth/Qwen3.5-4B-GGUF | `qwen3.5:4b` | 4B dense (with vision) | 2.74 GB | 2.91 GB | 4.48 GB | 262,144 native, extensible to ~1M | Apache-2.0 | LiveCodeBench v6 55.8, BFCL-V4 50.3, TAU2-Bench 79.9 |
| Qwen3.5-4B-MTP | https://huggingface.co/unsloth/Qwen3.5-4B-MTP-GGUF | 4B MTP tag UNVERIFIED (Ollama has `qwen3.5:0.8b-mtp-q8`) | 4B plus a multi-token-prediction head | not fetched | not fetched | not fetched | 262K | Apache-2.0 | Same model with a speculative-decoding head. Faster only if the runtime supports MTP (speedup UNVERIFIED) |
| Qwen3-4B-Instruct-2507 (2025-08) | https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF | `qwen3:4b` (mapping to 2507 UNVERIFIED) | 4B dense | 2.50 GB | 2.55 GB | 4.28 GB | 262,144 | Apache-2.0 | LiveCodeBench v6 35.1, BFCL-v3 61.9, TAU2-Retail 40.4. Non-thinking, so the first token arrives sooner than with Qwen3.5 |
| Granite 4.1 3B (2026-04) | https://huggingface.co/unsloth/granite-4.1-3b-GGUF | `granite4.1:3b` | 3B dense | 2.10 GB | 2.15 GB | 3.62 GB | 128K (UNVERIFIED) | Apache-2.0 | HumanEval 81.71, BFCL v3 60.80. Non-thinking |
| Granite 4.0 H Micro (2025-10) | https://huggingface.co/unsloth/granite-4.0-h-micro-GGUF | `granite4:3b-h` | 3B hybrid Mamba-2 | 1.94 GB | 1.96 GB | 3.40 GB | 128K (UNVERIFIED) | Apache-2.0 | HumanEval 81, BFCL v3 57.56. The hybrid design keeps the KV cache small at long context |
| Ministral 3 3B Instruct 2512 (2025-12) | https://huggingface.co/unsloth/Ministral-3-3B-Instruct-2512-GGUF | `ministral-3:3b` | 3B plus vision encoder | 2.15 GB | 2.19 GB | 3.65 GB | 256K | Apache-2.0 | Card has a LiveCodeBench table, but the 3B row was not extracted (UNVERIFIED). Native function calling (UNVERIFIED) |
| Phi-4-mini-instruct (2025-02) | https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF | `phi4-mini:3.8b` | 3.8B dense | 2.49 GB | not published | 4.08 GB | 128K | MIT | Card warns coding answers may start with "Sure, I can help with that" and break parsers. Weak fit for strict tool calls |

## 5-8B band

| Model | GGUF repo | Ollama tag | Params | Q4_K_M | UD-Q4_K_XL | Q8_0 | Context | License | Card scores |
|---|---|---|---|---|---|---|---|---|---|
| **Granite 4.1 8B** (2026-04) | https://huggingface.co/unsloth/granite-4.1-8b-GGUF | `granite4.1:8b` | 8B dense | 5.35 GB | 5.49 GB | 9.35 GB | 128K (UNVERIFIED) | Apache-2.0 | HumanEval 85.37, BFCL v3 68.27. Non-thinking |
| Ministral 3 8B Instruct 2512 (2025-12) | https://huggingface.co/unsloth/Ministral-3-8B-Instruct-2512-GGUF | `ministral-3:8b` | 8B plus vision encoder | 5.20 GB | 5.29 GB | 9.03 GB | 256K | Apache-2.0 | Scores not extracted (UNVERIFIED) |
| DeepSeek-R1-0528-Qwen3-8B (2025-05) | https://huggingface.co/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF | `deepseek-r1:8b` (UNVERIFIED) | 8B dense | 5.03 GB | 5.12 GB | 8.71 GB | 128K | MIT | The BFCL, Tau and SWE-bench rows on this card belong to the full R1-0528, not the 8B distill. Long reasoning traces make it slow on CPU, so it fits an agent loop poorly |
| Qwen2.5-Coder-7B-Instruct (2024, older) | https://huggingface.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF | `qwen2.5-coder:7b` (UNVERIFIED) | 7.6B dense | 4.68 GB | not published | 8.10 GB | 32K (a 128K variant repo exists) | Apache-2.0 | The only coding-specific small model found. Qwen3.5-4B is newer and smaller |

Qwen3.5-9B (https://huggingface.co/unsloth/Qwen3.5-9B-GGUF, `qwen3.5:9b`) is over the 8B limit. Its card lists LiveCodeBench v6 65.6, BFCL-V4 66.1 and TAU2 79.1, which is useful as a reference point next to Ornith 9B.

## Comparison with already-known models

- On CPU, decode speed is limited by memory bandwidth. Dense 8B models (Granite 4.1 8B, Ministral 3 8B) read about 5 GB of weights per token, so they run several times slower than LFM2.5-8B-A1B, which has about 1B active parameters at a similar file size. On 16 GB, if speed matters most, the known low-active-parameter MoE still beats every dense model in this report.
- Qwen3.5-4B has the best card scores under 5B (TAU2 79.9, LiveCodeBench v6 55.8) at 2.7-2.9 GB. It thinks by default, which costs tokens and latency on CPU. Ghost Code should disable thinking for routine tool steps through the chat-template flag.
- Granite 4.1 3B and 8B are non-thinking and Apache-2.0, with BFCL v3 scores of 60.8 and 68.3. They are the safest choices for predictable, low-latency tool-call formatting.
- LFM2.5-1.2B, at 0.73 GB, is the fastest usable tool-caller (BFCLv3 49.1). It can run alongside a larger model as the decision or router model.

## Recommended

| RAM (model budget) | Default | Faster pick |
|---|---|---|
| 8 GB (5.2 GB) | Qwen3.5-4B UD-Q4_K_XL, 2.91 GB (`qwen3.5:4b`), thinking off for tool steps | Granite 4.1 3B Q4_K_M, 2.10 GB (`granite4.1:3b`). Fastest: LFM2.5-1.2B Q4_K_M, 0.73 GB |
| 16 GB (10.4 GB) | Granite 4.1 8B Q4_K_M, 5.35 GB (`granite4.1:8b`), or Qwen3.5-4B Q8_0, 4.48 GB, if card scores matter more than non-thinking behaviour | Qwen3.5-4B UD-Q4_K_XL, 2.91 GB, or Granite 4.1 3B Q4_K_M, 2.10 GB |

No speeds were measured. Benchmark tokens/sec on target hardware before fixing the defaults.
