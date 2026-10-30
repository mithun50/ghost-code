# GhostCode

An offline-first AI coding agent for laptops and phones. GhostCode runs open
models locally through Ollama when the hardware allows, and switches to your own
API key (BYOK) when it does not.

GhostCode is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT). It is not affiliated with or endorsed by DeepSeek. The upstream README is
kept in `README.upstream.md`.

## Developer preview

GhostCode is in developer preview and changes quickly. Expect breaking changes.
Read the [safety notice](SAFETY.md) before running it.

## Run from source

```powershell
pnpm install
pnpm run build
pnpm ghostcode web
```

`pnpm run build` prepares the repository artifacts. `pnpm ghostcode web` uses
those artifacts without rebuilding, starts the Web UI at `http://127.0.0.1:3080`,
and opens it in your default browser. Pass `--no-open` to start the server
without opening a browser. See the [Web UI guide](docs/user/guide/index.md).

- Commands: `ghostcode`, short alias `ghost`
- Home directory: `~/.ghostcode`, override with `GHOSTCODE_HOME`

## Development

Start with the [development guide](docs/development.md) and the
[architecture documentation](docs/architecture.md). Agents follow
[AGENTS.md](AGENTS.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in
one terminal. `make help` lists the matching Make targets for Web and Desktop.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Third-party dependencies and their licenses are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
