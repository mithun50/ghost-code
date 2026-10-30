# AGENTS.md

Instructions for coding agents working in this repository.

## What this is

GhostCode is an offline-first coding agent, forked from DeepSeek Harness (MIT). Everything runs from `harness/`. GhostCode's own features are plugins; do not edit the agent loop to add them.

- Architecture and diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- The privacy and escalation hurdle: [docs/HURDLE.md](docs/HURDLE.md)
- Measured numbers: [docs/BENCHMARK.md](docs/BENCHMARK.md)
- Harness internals: `harness/docs/` and each package's README

## Commands

Run from `harness/`. Node 24.9+ and pnpm 11.

```
pnpm install
pnpm run build                                   # full build; run after source changes before `ghostcode web`
pnpm exec tsx scripts/build.ts --scope artifacts --serial   # lighter build on low-memory machines
pnpm ghostcode web                               # web UI on 127.0.0.1:3080
pnpm ghostcode kill                              # stop the Host, the model server and Laya
node_modules/.bin/tsc -b packages/<group>/<name> # type-check one package
pnpm exec vitest run packages/<group>/<name>     # test one package
```

`pnpm ghostcode web` serves the built output. Source edits do nothing until you rebuild.

## Where GhostCode code lives

| Package | Purpose |
|---|---|
| `packages/extensions/local-models` | llama.cpp server manager, pinned model catalog, system scan, privacy guard, short local prompt |
| `packages/extensions/laya` | Laya install, sidecar, decision hooks, benchmark in `bench/` |
| `packages/client/ui-model-selection` | Local tab and model menu |
| `packages/client/ui-laya` | Laya button, decision chip, privacy shield panel |
| `packages/client/ui-conversation` | Hero and the hand-off into chat |
| `packages/client/connection` | Stays connected to a local Host with no internet |
| `packages/api/gateway` | Idle shutdown when no browser is connected |
| `apps/cli/src/kill.ts` | Kill switch |

## Rules

- Keep the hooks pattern. New behaviour goes in a plugin hook (`agent/pre-step`, `llm/stream`, `tools/pre-execute`, `tools/post-execute`, `agent/request-error`, `agent/turn-stopping`).
- Never send secrets to a cloud model. Anything that builds a cloud request must go through `cleanRequest` in `local-models/src/guard.ts`.
- Escalate to the cloud only on evidence (failed checks), never on how hard a task looks.
- Pin every download by revision, size and SHA-256 (see `local-models/src/catalog.ts`).
- Every child process must die with the Host: kill process trees, record the owning Host's pid.
- Browser Remote method names must not collide with names the gateway reserves (`install`, `start`, `stop`, `remove`, `ctx`, `name`, `namespace`, ...). Prefix them.
- Client code that calls a Remote namespace must run in a scope that injects it (`ctx.inject(['remote.<ns>'], ...)`).
- Tests sit next to each package in `tests/`. Add one for every behaviour change.

## Writing style for UI copy and docs

- Plain, short sentences. No emojis. No em dashes or en dashes.
- Generated websites follow the design rules in `local-models/src/local-prompt.ts`: minimal, solid neutral colors, one muted accent, no gradients or glow.
