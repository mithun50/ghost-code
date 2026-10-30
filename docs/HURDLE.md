# Hurdle: Never Leak, Verify Before Escalating

GhostCode runs on a local model first. A request goes to the cloud only after it has been cleaned, and the task moves to the cloud only when checks show the local answer failed.

All of it lives in one plugin, `harness/packages/extensions/local-models`, and shows up in the composer as the **shield badge** (left of the Laya button).

## Where to look in the app

Click the shield in the composer. It has one section per hint:

| Panel section | What it shows |
|---|---|
| Where the next request goes | `On this device` or `Cloud`, the exact `provider/model`, and free RAM |
| 1. What may leave the machine | Secrets redacted, secret files withheld, secret-file reads blocked, cloud requests and bytes sent, and the **Privacy mode** switch |
| 2. Escalate only on evidence | Passed and failed checks, the failure streak, and the last checks with their reasons |
| 3. Running out of resources mid-task | Local recoveries (smaller model, restarted server, paused task) |
| Laya decision engine | Whether Laya is active, and its last question, answer, action and latency |
| Egress log | Every cloud request, block, escalation and recovery, newest first |

The badge text is `On device`, `Cloud` or `Private`. A number on it counts what was kept on the machine. A pulsing green dot means Laya is checking the session.

## Hint 1: what is allowed through the cloud door

Code: `src/egress.ts`, `src/guard.ts` (`cleanRequest`), and the `llm/stream` and `tools/pre-execute` hooks in `src/index.ts`.

- **Every request to a cloud route is cleaned.** Local routes (`ghostcode-local`, `ollama`, `lmstudio`) are not touched.
  - API keys (OpenAI, Anthropic, GitHub, AWS, Google, Slack, Stripe, Groq, Hugging Face), private keys, JWTs, URL passwords and `NAME=secret` assignments become `[REDACTED:kind]`.
- **Results of tool calls on secret files are withheld.** That covers `.env`, `.env.local`, `*.pem`, `id_rsa`, `.ssh/`, `.aws/`, `credentials.json` and similar. The cloud model sees `[withheld by GhostCode: .env holds secrets ...]`. Templates such as `.env.example` stay allowed.
- **While a cloud model is active, reading a secret file is denied.** The contents never enter a cloud-bound context.
- **Privacy mode** (the switch in the panel) blocks every cloud request.
- **Every cloud request is logged** with its provider, model, bytes, files named, secrets removed and files withheld. The log is in the panel and in `~/.ghostcode/local-models/egress.jsonl`.

## Hint 2: how the router knows the local answer was bad

Code: `judgeCommand` and `SessionGuard` in `src/guard.ts`, and the `tools/post-execute` hook.

- Every shell command (`pwsh`, `bash`) is judged on hard evidence. A pass needs exit code 0 and no failure in the output. A failure is a non-zero `[exit code: N]`, `error TS…`, `N failed`, `npm ERR!`, `Traceback` and similar.
- Laya breaks ties only. When the output has no exit code, a Laya "failed" verdict counts as a failure. Laya never overrides an exit code.
- The session escalates after **3 failed checks in a row** (`escalateAfter`). A hard-looking question never escalates by itself.
- When a check passes again, the session **returns to the local model** automatically.
- Each escalation is logged with the reasons that triggered it, and the model is told why.

## Hint 3: resources running out halfway through a task

Code: the `agent/pre-step` and `agent/request-error` hooks in `src/index.ts`.

- Before every local step, free RAM is checked. Model weights may use 67.5% of free RAM (`WEIGHT_SHARE`).
- If the current model no longer fits, the session moves to a **smaller installed local model**, never to the cloud.
- If the local server crashes mid-task, it is **restarted locally** and the step retried (twice at most).
- If nothing local can run, the task **pauses** with a clear message. It is not silently sent to the cloud.
- A rejected cloud key (HTTP 401 or 403) moves the session **to the local model**.

## A 3-minute demo script

1. **Local first.** Pick `GhostCode Local / Qwen3.5 2B` and ask for a small website. The shield says `On device`.
2. **Hint 1.** Create a `.env` with `OPENAI_API_KEY=sk-proj-...`. Switch to a cloud model and ask the agent to "read .env and summarize the config". The read is denied. The panel shows `1 secret-file read blocked`, and the egress log names the file.
3. **Redaction.** Paste a fake key in a message to a cloud model. The log entry shows `1 secrets redacted`.
4. **Hint 2.** On the local model, ask it to run a command that fails, such as `npm run build` in a folder with no `package.json`. Watch the failure streak climb. After 3 failures it escalates, and the log shows the evidence. Fix the command; the next pass returns the session to local.
5. **Privacy mode.** Turn on Privacy mode and send a message to a cloud model. It is blocked, and the log records it.
6. **Hint 3.** Explained from the panel and the code. The memory check runs before every step.

## Tests

`harness/packages/extensions/local-models/tests/guard.spec.ts` covers redaction, secret-file detection, withheld tool results, evidence judging and failure streaks. Run it with:

```
cd harness
pnpm exec vitest run packages/extensions/local-models
```
