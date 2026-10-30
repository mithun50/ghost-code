# GhostCode Implementation Plan

Status: draft v1, 2026-10-30
Team: Cozy Bears (Harsha N, Naren V, Mithun Gowda B, Nevil Anson Dsouza)

## 1. Goal

Build one coding agent that:

1. Runs fully offline on a laptop using a local open model (Ollama).
2. Measures free RAM, VRAM, CPU and disk before loading anything, and picks the
   largest model that fits.
3. Falls back to BYOK (bring your own API key) when the device is too small, and
   lets the user switch between local and BYOK at any time.
4. Uses Laya, a 421M-parameter decision model, to make small local models plan,
   pick tools and stop correctly.
5. Has web search and web scraping tools when online.
6. Works on Android phones (BYOK by default, small local model when RAM allows).

We do not write a harness from scratch. We fork DeepSeek Harness, Customize it as
GhostCode, and add our features as plugins.

## 2. Verified facts this plan depends on

Checked on 2026-10-30. Re-check before coding against them.

| Fact | Source |
|---|---|
| The harness is MIT licensed, Node.js, built with `pnpm install`, `pnpm run build`, `pnpm ghostcode web` | Harness README |
| The harness is "everything is a plugin" on Cordis. Model adapters register on `ctx.llm`, tools on `ctx.tools` | Harness `docs/architecture.md` |
| The harness has cookbook guides: `docs/cookbook/adding-an-llm-adapter.md`, `adding-a-tool.md`, `adding-a-package.md`, `adding-a-settings-card.md` | Harness `docs/architecture.md` |
| Harness profiles: `web`, `headless`, `sdk`, `sdk-minimal`, `acp`. `ghostcode --profile web --dump-config` prints the plugin tree | Harness `docs/architecture.md` |
| The `base` bundle (`packages/bundle/base`) already includes model adapters, tools, credentials, sandbox and approval policy | Harness `docs/architecture.md` |
| Harness hook points: `agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `agent/turn-stopping` | Harness `docs/architecture.md` |
| Harness rule: every model-visible input must be logged as a session event | Harness `docs/architecture.md` |
| Ollama REST API on `localhost:11434`: `/api/chat`, `/api/generate`, `/api/pull`, `/api/tags`, `/api/ps`, `/api/show`, `/api/delete` | Ollama `docs/api.md` |
| Ollama serves an OpenAI-compatible API at `/v1/chat/completions` (API key required by clients but ignored) | docs.ollama.com/api/openai-compatibility |
| Ollama `keep_alive` controls how long a model stays in memory (default 5m) | Ollama `docs/api.md` |
| Laya: `pip install laya`, Python 3.10+, extras `laya[serve]` (HTTP server), `laya[onnx]`, `laya[mcp]` | HF model card |
| Laya question types: `choice`, `score`, `noul` (yes probability). One forward pass, about 33 ms | HF model card |
| Laya checkpoints: English 421M (ModernBERT-large), multilingual 322M, typed-decisions 421M | HF model card |
| Laya fine-tuning matters: typed-decisions 0.766 accuracy vs 0.362 for base on the same benchmark | HF model card |

Not yet verified (each is a research task below): whether the harness already
ships an Ollama or OpenAI-compatible adapter, whether the harness has web search
tools, how Ollama estimates memory, and whether Laya ONNX runs on Android.

## 3. Architecture

```text
                       +-----------------------------+
   Web UI / CLI  --->  |  GhostCode (forked harness) |
   Android app   --->  |  agent loop + session log   |
                       +--------------+--------------+
                                      |
        +------------------+----------+-----------+------------------+
        |                  |                      |                  |
  ghostcode-profiler ghostcode-router       ghostcode-laya     ghostcode-web
  (RAM/VRAM/CPU/     (local or BYOK,        (decisions at      (search and
   disk/battery)      which model)           pre-step and       scrape tools)
        |                  |                 pre-execute)
        |          +-------+--------+              |
        |          |                |              |
        |   ghostcode-ollama ghostcode-byok  laya-serve (Python
        |   (ctx.llm adapter  (ctx.llm adapter  sidecar, HTTP)
        |    + model manager)  OpenAI-compat)
        |          |                |
        +----> Ollama server    Provider API
               localhost:11434  (user key)
