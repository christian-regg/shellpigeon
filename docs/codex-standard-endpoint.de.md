# Codex-Standardendpunkt: Ursache und Nachweis

Stand: 19. September 2026. Codex CLI 0.154.0 unter Windows; Desktop-Binary
0.155.0-alpha.9.2. Integration: 0.4.0-preview.2.

## Ergebnis

Native Zustellung in eine normal gestartete Codex-CLI ist belegt, **wenn beim
Start ein erreichbarer stock App-Server am Standard-Control-Socket existiert**.
Die CLI braucht dafür weder `--remote` noch unseren Session-Launcher. Auch ein
reguläres `codex resume <ID>` kann ein zuvor intern betriebenes Gespräch dort
anbinden, nachdem dessen vorheriger Prozess beendet wurde.

Ohne vorhandenen Listener läuft die normale CLI mit einem eingebetteten Server.
Dieser hat In-Memory-Kanäle statt eines externen Socket-Eingangs. Das Plugin kann
diesen fehlenden Eingang nicht durch einen anderen Socketpfad oder eine weitere
Handshake-Variante erreichen. Ein später gestarteter Listener übernimmt weder
solche offenen CLI-Sessions noch den separaten stdio-Server der Desktop-App.

Das erklärt den bisherigen Befund. Es war kein fehlerhafter Windows-Proxy und
kein fehlender Nachrichtenumschlag. Die direkte native Anbindung der hier
laufenden Desktop-App ist weiterhin nicht verfügbar. Die funktionierenden
nativen Versuche betreffen CLI-Gespräche am erreichbaren Standardlistener.

## Versionsgleicher Quellnachweis

Untersucht wurde der offizielle Tag `rust-v0.154.0`, Commit
`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`. Die Checkout-Kopie liegt ausschließlich
im ignorierten Verzeichnis `artifacts/upstream/codex-0.154.0`.

