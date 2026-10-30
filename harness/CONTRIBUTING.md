# Contributing

GhostCode is built by the Cozy Bears team. These rules keep the fork stable while
several people work on it at once.

## Workflow

- Work on a branch per feature (for example `feat/ollama-adapter`) and open a
  pull request into `ghostcode/main`. Every pull request needs one review.
- Run the full test suite on every pull request. The pass count must not drop
  below the recorded baseline.
- A bug fix comes with a regression test that fails before the fix.
- Add GhostCode features as plugins under `packages/ghostcode/`. Edit
  `packages/core/` only when a hook point is missing, so upstream merges stay
  small.
- Read the current docs of any API you use (Ollama, Laya, Flutter plugins) and
  link them in the pull request.
- Write what you tested, and on which machine, in the pull request. Nothing
  counts as working until it ran on a real device.

## Reporting issues

Open an issue with the steps to reproduce, the expected and actual result, your
OS, and the model you ran (local model tag or BYOK provider).

## Plugins

Most GhostCode features can live in plugins. If you publish a plugin, tag its
GitHub repository with the `ghostcode-plugin` topic so others can find it.
