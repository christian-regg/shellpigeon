# Update zwischen veröffentlichten Versionen

Stand: 20. September 2026. Der reale Windows-Wechsel von `0.4.0-preview.7` auf `0.5.0-preview.1` ist mit Codex CLI 0.155.1, Claude Code 2.1.278 und Node 22.16.0 bestanden.

## Ausführen

Im Quell-Checkout mit installierten Node-Abhängigkeiten sowie beiden Host-CLIs:

```powershell
npm run release:upgrade
```

Dieser Befehl baut den Prüfer und lädt die beiden unveränderten Windows-ZIPs samt ihren SHA-256-Dateien aus den öffentlichen ShellPigeon-Releases. Er erstellt eigene temporäre Profile mit Leerzeichen und Umlaut im Pfad. Persönliche Profile und Anmeldungen werden nicht verwendet; es gibt keine Modellaufrufe und keinen Nachrichtenversand.

Andere veröffentlichte Versionspaare lassen sich nach `npm run build` ausdrücklich wählen:

```sh
npm run package:verify -- --from-release 0.4.0-preview.7 --to-release 0.5.0-preview.1
```

Beide Versionen müssen ein Paket für das ausführende Betriebssystem besitzen. Der oben genannte historische Wechsel ist nur unter Windows möglich: `0.4.0-preview.7` hatte kein Linux-Paket. Für Linux bleibt der lokale Pakettest mit synthetischer Vorgängerversion bestehen; ein späterer echter Linux-Update-Test benötigt zwei veröffentlichte Linux-Versionen.

## Nachweise

- Download von Originalarchiven und passenden Prüfsummen aus dem festen Projekt-Repository; beschädigte Archive, falsche Dateinamen und fehlende Plattformpakete werden abgewiesen.
- Installation und wiederholte Installation der echten Vorgängerversion.
- Vor dem Update: Beide Hosts melden die alte Version; installierte Helfer und Skills stimmen mit dem alten Paket überein. Claude verbindet seinen MCP-Server, Codex lädt den Skill und die sieben optionalen MCP-Werkzeuge.
- Update im gleichen permanenten Testverzeichnis mit dem Installer aus dem neuen Archiv. Die Vorprüfung erkennt die tatsächlich installierte Vorgängerversion.
- Nach dem Neustart des Test-App-Servers: Beide Hosts melden die neue Version; Helfer, Skills und Host-Anbindung werden erneut gegen das neue Paket geprüft.
- Private Testdaten bleiben über Update und Deinstallation erhalten; die Reparatur der generierten Codex-Pfade besteht ebenfalls.
- Eigene Prozesse werden geschlossen, die temporären Profile und Archive werden entfernt. Ein unerwarteter Mailbox-Broker gilt als Fehler.

Der Bericht liegt lokal unter `artifacts/release-upgrade-probe.json` und enthält Versionsnummern, öffentliche Downloadadressen, geprüfte SHA-256-Werte und die Ergebnisse vor/nach dem Update. Er wird nicht eingecheckt. Der normale `npm run package:verify` bleibt der separate Test für ein lokal gebautes Paket und seine synthetische Vorgängerversion.

Der Nachweis deckt Paketinstallation und Host-Laden ab. Er ist kein neuer Nachrichten-Rundlauf und keine Garantie für beliebige historische Versionen oder manuell veränderte Installationen.
