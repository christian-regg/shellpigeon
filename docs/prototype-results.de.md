# Ergebnisse des ersten Integrationsprototyps

Stand: 17. September 2026. Lokal unter Windows geprüft.

## Umgesetzt

- Lokales Git-Repository auf `main`.
- TypeScript-Projekt mit gepinnten Dependencies und Lockfile.
- Ein Loopback-HTTP-Broker mit SQLite; Zugriff über Installationsgeheimnis und private Postfach-Handles.
- Zwei separat paketierte MCP-Adapter mit sieben Werkzeugen und gemeinsamen Skill-Anweisungen.
- Explizite Postfachanmeldung statt einer unbewiesenen Zuordnung über MCP-Prozess, Namen oder Arbeitsverzeichnis.
- Idempotentes Senden und Bestätigen, Antworten mit Konversationsbezug, Projekt-/Provider-Zuordnung.
- Startskripte, lokale Demo, Host-Prüfung und Tests.

Der erste Aufbau verwendet bewusst ein einziges TypeScript-Paket. Die im Architekturentwurf vorgesehenen Paketgrenzen sind bereits als Module erkennbar. SQLite ist über Node eingebunden; native npm-Builds und Bun sind nicht erforderlich.

## Nachweise

| Prüfung | Ergebnis |
|---|---|
| TypeScript-Build | Erfolgreich |
| Store-, CLI-, Launcher- und MCP-Tests | 10 bestanden |
| Zwei separate MCP-Prozesse | Nachricht und Antwort erfolgreich |
| Eigenständige Plugin-Bundles | Aus temporären Verzeichnissen mit Leerzeichen und Unicode gestartet, ohne Repo-Dependencies |
| Gleicher Ordner / gleicher Anzeigename / gemeinsamer Adapter | Verschiedene Handles ergeben verschiedene Postfächer |
| Broker- und Adapter-Neustart | Bereits angebotene, unbestätigte Nachricht wieder abrufbar |
| 12 parallele identische Sendewiederholungen | Genau ein gespeicherter Nachrichtendatensatz |
| Falscher Empfänger / fremdes Projekt / falscher Provider | Zugriff verweigert |
| HTTP ohne Authentisierung / mit Browser-Origin | Abgelehnt |
| Native Claude-Plugin-Validierung | Erfolgreich |
| Codex-Plugin-Creator-Validierung | Erfolgreich |
| Skill-Validierung | Erfolgreich |
| Claude `mcp list` | Gebündelter Server als `Connected` erkannt |
| Codex App Server | Sieben MCP-Werkzeuge im Inventar eines temporären Threads erkannt |
| npm-Audit der Laufzeitabhängigkeiten | Keine gemeldeten Schwachstellen zum Prüfzeitpunkt |

Host-Versionen: Claude Code `2.1.274`, Codex Desktop-Binary `0.155.0-alpha.2.6` und npm-CLI `0.154.0`, Node `22.16.0`. Der Launcher wurde nach einem Praxistest korrigiert: npm-Shims werden erkannt, ohne eine `codex.exe` im Suchpfad vorauszusetzen. Die erneute Host-Prüfung mit der npm-CLI erkannte alle sieben Werkzeuge.

Die Host-Prüfung nutzt Kindprozesse mit eigenen temporären Konfigurationsverzeichnissen. Sie verbindet die absoluten Pfade der fertigen MCP-Bundles direkt. Das beweist noch nicht die Installation über beide Marketplaces oder die Pfadsubstitution in einem installierten Plugin. Die Manifestformate wurden separat validiert. Bestehende Benutzereinstellungen wurden nicht verändert.

Die automatisierten Prüfungen enthielten keine Modellaufrufe; die Nachrichten in der Demo stammen von MCP-Testclients. Anschließend hat der Benutzer den Prototyp erfolgreich mit echten Sessions getestet (Bestätigung vom 17. September 2026). Damit ist der manuelle Austausch praktisch bestätigt. Automatisches Aufwecken ist damit noch nicht nachgewiesen.

## Erkenntnisse

1. **Explizite Identität funktioniert im gemeinsam genutzten MCP-Prozess.** Der Server führt keinen impliziten „aktuellen Benutzer“; jeder Toolaufruf trägt einen Capability-Handle. Eine spätere native Identitätsbindung muss zusätzlich beweisen, dass sie Forks und mehrere Desktop-Tasks unterscheidet.
2. **Persistenz und Empfang müssen getrennt sein.** Schreiben, Abrufen und ACK besitzen separate Zustände. Ein Empfänger-Neustart verliert angebotene Nachrichten nicht.
3. **Claude-Startoptionen sind kein Ersatz für MCP-Verwaltungskonfiguration.** Der Test mit `--mcp-config ... mcp list` zeigte kein Inventar. Ein MCP-Eintrag im isolierten Test-Konfigurationsverzeichnis wurde dagegen korrekt verbunden.
4. **Windows-Prozessbäume müssen vollständig beendet werden.** Nach App-Server-Prüfungen kann sonst das temporäre Datenverzeichnis gesperrt bleiben. Der Test beendet nur seinen selbst gestarteten Prozessbaum.
5. **Keine automatische Übernahme vorhandener Desktop-Threads belegt.** Die Codex-Prüfung erstellt einen ephemeren Thread im eigenen App Server und startet keinen Turn.

## Noch offen

- Native Session-/Thread-Bindung und automatische Wiederaufnahme ohne Handle im Gespräch.
- Hook-Kontext und Claude Channels/Monitore; sichere Push-Signale.
- Aufwecken kontrollierter Codex-Threads, anschließend Machbarkeit für vorhandene Desktop-Tasks.
- Reproduzierbarer automatisierter Modelltest mit begrenzter Aufgabe; der manuelle Test mit echten Sessions ist vom Benutzer bestätigt.
- Installierte Plugin-Pfadauflösung und Marketplace-Installation.
- Windows-ACL-Provisionierung, Retention/Purge, Session-Widerruf und belastbarer Autostart.
- Leases für mehrere konkurrierende Empfängerprozesse; automatische Loop-Budgets.
- Native Tests auf macOS/Linux sowie WSL-/Rechnergrenzen.

## Wiederverwendung

Die Recherche zu [agent-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp) zeigte einen Bun-basierten Aufbau und zusätzliche Annahmen rund um Launcher und Zustellung. Für den begrenzten Windows-Spike haben wir einen eigenen kleinen Node-Kern geschrieben. Es wurde kein Quellcode dieses Projekts übernommen. Das ist noch keine abschließende Entscheidung gegen spätere Wiederverwendung.

Die weitergehende Zielarchitektur bleibt im [Recherchebericht](architecture.de.md) dokumentiert. Dieser Prototyp deckt deren Postfach-Basis und einen Teil der Host-Kompatibilitätsprüfung ab; automatische Zustellung ist ausdrücklich noch nicht umgesetzt.
