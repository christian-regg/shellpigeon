# Codex-CLI im Alltag verbinden

Stand: 20. September 2026. Gewünschter Standard: zwei oder mehrere gewöhnliche
Claude-Code- und Codex-CLI-Sessions starten, andere Sessions auflisten und
ihnen Nachrichten schicken. Dafür ist kein drittes Terminal, eigener Daemon
oder zusätzlicher Codex-Installer vorgesehen. Desktop-Unterstützung ist optional.

## Normaler Betrieb

Nach dem Plugin-Update im gewünschten Projekt wie gewohnt `codex` oder
`claude` starten. Im Gespräch beispielsweise „Liste die anderen Codex- und
Claude-Sessions auf“ oder „Sende das Ergebnis an Session X“ anweisen.
Der Skill ruft den mitgelieferten Helfer auf. Er braucht keinen Session-Launcher
und keine manuelle Postfachregistrierung.

Der direkte Listenbefehl lautet `node <absoluter-peer.cjs-Pfad> list`.
`list --all` umfasst andere Projekte; `--provider codex` beziehungsweise
`--provider claude` schränkt die Auswahl ein. Im Repository nach dem Build:

~~~powershell
node plugins/codex/agent-session-messaging/dist/peer.cjs list --all
~~~

- Claude empfängt über seine vorhandene lokale IPC-Verbindung.
- Codex nutzt einen vorhandenen nativen Zugang, wenn dieser das Zielgespräch
  bereitstellt. Sonst verwendet der normale Versand automatisch `codex queue`.
  Die Nachricht wird als gewöhnliche Benutzereingabe in einem separaten Turn
  verarbeitet; eine beschäftigte CLI beendet zuerst ihren aktuellen Turn.
  Die Quittung nennt den tatsächlich verwendeten Transport.

Queue-Kandidaten werden anhand von Writer-Locks und Sitzungsmetadaten erkannt.
Eine ganz neue, noch leere Codex-CLI kann bereits laufen, ohne gespeicherte
Sitzungsmetadaten zu haben. In diesem Fall einmal eine normale Nachricht senden,
beispielsweise „Antworte nur mit OK“, und die Liste danach erneut abrufen.
Am 20. September mit Codex 0.155.1 vom Benutzer bestätigt: Nach der ersten
Nachricht erschien die zuvor fehlende CLI. Für andere Projektordner `--all` nutzen.
Ein zurückgebliebener Lock kann veraltet sein; die Liste allein belegt deshalb
keine laufende TUI oder spätere Verarbeitung. Unterbrochene Gespräche müssen
wiederaufgenommen werden. `--native` schließt den Queue-Fallback ausdrücklich aus.

Unser echter Claude → normale Codex-CLI → Claude-Rundlauf
ohne gemeinsamen Listener ist bestanden; Bericht:
`artifacts/native-delivery/roundtrip.json`.

Die persönlichen Plugins wurden am 19. September 2026 auf 0.4.0-preview.4
aktualisiert. Versionen, geladener Codex-Skill, beide Paket-Prüfsummen,
MCP-Anbindung und lesende Erkennung sind geprüft. Laufende CLI-Sessions
neu starten, damit sie den aktuellen Skill verwenden.

## Session- und Sendestatus ab Preview.4

Der gespeicherte Sitzungstyp zeigt CLI-Herkunft oder App-Server-/Editor-Herkunft.
`vscode` kann eine Desktop-/Editor-Aufgabe oder eine an einen App-Server
angebundene CLI bezeichnen. Die Ausgabe erklärt diese Mehrdeutigkeit ausdrücklich.
Dieser Herkunftswert sagt nicht, ob gerade ein Terminal geöffnet ist.

Der Laufzeitstatus nennt getrennt einen bestätigten Claude-Prozess, einen
nativ geladenen Codex-Thread oder einen ungeprüften Writer-Lock-Kandidaten.
Die eigene Session wird markiert, wenn ihre Host-Identität zugeordnet werden kann.
Die Liste behauptet keinen Idle-/Busy-Zustand aus einem bloßen Prozessnachweis.