```

All GhostCode features live in `harness/packages/ghostcode/*` as harness
plugins. We do not edit `packages/core/*` unless a hook point is missing. This
keeps upstream merges cheap.

## 4. Team tracks

Phases 1, 2 and 3 run in parallel. Assign one owner per track.

| Track | Work | Owner | Starts |
|---|---|---|---|
| A. Fork and Customize | Clone the upstream harness, build it, Customize to GhostCode, set up CI | (assign) | Day 1 |
| B. Ollama model download | Research and build the model manager | (assign) | Day 1 |
| C. Ollama runtime in the harness | Research how Ollama runs models, build the `ctx.llm` adapter | (assign) | Day 1 |
| D. Laya and decisions | Laya sidecar, decision hooks, dataset for fine-tune | (assign) | Day 2 |

Tracks B and C research against plain Ollama and upstream `main` first. They do
not wait for Track A. They move their code into the Customizeed repo once Phase 1
is done.

Dependency order:

```text
Phase 0 setup
   |
   +--> Phase 1 fork + Customize (A) ------------------+
   +--> Phase 2 model download research + build (B) -+--> Phase 4 profiler + router
   +--> Phase 3 runtime research + adapter (C) ------+        |
                                                              v
                                    Phase 5 BYOK -----> Phase 6 Laya (D) --> Phase 7 web tools
                                                                                  |
                                                     Phase 8 Android <------------+
                                                              |
                                                     Phase 9 eval + demo
```

## 5. Phases

### Phase 0. Environment setup (everyone, half a day)

Tasks:

- [ ] Install Node.js (repo has v24 on Mithun's machine; check the `engines` field in the harness `package.json` for the required version).
- [ ] Install pnpm: `npm install -g pnpm` (check the version pinned in the `packageManager` field of the harness `package.json` and match it).
- [ ] Install Ollama for Windows from ollama.com. Confirm `ollama --version` and `curl http://localhost:11434/api/version`.
- [ ] Python 3.10+ (3.13 present). Create a venv for Laya: `python -m venv .venv-laya`.
- [ ] Pull one small test model: `ollama pull qwen2.5-coder:1.5b` (pick any small coding model available in the Ollama library; confirm the tag exists first).
- [ ] Each member records their machine specs in `docs/research/hardware.md` (RAM, GPU, VRAM, OS). These are our first test devices for the profiler.

Done when: every member can run `ollama run <small model>` and `node -v`, `pnpm -v`.

### Phase 1. Clone, build and Customize the harness (Track A)

Strategy: fork, not copy. Keep `upstream` as a remote so we can pull fixes.
We Customize the user-facing surface and the internal names (packages, symbols,
folders). Renamed internals make upstream merges conflict more often, so we
merge upstream on a schedule.

Tasks:

1. Clone and build unchanged first.
   ```powershell
   cd C:\Projects\ghostcode
   git clone https://github.com/deepseek-ai/deepseek-harness.git harness
   cd harness
   git remote rename origin upstream
   # create our own GitHub repo, then:
   git remote add origin https://github.com/<team>/ghostcode.git
   git checkout -b ghostcode/main
   pnpm install
   pnpm run build
   pnpm ghostcode web
   ```
   - [ ] Web UI loads at `http://127.0.0.1:3080`.
   - [ ] Run the existing test suite (check `package.json` scripts and `docs/development.md` for the test command). Record the baseline pass count in `docs/research/baseline.md`. We must not drop below it.
   - [ ] Read `docs/architecture.md`, `docs/cordis-primer.md`, `AGENTS.md`, `SAFETY.md`.
   - [ ] Run `pnpm ghostcode --profile web --dump-config > docs/research/config-tree.txt`. This is our map of every plugin row.

2. Inventory what to Customize. Search for the upstream names, do not guess:
   ```powershell
   rg -n -i "deepseek harness|\bdsh\b|DSH_HOME|deepseek-ai/dsh" --glob "!**/node_modules/**" > ..\docs\research\Customize-hits.txt
   ```
   Sort hits into: CLI bin names, env vars, home dir, UI strings and logos, docs, npm package names, telemetry endpoints.

3. Customize:
   - [ ] CLI bin: `ghostcode` and `ghost` bins pointing at `apps/cli/src/bin.ts`.
   - [ ] Home dir: `GHOSTCODE_HOME`, default `~/.ghostcode`. Read the upstream home variable as a fallback.
   - [ ] Web UI: product name, title, logo, favicon, about page.
   - [ ] Default profile name and welcome text.
   - [ ] Telemetry: turn off or point away from DeepSeek endpoints. GhostCode must make zero network calls in offline mode. Verify with Windows firewall logging or by unplugging the network.
   - [ ] README rewritten for GhostCode.
   - [ ] Docs English only: remove the Chinese translations and language switcher links.

4. Legal (MIT requires this):
   - [ ] Keep the original `LICENSE` text and DeepSeek copyright line. Add our copyright line below it.
   - [ ] Keep `THIRD_PARTY_NOTICES.md`.
   - [ ] State in README: "GhostCode is a fork of DeepSeek Harness."
   - [ ] Do not use DeepSeek logos or imply endorsement.

5. Workspace for our code:
   - [ ] Create `packages/ghostcode/` and follow `docs/cookbook/adding-a-package.md` to add an empty `ghostcode-hello` plugin that logs on load. This proves our package wiring works before real features.
   - [ ] Create a `ghostcode` bundle (like the `base` bundle, see `packages/bundle/base/README.md`) that mounts all our plugins, and a `ghostcode` profile that stacks the `base` bundle + our bundle.

6. CI: GitHub Actions that runs install, build, and tests on every PR.

Acceptance:
- `ghostcode web` starts the Customizeed UI.
- Upstream test baseline still passes.
- `ghostcode-hello` plugin loads and logs.
- No DeepSeek network calls when offline.

### Phase 2. Ollama model download and install (Track B)

Research first, write findings to `docs/research/R1-ollama-model-download.md`,
then build `ghostcode-models`.

Research questions:

1. How does a pull work end to end? Read `/api/pull` in `docs/api.md` and trace it in the Ollama source (`server/` directory, search for the pull handler). Document: registry host, manifest format, layer blobs, digest check.
2. Where are models stored on Windows, macOS, Linux? How does `OLLAMA_MODELS` change it?
3. What does the `/api/pull` progress stream look like (status, digest, total, completed)? Can we show a progress bar from it?
4. Is an interrupted pull resumable? Test it: start a pull, kill Ollama, restart, pull again, compare bytes downloaded.
5. How do we know the download size before pulling? (Check whether the manifest or the library page gives layer sizes.)
6. What does `/api/show` return: parameter count, quantization level, context length, architecture fields? We need these for the memory estimate in Phase 4.
7. Can we import a GGUF from Hugging Face directly (`ollama pull hf.co/<user>/<repo>` and Modelfile `FROM ./file.gguf`)? Test both.
8. How do `/api/delete` and disk cleanup work?

Build `ghostcode-models` (plugin + commands):

- [ ] `ModelCatalog`: a curated JSON of coding models we support, each with tag, params, quant, approx download size, approx RAM need, tool-calling support (from R2). Start with 6 to 10 entries from 0.5B to 14B.
- [ ] `listInstalled()` via `/api/tags`.
- [ ] `pull(tag)` via `/api/pull` streaming, with progress events to the UI and CLI.
- [ ] Disk check before pull: refuse if free disk < model size + 2 GB margin.
- [ ] `remove(tag)` via `/api/delete`, with confirmation.
- [ ] Human commands: `/models`, `/models pull <tag>`, `/models rm <tag>` (register on `ctx.commands`).
- [ ] Settings card listing installed models (see `adding-a-settings-card.md`).
- [ ] Ollama not running: detect, show a clear message, offer to start it.

Acceptance:
- From the GhostCode UI a user can see installed models, pull a new one with a live progress bar, and delete one.
- Pull is refused with a clear message when disk is too small.
- Unit tests with a mocked Ollama server for each endpoint.

### Phase 3. Ollama runtime inside the harness (Track C)

Research first, write findings to `docs/research/R2-ollama-runtime.md`, then build
the `ghostcode-ollama` LLM adapter.

Research questions about Ollama:

1. How does Ollama load a model: what decides GPU layers vs CPU, and how does it estimate memory? Trace the scheduler and memory estimate code in the Ollama source. Compare its estimate with `size` and `size_vram` from `/api/ps` after loading.
2. What do `num_ctx`, `num_gpu`, `num_thread`, `keep_alive` do, and what are safe defaults per device class?
3. Which models support tool calling through `/api/chat` `tools`? Test each model in our catalog with one tool call. Record pass/fail in a table.
4. `/api/chat` native vs `/v1/chat/completions` (OpenAI-compatible): which gives better tool calling, streaming and usage stats? Pick one and justify.
5. Thinking models: how `think` output is streamed and how to hide or show it.
6. Concurrency: what happens when the agent and Laya-free side requests hit Ollama at once (`OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS`)?

Research questions about the harness:

7. Does the harness already ship an OpenAI-compatible or Ollama adapter? Check `packages/llm/*` and the `--dump-config` tree. If an OpenAI-compatible adapter exists, the fastest path is to point it at `http://localhost:11434/v1` and skip writing an adapter.
8. Read `docs/subsystems/llm-streaming.md` and `docs/cookbook/adding-an-llm-adapter.md`. Write down the adapter interface (`prepareCall`, stream chunk types, tool-call format, usage, errors, cancellation).
9. How does the harness pick the model per session (`modelSelection`)? How do we switch model mid-session?

Build `ghostcode-ollama`:

- [ ] Register an adapter on `ctx.llm` that streams from Ollama.
- [ ] Map harness messages and tool schemas to Ollama format and back.
- [ ] Map tool calls, usage counts (`prompt_eval_count`, `eval_count`) and errors.
- [ ] Cancellation: abort the HTTP request when the harness cancels a step.
- [ ] Fallback for models without native tool calling: JSON-schema `format` with a tool-call schema (Ollama structured outputs). Test which works better.
- [ ] Settings: Ollama base URL, default model, `num_ctx`, `keep_alive`.

Acceptance:
- A full agent turn (read file, edit file, run a shell command, report) completes with a local model and no network.
- Tool-call table in R2 covers every catalog model.
- Contract tests for the adapter with recorded Ollama responses.

### Phase 4. Resource profiler and router (Tracks B + C)

`ghostcode-profiler` reads, on start and before each model load:

- Total and free RAM.
- GPU vendor, total and free VRAM (NVIDIA: `nvidia-smi --query-gpu=memory.total,memory.free --format=csv`; AMD, Intel and Apple: research per platform).
- CPU cores and architecture.
- Free disk on the model directory.
- Battery level and charging state (laptops and phones).

Research the Node library to use (for example `systeminformation` on npm). Check its current docs and Windows support before adopting it.

`ghostcode-router` decides local or BYOK, and which model:

```text
need = weights_size (from /api/show or manifest)
     + kv_cache(num_ctx, layers, kv_heads, head_dim, bytes_per_elem)
     + runtime_overhead (measure, start with 0.5 to 1 GB)
fits_gpu = need <= free_vram * 0.9
fits_ram = need <= free_ram * 0.7      (leave room for the OS and the IDE)

if user forced a mode:        use it
elif some catalog model fits: pick the largest that fits, prefer fits_gpu
elif BYOK key present:        BYOK
else:                         smallest model + warn "this will be slow"
```

- [ ] Validate the formula: for each catalog model on each team machine, compare `need` with the real `size` from `/api/ps`. Tune the overhead constant until the error is under 10 percent. Record the table.
- [ ] Re-check before every load, not only at start. Free RAM changes when the user opens a browser.
- [ ] UI badge showing current mode (Local: model name / BYOK: provider) with a one-click switch.
- [ ] Persist the choice per project.

Acceptance:
- On every team laptop, the router picks a model that loads without an out-of-memory error.
- Switching mode mid-session continues the same session with the new model.

### Phase 5. BYOK (Track C)

- [ ] First check whether the harness's existing adapters and the `credentials` plugin in the `base` bundle already cover OpenAI-compatible providers with a user key. Reuse them if so.
- [ ] Support any OpenAI-compatible endpoint: base URL + key + model name. This covers most providers and also Ollama itself.
- [ ] Store keys in the OS keychain through the harness credentials service. Never write keys to session logs, config files or telemetry. Add a test that greps the session log for the key.
- [ ] Show which mode is active on every request so the user knows when code leaves the device.
- [ ] Offline + BYOK selected: fall back to local with a notice, never hang.

Acceptance:
- User adds a key, switches to BYOK, continues the session, switches back to local.
- Test proves the key never appears in logs.

### Phase 6. Laya decision layer (Track D)

Laya does not generate text. It answers typed questions (`choice`, `score`, `noul`)
about a state in one forward pass. We use it as a fast, calibrated judge that
guides the small model.

Research first (`docs/research/R3-laya-integration.md`):

1. Run `laya-serve` (`pip install "laya[serve]"`). Document its HTTP API, port, auth, memory use and latency on CPU for each team laptop.
2. Measure RAM of the English (421M) and multilingual (322M) checkpoints. Pick one per device class.
3. Test `laya[onnx]` and `ONNXAgent` speed on CPU. This is our path to Android.
4. Define what "CDMs" means for us (decision modules: a named set of Laya questions per decision point). Confirm the term with the team.

Decision points (each is one CDM, a fixed question set):

| Hook | Question | Type | Action |
|---|---|---|---|
| `agent/pre-step` | What kind of task is this? (edit, explain, debug, research, refactor) | choice | Pick system prompt section and tool subset |
| `agent/pre-step` | Does this need web research? | noul | Enable web tools for the step |
| `agent/pre-step` | Is this too hard for the local model? | noul | If above threshold and BYOK is set, suggest switching |
| `tools/pre-execute` | Is this shell command destructive? | noul | Require user approval |
| `tools/post-execute` | Did the test or command succeed? | noul | Retry or continue |
| `agent/turn-stopping` | Is the user's request fully done? | noul | Stop or continue the turn |

Build `ghostcode-laya`:

- [ ] Sidecar manager: start `laya-serve` as a child process, health-check it, restart on crash. GhostCode must work, with Laya off, if the sidecar is missing.
- [ ] One hook listener per decision point above. Each must call `next()` (these are waterfall hooks).
- [ ] Log every Laya decision as a session event (harness rule: model-visible inputs must be logged).
- [ ] Thresholds in settings. Start at 0.7 and tune on the eval set.
- [ ] Timeout: if Laya takes more than 200 ms, skip the decision.

Fine-tune (stretch, but this is where accuracy comes from):

- [ ] Collect 500 to 2,000 labelled decisions from our own agent runs (state + correct answer per question).
- [ ] Fine-tune with Laya's Kaggle notebook (free 2x T4). Publish as `cozybears/laya-ghostcode`.
- [ ] Compare base vs fine-tuned on a held-out set.

Acceptance:
- Laya runs as a sidecar and all six decision points fire and log.
- Disabling Laya does not break anything.

### Phase 7. Web search and scrape tools (Track B)

- [ ] Check whether the harness already has web search or fetch tools in the `base` bundle. Reuse if so.
- [ ] `web_search` tool: pluggable backend (SearXNG self-hosted, or a BYOK search API). Choose after checking each option's current API and terms.
- [ ] `web_fetch` tool: fetch URL, strip to readable text, cap size, respect robots.txt.
- [ ] Offline: tools report "offline" instantly instead of timing out. Cache fetched docs on disk for reuse offline.
- [ ] Register on `ctx.tools` following `adding-a-tool.md`.

Acceptance: agent answers "what is the latest version of X" by searching and citing the page, and works with the network off by using the cache or saying it cannot.

### Phase 8. Android (Track A, after Phase 1)

Ollama does not ship an official Android app, so the phone needs a different
runtime. Two modes:

1. Remote mode (fastest to build): Flutter app connects to GhostCode running on
   the user's laptop over LAN. Uses the GhostCode SDK JSON-RPC server (`sdk` profile).
2. Standalone mode: Flutter app runs BYOK directly, plus a small local model
   through llama.cpp on device when RAM allows.

Tasks:

- [ ] Research Flutter bindings for llama.cpp on Android. Check maintenance status and license before picking one.
- [ ] Research ONNX Runtime Mobile for Laya. Measure latency on a team phone.
- [ ] Phone profiler: read RAM with Android `ActivityManager.MemoryInfo`, battery with `BatteryManager`.
- [ ] Router rule for phones: local only for models <= 3B and when RAM fits, else BYOK.
- [ ] Build with Flutter at `C:\flutter\bin`, install with `adb` from `C:\android-sdk\platform-tools`. Test on a real phone.

Acceptance: on a real Android phone, the app completes a small coding task in BYOK mode, and in remote mode against a team laptop.

### Phase 9. Evaluation and demo (everyone)

- [ ] Build an eval set of 30 to 50 small coding tasks with tests (fix a bug, add a function, write a test). Each task passes or fails by running its tests.
- [ ] Run each task with: local model alone, local model + Laya, BYOK model. Record pass rate, time and tokens.
- [ ] This table is the evidence for the pitch claim "Laya makes small models better". Without it, do not make the claim.
- [ ] Demo script: offline laptop (Wi-Fi off) fixes a bug end to end, router picks the model live, mode switch to BYOK, phone demo.
- [ ] Record a backup demo video in case the live demo fails.

## 6. Repository layout after Phase 1

```text
C:\Projects\ghostcode\
  README.md
  docs\
    IMPLEMENTATION_PLAN.md
    research\R1..R3, hardware.md, baseline.md, config-tree.txt
  harness\                         fork of deepseek-harness, Customizeed
    packages\ghostcode\
      bundle\                      mounts all GhostCode plugins
      hello\                       wiring check
      profiler\                    RAM, VRAM, CPU, disk, battery
      router\                      local vs BYOK, model choice
      ollama\                      ctx.llm adapter for Ollama
      models\                      pull, list, delete, catalog
      byok\                        OpenAI-compatible provider + key handling
      laya\                        sidecar manager + decision hooks
      web\                         web_search, web_fetch
  mobile\                          Flutter app (Phase 8)
  eval\                            task set and runner (Phase 9)
```

## 7. Working rules

- Branch per feature (`feat/ollama-adapter`), PR into `ghostcode/main`, one reviewer.
- Every PR runs the full test suite. No drop below the Phase 1 baseline.
- Bug fix = regression test that fails before the fix.
- Before using any API (Ollama, the harness, Laya, Flutter plugins), read its current docs. Write the doc link in the PR.
- Merge `upstream/master` weekly. Fewer edits in `packages/core` means fewer conflicts.
- Nothing claims "works" until it ran on a real machine. Write what was tested in the PR.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The upstream harness is a developer preview with breaking changes | Upstream merges break our plugins | Pin an upstream commit; merge on a schedule, not daily |
| Renamed internals conflict with upstream | Every upstream merge needs manual fixes | Keep a rename script so upstream changes can be renamed the same way before merging |
| Small models fail at tool calling | Agent loop stalls | R2 tool-call table; JSON-schema fallback; Laya decides retries; BYOK escalation |
| Memory estimate wrong | Out-of-memory crash on load | Validate against `/api/ps`; safety margins; catch load errors and step down one model size |
| Laya base accuracy on coding decisions is low (base 0.362 on typed decisions) | Bad routing | Fine-tune on our own data; thresholds; Laya can be turned off |
| No Ollama on Android | Phone local mode blocked | Remote mode and BYOK first; llama.cpp later |
| API keys leak into logs | Security issue | Keychain storage; log-grep test |
| Hackathon time | Unfinished features | Order of value: Phases 1, 3, 4 and 5 make the demo. 6 and 7 add the edge. 8 is a bonus |

## 9. Minimum demo (if time runs out)

1. GhostCode web UI, Customizeed.
2. Ollama adapter working, offline, with one local coding model.
3. Profiler + router picks the model and shows why.
4. BYOK switch.
5. One Laya decision point (task done or not) working and logged.

## 10. Laya plugin (install on demand)

Laya ships inside GhostCode as the `@deepseek-ai/dsh-laya` plugin
(`harness/packages/extensions/laya`), but nothing is downloaded or started until
the user asks for it.

### Flow

1. **Not installed (default).** The composer shows a brain button. Clicking it
   opens a small popover: "Laya decision engine, about 700 MB, runs locally" with
   an Install button. No Python, model or sidecar exists on disk yet.
2. **Install (user click only).** The plugin runs `uv venv --python 3.12` in
   `~/.ghostcode/laya/.venv`, then installs `laya[serve]` with CPU-only torch
   (`--extra-index-url https://download.pytorch.org/whl/cpu`). Measured on a
   16 GB Core Ultra 5 laptop: 70 s and 684 MB. Progress and errors stream through
   the plugin's `status()` remote.
3. **On.** The brain button turns decisions on. The plugin starts `laya-serve`
   bound to `127.0.0.1` on a random port with a random bearer key
   (`LAYA_HOST`, `LAYA_PORT`, `LAYA_API_KEY`). It never binds `0.0.0.0`.
4. **Off.** The sidecar stops and the hooks pass straight through.
5. **Uninstall.** Removes `~/.ghostcode/laya`.

The on/off choice is a live setting (`enabled`, default `false`) saved in the
profile. Laya works the same with BYOK and local models, because it hooks the
agent loop, not the model adapter.

### Decisions (first two)

| Hook | Question | Type | Action |
|---|---|---|---|
| `agent/turn-stopping` | Is the user's request fully done? | noul | Below threshold: continue once with a short "verify and finish" nudge |
| `tools/post-execute` | Did this command succeed? | noul | Logged; feeds the retry decision next |

Each call has an 800 ms budget. On timeout, error or a missing sidecar the hook
abstains and calls `next()`, so Laya can never stall or break a turn. Every
decision (question, probability, latency, action) goes to an in-memory buffer
(`decisions()` remote) and to `~/.ghostcode/laya/decisions.jsonl`.

### Benchmark: with and without Laya

Same task, same model, same machine, run twice: Laya off, then Laya on. Record
pass or fail, total time, API calls, tool calls, input and output tokens, tok/s
(from the per-turn stats row), the number of Laya decisions, and Laya overhead in
ms (from `decisions.jsonl`). Results go in `docs/research/benchmarks.md`.

### Known limits

- Base checkpoints score 0.34 to 0.36 zero-shot on typed decisions, below the
  0.461 majority baseline (R3). Expect little or no gain until we fine-tune on our
  own logged decisions; the benchmark must report that honestly.
- CPU latency is 192 to 453 ms per call with 4 questions, so only the two hooks
  above wait for Laya.
- Next: fine-tune on `decisions.jsonl` labels, then add the escalate-to-cloud and
  destructive-command decisions.
