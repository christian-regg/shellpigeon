# Weg zur Produktionsreife

**Preview.7:** Der bei der Qualitätsprüfung gefundene Windows-Dateiaustauschfehler ist gezielt reproduziert und korrigiert. Zwei neue Regressionstests ergänzen die jetzt 52 Tests. [Nachweis und Grenzen](windows-file-replacement.de.md).

**20. September: Schritte 3 und 4:** CLI-Stand gesichert; Preview.5 ergänzt
Installer, ZIP-/Prüfsummen-Paketierung, Abhängigkeitslizenzen und vorbereitete
Windows-CI. 50 Tests und isolierte Host-Installations-/Update-/Reparatur-/
Deinstallationsprüfungen bestanden. Preview.6 trägt den Namen ShellPigeon und
steht unter MIT. Das öffentliche Repository ist [christian-regg/shellpigeon](https://github.com/christian-regg/shellpigeon).
[Abgegrenzter Release-Stand](release-preparation.de.md).

**Betriebsanforderung präzisiert:** Gewöhnliche CLI-Sessions sollen sich ohne Zusatzterminal auflisten und anschreiben lassen. Die Vorschau unterstützt das mit nativer Claude-IPC und automatischem Codex-Queue-Fallback. Ein verwalteter Listener ist optional; sein noch offener Installations-/Startlauf blockiert diesen Ablauf nicht. Vollständig native Codex-Zustellung ohne zusätzliche Einrichtung bleibt separat offen. [Alltagsbetrieb](codex-cli-operation.de.md)

**Update 19. September:** Der native Standardzugang funktioniert für normale CLI-Starts/Resume bei vorhandenem stock Listener. Ohne diesen läuft die CLI intern; die Desktop-App bleibt separat. [Versionsgleicher Quell- und Live-Nachweis](codex-standard-endpoint.de.md)

**Neuer Nachweis 19. September:** Ein vollständig nativer Rundlauf mit den in
Testprofilen installierten Helfern ist im Leerlauf und während eines offenen
Codex-Werkzeugs bestanden. Exakte Rückadressen und Empfang des unbekannten
Antwortcodes in derselben Claude-Session sind geprüft. [Ergebnisse und Testaufbau](native-integration.de.md#vollständig-nativer-rundlauf-aus-installierten-paketen)

**Vorschau 0.4.0:** Native Sitzungserkennung, Versandhelfer und automatischer Rückweg sind ergänzt und separat geprüft. Beide persönlichen Plugins sind inzwischen auf 0.4.0-preview.4 aktualisiert; Paket-Prüfsummen, Host-Anbindung, Codex-Skill und lesende Session-Erkennung sind bestanden. [Aktueller Integrationsstand und Grenzen](native-integration.de.md)

Ausgangsbewertung: 17. September 2026, Commit 1763e75 / Version 0.2.0. Die Tabelle beschreibt diesen Ausgangsstand.

Update für 0.3: Atomare Initialisierung, differenzierte Startfehler, Offline-Diagnose, Schema-Migration 1 nach 2, konfigurierbare Bereinigung mit begrenztem Duplikatschutz und Logrotation sind umgesetzt. 28 Tests bestehen, einschließlich Migrationsabbruch und Neustart. Details und Grenzen: [Prüfergebnisse 0.3](phase-3-results.de.md). Windows-ACLs, allgemeiner Installer, automatisierte Backups/Restore, Session-Lebenszyklus und vollständiger Release-Nachweis bleiben offen.

Der Benutzer hat auch die installierten Plugins erfolgreich mit echten Sessions getestet. Damit ist der lokale Nutzungsablauf praktisch bestätigt. Die folgende Einschätzung beruht auf einer gezielten Code-Durchsicht und den vorhandenen Prüfergebnissen; sie ist kein vollständiger Sicherheits- oder Lasttest.

## Aktueller Zielumfang der ersten nativen Version

Entscheidung vom 19. September: zunächst Claude Code und Codex CLI auf Windows,
ein Betriebssystembenutzer und lokale Projekte. Native Zustellung soll ohne
Postfachabruf funktionieren und die genaue Rückadresse automatisch binden.
Codex benötigt dafür einen erreichbaren stock Listener. Der ausgewiesene
Queue-Fallback gehört zum normalen Betrieb ohne Zusatzterminal, hat aber andere
Zustellsemantik: gewöhnliche Benutzereingabe in einem separaten Turn.

Desktop-Aufgaben sind optional: nur aufnehmen, wenn ein unterstützter Weg mit
geringem Zusatzaufwand verfügbar wird. Ihr derzeit offener Eingang ist kein
Release-Blocker. Weitere Plattformen und Rechner folgen separat.

Die bestehenden dauerhaften Pull-Postfächer bleiben ein eigener, optionaler
Ablauf. Die folgende historische Tabelle betrifft deren Produktionshärtung;
sie ist keine unverändert geltende Abnahmeliste für die neue native CLI-Version.

## Präzisierung nach dem CLI-Alltagstest

Preview.4 setzt die nächsten Bedienungsverbesserungen um: gespeicherte
CLI-/App-Server-Herkunft mit ausdrücklich unbekannter UI bei `vscode`, belegter
Laufzeitstatus, markierte eigene Session,
getrennte Zähler für Queue-Kandidaten und erklärende Versandquittungen.
Skill und MCP-Hinweise trennen den normalen Peer-Versand von den optionalen
Postfächern; Claude-IPC-Rückantworten benötigen kein manuelles Abrufen.
47 Tests bestehen. Die folgende Tabelle bleibt der historische Postfachplan.

## Priorisierte Arbeit

P0 bezeichnet einen vorgeschlagenen Release-Blocker für diesen Zielumfang, P1 den anschließenden Ausbau. Das sind Produktprioritäten, keine CVSS-Sicherheitsbewertungen.

| Priorität | Bereich und konkreter Ist-Stand | Abnahme |
|---|---|---|
| P0 | **Erststart und Fehlerbehandlung:** `initializeData` legt die Token-Datei vor dem Schreiben an. Ein Abbruch dazwischen kann eine leere Datei hinterlassen. `loadBroker` fasst fehlende Dateien, ungültige Inhalte und inkompatible Descriptoren in einer Meldung zusammen; der Autostart behandelt sie anschließend als fehlenden Broker. | Unterbrechungen an jedem Initialisierungsschritt sind getestet. Fehlend, beschädigt, nicht zugreifbar und inkompatibel erhalten unterscheidbare Fehler. Beschädigte bestehende Zugangsdaten werden nicht durch einen stillen Reset ersetzt. |
| P0 | **Schutz lokaler Daten:** Es gibt Mode-Angaben, aber keine explizite Windows-ACL-Einrichtung oder Prüfung. Die effektiven Rechte hängen deshalb von der Umgebung ab. | Frische und bestehende Datenverzeichnisse werden auf der unterstützten Windows-Konfiguration geprüft. Ein anderer Standardbenutzer kann Token, Datenbank und Backups nicht lesen. Zulässige System-/Admin-Zugriffe und die Grenze gegenüber Prozessen desselben Benutzers sind dokumentiert. |
| P0 | **Updates und Datenbankmigrationen:** Schema-Versionen größer als 1 werden bereits abgelehnt. Es fehlen jedoch Migrationen, ein Kompatibilitätsvertrag für gleichzeitig installierte Adapter-Versionen sowie ein geprüfter Sicherungs-/Wiederherstellungsablauf. | Update von einer gespeicherten alten Fixture erhält Postfächer, Nachrichten, ACKs und Idempotenzdaten. Ein abgebrochenes Update ist wiederaufnehmbar. Ein Downgrade wird entweder nachweislich unterstützt oder vor Änderungen klar abgewiesen. |
| P0 | **Begrenzte Datenhaltung:** Nachrichten verfallen nach 24 Stunden für den Abruf, ihre Datensätze werden aber nicht gelöscht. Auch bestätigte Nachrichten, Sessions und `broker.log` wachsen ohne Bereinigung weiter. | Dokumentierte Aufbewahrungs- und Größengrenzen, sichere Bereinigung und Logrotation. Nach Bereinigung führen Sendewiederholungen innerhalb des zugesagten Idempotenzfensters nicht zu Duplikaten. Antwortbezüge bleiben konsistent. |
| P0 | **Verteilbare Installation:** Die lokale Einrichtung funktioniert. Codex benötigt noch `setup.cjs` und eine dauerhaft vorhandene Quelle mit eingetragenem absoluten Pfad. Der Ablauf ist an lokale Entwicklungshilfen gekoppelt. | Auf einem frischen Windows-System installierbar, mit klarer Runtime-Prüfung. Installation, Update, Reparatur und Deinstallation sind wiederholbar. Quellenumzug oder fehlendes Node erzeugen eine verständliche Reparaturanleitung. Vorhandene Host-Konfigurationen und private Daten bleiben erhalten. |
| P0 | **Release-Nachweis:** 14 automatisierte Tests, native Werkzeugerkennung und erfolgreiche Benutzertests liegen vor. Ein reproduzierbarer Modelltest über die installierten Pakete, ein längerer Betriebslauf und ein automatisierter Release-Prozess fehlen. | Festgelegte Host-/Node-Versionen; Neuinstallation und Update auf sauberer Windows-Umgebung; begrenzter Dialog echter Sessions in beiden Richtungen; Neustart-/Abbruchtests und ein längerer Betriebslauf. Verteilte Artefakte enthalten nur die vorgesehenen Dateien. |
| P1 | **Postfach-Lebenszyklus:** Wiederaufnahme verlangt den Handle im Gespräch. Es gibt weder Widerruf noch Abmeldung oder Archivierung. Eine Registrierung mit verloren gegangener Antwort lässt sich nicht idempotent wiederholen. | Registrierung bei unklarem Sendeausgang wiederholbar; sichere Wiederaufnahme; widerrufene Handles verlieren Zugriff; verwaiste Postfächer sind erkennbar und kontrolliert aufräumbar. |
| P1 | **Mehrere Leser:** Die Broker-Startsperre verhindert mehrere Broker, aber keine gleichzeitige Bearbeitung derselben Nachricht durch zwei Verbraucher mit demselben Handle. | Entweder genau ein aktiver Verbraucher wird erzwungen oder eine zeitlich begrenzte Verarbeitungs-Lease mit Crash-/Ablauftests eingeführt. Wiederholte Zustellung bleibt ausdrücklich möglich; beliebige Agentenaktionen werden nicht als genau einmal ausgeführt versprochen. |

## Vereinbarter Meilenstein 0.3

Zuerst Erststart, Diagnose und Datenhaltung härten. Das liefert einen klar abgegrenzten nächsten Schritt:

1. Fehlerklassen für Discovery und Start einführen; `doctor` muss auch ohne erreichbaren Broker erklären können, was fehlt.
2. Token-Initialisierung und Konfigurationsschreiben gegen Unterbrechungen absichern. Neue Geheimnisse nur bei einer tatsächlich neuen Installation anlegen.
3. Mit einer ersten getesteten Schema-Migration eine belastbare Basis für Aufbewahrungsregeln schaffen.
4. Nachrichtenbereinigung und Logrotation mit festem Idempotenzfenster implementieren. Die konkreten Fristen vor einer Änderung bestehender Daten sichtbar dokumentieren.

Die Arbeiten wurden zunächst an temporären Testdaten geprüft. Anschließend wurden die lokalen Plugins aktualisiert und die vorhandene Datenbank nach einer konsistenten Sicherung migriert; bestehende Inhalte blieben unverändert erhalten. Der Ablauf ist in den Prüfergebnissen 0.3 dokumentiert.

Neue Priorität vom 18. September 2026: Auf Wunsch des Benutzers wurde der Nachweis nativer Zustellung vorgezogen. Claude-IPC und Codex-Delegation über einen eigenen App-Server samt Control-Socket sind belegt; die Anbindung beliebiger offener Codex-Sitzungen bleibt offen. [Versuche und nächste Schritte](native-delivery-proof.de.md). Windows-Zugriffsrechte und der allgemeine Installations-/Updateablauf bleiben Aufgaben für ein produktives Release.

## Codebezüge

- [Initialisierung und Discovery](../src/config.ts)
- [Broker-Autostart](../src/autostart.ts)
- [Startsperre und Legacy-PIDs](../src/broker-owner.ts)
- [Datenmodell, Ablauf und Idempotenz](../src/store.ts)
- [MCP-Identitäten und Fehlerausgabe](../src/mcp.ts)
- [Lokale Codex-Einrichtung](../src/setup-codex.ts)
- [Paketierung](../scripts/package.mjs)
- [Bisherige Nachweise](phase-2-results.de.md)

Lizenzentscheidung vom 20. September: Der eigene Code steht unter [MIT](../LICENSE), die Lizenztexte der gebündelten Abhängigkeiten sind Bestandteil der Pakete. Repository und Veröffentlichungsablauf stehen in [release-preparation.de.md](release-preparation.de.md). Die längerfristige Support-/Versionspolitik bleibt festzulegen.
