# Prüfergebnisse Version 0.3.0

Stand: 17. September 2026. Windows, Node 22.16.0.

## Umgesetzt

- Atomare Veröffentlichung von Token, Descriptor, Besitzerdatei und Codex-MCP-Konfiguration. Ein vorhandener ungültiger Token wird abgelehnt; bei vorhandenen Installationsdaten wird ein fehlender Token nicht neu erzeugt.
- Unterscheidbare Fehler für fehlende, beschädigte, unzugängliche und inkompatible Zustände. Der Adapter übernimmt konkrete Startfehler aus dem gestarteten Prozess. Nur Konkurrenz um den Broker-Besitzer führt zu begrenzten weiteren Startversuchen.
- `doctor` arbeitet auch offline: Dateibefunde, SQLite-Quick-Check, Schema, Besitzer, Aufbewahrungsregeln, Loggrößen und Broker-Zustand. Kein Start, keine Migration, keine Token-/Nachrichteninhalte.
- Transaktionale Migration von Schema 1 nach 2. Bestehende Nachrichten erhalten die volle konfigurierte Aufbewahrungsdauer ab Migration. Broker-Protokoll 2 verhindert unbemerkte Versionsmischung, auch bei deaktiviertem Autostart.
- Standardmäßig 7 Tage Texte und 30 Tage Nachrichtenmetadaten/Duplikatschutz. Konfigurierbar über `retention.json`; manueller Modus vorhanden. Identische Sendewiederholungen bleiben nach Textlöschung idempotent; Antwortbezüge bleiben als IDs erhalten.
- Bereinigung in begrenzten Durchläufen, Vorschau über `prune` und Anwendung nur mit `--apply`. Kein Wartungs-MCP-Werkzeug.
- Vier Logdateien mit höchstens je 1 MiB, ohne dauerhaft offene Log-Handles. Übernahme zu großer 0.2-Logs wird begrenzt.

## Nachweise

`npm.cmd test`: **28 Tests bestanden**. Gegenüber 0.2 sind 14 Tests hinzugekommen:

- konkurrierende Token-Erstellung, unterbrochene temporäre Datei, unverändertes Geheimnis bei Konflikt;
- beschädigter/verlorener Token und unmittelbar gemeldeter Startfehler;
- ungültiger Descriptor und nicht unterstütztes Protokoll ohne Startversuch;
- Offline-Diagnose, Exit-Codes und Vermeidung von Geheimnissen in der Ausgabe;
- Logrotation bei überlangen Unicode-/Escape-Einträgen und großen Altdateien;
- Diagnose/Stop eines alten Brokers, Ablehnung normaler Zugriffe einschließlich MCP mit `BRIDGE_AUTOSTART=0`;
- Migration einer gespeicherten v1-Schema-Fixture mit erhaltenen Identitäten, ACKs und Antwortbezügen;
- simuliertes Commit-Versagen mit vollständigem Transaktions-Rollback;
- tatsächliches Prozessende vor dem Migrations-Commit und erfolgreiche Wiederaufnahme;
- Schutz unversionierter bestehender Tabellen;
- Zeitgrenzen für Abruf, Textlöschung und Duplikatschutz einschließlich Vorschau;
- Antwortwiederholung nach Entfernung des ursprünglichen Metadatensatzes;
- Mengenbegrenzung pro Wartungsdurchlauf und Erhalt der Postfächer;
- automatische/manuelle Wartung mit Token- und Instanzprüfung.

Weiterhin bestehen unter anderem die bisherigen Tests für sechs gleichzeitig startende installierte Bundles, Wiederanlauf nach einem erzwungenen Broker-Absturz, Nachrichtenpersistenz, gemeinsame Adapter-Prozesse, Identitätsgrenzen und Windows-Launcher.

Die neuen Pakete wurden mit Claude Code 2.1.274 und Codex CLI 0.154.0 erkannt. Die tatsächlich installierten Plugins wurden anschließend ohne eingespeiste MCP-Konfiguration geprüft, sowohl mit Codex CLI 0.154.0 als auch mit dem Desktop-Binary 0.155.0-alpha.2.6: Claude meldet die Verbindung, Codex sieht alle sieben Werkzeuge. Es wurden dabei keine Modell-Turns gestartet.

Codex-Plugin- und Skill-Validator sowie Claude-Plugin-Validator bestehen. Die Claude-Marketplace-Prüfung besteht mit einem kosmetischen Hinweis auf die fehlende Marketplace-Beschreibung.

## Lokales Upgrade

Beide bestehenden Plugin-Installationen wurden auf 0.3.0 aktualisiert; Codex verwendet zusätzlich den Entwicklungs-Cachebuster. Die dauerhaften Plugin-Quellen bleiben an ihren bisherigen Orten.

Vor dem Upgrade wurde die private SQLite-Datenbank unter exklusiver Broker-Besitzersperre konsistent mit `VACUUM INTO` gesichert; Original-Token und Descriptor wurden mitkopiert. Die Sicherung liegt unter:

~~~text
%LOCALAPPDATA%\AgentSessionMessaging\backups\before-0.3-2026-09-17T19-20-57-883Z
~~~

Der installierte Broker hat das Schema auf 2 migriert. Der anschließende Vergleich mit der Sicherung bestätigt: Original-Token, sämtliche bisherigen Sessions und sämtliche bisherigen Nachrichtenfelder sind unverändert erhalten. Die neue Aufbewahrungsfrist beginnt für diese Nachrichten bei der Migration. `doctor` meldete `ready` und Integrität `ok`; `prune` zeigte null fällige Texte und Metadatensätze. Es wurde keine manuelle Bereinigung der privaten Daten ausgeführt.

Die Sicherung enthält private Daten und wird von der Nachrichtenbereinigung nicht gelöscht. Sie ist ein lokaler Upgrade-Nachweis, kein implementierter allgemeiner Backup-/Restore-Dienst.

## Verbleibende Grenzen

Kein neuer Testdialog echter Modelle für 0.3, kein Dauerlastlauf und keine frische Windows-Installation. Windows-ACL-Einrichtung, automatisierter Backup-/Restore-Ablauf, allgemeiner Installer, reproduzierbarer Release-Prozess und Postfach-Lebenszyklus bleiben offen. Physische Stromausfälle, Datenträgerausfälle, eine vollständige Berechtigungsmatrix und native macOS-/Linux-Ausführung wurden nicht geprüft.

Die Aufbewahrung ist eine logische Bereinigung mit begrenztem Duplikatschutz. Es gibt keine garantierte forensische Löschung und keine feste Obergrenze für die gesamte SQLite-Datei. Agentenaktionen werden weiterhin nicht als genau einmal ausgeführt zugesagt. Nachrichtenabruf und Modellarbeit bleiben manuell.

[Installation und Upgrade](installed-plugin.de.md) · [Produktionsreife](production-readiness.de.md)
