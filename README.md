# ShellPigeon

**Local messaging between Claude Code and Codex sessions.**

Exchange messages between ordinary local CLI sessions on Windows and Linux (including Ubuntu under WSL 2).

Start your CLIs as usual, ask to list the other sessions, then send a message to an exact address from that list. No extra terminal, special launcher or mailbox registration is needed for this workflow.

**Status: 0.5.0-preview.1 — Windows and Linux preview.** Licensed under [MIT](LICENSE). [Deutsche Dokumentation](docs/codex-cli-operation.de.md)

## Delivery

| Recipient | Delivery |
|---|---|
| Claude Code | Its existing local IPC endpoint; inbound policy may require confirmation. |
| Codex CLI with a reachable native endpoint | Native attributed delegation; can arrive during an active turn. |
| Codex CLI without a native endpoint | Automatic fallback to `codex queue`, processed as ordinary user input in a separate turn. |

Messages include the exact return address. A transport receipt does not prove that the recipient read or completed the request. Uncertain sends are not automatically retried.

## Install

ShellPigeon is the public name. The plugin and marketplace IDs remain `agent-session-messaging` for compatibility with earlier previews; installed skill names and private data paths stay the same. Release archives use `shellpigeon-<version>-windows.zip` and `shellpigeon-<version>-linux.tar.gz`.

Use the Windows ZIP or Linux tar.gz from [GitHub Releases](https://github.com/christian-regg/shellpigeon/releases) and follow [INSTALL.md](INSTALL.md). Requirements: Node.js 22.16+, Codex CLI 0.154.0+ and/or Claude Code 2.1.278+, installed separately. Keep the extracted directory at a permanent location:

```powershell
node ./install.cjs --check
node ./install.cjs
```

Use `--host codex` or `--host claude` to select one host. The installer uses each host's native plugin commands. It detects conflicting previous installations and does not silently add duplicate plugins. Restart your CLIs after installation or updates.

These commands run from the extracted **release archive**, not the source checkout. To build a release from source, see Development below. Python and local Codex development skills are not required to install the release.

## Use

Ask your session naturally:

- “List the other Claude and Codex sessions.”
- “List all sessions across projects.”
- “Send the build result to `codex:<exact thread ID>`.”
- “Reply to the sender with the test result.”

A fresh empty Codex conversation may not be discoverable via the queue until its **first normal user message** has created saved metadata. Send a short message there, then refresh the list. Use “all sessions” when the projects differ.

The installed skill locates the bundled helper. For direct diagnosis from an installed plugin directory:

```powershell
node ./dist/peer.cjs list --all
node ./dist/peer.cjs doctor
```

Only exact addresses, exact IDs or unique exact names are accepted. Peer messages do not grant user permissions. Claude IPC replies arrive directly when policy allows them; normal peer messaging does not use mailbox polling.

## Scope and limits

- Native Windows or Linux, one operating-system user, local sessions. Under WSL 2 both CLIs must run inside the same Linux distribution. Windows-to-WSL, cross-distribution, macOS and remote-host messaging are outside this preview.
- A Codex writer lock identifies a queue candidate; it may belong to a closed session. Resume a closed or interrupted CLI before expecting queued work to run.
- A saved `vscode` source can mean Desktop/editor or a CLI attached to an app-server; it does not prove the current UI. Desktop queue dispatch is unverified.
- Native Codex delivery requires an existing endpoint that owns the thread. The helper does not start a daemon or adopt an already running embedded CLI.
- The optional managed listener script is an advanced experimental path, not an installation prerequisite. Its full Windows lifecycle has not passed on this development host.
- Existing host approval and inbound-message policies apply.

The earlier durable mailbox tools remain available as a separate optional workflow. Their broker, retention and pull semantics are described in [the mailbox guide](docs/installed-plugin.de.md). They are not the default session-discovery or reply mechanism.

## Development and verification

From the source checkout:

```powershell
npm ci --ignore-scripts
npm test
npm run package
npm run release:verify
npm run package:verify
```

The last command needs both host CLIs but no model calls. It extracts the platform archive into temporary directories, exercises the real installer and cleans up the isolated host profiles. It does not update personal installations. Add `-- --native-roundtrip` only when explicitly choosing live model tests.

- **60 automated tests** cover messaging, identity, queue/native failure handling, storage and installation guards.
- Archive installation, repeat install, a synthetic prior-version update, repair and uninstall passed with Codex 0.155.1, Claude Code 2.1.278 and Node 22.16.0 on Windows and Ubuntu/WSL 2.
- On Windows, `npm run release:upgrade` verifies the real published `0.4.0-preview.7` → `0.5.0-preview.1` update, including host loading before and after the update. [Repeat the check](docs/released-upgrade.de.md).
- Installed-package live probes on Windows and Linux cover native idle/busy Codex delivery and exact Claude return routing. An ordinary CLI roundtrip using Codex queue and Claude IPC was also confirmed by the user.
- [Linux scope and verification](docs/linux-support.de.md); [Detailed evidence and limits](docs/native-integration.de.md); [release preparation](docs/release-preparation.de.md).

`npm run publication:audit` checks intended source files and reachable Git history for a limited set of credential patterns. It is not a complete secret audit. [GitHub Actions](https://github.com/christian-regg/shellpigeon/actions/workflows/windows.yml) runs the Windows and Ubuntu test/build checks without signed-in CLIs or model calls.

Release artifacts include `release.json` file hashes, bundled third-party license texts and an archive SHA-256. Checksums detect corruption and are not publisher signatures. No Node or host CLI binaries are redistributed.

## Project status

The release ZIP and sanitized source snapshot can be prepared locally. The GitHub repository is [christian-regg/shellpigeon](https://github.com/christian-regg/shellpigeon), licensed under MIT. The public history starts from a sanitized source snapshot. Dependency license texts are generated from the actual bundled source graph. See [release preparation](docs/release-preparation.de.md) for the remaining publication decisions.

## License

ShellPigeon is licensed under the [MIT License](LICENSE). Bundled dependencies retain their own licenses; release packages include their full texts in `THIRD-PARTY-NOTICES.txt` and an inventory in `BUNDLED-DEPENDENCIES.json`.
