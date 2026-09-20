# Optional Codex native listener setup

Ordinary discovery and default CLI queue delivery need no listener setup.

Verified for Codex 0.154.0: ordinary CLI starts reuse an existing default listener; without one they use an embedded server. CLI configuration overrides and profiles can prevent reuse. A later listener does not adopt open embedded sessions or the Desktop stdio server.

For explicitly requested managed setup, the Codex package includes `../../../setup-listener.ps1` relative to this reference directory. Its default mode only previews changes. `-Apply` installs pinned Codex 0.154.0 through a checksum-verified official installer if missing, keeps npm installed, updates the user PATH for the standalone CLI and starts the stock local daemon.

Windows requires a non-administrator terminal permitting detached processes; the Desktop tool shell tested here does not. Setup does not request remote control, bootstrap, an updater or Windows autostart. Do not apply it as an implicit delivery repair.

`ASM_CODEX_SOCKET` may select an already existing local control socket. It does not create one or move a thread. A CLI can attach on a new start or resume after its previous owner exits; never force a locked thread.
