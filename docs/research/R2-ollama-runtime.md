# R2. How Ollama runs models and how GhostCode calls them

Owner: (assign)
Plan section: Phase 3

## Questions

1. Model load: GPU vs CPU layers, memory estimate vs /api/ps size and size_vram
2. num_ctx, num_gpu, num_thread, keep_alive defaults per device class
3. Tool calling support per catalog model
4. /api/chat vs /v1/chat/completions for tools, streaming, usage
5. Thinking output handling
6. Concurrency (OLLAMA_NUM_PARALLEL, OLLAMA_MAX_LOADED_MODELS)
7. Does the harness already ship an OpenAI-compatible or Ollama adapter?
8. Harness adapter interface (prepareCall, chunks, tool calls, usage, errors, cancel)
9. Harness modelSelection and mid-session model switch

## Tool-calling table

| Model tag | Params | Quant | Native tools | JSON-schema fallback | Notes |
|---|---|---|---|---|---|

## Findings

