# Changelog

## 0.4.0-preview.7 — 2026-09-20

- Fix intermittent Windows mailbox-broker startup failures when a discovery reader briefly holds `broker.json` open during atomic replacement.
- Retry only failed Windows rename operations with access/sharing errors, up to six retries and 630 ms of scheduled backoff. Keep the old file intact and report persistent failures.
- Add real-file regression tests for temporary and persistent read handles; existing exclusive token publication stays unchanged.

Validation: the temporary-reader regression fails before the fix and passes after it; 52 tests and 1,000 atomic replacements with periodic concurrent readers pass. See docs/windows-file-replacement.de.md for the bounded retry behavior.

## 0.4.0-preview.6 — 2026-09-20

- License ShellPigeon under MIT; include the project license in the source snapshot, release root and both host packages.
- Adopt **ShellPigeon** as the public product name, with the subtitle "Local messaging between Claude Code and Codex sessions."
- Use ShellPigeon in documentation, plugin descriptions, Codex display names, CLI help and outgoing peer message headings.
- Name release/source archives `shellpigeon-<version>-*.zip` and source snapshot directories `shellpigeon/`.
- Retain the `agent-session-messaging` plugin/marketplace IDs, skill names, transport identifiers and private data paths so existing previews keep their update path.

Validation: 50 automated tests, skill/plugin validation and isolated installation/update/repair/uninstall from the ShellPigeon ZIP passed without model calls.

## 0.4.0-preview.5 — 2026-09-20

- Add a Windows release installer using the existing host plugin commands, with preflight, repeat install, update, repair and data-preserving uninstall.
- Ship release ZIPs, file checksums and complete third-party license notices generated from the bundled dependency graph.
- Document empty Codex conversations before their first message in the skill and diagnosis output.
- Prepare public installation/contribution guidance and a Windows GitHub Actions check workflow.
- Pass 50 automated tests and isolated ZIP-based installation/update/repair/uninstall checks without model calls. Personal installations remain on Preview.4.
- Project license and GitHub publication target remain pending.

## 0.4.0-preview.4 — 2026-09-19

Windows preview for ordinary Claude Code and Codex CLI sessions.

- Discover local Claude processes and loaded Codex threads; show queue candidates separately.
- Deliver through Claude IPC or an existing native Codex endpoint, falling back to Codex queue before sending.
- Bind replies to the exact originating session and avoid automatic retries after an uncertain send.
- Explain session origin, evidence, current-session identity and transport-specific delivery receipts.
- Keep the optional durable mailbox workflow separate from ordinary session messaging.
- Package both hosts with shared skills and optional listener documentation.

Validation: 47 automated tests; isolated plugin installs; native idle/busy delivery probes; user-confirmed ordinary CLI roundtrip. Native Codex proofs used 0.154.0; installed preview checks also used 0.155.1. Claude Code 2.1.278 and Node 22.16.0 were used on Windows.

Known limits: Windows only; a writer lock does not prove an open recipient; a fresh empty CLI may need its first user message before queue discovery; native Codex needs an existing endpoint; Desktop queue dispatch is unverified. No general Windows daemon lifecycle claim.

## 0.3.0 — 2026-09-17

Optional durable mailboxes: atomic initialization, startup diagnostics, schema migration, retention and log rotation. See docs/phase-3-results.de.md.