CLI-Queue-Quittungen erklären das Warten auf eine geschlossene oder unterbrochene
CLI und liefern den genauen Resume-Befehl. Quittungen für mehrdeutige
App-Server-/Editor-Queue-Ziele versprechen keine automatische Verarbeitung. Rückantworten über Claude-IPC
erscheinen bei erlaubter Zustellung direkt im Gespräch; `inbox_read` betrifft
nur die separaten optionalen Postfächer.

## Stand der vollständig nativen Codex-Zustellung

Codex 0.154.0 startet auf diesem Rechner ohne vorhandenen Standardlistener
einen eingebetteten Server ohne externen Socket-Eingang. Native Zustellung
während des aktiven Turns ist hier nur mit einem bereits erreichbaren stock
Listener nachgewiesen. Die Queue ersetzt diesen Nachweis nicht.
Eine durchgängig native Verbindung gewöhnlicher CLI-Starts ohne zusätzliche
Einrichtung bleibt eine offene Kompatibilitätsfrage.
[Versionsgleicher Quell- und Live-Nachweis](codex-standard-endpoint.de.md).

Der zuvor empfohlene dritte Terminalprozess mit `codex app-server --listen unix://`
ist ein Diagnose-/Testaufbau und kein Pflichtschritt für den normalen Plugin-Betrieb.
Auch die folgende verwaltete Einrichtung ist optional.

## Optional: verwalteter nativer Listener

### Aktueller Stand auf diesem Rechner

- Codex CLI 0.154.0 ist über npm installiert; der verwaltete Standalone-Pfad fehlt.
- Native Zustellung und Rückantworten mit installierten Helfern sind separat
  nachgewiesen. Ein Daemon für den täglichen Betrieb wurde noch nicht eingerichtet.
- Der isolierte Daemon-Test wurde von Windows mit
  `host Job Object prevents daemon detachment` abgewiesen. Die App-Ausführung
  erlaubt keinen dauerhaft unabhängigen Hintergrundprozess. Der Test wurde
  bereinigt; er ist kein erfolgreicher Nachweis von Start/Neustart/Stop.
- Falls dieser optionale Betriebsweg gewünscht wird, muss die Einrichtung aus
  einer normalen, nicht als Administrator gestarteten PowerShell außerhalb der
  Codex-App erfolgen. Sie ist keine Voraussetzung für Listen und Queue-Versand.

### Einrichtung

Im Repository zeigt dieser Aufruf nur die geplanten Änderungen:

~~~powershell
.\scripts\setup-codex-listener.ps1
~~~

Nur für die ausdrücklich gewählte optionale Einrichtung aus der genannten PowerShell:

~~~powershell
.\scripts\setup-codex-listener.ps1 -Apply
~~~

Im verteilten Codex-Paket heißt dieselbe Datei `setup-listener.ps1` im
Plugin-Hauptordner. Sie ist unabhängig von `setup.cjs`, das lediglich die
MCP-Pfade im Plugin einträgt.

`-Apply` führt folgende konkret begrenzte Schritte aus:

1. Bestehende Daemon-Einstellungen prüfen. Bereits aktiviertes Remote Control
   wird nicht verändert; diese lokale Einrichtung bricht dann vor Änderungen ab.
2. Falls die Standalone-Installation fehlt, den offiziellen Installer aus dem
   gepinnten Commit herunterladen und seinen SHA-256 prüfen. Installiert wird
   exakt Codex 0.154.0. Der Installer läuft ohne interaktive Rückfragen.
3. Der offizielle Installer behält npm-Codex und fügt den Standalone-Pfad dem
   Benutzer-PATH hinzu beziehungsweise priorisiert ihn für neue Terminals.
   Dateien liegen unter `CODEX_HOME/packages/standalone`; der sichtbare Pfad
   liegt standardmäßig unter `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`.
4. Die verwaltete Version prüfen und den stock Befehl `daemon start` ausführen.
   Eine schon installierte abweichende Version wird weder ersetzt noch gestartet.
   Ein vorhandener Listener wird vom Upstream-Befehl erkannt, nicht übernommen.

