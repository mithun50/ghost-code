# R9: Prompt caching, prompt slimming, streaming UX, speculative decoding

Date: 2026-10-30. Builds on R5-runtime-integration.md (R1-local-inference.md was not found in docs/research). Problem: system prompt plus tool definitions is about 7.4K tokens per request, and on CPU, prefill of that prompt dominates time to first token (TTFT).

TTFT arithmetic used below (an estimate, not measured): CPU prefill for a 4-8B Q4 model on a laptop is assumed to run at 20-100 tokens/s. That makes an uncached 7.4K prefix cost about 75-370 s. A cached prefix costs only the new suffix (typically 50-2,000 tokens per agent turn). **UNVERIFIED**: measure prefill t/s on target hardware first.

## 1. Local prompt/KV caching

### Ollama

- **Context size is a correctness bug before it is a speed issue.** The default context window is 4096 tokens, overridable with `OLLAMA_CONTEXT_LENGTH` or the `num_ctx` option (https://docs.ollama.com/faq). A 7.4K prompt does not fit in 4096. Always send `options.num_ctx` (e.g. 16384) on every request.
- **Keep `num_ctx` and other load options identical across calls.** **UNVERIFIED** (not in the fetched docs): changing `num_ctx` reloads the model runner, which discards the KV cache. Pick one value per model and never vary it.
- **Prefix reuse across /api/chat calls.** The final response reports `prompt_eval_count` (tokens in the prompt), `prompt_eval_cached_count` ("number of prompt tokens read from the cache") and `prompt_eval_duration` ("time spent ... evaluating uncached prompt tokens") (https://github.com/ollama/ollama/blob/main/docs/api.md). So Ollama does reuse a cached prefix. To get hits: same model, same options, model kept loaded (`keep_alive`, or `-1` to keep it loaded indefinitely, which overrides `OLLAMA_KEEP_ALIVE`, https://docs.ollama.com/faq), and append-only message history (do not rewrite, reorder or trim earlier messages, do not inject timestamps into the system prompt).
- **Expected gain:** turn 1 pays the full 7.4K prefill. Later turns pay only the new suffix, so TTFT drops from minutes to seconds (estimate, see arithmetic above).
- **Verify:** on turn 2+, `prompt_eval_cached_count` should be at least about 7,400 and `prompt_eval_count - prompt_eval_cached_count` should equal the new suffix. `prompt_eval_duration / (prompt_eval_count - prompt_eval_cached_count)` gives true prefill speed. A large `load_duration` means the model was reloaded and the cache was lost.
- **`OLLAMA_KV_CACHE_TYPE`**: default `f16` (https://docs.ollama.com/faq). `q8_0` halves KV memory with very small loss. `q4_0` quarters it with more loss, and Ollama needs flash attention for either (see R5 section on KV quantization). Effect on TTFT: memory only, not prefill speed. It lets a 16K-32K `num_ctx` fit in 8-16 GB. A quantized KV may slow prefill (GPU report in R5, PR #27140); **UNVERIFIED** on CPU.
- **Flash attention:** Ollama turns it on automatically when the backend supports it. `OLLAMA_FLASH_ATTENTION=1` forces it on (https://docs.ollama.com/faq). Leave it on auto or 1.
- **`OLLAMA_NUM_PARALLEL`**: default 1. "Required RAM will scale by OLLAMA_NUM_PARALLEL * OLLAMA_CONTEXT_LENGTH" (https://docs.ollama.com/faq). Keep it at 1. With more slots, a request can land on a slot without our prefix (**UNVERIFIED** slot-assignment behaviour) and RAM multiplies.
- KV type is global in Ollama, not per model (R5).

### llama-server

All facts from https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md unless noted.

- **`cache_prompt`** (request field, default `true`; `--cache-prompt` server flag, default enabled): "the prompt is compared to the previous completion and only the 'unseen' suffix is evaluated". The README warns that logits are not guaranteed bit-identical between batch sizes, so results can be nondeterministic. Accept that.
- **`--cache-reuse N`** (request `n_cache_reuse`, default 0 = off): minimum chunk size to reuse from the cache "via KV shifting". It helps when the middle of the prompt changes (e.g. context pruning) and later chunks can be shifted and reused. It does not help a pure append-only prefix, which `cache_prompt` already covers. Suggested value: 256. R5 caveat: hybrid/recurrent models such as Qwen3.6 may not support shifting or partial restore. Benchmark before relying on it.
- **`--slot-save-path PATH` plus `/slots` API**: `POST /slots/{id}?action=save` with `{"filename": ...}` writes the slot's prompt cache to that directory. It returns `n_saved` and `timings.save_ms`. `POST /slots/{id}?action=restore` returns `n_restored` and `timings.restore_ms`. The README example shows 1,745 tokens saved as 14.3 MB in 50 ms and restored in 43 ms. **Plan:** at first run, send one request containing just the system prompt plus tools (`n_predict: 0` or 1), save it to `ghost-<modelhash>-<prompthash>.bin`, and restore it at every server start. That removes the turn-1 prefill, which saves the full 75-370 s estimate on a cold start. File size scales with tokens times KV size per token. For 7.4K tokens, expect tens to a few hundred MB depending on model and `-ctk` (estimate from the README ratio, **UNVERIFIED** per model). Invalidate the file whenever the model, quant, `-ctk/-ctv`, chat template, or prompt bytes change.
- **`-ctk/-ctv`**: f16 default, q8_0 recommended (R5). Smaller KV also makes slot files smaller.
- **`-fa on|off|auto`**: default auto.
- **`-np` (parallel slots)**: keep at 1 for a single-user agent so the warmed slot is always the one used. Pin requests with `id_slot: 0` (default -1 = any idle slot) so they hit the restored slot.
- **Verify:** each completion returns `timings.cache_n` ("number of prompt tokens reused from cache") and `timings.prompt_n` ("number of prompt tokens being processed"), and context = `prompt_n + cache_n + predicted_n`. On a hit, `cache_n` should be at least about 7,400 and `prompt_n` should equal the new suffix. `timings.prompt_ms` and `timings.prompt_per_second` give prefill time and speed for the uncached part.

## 2. Prompt slimming for small models

Caching removes repeated prefill but not the first one, and it does nothing when the cache misses (model reload, new session without a slot file, Ollama). Slimming reduces every prefill. Options:

- **"Lite" tool set for local models**: keep about 5-6 core tools (read_file, write/edit_file, list/glob, grep, run_command, finish). Drop rarely used tools (web fetch, sub-agents, notebook, todo) or load them on demand. Shorten each tool `description` to one sentence and remove examples from the JSON schemas.
- **Short system prompt mode**: keep rules the model actually violates and drop style guidance. A target of 1.5-2.5K tokens total (prompt plus tools) cuts cold prefill by roughly 3-5x against 7.4K (linear estimate; attention cost grows faster than linear, so the real gain is slightly larger).
- **Tradeoffs**: fewer tools means more multi-step workarounds (e.g. using run_command for search). Shorter instructions can raise format errors in tool calls for small models. Every prompt variant needs its own cache entry and slot file. Measure with a fixed task suite (success rate, turns per task, TTFT) before making lite the default. **UNVERIFIED**: no fetched source quantifies the quality loss. It is model-specific.
- Keep the lite prompt byte-stable too. Slimming and caching combine.

## 3. Cloud prompt caching (BYOK)

General rule for every provider: caches match an exact **prefix**. Keep these bytes identical across requests in a session: tool list (same order, same JSON key order, same descriptions), system prompt (no timestamps, cwd lists, or random IDs; put volatile context in a later message), and earlier messages (append-only). Serialize tools deterministically (sorted once at startup, `JSON.stringify` with a fixed key order).

| Provider | How | Minimum / TTL / price | Hit fields | Source |
|---|---|---|---|---|
| Anthropic | Explicit `cache_control: {type: "ephemeral"}` on blocks, up to 4 breakpoints. Cache order is `tools` -> `system` -> `messages`. Breakpoint lookback is 20 blocks, so put one on the last message block each turn. Changing `tool_choice`, images, or thinking config invalidates message-level cache. | Minimum 512 tokens for Opus 5.5, Opus 5, Sonnet 5.5, Haiku 5.5 and similar; 1,024 for Sonnet 4.5/4.6/5 and Opus 4.8; 4,096 for Opus 4.5/4.6 and Haiku 4.5. Shorter prompts silently don't cache. TTL 5 min default, or `"ttl": "1h"`. Writes cost 1.25x base input (5m) or 2x (1h); reads cost 0.1x. | `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens` | https://docs.claude.com/en/docs/build-with-claude/prompt-caching |
| OpenAI | Automatic prefix caching. Set `prompt_cache_key` (e.g. session ID) so related requests route to the same cache. `prompt_cache_retention` supports `in_memory` or `24h` on some models; the default depends on the org's data retention policy. The page now also describes explicit breakpoints with 30-minute and 12-hour coverage (new; read the page before implementing). | Minimum 1,024 tokens (GPT-5). | `usage.prompt_tokens_details.cached_tokens` (Chat Completions; field name `cached_tokens` confirmed, parent path **UNVERIFIED** this session) | https://platform.openai.com/docs/guides/prompt-caching |
| DeepSeek | Automatic disk KV cache, on by default, "best-effort" with no 100% hit guarantee. Cleared when unused, "usually within a few hours to a few days". | No client setting. Hit pricing per DeepSeek pricing page (**UNVERIFIED** this session). | `usage.prompt_cache_hit_tokens`, `usage.prompt_cache_miss_tokens` | https://api-docs.deepseek.com/guides/kv_cache |
| Gemini | Implicit caching is on by default for Gemini 2.x+ models; advice is to put large common content at the start. Explicit caching creates a `cachedContent` resource with a TTL. | Per-model minimum token counts listed in a table on the page (values not extracted, **UNVERIFIED**). | `usage_metadata.cached_content_token_count` (**UNVERIFIED** this session) | https://ai.google.dev/gemini-api/docs/caching |
| OpenRouter | Passes through provider caching. Accepts Anthropic-style `cache_control` block markers (also mapped to OpenAI breakpoints) and top-level automatic `cache_control` for Anthropic, Vertex, Azure, Bedrock. Send `session_id` (body) or `x-session-id` header for sticky provider routing, otherwise a request can land on a different provider and miss. | Provider rules apply. | `usage.prompt_tokens_details.cached_tokens`, `cache_write_tokens` | https://openrouter.ai/docs/features/prompt-caching |

GhostCode implementation: one `CacheStrategy` per provider. Anthropic: breakpoint on the last tool, on the system block, and on the last message. OpenAI/OpenRouter: set `prompt_cache_key`/`session_id` to the GhostCode session ID. Log the hit fields per turn and alert in debug mode when hit tokens drop to 0 after turn 1 (a sign that the prefix bytes changed).

## 4. Streaming UX

What to build (patterns common in coding agents such as Claude Code, Codex CLI and Aider; this list comes from general knowledge, not a fetched source, so **UNVERIFIED** as to each product's exact behaviour):

- **Token streaming**: always `stream: true`. Render text deltas immediately.
- **Reasoning stream**: show thinking in a dimmed, collapsible block. Ollama returns it as `message.thinking` when `think` is set (boolean or `"low"/"medium"/"high"/"max"`) (https://github.com/ollama/ollama/blob/main/docs/api.md). llama-server returns `reasoning_content` with `--reasoning-format deepseek` (README above). Anthropic streams `thinking` content blocks. DeepSeek and OpenRouter return `reasoning_content`/`reasoning`.
- **Tool-call argument streaming**: OpenAI-style APIs stream `tool_calls[].function.arguments` as partial JSON strings; Anthropic streams `input_json_delta`. Show "editing src/foo.ts..." as soon as the `path` field parses, and show a live line count for large write arguments. Parse with a tolerant partial-JSON parser and execute only after the call is complete. **UNVERIFIED**: whether Ollama streams tool-call arguments incrementally; treat it as whole-call-at-once.
- **TTFT display**: start a timer at request send. Show "waiting for model (Ns)" until the first token, then record TTFT and decode t/s in the status line. In debug mode, show cached vs new prompt tokens from the hit fields in sections 1 and 3.
- **Prefill progress for local models**:
  - llama-server: set `return_progress: true` with `stream: true`. Chunks then include `prompt_progress` with `total`, `cache`, `processed`, `time_ms`. Real progress is `(processed - cache) / (total - cache)` (README above). Render "Prefilling 5,210 / 7,400 tokens (2,100 cached), ETA 40s", with ETA from `time_ms`. **UNVERIFIED** whether the OpenAI-compatible `/v1/chat/completions` endpoint emits `prompt_progress` the same way as `/completion`; test both.
  - Ollama: no prefill progress field found in api.md; the first stream chunk arrives only after prefill. **UNVERIFIED** (absence). Fallback: estimate "Prefilling ~N tokens" from a local token count and the measured prefill t/s of the previous turn (`prompt_eval_duration`).

## 5. Speculative decoding in llama-server (CPU)

- Flags (README above): `--spec-type` takes `none` (default), `draft-simple`, `draft-eagle3`, `draft-mtp`, `draft-dflash`, `draft-dspark`, and n-gram types (`ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod`, `ngram-cache`). A draft model is set with `-md` or `-hfd`; `--spec-draft-n-max` defaults to 3. The old `--draft-max/--draft-min` flags were removed. Presets `--fim-qwen-7b-spec` / `--fim-qwen-14b-spec` pair Qwen2.5-Coder with a 0.5B draft. Metrics: `/metrics` has `llamacpp:spec_decode_num_draft_tokens_total` and `..._accepted_tokens_total` for the acceptance rate.
- **It speeds decode, not prefill.** It does not improve TTFT. The draft model also has to prefill the 7.4K prompt, which makes cold TTFT worse on CPU (inference from how draft models work, **UNVERIFIED** in a source).
- **CPU gains**: no fetched source gives CPU numbers. **UNVERIFIED** expectation: on memory-bandwidth-bound CPUs, a draft model gives small or negative gains unless acceptance is high, because verification batches compete for the same cores. The n-gram types need no draft model and no extra prefill. They fit coding agents well, since edits repeat text already in context (file contents, diffs). Try `--spec-type ngram-mod` (or `ngram-cache`) first, and keep it only if measured decode t/s improves.
- MTP for Qwen3.6 is unavailable at our quant sizes (R5).

## Recommended defaults

| Setting | Value | Why | How to verify |
|---|---|---|---|
| Ollama `options.num_ctx` | 16384 (fixed per model, sent on every request) | Default 4096 cannot hold the 7.4K prompt; changing it may reload the model and drop the cache | `prompt_eval_count` > 7,400 with no truncation; `load_duration` small on turn 2+ |
| Ollama `keep_alive` | `-1` while GhostCode runs; `0` on exit | Keeps the model and KV cache resident between turns | `load_duration` near 0 and `prompt_eval_cached_count` >= 7,400 on turn 2+ |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Half the KV memory of f16 with very small loss, so 16K context fits in 8-16 GB | RAM use of `ollama ps`; compare prefill t/s against f16 once |
| `OLLAMA_FLASH_ATTENTION` | `1` (or auto) | Required for quantized KV | Server log shows flash attention enabled |
| `OLLAMA_NUM_PARALLEL` / llama-server `-np` | `1` | RAM scales with slots; one slot keeps the warmed cache | Hit counts stay high across turns |
| Message history | Append-only; volatile data goes in the latest message | Any earlier byte change breaks prefix reuse locally and in the cloud | Cached-token fields do not drop to 0 after turn 1 |
| llama-server `cache_prompt` | `true` (default) | Only the unseen suffix gets evaluated | `timings.cache_n` >= 7,400, `timings.prompt_n` = new suffix |
| llama-server `--slot-save-path` + `/slots` save/restore | Save the warmed system+tools slot once; restore at start; pin `id_slot: 0` | Removes the cold-start 7.4K prefill (minutes on CPU, estimated) | Restore response `n_restored` ~7,400; first-turn `cache_n` ~7,400 |
| llama-server `--cache-reuse` | `256` | Reuses shifted chunks after context pruning | `cache_n` stays high after a prune; benchmark on Qwen3.6 (recurrent caveat in R5) |
| llama-server `-ctk/-ctv` | `q8_0` | Memory, plus smaller slot files | Startup KV buffer size; slot file size |
| llama-server `return_progress` | `true` with streaming | Drives the "Prefilling N tokens" bar | `prompt_progress` objects appear in stream chunks |
| Local prompt mode | "Lite": about 6 tools and a short prompt, target <= 2.5K tokens | Cuts every cache-miss prefill about 3x | `prompt_eval_count` / `prompt_n` on turn 1; task-suite success rate |
| Anthropic | `cache_control` on last tool, system, last message; 5m TTL (1h for long sessions) | Reads cost 0.1x; prompt is above every model's minimum | `cache_read_input_tokens` > 0 on turn 2+ |
| OpenAI / OpenRouter | `prompt_cache_key` / `session_id` = session ID | Routes to the same cache/provider | `cached_tokens` > 0 on turn 2+ |
| Speculative decoding | Off by default; opt-in `--spec-type ngram-mod` | No TTFT gain; CPU gains unproven | `/metrics` acceptance rate and decode t/s A/B |
