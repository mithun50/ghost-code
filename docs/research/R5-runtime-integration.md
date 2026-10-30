# R5: Runtime integration for CPU-only low-bit MoE models

Researched 2026-10-30. Scope: how to run low-bit Unsloth Dynamic GGUFs of ~3B-active / 20-40B-total MoE models from a Node.js app on CPU-only laptops with 8-16 GB RAM. Model choice and file sizes are covered elsewhere (R4, R6). File sizes appear here only where they decide whether a runtime works.

Anything marked **UNVERIFIED** was not confirmed against a primary source in this session. None of the fetched pages contained instructions aimed at AI agents.

## 0. The constraint that drives everything

A 65% RAM budget gives 5.2 GB on an 8 GB laptop and 10.4 GB on a 16 GB laptop. Every quant of `unsloth/Qwen3.6-35B-A3B-GGUF` is a single file. The low-bit ones are listed below, sizes from the HF tree API (https://huggingface.co/api/models/unsloth/Qwen3.6-35B-A3B-GGUF/tree/main):

| Quant | Size | Fits 5.2 GB (8 GB laptop) | Fits 10.4 GB (16 GB laptop) |
|---|---|---|---|
| UD-IQ1_M | 10.05 GB | no | weights only; ~0.35 GB left for KV and runtime |
| UD-IQ2_XXS | 10.76 GB | no | no, about 0.4 GB over |
| UD-IQ2_M | 11.52 GB | no | no, about 1.1 GB over |
| UD-Q2_K_XL | 12.29 GB | no | no, about 1.9 GB over |
| UD-IQ3_XXS | 13.21 GB | no | no, about 2.8 GB over |

That repo has no UD-IQ1_S file. The architecture is `qwen35moe` with a 262,144-token native context (same API response: https://huggingface.co/api/models/unsloth/Qwen3.6-35B-A3B-GGUF).

So on 16 GB machines, a 35B-A3B model at agent-usable quality (UD-Q2_K_XL, see section 5) exceeds the budget. It only runs if part of the file is paged from disk through mmap. The runtime therefore has to (a) allow mmap past free RAM without refusing to load and (b) give us control of KV cache type and context size. That requirement decides the recommendation.

## 1. Ollama with Hugging Face GGUFs

### Syntax and quant matching

Source: Hugging Face docs, "Use Ollama with any GGUF Model on Hugging Face Hub" (https://huggingface.co/docs/hub/en/ollama, raw: https://raw.githubusercontent.com/huggingface/hub-docs/main/docs/hub/ollama.md).

- `ollama run hf.co/{username}/{repository}` or `ollama pull ...`. `huggingface.co` also works as the domain.
- A quant is selected with a tag: `hf.co/{username}/{repository}:{quantization}`. The tag is case-insensitive (`:iq3_m` works). The full filename also works as a tag, for example `:Llama-3.2-3B-Instruct-IQ3_M.gguf`.
- With no tag, Ollama uses `Q4_K_M` if present, otherwise "one reasonable quant type present inside the repo".
- So `ollama pull hf.co/unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ2_XXS` matches the documented form. The docs do not say whether the `UD-` prefix is matched as part of the quant name or whether `:IQ2_XXS` alone resolves to the UD file. **UNVERIFIED**: the exact matching of `UD-` tags. Using the full filename (`:Qwen3.6-35B-A3B-UD-IQ2_XXS.gguf`) is the documented fallback that avoids the ambiguity.
- Chat template: picked automatically from a list of known templates, based on `tokenizer.chat_template` in the GGUF. A custom template has to be a **Go template, not Jinja**, placed as a `template` file in the HF repo. You can't add that file to someone else's repo.
- Private repos authenticate with the Ollama SSH key (`~/.ollama/id_ed25519.pub`) added to the HF account.

### Split (multi-part) GGUFs

Not supported for `hf.co` pulls as of Ollama v0.40.13 (released 2026-10-28, https://github.com/ollama/ollama/releases). The HF registry returns: `400: This repository only contains sharded GGUF files. Ollama does not yet support pulling sharded GGUF via the registry; please download the shards and merge them locally with ollama create`. The fix, PR #17743 "server: pull sharded GGUF models from Hugging Face", is still open (https://github.com/ollama/ollama/pull/17743). Split files can be imported locally with `FROM /path/to/model-*.gguf` in a Modelfile (https://docs.ollama.com/import). This doesn't block us, because all low-bit Qwen3.6-35B-A3B quants are single files.

### Pull progress

`POST /api/pull` streams NDJSON by default. It sends `{"status":"pulling manifest"}`, then `{"status":"pulling <digest>","digest":...,"total":N,"completed":M}`, then `verifying sha256 digest`, `writing manifest`, `success`. "Cancelled pulls are resumed from where they left off, and multiple calls will share the same download progress" (https://github.com/ollama/ollama/blob/main/docs/api.md#pull-a-model). For hf.co pulls, the CLI shows the same per-digest progress bar (output quoted in https://github.com/ollama/ollama/issues/15447). **UNVERIFIED**: that `/api/pull` emits `total`/`completed` for hf.co pulls exactly as it does for library models. It is very likely, because the CLI is built on that endpoint.

### Known failures relevant to us

| Problem | Status | Source |
|---|---|---|
| hf.co `qwen35`/`qwen35moe` models get no Qwen3.5 renderer/parser and fall back to the GGUF's own template ("native" mode). Sending `tools` plus a JSON-schema `format` gives malformed GBNF: "failed to parse grammar". | PR open | https://github.com/ollama/ollama/pull/17965 |
| hf.co `qwen3moe` (e.g. Qwen3-Coder-30B-A3B) gets a generic template, and "tool-calling becomes unreliable". | PR open | https://github.com/ollama/ollama/pull/17769 |
| `qwen35`/`qwen35moe` parallel requests are disabled. | PR open | https://github.com/ollama/ollama/pull/17144 |
| hf.co pull downloads fully, then fails with `Error: 400:` (empty body); the workaround is a manual Modelfile. | open | https://github.com/ollama/ollama/issues/15447 |
| `unknown model architecture` for new architectures (e.g. `lfm3` on v0.40.12) | closed 2026-10-27 | https://github.com/ollama/ollama/issues/19347 |
| Qwen3.5 hf.co GGUFs gave "500 unable to load model" on v0.17.5 | closed | https://github.com/ollama/ollama/issues/14575 |
| Memory pre-check refuses to load: "model requires more system memory (17.7 GiB) than is available (13.6 GiB)", even with `useMmap: true` | open since 2024-12 | https://github.com/ollama/ollama/issues/7942, PR https://github.com/ollama/ollama/pull/8895 (open) |
| No env var for `use_mmap` | open | https://github.com/ollama/ollama/issues/4895 |

The last two rows matter most for us. If Ollama still pre-checks memory this way (the issue is open; **UNVERIFIED** whether v0.40.x still behaves like this), a 12.29 GB UD-Q2_K_XL would be refused on a 16 GB laptop with ~11-13 GB free.

KV cache type is global (`OLLAMA_KV_CACHE_TYPE`), not per model. Per-model control is an open request (https://github.com/ollama/ollama/issues/16245, PR https://github.com/ollama/ollama/pull/16723).

## 2. ollama-js (official `ollama` npm package)

- Version **0.6.4**, license **MIT**, one dependency (`whatwg-fetch`) (https://registry.npmjs.org/ollama/latest).
- API (https://github.com/ollama/ollama-js/blob/main/README.md): `chat`, `generate`, `pull`, `push`, `create`, `delete`, `copy`, `list`, `show`, `embed`, `ps`, `version`, `webSearch`, `webFetch`, `abort`, and `systemone` (a structured-decision endpoint, `POST /v1/systemone`).
- `stream: true` returns an `AsyncGenerator`. `pull({model, stream:true})` yields `ProgressResponse` objects, which map to the NDJSON above.
- `chat` takes `tools`, `think` (`boolean | "high" | "medium" | "low"`), `format` (`json` or schema), `keep_alive`, `logprobs`, `options`. Tool results go back as messages with `tool_name`.
- `abort()` aborts **all** streams on that client instance. Pending `for await` loops throw `AbortError`. The README recommends one client per stream for per-request cancel.
- Browser: `import ollama from 'ollama/browser'`. The browser build follows the server's CORS rules. Node: `import ollama from 'ollama'`. Custom client: `new Ollama({ host, fetch, headers })`. The default host is `http://127.0.0.1:11434`.

**Embedding or bundling Ollama:** I found no official library or embedding API. What does exist: Ollama is MIT (https://github.com/ollama/ollama/blob/main/LICENSE), and each release ships standalone archives (`ollama-windows-amd64.zip`, `ollama-linux-amd64.tar.zst`, `ollama-darwin.tgz`, plus installers) (https://github.com/ollama/ollama/releases/tag/v0.40.13). An app could ship that binary, run `ollama serve` as a child process with `OLLAMA_HOST` set to a private port and `OLLAMA_MODELS` set to its own directory (both documented in https://docs.ollama.com/faq), and connect with ollama-js. **UNVERIFIED** that no official embedding mode exists. I found none.

## 3. llama.cpp from Node without Ollama

### Current llama.cpp

llama.cpp now has semantic releases (`v0.7.0` on 2026-10-15, `v0.8.0` on 2026-10-28) alongside the build tags (`b12001` on 2026-10-30) (https://github.com/ggml-org/llama.cpp/releases). Prebuilt assets for b12001 include `llama-b12001-bin-win-cpu-x64.zip`, `-win-cpu-arm64.zip`, `-win-vulkan-x64.zip`, `-win-cuda-12.4/13.4-x64.zip`, `-ubuntu-x64.tar.gz`, `-ubuntu-arm64`, `-ubuntu-vulkan-x64`, `-macos-arm64`, `-macos-x64` (https://github.com/ggml-org/llama.cpp/releases/tag/b12001). License MIT.

### node-llama-cpp (withcatai)

| Item | Value | Source |
|---|---|---|
| Version | 3.22.2 (2026-10-17) | https://registry.npmjs.org/node-llama-cpp/latest, https://github.com/withcatai/node-llama-cpp/releases/tag/v3.22.2 |
| License | MIT; Node >= 20 | same |
| Bundled llama.cpp | `v0.7.0` (13 days behind `v0.8.0`). Newer versions need `npx -n node-llama-cpp source download --release latest`, which compiles with cmake. | release notes, v3.22.2 |
| Prebuilt binaries | optional deps: `mac-x64`, `mac-arm64-metal`, `win-x64`, `win-x64-cuda`, `win-x64-cuda-ext`, `win-x64-vulkan`, `win-arm64`, `linux-x64`, `linux-x64-cuda`, `linux-x64-cuda-ext`, `linux-x64-vulkan`, `linux-arm64`, `linux-armv7l`, `linux-riscv64`. If none match, it falls back to a cmake build (no node-gyp or Python). | package.json optionalDependencies; https://github.com/withcatai/node-llama-cpp |
| HF download | `hf:<user>/<model>:<quant>` and `hf:<user>/<model>/<file-path>#<branch>`, via `resolveModelFile()` or `createModelDownloader()`. Multi-part and binary-split files are handled. HF token is supported. | https://node-llama-cpp.withcat.ai/guide/downloading-models |
| Function calling | `defineChatSessionFunction` with `LlamaChatSession`. The prompt format comes from the library's own chat wrappers (custom wrappers are possible); it depends on `@huggingface/jinja` for GGUF templates. | https://node-llama-cpp.withcat.ai/guide/function-calling |
| Grammar / JSON schema | `llama.createGrammarForJsonSchema()` (a subset of JSON Schema), usable together with function calling | https://node-llama-cpp.withcat.ai/guide/grammar |
| Speculative decoding | its own `DraftSequenceTokenPredictor` (PR #405, merged 2025). Native llama.cpp MTP is **not** bound yet (issue #642 open). | https://github.com/withcatai/node-llama-cpp/issues/642 |
| Memory options | `useMmap` ("auto"/bool), `useMlock`, `useDirectIo`, `gpuLayers`; context `flashAttention`, `experimentalKvCacheKeyType`/`ValueType`, `swaFullCache` | `src/evaluator/LlamaModel/LlamaModel.ts`, `src/evaluator/LlamaContext/types.ts` on master |
| MoE expert offload | no `n-cpu-moe` equivalent found in the model options. This doesn't matter for CPU-only, where everything already sits in RAM. | same files; issue search returned nothing |

**UNVERIFIED**: that node-llama-cpp's chat wrapper detection handles the Qwen3.6 (`qwen35moe`) template and its tool-call format correctly. Test this before relying on it.

### Spawned `llama-server`

Flags from https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md:

| Flag | Meaning |
|---|---|
| `-hf, --hf-repo <user>/<model>[:quant]` | Download from HF. Quant is optional and case-insensitive; default Q4_K_M, else the first file. mmproj is fetched automatically unless `--no-mmproj`. `-hff` picks an exact file. Cache directory is `LLAMA_CACHE` (Unsloth docs). |
| `--jinja` / `--no-jinja` | Jinja chat templates from GGUF metadata, **enabled by default**. Needed for OpenAI-style `tools`. `--chat-template-file` overrides the template. |
| `--reasoning-format none\|deepseek\|...` | Puts thinking into `message.reasoning_content` (deepseek). |
| `--chat-template-kwargs '{"enable_thinking":false}'` | Turns off Qwen3.6 thinking (Unsloth Qwen3.6 guide) |
| `--cache-reuse N` | Minimum chunk size to reuse from the prompt cache via KV shifting. Default 0 (off). |
| `-ctk/-ctv` | KV types: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1. Default f16. |
| `-fa on\|off\|auto` | Flash attention, default auto |
| `-cmoe`, `-ncmoe N`, `--moe-cache-mib N` | Keep MoE experts on CPU / GPU cache for them. GPU-only relevance. |
| `-lm, --load-mode auto\|none\|mmap\|mlock\|mmap+mlock` | Replaces the older `--no-mmap`/`--mlock`. Default auto = mmap. |
| `--spec-draft-*` | Draft-model and MTP speculative decoding. Unsloth recommends `--spec-draft-n-max 2` for Qwen3.6 MTP. Unsloth removed MTP from quants at UD-Q2_K_XL and below (https://unsloth.ai/docs/basics/dynamic-3.0-ggufs), so it doesn't apply at our sizes unless the separate Q4_0 MTP module is added. |

The server exposes an OpenAI-compatible `/v1/chat/completions` (same README). Ghost Code can use any OpenAI-style client.

Caveat for `--cache-reuse` with Qwen3.6: it is a hybrid model with recurrent (delta-net) layers. In ik_llama.cpp, Qwen3.6 context checkpoints were "never restored — full prompt re-processing on every turn" (https://github.com/ikawrakow/ik_llama.cpp/issues/1762). **UNVERIFIED** whether mainline has the same prefix-reuse limit for recurrent state. It matters a lot for an agent loop that resends a long, growing prompt on each turn. Measure it.

## 4. CPU speed of very low-bit quants

CPU decode is mostly memory-bandwidth bound. Bytes read per token ≈ active params × bits-per-weight / 8. For a 3B-active model at ~2.7 bpw that is ~1 GB per token, so dual-channel laptop RAM (~40-80 GB/s) puts a ceiling of roughly 40-80 tokens/s. Real numbers come in well below that. This is an estimate from first principles, **UNVERIFIED** as a measurement. Lower bpw cuts bytes per token, but i-quants (IQ1/IQ2/IQ3) decode through codebook lookups, which costs more compute per weight than k-quants.

Measured numbers found (ik_llama.cpp PR #212, 2025-02, DeepSeek-Lite 16B MoE with ~2.4B active, IQ1_S, https://github.com/ikawrakow/ik_llama.cpp/pull/212):

| CPU | Test | mainline llama.cpp t/s | ik_llama.cpp t/s | Speedup |
|---|---|---|---|---|
| Ryzen 5975WX (AVX2), 32 thr | pp512 | 209.5 | 485.0 | 2.32x |
| Ryzen 5975WX (AVX2), 4 thr | tg128 | 21.3 | 26.3 | 1.24x |
| Ryzen 5975WX (AVX2), 8 thr | tg128 | 30.9 | 36.2 | 1.17x |
| Ryzen 7950X (Zen4/AVX-512), 16 thr | pp512 | 142.3 | 496.3 | 3.49x |
| Ryzen 7950X, 4 thr | tg128 | 24.3 | 31.3 | 1.29x |
| Ryzen 7950X, 8 thr | tg128 | 35.6 | 42.5 | 1.19x |

These are workstation CPUs from early 2025, and mainline has changed since. They show the pattern: ik_llama.cpp's gain on i-quants is large for prefill (2.3-3.5x) and small for decode (1.05-1.35x).

Other data points:
- ik_llama.cpp is "a llama.cpp fork with better CPU performance". It requires AVX2 or better. AVX-512 builds need extra flags or they "silently" fall back to AVX2 (https://github.com/ikawrakow/ik_llama.cpp/blob/main/README.md). It lists "much faster CPU prompt processing for all non-interleaved quants" and fused MoE ops.
- ik_llama.cpp trellis quants (IQ*_KT) were slow on CPU at first: 4.83 t/s IQ2_KT vs 4.59 t/s F16 on Llama-3.1-8B, EPYC 7R32 (https://github.com/ikawrakow/ik_llama.cpp/pull/441). Avoid KT quants on CPU.
- Mainline x86 int8 dot-product fixes explicitly exclude `iq2_*`, `iq3_*` (https://github.com/ggml-org/llama.cpp/pull/29359). A VNNI Q2_0 kernel claims 3x on VNNI CPUs (https://github.com/ggml-org/llama.cpp/pull/26348, open). CPU kernel work is uneven across quant types.
- **ik_llama.cpp distribution:** the only GitHub release is `t0002` from 2025-07-22 (https://github.com/ikawrakow/ik_llama.cpp/releases). Otherwise it ships as CPU Docker images (`ghcr.io/ikawrakow/ik-llama-cpp:cpu-server`) and source builds (README). I found no Node binding. Its server is a llama-server fork, so it should speak the same HTTP API (**UNVERIFIED** for full OpenAI tool-call compatibility). License MIT.

**Not found:** a recent, like-for-like CPU benchmark of UD-IQ2_XXS vs UD-Q2_K_XL vs Q4_K_M on a ~30B-A3B MoE on a laptop. **UNVERIFIED**: the common claim that IQ2_XXS decodes slower than Q2_K_XL on CPU despite being smaller. Ghost Code should run `llama-bench -p 512 -n 128` on its own test laptops for each quant. That takes minutes and settles the question.

## 5. Quality at 1-2 bits

From Unsloth "Dynamic 3.0 GGUFs" (https://unsloth.ai/docs/basics/dynamic-3.0-ggufs; the older "Dynamic 2.0" URL redirects there):

- "**1-bit should not be used for agentic use-cases.**" Divergence-300@32, which measures agreement with BF16 over 32-token trajectories, drops "from around 25% [UD-Q2_K_XL] to under 8-10% [UD-IQ2_S] ... This sharp drop off means tool calling and non thinking modes break down."
- For 1-bit: "Do not use the model for tool calling — only general knowledge is retained ... the model will either fail to call tools, keep calling tools or not even call them." Always enable at least low reasoning; "non reasoning modes cause the model to not even output".
- UD-IQ1_S keeps "around 72% top-1 accuracy". Unsloth calls top-1 a poor proxy for real inference.
- UD-Q2_K_XL is "+8% more accurate on top-1 than the next best" and "created a working HTML program with 1 small JS bug" (example model: Qwen3.8-27B).
- Aider Polyglot: 3-bit DeepSeek V3.1 (671B) scores 75.6%. That is a much larger model and doesn't carry over to 30B MoEs.
- Unsloth argues KL divergence beats perplexity for measuring quant error, citing "Accuracy is Not All You Need" (https://arxiv.org/pdf/2407.09141).

From the Qwen3.6 guide (https://unsloth.ai/docs/models/qwen3.6): "the 2-bit Qwen3.6 GGUF made 30+ tool calls, searched 20 sites and executed Python code". That run was in Unsloth Studio, which has "self-healing tool calling", so it is not a raw-runtime result. Unsloth also says it fixed tool-calling chat-template issues in its Qwen3.5/3.6 uploads (nested-object parsing, `developer` role).

Conclusion for Ghost Code:

| Quant tier | Agent / tool use | Source basis |
|---|---|---|
| UD-Q2_K_XL | Lowest tier Unsloth endorses for agent work. Works with retries and validation. | Unsloth 3.0 doc |
| UD-IQ2_M | Between Q2_K_XL and IQ2_S; not measured separately. **UNVERIFIED** | — |
| UD-IQ2_S / UD-IQ2_XXS | Past the measured cliff; expect unreliable tool calls | Unsloth 3.0 doc |
| UD-IQ1_S / UD-IQ1_M | Chat and short fact questions only; no tool calling | Unsloth 3.0 doc |

For Qwen3.6-35B-A3B, UD-IQ2_M (11.52 GB) is only 0.77 GB smaller than UD-Q2_K_XL (12.29 GB). Paying the quality cliff to save that little is a poor trade.

## 6. mmap and memory

- llama-server defaults to mmap (`--load-mode auto` = "mmap, unless a device does not support it"). `none` gives a "slower load but may reduce pageouts if not using mlock". `mlock` pins pages (server README). node-llama-cpp exposes `useMmap`/`useMlock`/`useDirectIo`.
- With mmap, the weights are file-backed pages. The OS can drop them under pressure and re-read them from disk, so a model larger than free RAM still loads and runs. Unsloth: "If it doesn't [fit], you can still run via SSD/HDD offloading, but inference will be slower" (Qwen3.6 guide).
- How much slower: the only measured numbers found are for GPU-offload setups. In https://github.com/ggml-org/llama.cpp/issues/29130 (106.6 GB MoE, 32 GB RAM, PCIe 4.0 NVMe, page cache dropped), prefill over mmap ran 4.6-35 t/s and read ~1.1 GB/s from disk, against 16-140 t/s with an O_DIRECT patch. Decode after long prompts was 11.7 vs 14.4 t/s. The issue also notes "long prompts flush the page cache, which makes token generation slower afterwards". Open PR #25294 adds MoE expert streaming from SSD for over-RAM models (https://github.com/ggml-org/llama.cpp/pull/25294).
- **UNVERIFIED estimate for our case** (CPU-only, 12.29 GB file, ~2 GB not resident): MoE routing touches different experts each token, so a share of each token's ~1 GB of expert reads will miss RAM. Expect decode to drop sharply as the over-budget amount grows. Prefill on long agent prompts gets hit hardest. Measure on a 16 GB laptop with an NVMe drive before promising it.
- Ollama: see the memory pre-check issue in section 1. It may refuse before mmap gets a chance.
- **Measuring real resident memory** (standard OS behaviour, not checked against a fetched source this session): on Linux, read `/proc/<pid>/smaps_rollup` and compare `Rss` with `Anonymous`. `Rss` includes resident model pages, while `Anonymous` is KV cache, compute buffers and heap. On Windows, `Get-Process` `WorkingSet64` includes resident mapped file pages, and `PrivateMemorySize64` is closer to the non-model share. On macOS use `footprint <pid>` or `vmmap --summary`. Also log llama-server's startup buffer-size lines (model buffer, KV buffer, compute buffer) for the planned split.
- **KV cache quantization:** `q8_0` takes ~1/2 the memory of f16 with "very small loss", and `q4_0` takes ~1/4 with "small-medium loss ... more noticeable at higher context sizes". Ollama requires flash attention for this (https://docs.ollama.com/faq). llama-server takes `-ctk q8_0 -ctv q8_0`. Cost: open PR #27140 reports prefill at ~9,000 tokens of 74 t/s with q4_0 vs 1,159 t/s with q8_0 before its fix (https://github.com/ggml-org/llama.cpp/pull/27140). That was measured on GPU, and the fix is not merged. **UNVERIFIED** on CPU, but treat q8_0 as the safe default and q4_0 as a last resort. Unsloth suggests `--cache-type-k bf16 --cache-type-v bf16` if Qwen3.6 outputs gibberish, which is the opposite direction (Qwen3.6 guide).

## Recommendation

**Primary path: spawn a prebuilt `llama-server` from ggml-org GitHub releases and talk to its OpenAI-compatible API.**

Reasons:
1. **Freshest model support.** llama.cpp publishes several builds a day (b12001 on 2026-10-30). node-llama-cpp ships `v0.7.0`, and Ollama's hf.co handling of `qwen35moe` tool templates still has open fix PRs (#17965, #17769). New MoE architectures land in llama.cpp first.
2. **Tool calling uses the GGUF's own Jinja template** (`--jinja`, on by default), including Unsloth's template fixes. Ollama's hf.co path needs Go templates or built-in renderers, which it currently doesn't assign for Qwen3.5/3.6 MoE.
3. **Memory control we need on 16 GB laptops:** mmap past free RAM with no pre-check refusal, plus `-c`, `-ctk/-ctv q8_0`, `--load-mode` and `-t` set per model. Ollama exposes KV type only globally, and its memory check may refuse over-RAM models.
4. **One HTTP protocol** (OpenAI chat completions with `tools`, streaming and `reasoning_content`). It fits a DeepSeek-style harness and also works with ik_llama.cpp's server as an optional faster-prefill backend.
5. **Crash isolation.** A native crash or out-of-memory kill takes down only the child process, not the Ghost Code Node server. An in-process addon (node-llama-cpp) would take down the web UI.

Implementation notes:
- Download the GGUF in Node with our own progress UI. Use HF `resolve/main/<file>` URLs with Range-based resume, then pass `-m <path>`. `-hf` works, but its progress only goes to stderr.
- Pin a tested llama.cpp build per Ghost Code release. Fetch the matching `win-cpu-x64` / `ubuntu-x64` / `macos-arm64` asset and verify its checksum. Bind to `127.0.0.1` on a random port, and set `--api-key`.
- Defaults: UD-Q2_K_XL as the agent floor, `-ctk q8_0 -ctv q8_0`, a modest `-c` (e.g. 16-32K), and `--reasoning-format deepseek`. Benchmark `--cache-reuse` against Qwen3.6's recurrent layers before relying on it.
- Gate 1-bit quants to a "chat only" mode with tools disabled, per Unsloth's guidance.
- Tell 8 GB users plainly that no 35B-A3B quant fits a 5.2 GB budget. Those machines need a smaller model (see R6).

**Fallback: Ollama through ollama-js.** Use it when the user already runs Ollama or llama-server can't start (blocked binary, unsupported CPU). It gives a clean model-management API (`pull` with streamed progress, `list`, `ps`, `delete`) and a mature installer. Known gaps today: unreliable tool calling for hf.co Qwen MoE models, no sharded hf.co pulls, a global-only KV cache type, and a possible memory pre-check refusal for models larger than free RAM.

**Not chosen as primary: node-llama-cpp.** It has a good TypeScript API, `hf:` downloads, JSON-schema grammars and prebuilt CPU/CUDA/Vulkan/Metal binaries, and the MIT license is fine. But it lags llama.cpp by one or more releases, it doesn't bind native MTP, its Qwen3.6 tool-call format is unverified, and it runs in-process. It is worth keeping as an option if Ghost Code later needs grammar-constrained decoding inside the agent loop.