- [TUI: Probe des vorhandenen Standard-Sockets, Verbindung und Embedded-Fallback](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/tui/src/lib.rs#L459)
- [TUI: Auswahl des Ziels und Bedingungen für Daemon-Wiederverwendung](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/tui/src/lib.rs#L927)
- [Startablauf: wann der Standard-Socket überhaupt geprüft wird](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/tui/src/startup_orchestration.rs#L150)
- [Embedded-Runtime mit In-Memory-Kanälen](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server/src/in_process.rs#L1)

Insbesondere verhindern zusätzliche `-c`/`--config`-Overrides, Profile,
`--strict-config` und bestimmte andere Startoptionen die implizite Nutzung des
Daemons. Auch Worktree-, OSS- und spezielle Executor-/Identity-Modi können einen
internen Server wählen. Diese Aussagen sind auf die untersuchte Version
bezogen. `--remote` ist eine explizite andere Auswahl.

Unser früherer Teststart mit `-c features.hooks=false` eignete sich deshalb
nicht als Nachweis der automatischen Nutzung eines bereits laufenden Daemons.
Im neuen Versuch waren die Hooks nur am eigenen **Server** für diesen Prozess
deaktiviert; die Test-TUIs verwendeten keine `-c`-Overrides.

Die allgemeine [App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server)
beschreibt die Socket- und WebSocket-Transporte. Die Bedingungen für die
implizite CLI-Verbindung wurden zusätzlich am gepinnten Code geprüft.

## Kontrollierter Live-Test

| Schritt | Beobachtung |
|---|---|
| Eigene normale CLI bei fehlendem Standardlistener starten | Nur Queue-Kandidat, kein nativer Endpunkt. |
| Eigenen stock Prozess mit `app-server --listen unix://` starten | Standard-Proxy erreichbar; zunächst keine geladenen Gespräche. |
| Vorher gestartete CLI weiter offen lassen | Bleibt intern und wird nicht automatisch vom Listener übernommen. |
| Zweite normale CLI ohne `--remote` oder `-c` starten | Ihr Gespräch wird vom Standardlistener gemeldet und als `codex-native` erkannt. |
| Mit `peer.cjs send ... --native` einen frischen Code senden | Native RPC-Annahme und exakte Antwort in derselben TUI. |
| Darstellung in der TUI prüfen | Nachricht erscheint mit „Sent by Codex from task …“, nicht als normale Benutzereingabe. |
| Erste CLI regulär beenden und mit `codex resume <ID>` öffnen | Dieselbe Gesprächs-ID ist jetzt nativ am Standardlistener erreichbar. |
| Zweiten frischen Code an diese ID senden | Exakte Antwort im wiederaufgenommenen Gespräch. |
| Beide eigenen TUIs und den eigenen Listener beenden | Standard-Socket wieder verschwunden; nur die vorher vorhandenen Host-Prozesse laufen. |

Die Test-TUIs verwendeten `--no-alt-screen --sandbox read-only
--ask-for-approval never`; ihre Modelle durften ausschließlich Prüf-Codes
zurückgeben. Kein Testthread wurde erzwungen übernommen. Vor dem Stoppen wurden
die geladenen IDs auf die eigenen Testgespräche geprüft und deren Leerlauf
bestätigt. Keine Nachricht ging an eine andere bestehende Session.

Lokaler Beleg: `artifacts/native-delivery/standard-listener.json`. Er enthält
Test-IDs, Codes, Turn-IDs und die protokollierten Beobachtungen, keine privaten
Transkripte oder Schlüssel. Die Terminaldarstellung wurde am eigenen Test-TUI
beobachtet. Der Listener war ein temporärer stock Prozess; `daemon bootstrap`,
Remote-Control-Aktivierung und dauerhafte Konfigurationsänderungen wurden nicht
ausgeführt. Ein dauerhaft verwalteter Daemon wurde noch nicht eingerichtet.

## Änderungen am Plugin

`node <peer.cjs> doctor` untersucht rein lesend die Codex-Endpunkte:

- `reachable`: Initialize und Discovery gelungen; Anzahl adressierbarer
  User-Threads separat angegeben.
- `missing`: Verbindung gescheitert und Pfad bei anschließender Prüfung nicht
  vorhanden. Das ist eine Momentaufnahme, kein Beleg für die Ursache eines
  früheren Fehlers.
- `unavailable`: Verbindung gescheitert, ohne den Pfad sicher als fehlend
  nachweisen zu können. Beispielsweise kann ein vorhandener Socket gestört sein.

Der Befehl startet keinen Daemon, lädt kein fremdes Gespräch und ruft kein
Modell auf. Er trennt native User-Threads von bloßen Queue-Kandidaten und nennt
die versionsabhängigen Startbedingungen.

Die Live-Erkennung fand außerdem einen internen `threadSource: system`-Thread,
der wie das menschliche Gespräch `source: vscode` meldete. `source` allein
reicht daher nicht aus. Die Erkennung schließt nun System-Threads, Threads mit
Eltern-ID und explizit nicht direkt adressierbare Threads aus. Neuere
State-Datenbanken werden auch für Queue-Kandidaten auf `thread_source` geprüft;
ältere Metadaten ohne dieses Feld bleiben kompatibel. Verschiedene Windows-
Schreibweisen desselben Socketpfads werden vor dem Verbinden zusammengeführt.

## Separater Desktop-Adapter

Zusätzlich wurde der hier installierte Adapter `codex-app-tools` 0.1.4
lesend geprüft (`server.mjs`, Bereich ab Zeile 24772, und seine `.mcp.json`).
Er verbindet sich über die von der App gesetzte Variable
`CODEX_APP_TOOLS_PIPE_PATH` mit einer eigenen Pipe. Werkzeugaufrufe erwarten
Aufgabenkontext aus dem Executor; fehlt dieser, weist der Adapter den Aufruf
zurück. Diese Verbindung ist ein anderer Vertrag als der stock Control-Socket
mit `turn/start.toolOutput`.

Der lokale Befund bestätigt einen appinternen Werkzeugweg. Er belegt keinen
allgemeinen externen Eingang für eine gewöhnliche Claude-Session. In der
geprüften offiziellen Dokumentation wurde kein entsprechender externer Vertrag
gefunden. Das ist kein Nachweis technischer Unmöglichkeit. Der Peer-Helfer
verwendet diesen internen Adapter vorerst nicht und erzeugt keine fremden
Aufgaben- oder Turn-Metadaten dafür. Der Desktop-Eingang bleibt offen; eine
Neuinstallation des Plugins löst diese Transportfrage nicht. Für die erste native
Version genügt nach der Entscheidung vom 19. September die Verbindung der CLIs;
Desktop-Unterstützung bleibt eine optionale Erweiterung.

## Konsequenz für den Betrieb

Der Plugin-Versand bleibt ohne eigenen Daemon. Für native CLI-Zustellung muss
Codex selbst einen gemeinsam erreichbaren Listener bereitstellen. Das ist keine
Voraussetzung für Auflisten und Standardversand mit Queue-Fallback. Die zusätzliche
Einrichtung bleibt optional; [normaler Betrieb und Windows-Grenze](codex-cli-operation.de.md). Das Plugin startet
oder konfiguriert ihn nicht nebenbei. Ohne ihn bleibt der kenntlich gemachte
Queue-Fallback für normale CLI-Sessions nutzbar. Eine bloße Plugin-Neuinstallation
macht den separaten Desktop-App-Server nicht extern erreichbar.
