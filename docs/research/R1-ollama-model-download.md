# R1. How Ollama finds, downloads and stores models

Owner: (assign)
Plan section: Phase 2

## Questions

1. Pull flow end to end (registry, manifest, layers, digest check)
2. Storage path per OS and OLLAMA_MODELS
3. /api/pull progress stream format
4. Resume after interrupted pull (tested?)
5. Download size before pull
6. /api/show fields (params, quant, context length, architecture)
7. Hugging Face GGUF import (hf.co pull and Modelfile FROM)
8. Delete and disk cleanup

## Findings

(For each answer: what you found, how you verified it, source link.)

