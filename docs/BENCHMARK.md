# Benchmarks

Measured on 2026-10-31 on an Intel Core Ultra 5 125H laptop, 16 GB RAM, Intel Arc graphics, Windows 11.

## Laya decisions

Script: `harness/packages/extensions/laya/bench/laya-bench.ts`. Run from `harness/`:

```
node --import tsx/esm packages/extensions/laya/bench/laya-bench.ts out.json
```

It starts the installed Laya sidecar, asks the same two questions GhostCode asks during a turn, and scores the answers against 32 hand-labelled cases (20 command outputs, 12 end-of-turn replies). The set is small and written by us, so treat the numbers as a sanity check, not a published score.

### "Did this command succeed?" (20 cases)

| Judge | Correct |
|---|---|
| Always says "passed" (no checking) | 50% |
| Laya alone (threshold 0.3) | 75% (15/20) |
| Exit-code and failure-word rules alone | 85% (17/20) |
| Exit code decides when present, Laya decides otherwise | **90% (18/20)** |

On the 6 outputs with no exit code (a dev server, `npm install` warnings, `curl`, a missing module, permission denied, `pytest -q`), Laya got 67% and the rules got 50%. That is why GhostCode lets the exit code win and uses Laya only to break ties.

Laya's misses: it rated three successful commands with short or no output (`node --check`, a directory listing, a script printing totals) as likely failed, and rated `curl: Failed to connect` as likely passed.

### "Is the task done?" (12 cases)

| Judge | Correct |
|---|---|
| Always stops (what the loop does without Laya) | 50% |
| Laya alone (threshold 0.5) | **67% (8/12)** |

Laya caught 3 of 6 unfinished turns (a plan with no files written, a refactor claimed but not shown, a run that stopped on an error) and asked the model to verify. It wrongly nudged 1 of 6 finished turns. Four of its misses scored between 0.48 and 0.67, close to the threshold.

### Speed

| | Value |
|---|---|
| Sidecar start (model already on disk) | 9.2 s |
| Median decision | 312 ms |
| Slowest decision | 571 ms |

## Local model

Qwen3.5 2B Q4_K_M with Qwen3.5 0.8B as a draft model, llama.cpp b12004, Vulkan.

| | Value |
|---|---|
| Generation | 27 to 30 tokens/s (23 without the draft model) |
| Prompt sent for a local step | about 2.2K tokens (9.7K before the local prompt) |
| First prompt read | 4.4 s |
| Follow-up prompt read | 0.9 s |
| Context window | 204,800 tokens |

## Building a landing page

The same prompt (a GhostCode landing page, plain HTML, CSS and JS, minimal design rules) run through GhostCode with two models.

| | Cloud: Claude Sonnet 4.6 | Local: Qwen3.5 2B |
|---|---|---|
| Time | 158 s | 172 s |
| Tool calls | 9 | 4 |
| Files | index.html, styles.css, script.js (23 KB) | index.html, styles.css, script.js (10 KB) |
| `node --check script.js` | passes | passes |
| All requested sections | yes | yes |
| Emojis, gradients | none | none |
| Design quality | clean and well spaced | plain; small hero headline, bright blue buttons, cramped step cards |

The local model follows the structure and the hard rules (no emojis, no gradients, working JavaScript, no internet) but its layout needs a human pass. For polished pages, use a cloud model; the privacy guard cleans what is sent.
