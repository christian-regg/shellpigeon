# Phase 2: Normale Plugin-Nutzung

Stand: 17. September 2026, Version 0.2.0, Windows.

## Ergebnis

Die Plugins sind auf dem Entwicklungsrechner in Claude Code und Codex installiert und aktiviert. Der Benutzer kann die Hosts wie gewohnt öffnen. npm-Session-Launcher und ein separates Broker-Terminal werden für die normale Nutzung nicht mehr benötigt.

Der erste Werkzeugaufruf startet bei Bedarf einen unsichtbaren Hintergrund-Broker. Die sieben MCP-Werkzeuge und die manuelle Postfachanmeldung bleiben unverändert. Es wurde ausdrücklich kein Automatikmodus für Modell-Turns und keine eigene Codex-Oberfläche implementiert.

## Nachweise

| Prüfung | Ergebnis |
|---|---|
| Automatisierte Tests | 14 bestanden |
| Sechs parallele Adapter aus kopierten Paketen | Gemeinsamer Broker und sechs getrennte Postfächer |
| Erzwungener Broker-Absturz | OS-Sperre freigegeben; nächster Aufruf startet neu; Nachricht und Handles bleiben erhalten |
| Broker-Leerlauf und erneuter Start | Prozess beendet sich; Geheimnis bleibt erhalten |
| Start unmittelbar nach Shutdown-Anforderung | Neuer Broker wird gefunden/gestartet |
| Lebende alte Broker-PID | Kein Verdrängen und kein ungeprüftes Löschen der Sperrdatei |
| Zukünftiges Datenbankschema | Start verweigert, Versionsnummer nicht überschrieben |
| Codex-Setup aus einem fremden Arbeitsordner | Pfade zeigen auf das kopierte Plugin; Arbeitsordner wird nicht auf das Plugin umgestellt |
| Claude Plugin-Validierung | Bestanden |
| Codex Plugin-Creator-Validierung | Bestanden |
| Skill-Validierung | Bestanden |
| Installiertes Claude-Plugin | Normales `claude mcp list` meldet `Connected` |
| Installiertes Codex-Plugin, npm-CLI 0.154.0 | App Server erkennt alle sieben Werkzeuge |
| Installiertes Codex-Plugin, Desktop-Binary 0.155.0-alpha.2.6 | App Server erkennt alle sieben Werkzeuge |

Claude Code: 2.1.274. Node: 22.16.0. Die Host-Prüfung verwendet keine MCP-Konfigurationsinjektion, keine Session-Launcher und keine Modellaufrufe. Der Codex-Prüfthread ist ephemer und erhält keinen Turn. Ein eigener automatisierter Modelltest im Desktop-Frontend wurde nicht durchgeführt. Anschließend hat der Benutzer die installierten Plugins erfolgreich mit echten Sessions getestet und dies am 17. September 2026 bestätigt.

## Gefundener Paketierungsfehler

Codex 0.154.0 übergab `${PLUGIN_ROOT}/dist/mcp.cjs` und auch `${CLAUDE_PLUGIN_ROOT}/dist/mcp.cjs` wörtlich an Node. Die betreffenden Variablen waren im MCP-Prozess ebenfalls nicht gesetzt. Dadurch war das Plugin sichtbar, sein MCP-Server aber nicht startfähig. Die früheren Prüfungen mit direkten absoluten Pfaden konnten das nicht erkennen.

Das Codex-Paket enthält deshalb `setup.cjs`. Es wird nach dem Kopieren an den dauerhaften Installationsort einmal ausgeführt und trägt Node- und MCP-Pfad in `.mcp.json` ein. Die anschließende native Plugin-Installation wurde auf beiden Codex-Versionen erfolgreich geprüft. Bei Verschieben der lokalen Plugin-Quelle müssen Setup und Plugin-Installation wiederholt werden. Die lokale Quelle bleibt damit Teil der Installation.

Für Updates wurde der dokumentierte Plugin-Creator-Cachebuster verwendet. Installierte Codex-Version: `0.2.0+codex.20260917093403`.

## Lokale Installation

- Codex: `agent-session-messaging@personal`, persönliche Marketplace-Datei `%USERPROFILE%\.agents\plugins\marketplace.json`.
- Codex-Quelle: `%USERPROFILE%\plugins\agent-session-messaging`.
- Claude: `agent-session-messaging@agent-session-messaging-local`, Benutzerscope.
- Claude-Quelle: `%LOCALAPPDATA%\AgentSessionMessaging\plugin-sources\claude-marketplace`.
- Beide behalten private Daten im gemeinsamen Datenverzeichnis, unabhängig vom Repo und den Plugin-Caches.

Andere Plugin-Einträge und bestehende Host-Konfigurationen wurden nicht ersetzt. Es erfolgte keine Veröffentlichung und keine Änderung von Tool-Freigaben.

## Grenzen und nächste Schritte

Ein allgemeiner plattformübergreifender Installer, ein öffentliches Release und eine mitgelieferte Node-Runtime stehen noch aus. Node ab 22.16 muss installiert bleiben. Windows nutzt bislang geerbte ACLs.

Die Hintergrund-Startsperre schützt den Broker-Prozess; sie ist keine Verarbeitungs-Lease für mehrere Leser desselben Postfachs. Nachrichtenzustellung bleibt Pull, und die automatische Bindung an native Gesprächs-IDs ist nicht umgesetzt.

Die Anleitung für Alltag, Diagnose, Updates und Deinstallation steht in [Installiertes Plugin verwenden](installed-plugin.de.md).
