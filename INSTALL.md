# Install ShellPigeon (Windows preview)

This release connects ordinary local Claude Code and Codex CLI conversations. Keep using your existing CLIs. The installer configures their native plugin systems; it does not install a model runtime, listener, daemon, autostart entry or another Codex copy.

The public product name is **ShellPigeon**. The plugin/marketplace ID remains `agent-session-messaging`, the skill remains `session-messaging`, and private data stays under `AgentSessionMessaging`. Earlier previews can use the same update path; the new archive name does not require moving an existing installation.

## Requirements

- Native Windows, one operating-system user.
- Node.js 22.16 or newer, available as `node`.
- Codex CLI 0.154.0 or newer and/or Claude Code 2.1.278 or newer, already installed and signed in.
- Tested with Node 22.16.0, Codex 0.154.0 / 0.155.1 and Claude Code 2.1.278. Later versions may change the local protocols.

## Install

1. Download `shellpigeon-<version>-windows.zip` from [GitHub Releases](https://github.com/christian-regg/shellpigeon/releases). Its adjacent `.sha256` file gives the archive checksum (`Get-FileHash -Algorithm SHA256 <zip>`). Checksums detect corruption; they are not a publisher signature.
2. Extract it to a **permanent directory**, for example `$env:LOCALAPPDATA\ShellPigeon\distribution`. Keep hidden `.agents`, `.claude-plugin` and `.codex-plugin` directories when extracting or copying.
3. Close the CLI conversations you plan to restart. In a normal PowerShell in the extracted directory:

```powershell
node .\install.cjs --check
node .\install.cjs
```

Use `--host claude` or `--host codex` on both commands to install only one host. The default is both. `--check` verifies the release and reads installed host versions and plugin inventories. Installation adds the dedicated `agent-session-messaging` marketplace and enables the plugin for your user through each host's CLI. Codex's bundled `setup.cjs` records the permanent Node and MCP paths inside this package.

Restart the selected CLIs and start new conversations to load the skill. Ask “List the other Claude and Codex sessions”, or “List all sessions across projects”. In a brand-new empty Codex conversation, first send an ordinary message such as “Reply only with OK”; queue discovery needs its saved thread metadata.

Then ask to send a message to an exact address from the list. Claude replies are delivered directly when its inbound policy allows them. Without an existing native Codex endpoint, Codex receives ordinary queued user input in a separate turn. A busy CLI finishes its turn first; a closed/interrupted CLI must be resumed. A send receipt does not prove the recipient read the message.

## Update and repair

Keep the same permanent directory. Back up its program files, close affected CLI sessions, and extract the complete new ZIP over it. Run `node .\install.cjs --check`, then `node .\install.cjs`. Restart the CLIs. The installer verifies the exact packaged version, invokes the host update/install commands and regenerates Codex's local paths. Rerunning after an interrupted install is supported; the installer reports which hosts completed. It does not roll back a successful first host if the second fails.

A checksum mismatch means re-extract the complete release before retrying. If Node moved, rerun with the new `node`. If the permanent directory moved, explicitly remove the old plugin and marketplace registrations using the commands below, then install from the new location. Do not remove private mailbox data to repair installation.

An existing installation of the same plugin from `personal`, `agent-session-messaging-local` or another marketplace is reported as a conflict before changes. Migrate deliberately: remove the old **plugin** using its exact ID in that host, then run this installer. Leave a shared personal marketplace in place. Our development installation is not automatically migrated.

## Uninstall

From the permanent release directory:

```powershell
node .\install.cjs --uninstall
```

Use `--host codex` or `--host claude` to choose one host. Private mailbox data and release files are retained. To also remove this release's dedicated marketplace registrations:

```powershell
codex plugin marketplace remove agent-session-messaging
claude plugin marketplace remove agent-session-messaging
```

If the release directory is already missing, remove its plugin directly:

```powershell
codex plugin remove agent-session-messaging@agent-session-messaging
claude plugin uninstall agent-session-messaging@agent-session-messaging --scope user --keep-data
```

Only after uninstalling both hosts, remove the extracted release directory if desired. Private data under `%LOCALAPPDATA%\AgentSessionMessaging` (or `BRIDGE_DATA_DIR`) is separate; do not delete the parent directory as part of removing program files.

## Scope and limits

Windows CLI support is the preview scope. A writer lock is only a candidate, not proof that a recipient is open. Native Codex delivery needs an endpoint that already owns the thread. Desktop/editor queue processing, macOS/Linux/WSL integration and managed listener installation are not release guarantees. No manual inbox polling is needed for normal Claude IPC replies. The legacy durable mailbox tools are a separate optional workflow.

The helper requests normal host access when shell sandboxing prevents local IPC or metadata access. It does not change your CLI approval policies. More details: [CLI operation](docs/codex-cli-operation.de.md), [test evidence](docs/native-integration.de.md), [optional mailboxes](docs/installed-plugin.de.md).

## License

ShellPigeon uses the [MIT License](LICENSE). The release root and both plugin packages include `LICENSE`; bundled dependency licenses are included separately in `THIRD-PARTY-NOTICES.txt`.
