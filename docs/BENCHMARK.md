# Benchmarks

All numbers were measured on 2026-10-31 on one laptop: Intel Core Ultra 5 125H (14 cores), 16 GB RAM, Intel Arc integrated graphics, Windows 11. Raw results for the Laya benchmark are reproducible with the script below.

## Summary

| What | Result |
|---|---|
| Command success: exit code first, Laya when there is none (what GhostCode ships) | **90%** correct (18/20) |
| Command success: no checking at all | 50% |
| Task done: Laya | **67%** correct (8/12) |
| Task done: no Laya (the loop just stops) | 50% |
| Laya decision time | 312 ms median, 571 ms slowest |
| Local model speed (Qwen3.5 2B with a draft model) | 27 to 30 tokens/s |
| Local model context window | 204,800 tokens |
| Landing page, cloud (Claude Sonnet 4.6) | 158 s, works, clean design |
| Landing page, local (Qwen3.5 2B, offline) | 172 s, works, plain design |

## 1. Laya decision benchmark

### What Laya does

Laya is a 421M-parameter decision model ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya), Apache 2.0, English checkpoint at revision `7b928d8`). It does not write text. It reads a block of text and a yes/no question and returns the probability of "yes" in one forward pass. It runs on the CPU next to GhostCode.

GhostCode asks Laya two questions during every agent turn:

| Question | When | Threshold | What GhostCode does below the threshold |
|---|---|---|---|
| "Did this command succeed without errors?" | After every shell command | 0.3 | Tells the coding model the command looks failed |
| "Is the user's request fully done, with nothing left to implement, run or verify?" | When a turn is about to end | 0.5 | Asks the coding model to check its work once more |

The benchmark measures how often those answers are right.

### Test set

32 cases, written by hand to look like real agent output from the tools a coding agent runs:

- **20 command outputs**: vite, tsc, jest, pip, python, npm, git, eslint, PowerShell, node, curl, pytest. Half succeeded and half failed.
  - 14 end with the `[exit code: N]` marker that GhostCode's shell tool prints.
  - 6 have no exit code. These model long-running servers and tools whose output does not include one. They are the hard cases, because the outcome has to be read from the text.
- **12 end-of-turn pairs**, each a user request plus the agent's final reply. Half finished the job; half only planned, stopped on an error, asked permission, or claimed work without showing it.

Both sets are balanced, so a judge that always answers the same way scores 50%.

### Method

1. Start the installed Laya sidecar exactly as GhostCode does: CPU, English checkpoint only, loaded from disk.
2. Send one warm-up question, excluded from the results.
3. Ask each case once, with the same question text and thresholds GhostCode ships. Laya is deterministic, so the same input always gives the same answer.
4. Score four judges against the labels:

| Judge | How it decides |
|---|---|
| Always yes | Says every command passed and every turn is done. This is what an agent loop does with no checking. |
| Laya alone | Laya's probability against the threshold. |
| Exit-code rules | GhostCode's `judgeCommand`: a non-zero exit code or failure words (`error TS`, `npm ERR!`, `Traceback`, `N failed` and similar) mean failed. |
| Shipped combination | The exit code decides when there is one. Laya decides only when there is not. |

### Metrics

- **Accuracy**: share of cases judged correctly.
- **Failures caught**: real failures the judge flagged. Missing one means the agent carries on as if broken code worked.
- **False alarms**: real successes the judge flagged as failed. Each one costs the agent an extra step.
- **Latency**: wall time for one decision, measured by GhostCode's Laya client.

### Results: did the command succeed? (20 cases)

| Judge | Accuracy | Failures caught | False alarms |
|---|---|---|---|
| Always yes | 50% (10/20) | 0 of 10 | 0 of 10 |
| Laya alone | 75% (15/20) | 9 of 10 | 4 of 10 |
| Exit-code rules | 85% (17/20) | 7 of 10 | 0 of 10 |
| **Shipped combination** | **90% (18/20)** | **9 of 10** | **1 of 10** |

On the 6 outputs without an exit code, Laya was right on 4 and the rules on 3.

### Results: is the task done? (12 cases)

