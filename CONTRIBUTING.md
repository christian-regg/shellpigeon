# Contributing

The target is Windows and Linux, ordinary Claude Code and Codex CLI sessions under one user. WSL 2 tests use both hosts inside the same Linux distribution. Please discuss new hosts, background services or changes to delivery semantics before broadening that scope.

Use Node.js 22.16 or newer. Run `npm ci --ignore-scripts`, then `npm test`, `npm run package` and `npm run release:verify`. Real-host installation checks use `npm run package:verify` in temporary profiles and require both CLIs. Live native roundtrip probes start models and must be chosen explicitly.

On Windows, `npm run release:upgrade` checks the published `0.4.0-preview.7` → `0.5.0-preview.1` update using fresh downloads and SHA-256 verification. It installs and loads both versions in temporary profiles without model calls. See [published upgrade checks](docs/released-upgrade.de.md) for custom version pairs and the platform limit.

Preserve exact target and return-address binding. Do not convert an uncertain send into an automatic retry or fallback. Distinguish transport acceptance from recipient processing. Keep session discovery read-only and do not inspect other sessions' transcript bodies for discovery.

Changes to packaging should include a focused check of install/update/uninstall behavior. Documentation and reversible presentation-only edits do not need tests that duplicate their implementation.

Contributions to ShellPigeon are provided under the [MIT License](LICENSE). Preserve applicable copyright notices and the license notices of any third-party code.
