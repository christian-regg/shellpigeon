# Contributing

The initial target is native Windows, ordinary Claude Code and Codex CLI sessions under one user. Please discuss new hosts, background services or changes to delivery semantics before broadening that scope.

Use Node.js 22.16 or newer. Run `npm ci --ignore-scripts`, then `npm test`, `npm run package` and `npm run release:verify`. Real-host installation checks use `npm run package:verify` in temporary profiles and require both CLIs. Live native roundtrip probes start models and must be chosen explicitly.

Preserve exact target and return-address binding. Do not convert an uncertain send into an automatic retry or fallback. Distinguish transport acceptance from recipient processing. Keep session discovery read-only and do not inspect other sessions' transcript bodies for discovery.

Changes to packaging should include a focused check of install/update/uninstall behavior. Documentation and reversible presentation-only edits do not need tests that duplicate their implementation.

Contributions to ShellPigeon are provided under the [MIT License](LICENSE). Preserve applicable copyright notices and the license notices of any third-party code.