| Judge | Accuracy | Unfinished turns caught | Finished turns wrongly sent back |
|---|---|---|---|
| Always done (no Laya) | 50% (6/12) | 0 of 6 | 0 of 6 |
| **Laya, threshold 0.5** | **67% (8/12)** | **3 of 6** | **1 of 6** |

### Speed

| | Value |
|---|---|
| Sidecar start, model on disk | 9.2 s (21.6 s on the very first start after install) |
| Median decision | 312 ms |
| Slowest decision | 571 ms |

A decision adds about a third of a second to a step. The coding model itself needs several seconds per step, so Laya does not slow a turn noticeably.

### Per-case results: command success

`p` is Laya's probability that the command succeeded. At 0.3 or above, Laya says it succeeded.

| # | Case | Truth | Laya p | Laya | Rules | Exit code | ms |
|---|---|---|---|---|---|---|---|
| 1 | vite build ok | succeeded | 0.79 | right | right | yes | 538 |
| 2 | tsc type error | failed | 0.14 | right | right | yes | 320 |
| 3 | jest all pass | succeeded | 0.90 | right | right | yes | 312 |
| 4 | jest one failing | failed | 0.07 | right | right | yes | 493 |
| 5 | pip install ok | succeeded | 0.44 | right | right | yes | 336 |
| 6 | python traceback | failed | 0.18 | right | right | yes | 347 |
| 7 | node script output | succeeded | 0.09 | wrong | right | yes | 316 |
| 8 | missing npm script | failed | 0.18 | right | right | yes | 329 |
| 9 | git commit ok | succeeded | 0.74 | right | right | yes | 314 |
| 10 | eslint errors | failed | 0.10 | right | right | yes | 571 |
| 11 | pwsh listing | succeeded | 0.18 | wrong | right | yes | 259 |
| 12 | pwsh not recognized | failed | 0.00 | right | right | yes | 284 |
| 13 | port in use | failed | 0.07 | right | right | yes | 310 |
| 14 | syntax check ok | succeeded | 0.10 | wrong | right | yes | 224 |
| 15 | server ready | succeeded | 0.88 | right | right | no | 306 |
| 16 | deprecation warning only | succeeded | 0.19 | wrong | right | no | 282 |
| 17 | curl connection refused | failed | 0.56 | wrong | wrong | no | 278 |
| 18 | cannot find module | failed | 0.03 | right | wrong | no | 288 |
| 19 | permission denied | failed | 0.03 | right | wrong | no | 237 |
| 20 | tests pass | succeeded | 0.71 | right | right | no | 249 |

### Per-case results: task done

`p` is Laya's probability that the task is done. At 0.5 or above, Laya says done.

| # | Case | Truth | Laya p | Laya | ms |
|---|---|---|---|---|---|
| 1 | site built and checked | done | 0.90 | right | 521 |
| 2 | only planned | not done | 0.24 | right | 481 |
| 3 | bug fixed, tests green | done | 0.56 | right | 304 |
| 4 | fix written, not run | not done | 0.67 | wrong | 287 |
| 5 | stopped on error | not done | 0.36 | right | 278 |
| 6 | question answered | done | 0.48 | wrong | 280 |
| 7 | half the files | not done | 0.54 | wrong | 494 |
| 8 | PWA complete | done | 0.83 | right | 531 |
| 9 | asks permission instead | not done | 0.50 | wrong | 285 |
| 10 | rename done | done | 0.84 | right | 296 |
| 11 | refactor claimed, nothing shown | not done | 0.30 | right | 312 |
| 12 | refactor done | done | 0.75 | right | 501 |

### What the results show

**The exit code should win, and Laya should break ties.** Laya alone missed 4 successful commands. All 4 have short or plain output with no success words: a script printing totals, a directory listing, `node --check` printing nothing, and npm deprecation warnings. The exit code gets three of those right, so the shipped combination never asks Laya about them. Where there is no exit code, Laya catches failures the rules miss ("Cannot find package", "Permission denied"), because it reads the meaning instead of matching words. That is why GhostCode combines them: 90%, against 85% for the rules alone and 75% for Laya alone.

**The one failure everything missed** is `curl: (7) Failed to connect`. It has no exit code and no failure word the rules know, and Laya scored it 0.56. Adding "Failed to connect" and "Couldn't connect" to the failure words would fix it for the rules.