Die Einrichtung startet weder `bootstrap` noch einen automatischen Updater und
richtet keinen Windows-Autostart ein. Der Daemon nutzt das bestehende Codex-
Profil; eine erneute Anmeldung oder Übertragung von Gesprächen ist nicht Teil
dieses Schritts. Die persönlichen Plugins sind unabhängig davon bereits auf
0.4.0-preview.4 aktualisiert; der optionale Listener wurde nicht eingerichtet.

Der Installer wurde vorab heruntergeladen, gegen den geprüften Git-Blob
abgeglichen und nicht ausgeführt. Die Vorschau und die Ablehnung unpassender
Remote-Control-Einstellungen sind automatisiert geprüft. Die tatsächliche
Installation und der anschließende Daemon-Start stehen noch aus.

### Starten und verwenden

Nach einem Windows-Neustart oder einem bewussten Stop einmal aus einer
normalen PowerShell starten:

~~~powershell
codex app-server daemon start
codex app-server daemon version
~~~

Start ist laut geprüftem Upstream-Code idempotent: Ein erreichbarer Listener
liefert `alreadyRunning`. `version` prüft den vorhandenen Socket; bei fehlendem
Listener ist ein Fehler zu erwarten. Es ist kein universeller Offline-Status.
Bis ein neues Terminal den aktualisierten PATH übernommen hat, kann der
explizite Pfad `~/.codex/packages/standalone/current/bin/codex.exe` verwendet
werden; bei gesetztem `CODEX_HOME` entsprechend darunter.

Danach im gewünschten Projekt normal `codex` beziehungsweise `claude` starten.
Normale Codex-Starts verwenden den vorhandenen Standardlistener. Zusätzliche
CLI-Overrides wie `-c`, Profile oder spezielle Executor-Modi können stattdessen
einen internen Server wählen. Ein vorher intern geöffnetes Gespräch zuerst
regulär beenden und dann mit `codex resume <ID>` wiederaufnehmen.

Der Listener behält die Umgebung, mit der er gestartet wurde. Neue Umgebungs-
variablen eines später geöffneten Terminals werden nicht automatisch zu seiner
Umgebung. Deshalb aus einer gewöhnlichen persönlichen Shell starten; nach
relevanten Umgebungsänderungen die verbundenen CLIs schließen und neu starten.

Nach dem Plugin-Update zeigt `node <absoluter-peer.cjs-Pfad> doctor` die
erreichbaren Endpunkte und `list` die Empfänger. Der Plugin-Helfer startet den
Daemon auch weiterhin nicht automatisch als Reparatur einer fehlenden Route.

### Beenden und Aktualisieren

Vor Stop oder Neustart alle mit dem Listener verbundenen Codex-CLIs regulär
schließen: Diese Befehle betreffen den gemeinsamen Server.

~~~powershell
codex app-server daemon stop
# Nach einer bewusst vorgenommenen Aktualisierung oder Umgebungsänderung:
codex app-server daemon start
~~~

`restart` ist ebenfalls ein stock Befehl, aber kein unterbrechungsfreies Update.
Ein bereits laufender, nicht durch `daemon start` verwalteter Listener wird von
`stop` und `restart` abgewiesen; ihn über seinen eigenen ursprünglichen Start
beenden. Keine fremden PID-/Socket-Dateien löschen und keine laufenden Aufgaben
erzwungen übernehmen.

### Prüfbeleg und Quellen

`scripts/probe-codex-daemon.mjs --codex-exe <absoluter-stock-codex.exe-Pfad>`
prüft den Lebenszyklus in einem temporären Profil ohne Anmeldung oder Modelle.
Dafür kopiert er das vorhandene stock Binary in eine verwaltete Pfad-Fixture;
er ersetzt keinen Installer-Test. Hier wurde nur die Ablehnung des fehlenden
Managed-Pfads bestätigt, bevor Windows die Prozessablösung blockierte.
Bericht: `artifacts/native-delivery/daemon-lifecycle.json`.

- [Upstream-Betriebsvertrag und Windows-Grenzen](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-daemon/README.md)
- [Start, Stop und Umgang mit fremden Listenern](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-daemon/src/lib.rs)
- [Windows-Prüfung der Prozessablösung](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-daemon/src/backend/windows.rs)
- [Gepinnter offizieller Installer](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/scripts/install/install.ps1)
