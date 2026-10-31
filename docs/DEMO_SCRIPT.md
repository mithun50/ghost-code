# Demo script and repo walkthrough

A talk track for presenting GhostCode to judges, plus the inside-out tour of the repo to answer questions from. Every number here is measured; the source of each is in [BENCHMARK.md](BENCHMARK.md).

## The one-line pitch

GhostCode is a coding agent that runs on the laptop you already own. It works with the Wi-Fi off, it never sends a secret to the cloud, and it only asks the cloud for help when a real check has failed.

## Before you start (5 minutes ahead)

1. `cd harness && pnpm ghostcode web --port 3090`, open the printed URL.
2. Confirm the model menu shows `GhostCode Local / Qwen3.5 2B` and the shield badge says `On device`.
3. Turn Laya on (brain button). The chip next to it shows each decision.
4. Have an empty folder ready as the workspace, and a terminal open for `pnpm ghostcode kill`.

## Talk track (about 6 minutes)

### 1. The problem (30 s)

"Coding agents today need the internet and send your code, and often your keys, to someone else's server. On a train, in a hostel with bad Wi-Fi, or in a company that forbids it, you have nothing. GhostCode runs fully on the device."

### 2. Local agent, live (2 min)

Pick the local model. Type:

> Create a folder `todo` with index.html, styles.css and app.js for a minimal to-do app. Keep items in localStorage.

Point out while it runs:

- **Tool calls are real.** Each `write` and `edit` row is a file being written on disk. Open one to show the arguments.
- **Changed files card.** When the turn ends, the card lists every file with line counts. Click one: the review tab shows the diff.
- **Laya chip.** After each command it says `command ok` or `command failed`, with its confidence and latency (median 312 ms on CPU).
- **The model.** Qwen3.5 2B, 4-bit, 1.3 GB, with a 0.8B draft model. 27 to 30 tokens/s on this laptop, 204,800-token context.

Then ask for a change, to show it edits instead of rewriting:

> Add a "clear completed" button.

### 3. Turn the Wi-Fi off (1 min)

Disconnect the network. Send another request. Nothing changes: no "reconnecting" banner, because the browser talks to the Host on 127.0.0.1. If the session was on a cloud model, GhostCode notices the cloud is unreachable, switches the session to the local model and retries the step. The shield shows `Offline, local` and the egress log records the switch.

### 4. Never leak (1 min)

Open the shield panel. Explain the three sections, one per hint:

1. **What may leave the machine.** Every cloud request passes through one function, `cleanRequest`. API keys, private keys, JWTs and `NAME=secret` lines become `[REDACTED:kind]`. Tool results from `.env`, `*.pem`, `.ssh/` are withheld. While a cloud model is active, reading `.env` is denied outright. Privacy mode blocks the cloud entirely.
2. **Escalate only on evidence.** Every shell command is judged on its exit code and error output. Only 3 failed checks in a row move the session to the cloud. A hard-looking question never does. One passing check moves it back.
3. **Running out of resources.** Before each local step, free RAM is checked. If the model no longer fits, the session moves to a smaller local model, not the cloud. If the server crashes, it restarts locally. If nothing fits, the task pauses with a message.

### 5. Laya, measured (45 s)

"Laya is a 421M decision model that answers yes or no questions about the agent's state. We benchmarked it on 32 hand-written cases. For 'did this command succeed', exit code first and Laya as tie-breaker scores 90%, against 85% for rules alone and 75% for Laya alone. For 'is the task done', Laya scores 67% against 50% for stopping blindly." Then show `docs/BENCHMARK.md`.

### 6. Kill switch (15 s)

Run `pnpm ghostcode kill`. The Host, the model server and Laya all stop. Closing the browser does the same after 2 minutes of no connection.

## Repo, inside out

```text
ghost-code/
  README.md, AGENTS.md          entry points for people and coding agents
  docs/                         ARCHITECTURE, HURDLE, BENCHMARK, this script
  harness/                      fork of DeepSeek Harness (MIT), pnpm monorepo
    apps/cli/src/kill.ts        the kill switch
    packages/extensions/
      local-models/             llama.cpp manager, model catalog, system scan, privacy guard
      laya/                     Laya install, sidecar, decision hooks, auto-continue, bench/
    packages/client/
      ui-model-selection/       Local tab, one-click install, model menu
      ui-laya/                  Laya button, decision chip, shield panel
      ui-conversation/          hero and the hand-off into chat
      connection/               stays connected to a local Host with no internet
    packages/api/gateway/       idle shutdown when no browser is connected
```

### How a request flows

1. The browser sends the message to the Host on 127.0.0.1.
2. The agent loop runs a step. Before it, `agent/pre-step` checks free RAM and starts the local model server if needed.
3. The step goes through `llm/stream`. Local requests get a short system prompt and 10 slim tools, so the prompt is about 2.2K tokens instead of 9.7K. Cloud requests go through `cleanRequest` first, or are blocked in privacy mode.
4. Tool calls run. `tools/pre-execute` denies secret-file reads on a cloud model. `tools/post-execute` judges command output, with Laya as tie-breaker, and counts the failure streak.
5. When the turn is about to end, `agent/turn-stopping` runs two checks. If the reply was cut off at the output limit, auto-continue asks the model to continue (up to 3 times). Otherwise Laya asks "is the task done?" and, below 0.5, asks the model to check once more.

### Design decisions judges may ask about

| Question | Answer |
|---|---|
| Why plugins, not edits to the agent loop? | The fork stays mergeable with upstream. Every GhostCode feature is a hook in its own package. |
| Why a 2B model? | It runs at 27 to 30 tokens/s on a laptop iGPU and fits in 1.3 GB, so it leaves room on 8 GB machines. |
| Why 4-bit, not 1 or 2-bit? | 2-bit was slower on this hardware (13.5 tokens/s) and loses quality. Low-bit only pays off for models too big to fit otherwise. |
| How do downloads stay safe? | Every file is pinned to a Hugging Face revision, size and SHA-256 in `catalog.ts`. |
| What happens to child processes? | Each one records its owning Host's pid. Trees are killed on exit, and a stale server is reaped on the next start only if its owner is dead. |
| How do you know Laya helps? | `packages/extensions/laya/bench/laya-bench.ts`, results in `docs/BENCHMARK.md`, including where it fails. |
| Tests? | 821 tests pass across the GhostCode packages and the agent loop: `pnpm exec vitest run packages/extensions packages/client/ui-laya packages/client/ui-model-selection packages/core/agent-loop`. |

### Honest limits

- The 2B model handles small, well-scoped tasks. Large multi-file refactors still need a cloud model, which is what evidence-based escalation is for.
- The Laya benchmark is 32 cases we wrote ourselves. It shows the direction, not a final accuracy.
- The Northline Cycles site in the cloud vs local comparison was built by GhostCode driving Claude Sonnet 4.6, in 488 s.