**Task done is harder.** Laya clearly separated plans and half-finished work from finished work in most cases. All 4 misses scored between 0.48 and 0.67, close to the threshold. "Fix written, not run" scored 0.67: the reply sounds finished even though the work was never checked.

**The threshold may be slightly low.** At 0.55 instead of 0.5, this set scores 83% (10/12), catching 5 of 6 unfinished turns with the same 1 false nudge. We did not change the shipped default, because tuning on 12 cases we wrote ourselves would overfit.

### Limits

- 32 cases is small, and we wrote them ourselves after building the system. Treat these as a sanity check, not a published score.
- English only, and one checkpoint.
- Laya is deterministic, so each case was run once. A different phrasing of the same output can score differently.
- The benchmark scores single decisions. It does not measure whether a whole coding task succeeds more often with Laya on. That needs a task benchmark (see the end of this file).

### Reproduce

From `harness/`, with Laya installed (click Install Laya in GhostCode once):

```
node --import tsx/esm packages/extensions/laya/bench/laya-bench.ts out.json
```

The script is `harness/packages/extensions/laya/bench/laya-bench.ts`. It prints the tables above and writes every case, probability, verdict and latency to `out.json`.

## 2. Local model

Qwen3.5 2B (Q4_K_M, 1.3 GB) on llama.cpp b12004 with the Vulkan backend on Intel Arc. Qwen3.5 0.8B runs beside it as a draft model for speculative decoding.

| | Value | How it was measured |
|---|---|---|
| Generation | 27 to 30 tokens/s | llama-server's own `predicted_per_second` over 64 to 160 tokens |
| Generation without the draft model | 23 tokens/s | Same, draft model off |
| Prompt GhostCode sends for a local step | about 2.2K tokens | Server log; it was 9.7K before the short local prompt and slim tools |
| First prompt read | 4.4 s | Server log `prompt eval time`, 2,206 tokens at about 500 tokens/s |
| Follow-up prompt read | 0.9 s | Same, after the prompt cache reused the shared prefix |
| Context window | 204,800 tokens | Server `/props` reports `n_ctx 204800`; Qwen3.5's native window is 262K |
| Model start | about 20 s | Preloaded 2 s after GhostCode starts, so the first message does not wait |

Lower-bit versions were slower on this laptop, not faster:

| Qwen3.5 2B | File | Generation |
|---|---|---|
| 4-bit Q4_K_M (shipped) | 1.3 GB | 23 to 26 tokens/s alone |
| 2-bit IQ2_M | 0.86 GB | 13.5 tokens/s inside GhostCode, 21 in llama-bench |

2-bit formats cost more to unpack per token on this hardware, and they lose quality. They only make sense for large models that would not fit otherwise.

## 3. Building a landing page: cloud vs local

Both runs used the same prompt file: a GhostCode landing page in plain HTML, CSS and JavaScript, with the minimal design rules and a request to check the script with `node --check`.

| | Cloud: Claude Sonnet 4.6 | Local: Qwen3.5 2B, offline |
|---|---|---|
| Time | 158 s | 172 s, including about 20 s to start the model server |
| Tool calls | 9: 3 writes, 5 to-do updates, 1 shell check | 4: 3 writes, 1 job stop |
| Ran `node --check` itself | yes | no; we ran it afterwards and it passed |
| Output | index.html, styles.css, script.js (23 KB) | index.html, styles.css, script.js (10 KB) |
| All six requested sections | yes | yes |
| Emojis, gradients | none | none |
| Dashes in visible text | none (4 in code comments) | none |
| Design | clean, well spaced, strong hierarchy | plain; small hero headline, bright blue buttons, cramped step cards |

The local model followed the structure and the hard rules with no internet, but skipped the verification step and needs a design pass. For polished pages a cloud model is better, and the privacy guard cleans what is sent.

## Not yet measured

- **Task success rate.** About 10 small coding tasks (fix a bug, add a function, build a page), each passing or failing on its own test, run on the local and cloud models, with Laya on and off. This is the number that would show Laya's effect on whole tasks.
- **Memory with a full 200K window.** The server opens 200K, but no test has filled it.
- **The offline reroute** in a real Wi-Fi-off session; it is still being fixed.
