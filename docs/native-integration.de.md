# ShellPigeon: native Sitzungen und Integrationsnachweise

Aktueller Ausbau: **0.5.0-preview.1 ergänzt Linux/Ubuntu unter WSL 2**. Umfang und neue Nachweise stehen in [Linux-Unterstützung](linux-support.de.md). Die folgenden Windows-Ergebnisse bleiben historische Nachweise.

Stand: 20. September 2026. Windows-Vorschau, Node.js ab 22.16.
Preview.5 ergänzt den portablen Release-Installer, Paketprüfsummen und die
Anleitung für leere Codex-Gespräche. [Release-Stand und Prüfungen](release-preparation.de.md).
Preview.4 präzisiert Session-Status, Versandquittungen und die Trennung vom
Postfachbetrieb. Preview.3 ergänzt den weiterhin optionalen Listener-Einrichter.
Die nativen Live-Nachweise unten stammen aus Preview.2; die Transportprotokolle
sind unverändert.
[Normaler CLI-Betrieb ohne Zusatzterminal und optionale Einrichtung](codex-cli-operation.de.md)
Die Pakete enthalten neben den unveränderten MCP-Postfächern den eigenständigen
Helfer `dist/peer.cjs` und einen aktualisierten Skill. Der Helfer benötigt keinen
eigenen Broker, keine manuelle Registrierung und keinen besonderen Session-Launcher.
Beide persönlichen Plugins sind am 19. September auf 0.4.0-preview.4 aktualisiert.
Die vorherigen Installations- und Praxisnachweise für Preview.3 stehen weiter unten.

## Vorschau 0.4.0-preview.4: verständliche Session- und Zustellstatus

Die Liste ergänzt die gespeicherte Codex-Herkunft (`codexSource`) und einen
lesbaren Typ (`sessionKind`). `cli` ist CLI-Herkunft. `vscode` wird auch von
stock App-Servern verwendet und kann sowohl Desktop/Editor als auch eine daran
angebundene CLI bedeuten. Die Ausgabe nennt deshalb `codex-app-server-or-editor`
und erklärt die Mehrdeutigkeit in `originExplanation`. Der Typ beweist weder
eine konkrete aktuell verwendete Oberfläche noch deren Aktivität.

`runtimeStatus` unterscheidet bestätigte Claude-Prozesse, Threads an einem
erreichbaren nativen Endpunkt und ungeprüfte Writer-Lock-Kandidaten. Die
getrennten Zähler führen diese Kandidaten nicht als laufende Empfänger.
`currentAddress` und `isCurrentSession` kennzeichnen die eigene Session,
sofern sie aus der tatsächlichen Host-Identität zugeordnet werden konnte.

`delivery` erklärt den jeweiligen Versandweg auch in der Sendebestätigung:

- Claude-IPC und native Codex-Zustellung können automatisch einen freien Turn
  starten beziehungsweise während laufender Arbeit zustellen. Annahme oder
  Schreiben bestätigt weiterhin keinen Modell-Empfang.
- CLI-Queue-Nachrichten werden von einer geöffneten freien CLI automatisch
  verarbeitet; geschlossene oder unterbrochene CLIs warten auf Wiederaufnahme.
  Für CLI-Herkunft wird der genaue Resume-Befehl mitgeliefert, anzuwenden erst
  nach Beenden des bisherigen Besitzers.
- Bei mehrdeutiger App-Server-/Editor-Herkunft und anderen ungeprüften Queue-Empfängern
  wird ausdrücklich keine automatische Verarbeitung zugesagt.

Der Skill empfiehlt kurze Einträge mit vollständigem Pfad und Adresse statt
breiter ASCII-Tabellen. Er verwendet für gewöhnliche Sessions ausschließlich
den Peer-Helfer und erklärt die automatische Claude-Rückzustellung ausdrücklich.
Die alten Postfachregeln und die optionale Listener-Einrichtung liegen in
separaten mitgelieferten Referenzen. Auch die MCP-Serverhinweise beschränken
Pull-Verhalten und fehlendes Aufwecken auf die Postfach-Werkzeuge.

47 Tests bestehen. Neue Fälle prüfen insbesondere Herkunft gegenüber Laufzeit,
mehrdeutige App-Server-/Editor-Queue gegenüber CLI-Queue, Selbstmarkierung, getrennte Zähler,
das Weglassen privater Registrierungsfelder und die Quittung nach einem
tatsächlichen Native-zu-Queue-Fallback. Die Transportprotokolle, Adressprüfung
und Regeln gegen doppeltes Senden bleiben unverändert.

Diese Mehrdeutigkeit ist am gespeicherten Herkunftswert unseres bereits
bestandenen Standardlistener-CLI-Tests sichtbar. Der gepinnte
[App-Server-Start verwendet `SessionSource::VSCode`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server/src/lib.rs#L435).
Die Statusanzeige verspricht deshalb keine vollständige CLI-/Desktop-Erkennung.

## Was funktioniert

| Empfänger | Erkennung | Zustellung / Ergebnis |
|---|---|---|
| Claude Code unter Windows | Sitzungsregistrierung, lebender Prozess, exakte Startzeit und lokale Pipe | Native Peer-Nachricht; `transport-written` bestätigt nur den Schreibvorgang. Die Inbound-Policy bleibt maßgeblich. |
| Codex mit erreichbarem Control-Socket | `thread/loaded/list`, Metadaten ohne Turns; eindeutige Zuordnung zum Server | `turn/start.toolOutput`, `accepted` und Turn-ID. Funktioniert auch im aktiven Turn. |
| Codex ohne solchen Endpunkt | Writer-Lock-ID plus Metadaten aus der lokalen Zustandsdatenbank | Sichtbar als `codex-queue`; `queued` bestätigt Speicherung als gewöhnliche Benutzereingabe. |

**Neue Klärung vom 19. September:** Normale Codex-CLIs starten ohne gemeinsamen
Listener mit einem internen Server. Ist beim Start bereits ein stock Listener
am Standard-Socket erreichbar, verwenden sie ihn automatisch. Native Zustellung
in eine so gestartete CLI und in ein regulär wiederaufgenommenes Gespräch ist
jetzt belegt. Ein späterer Listener übernimmt offene interne Sessions nicht.
Die Desktop-App betreibt hier einen separaten stdio-Server und bleibt darüber
nicht direkt nativ erreichbar. [Ursache und Live-Nachweis](codex-standard-endpoint.de.md)

Queue-Verarbeitung ist für eine normale Codex-CLI belegt, für Desktop-Aufgaben
hier nicht. Verwaiste Lock-Dateien können Queue-Kandidaten erzeugen;
`writer-lock` bedeutet weder „läuft“ noch „wird die Nachricht bearbeiten“.
Auch ein geladener App-Server-Thread beweist keine sichtbare TUI.

## Benutzen

Im Repository zuerst `npm.cmd run build`. Der folgende Pfad ist das Codex-Bundle;
das Claude-Bundle enthält denselben Helfer. In installierten Plugins löst der
Skill den Pfad relativ zu seinem eigenen Installationsort auf.

```powershell
node .\plugins\codex\agent-session-messaging\dist\peer.cjs list
node .\plugins\codex\agent-session-messaging\dist\peer.cjs list --all --provider claude
node .\plugins\codex\agent-session-messaging\dist\peer.cjs self
node .\plugins\codex\agent-session-messaging\dist\peer.cjs doctor
node .\plugins\codex\agent-session-messaging\dist\peer.cjs send 'claude:<exakte-ID>' 'Build' 'Der Build ist grün.'
node .\plugins\codex\agent-session-messaging\dist\peer.cjs send 'codex:<exakte-ID>' 'Review' --message-file .\review.txt --native
```

`list` beschränkt die Ausgabe auf das aktuelle Projekt. Namen müssen exakt und
eindeutig sein; für Namen aus anderen Projekten ist `--all` nötig. Eine exakte
Adresse `claude:<UUID>` oder `codex:<UUID>` kann projektübergreifend verwendet
werden. Mehrere mögliche Prozesse oder Server für dieselbe Adresse führen zum
Abbruch. Es gibt keine Zuordnung nach „neuestem Gespräch im Ordner“.

`send` muss als Werkzeugaufruf aus dem sendenden Gespräch laufen. Die Quelle
kommt aus `CLAUDE_CODE_MESSAGING_SOCKET` beziehungsweise `CODEX_THREAD_ID` und
muss einem erkannten Peer entsprechen. Claudes eigener Socket hat Vorrang vor
einer möglicherweise geerbten Codex-ID. Ein gewöhnliches Terminal ohne
Sitzungsidentität kann auflisten, aber keine fremde Rückadresse behaupten.

Jede Nachricht enthält eine neue Nachrichten-ID und eine providerqualifizierte
`replyTo`-Adresse. Für eine beauftragte Antwort ruft der Empfänger denselben
Helfer mit dieser Adresse auf. Es gibt keine automatische Bestätigungsschleife.
Nachrichten-ID und Rückadresse sind keine Berechtigung und kein Duplikatschutz.

`--native` sendet nur nativ, andernfalls gar nicht. `--queue` erzwingt die Codex-
Queue. Ohne Schalter ist Queue-Fallback nur vor einer nativen Sendeanfrage
möglich. Scheitert eine begonnene Zustellung ohne eindeutiges Ergebnis, endet
der Helfer mit Code 2 und `outcome: unknown`; er sendet nicht erneut.
`state: accepted`, `queued` oder `transport-written` ist noch keine fachliche
Antwort. Der Test unten weist den Modell-Empfang separat nach.

`ASM_CODEX_SOCKET` kann einen vorhandenen absoluten lokalen Control-Socket-Pfad
angeben. Standardpfad und explizite `--listen unix://...` / `--remote unix://...`
Argumente laufender Windows-Codex-Prozesse werden geprüft. Der Helfer startet
nur den kurzlebigen stock Proxy, keinen Listener oder Daemon. Er lädt oder
übernimmt keinen anderen Thread. TCP-Server, OpenCode sowie Claude-Discovery
auf macOS/Linux gehören nicht zu dieser Vorschau.

Codex-Sandboxen können den Zugriff auf Host-Prozesse und IPC blockieren. Der
Skill beschreibt dafür den normalen, eng auf den Helfer begrenzten
Freigabeweg. Es werden weder globale Sicherheitsregeln noch Claudes
`crossSessionInbound` geändert. Schlüssel bleiben im Helferprozess und stehen
nicht in den Ergebnissen. Die Metadatenprüfung ersetzt keine Isolation gegen
beliebigen Schadcode unter demselben Betriebssystembenutzer.

## Nachweise

- `npm.cmd test`: **44 bestanden**, ohne Modellaufrufe. Neue Prüfungen decken
  doppelte Namen/Server, PID-Wiederverwendung, unbekannte Absender, Subagenten-
  Ausschluss, exakte Argumente, WebSocket-Tunnel, Fallback vor dem Senden und
  fehlenden Zweitversand nach einer verlorenen Antwort ab.
- `npm.cmd run native:socket -- --delivery`: Der integrierte Discovery- und
  Versandcode findet den eigenen echten Codex-Testthread. Native Zustellung im
  Leerlauf und während eines offenen Testwerkzeugs bestanden; derselbe aktive
  Turn bleibt erhalten.
- Eigene normal gestartete Codex-CLI 0.154.0 und Claude Code 2.1.277 `-p`:
  **Claude → Codex-Queue → native Claude-IPC-Rückantwort bestanden.** Beide
  Modelle verwenden den gebauten Helfer. Die Rückadresse wird automatisch
  gebunden; kein `inbox_read`, kein manuell weitergereichter Nachrichtentext.
  Der Antwortcode war nur im anfänglichen Codex-Testprompt bekannt und wurde
  anschließend in Claudes ursprünglicher Session empfangen.

Der Rundlauf dauerte im erfolgreichen Versuch etwa 26 Sekunden einschließlich
Modellaufrufen. Claude hatte nur für diesen Testprozess Inbound `accept` und
einen auf den Helfer begrenzten erlaubten Bash-Aufruf. Codex nutzte den normalen
Freigabeweg für lokalen IPC-Zugriff. Es wurden nur eigene Testprozesse benutzt
und anschließend beendet. Der Claude-Empfänger war eine Stream-JSON-Session,
keine interaktive TUI; Claudes Verhalten bei einem laufenden Tool ist offen.

Die erste Erkennungsprüfung fand einen Windows-Präzisionsfehler: CIM rundet die
Prozessstartzeit auf Mikrosekunden, Claude speichert FILETIME mit 100-ns-
Auflösung. Die Implementierung verwendet jetzt `Get-Process.StartTime` und
behält den exakten Vergleich bei. Ein weiterer Testabbruch entstand durch eine
zu streng geprüfte Modellantwort; der Test akzeptiert nun Zusatztext nach dem
Sendebestätigungsmarker. Der erfolgreiche Rundlauf wurde mit einer frischen
Absendersession durchgeführt, nicht als automatische Wiederholung.

Lokale Belege: `artifacts/native-delivery/roundtrip.json`, `codex-proxy.json` und
`explicit-socket.json`. Diese enthalten keine Peer-Schlüssel und bleiben von
Git ausgeschlossen. Der wiederverwendbare Rundlaufprüfer ist
`scripts/probe-peer-roundtrip.mjs`: Er benötigt die exakte Adresse einer eigenen
bereits vorbereiteten Codex-Testsession und einen nur diesem Empfänger bekannten
Code `ASM_RETURN_<32 Hexzeichen>`. Die Vorbereitung autorisiert genau eine
Helferantwort auf `ASM_ROUNDTRIP_REQUEST`; danach wird der Prüfer mit diesen
beiden Argumenten gestartet. Für die Herkunft des Transports und den ersten
Protokollnachweis siehe [Native Zustellung](native-delivery-proof.de.md).

Die aktuellen Vorschaupakete liegen unter `artifacts/release/0.4.0-preview.4`.
Sie wurden in temporären Plugin-Caches beider Hosts installiert und geprüft;
die persönlichen Installationen wurden während dieser isolierten Tests nicht
ersetzt. Das anschließende persönliche Update ist inzwischen bestanden. Der normale Betrieb benötigt keinen zusätzlichen Listener;
der automatische Queue-Fallback ist Teil dieses Ablaufs. Vollständig native
Codex-Zustellung ohne zusätzliche Einrichtung bleibt gesondert offen. Der native
Rundlauf mit installierten Helfern ist inzwischen bestanden. Nach der Scope-Entscheidung vom
19. September genügt zunächst die Verbindung von Claude Code und Codex CLI unter
Windows. Desktop-Anbindung und weitere Plattformen sind optionale Erweiterungen;
der Desktop-Eingang blockiert die erste native Version nicht.

## Isolierter Pakettest

Am 19. September mit Codex CLI 0.154.0, Claude Code 2.1.278 und Node 22.16.0
bestanden. Der neue Prüfer installiert die fertigen Release-Pakete mit den
gewöhnlichen Plugin-Befehlen in frisch erzeugten Testprofilen. Er verwendet
keine direkt eingespeiste MCP-Konfiguration und ruft kein Modell auf.

- Codex lädt den aktivierten Skill aus seinem neuen Plugin-Cache und bietet
  exakt die sieben erwarteten MCP-Werkzeuge an.
- Claude meldet das tatsächlich installierte Plugin als aktiviert und dessen
  MCP-Server als verbunden.
- In beiden Installationen stimmen MCP-, Broker-, Peer-Bundle und Skill per
  SHA-256 mit dem Release-Paket überein. Der relative Skill-Pfad führt zum
  installierten Helfer; dessen Hilfe und lesende Diagnose laufen aus einem
  anderen Arbeitsverzeichnis. Die Installationspfade enthalten Leerzeichen
  und einen Umlaut.
- Testprofile, temporärer Marketplace und eigener App-Server werden danach
  entfernt beziehungsweise beendet. Kein Broker wird gestartet. Die bisherigen
  persönlichen Installationen wurden von diesem isolierten Test nicht verändert.

Aus dem Repository nach dem Paketbau:

~~~powershell
npm.cmd run package
npm.cmd run package:verify -- --python '<absoluter Pfad zu Python>'
~~~

Der offizielle Plugin-Creator-Scaffolder wird standardmäßig unter
`~/.codex/skills/.system/plugin-creator` gesucht. Bei anderem Speicherort
zusätzlich `--plugin-creator '<absoluter Skill-Ordner>'` angeben. Python wird
nur für diese Entwicklungsprüfung benötigt, nicht für den Plugin-Betrieb.
Das Skript legt den Test-Marketplace mit dem Scaffolder an und registriert ihn
nur im temporären Codex-Profil. Es ändert weder den persönlichen Marketplace
noch bestehende Plugin-Caches. Bericht: `artifacts/package-install-probe.json`.

Der erste Durchlauf deckte einen Fehler im Prüfer auf: Codex meldet den Skill
als `agent-session-messaging:session-messaging`. Die Prüfung verwendet jetzt
diesen vollständigen Namen und die genaue Plugin-ID. Am Produkt war dafür
keine Änderung erforderlich.

Der reine Pakettest belegt Installation und Host-Anbindung. Der folgende
zusätzliche Modelltest weist den nativen Rundlauf mit installierten Helfern nach.
Die früheren CLI- und Protokollnachweise bleiben separate Prüfungen.

## Vollständig nativer Rundlauf aus installierten Paketen

Am 19. September mit denselben Host-Versionen bestanden. Der Paketprüfer kann
jetzt zusätzlich echte Modelle und die zuvor in frischen Profilen installierten
Helfer verwenden:

~~~powershell
npm.cmd run package:verify -- --python '<absoluter Pfad zu Python>' --native-roundtrip
~~~

Dieser zusätzliche Schalter startet Modell-Turns. Er verwendet die vorhandenen
lokalen Anmeldungen in privaten temporären Testprofilen; diese Kopien werden
nach Beenden der eigenen Testprozesse entfernt. Die persönlichen Plugins und
Host-Einstellungen werden nicht ersetzt. Der reine Pakettest ohne diesen
Schalter bleibt ohne Modellaufrufe.

| Fall | Geprüftes Ergebnis |
|---|---|
| Codex im Leerlauf | Claude ruft den installierten Helfer mit `--native` auf. Codex empfängt `functionCallOutput` unter `codex_app.send_message_to_thread` und sendet mit seinem installierten Helfer nativ an Claude zurück. |
| Codex während eines offenen Testwerkzeugs | Die native Annahme liefert dieselbe Turn-ID. Der Turn bleibt während des offenen Werkzeugs aktiv; erst nach dessen Freigabe sendet Codex die Rückantwort. |
| Rückadresse und Modell-Empfang | Der anfangs ausschließlich Codex bekannte, zufällige Antwortcode erscheint exakt in der ursprünglichen Claude-Session. Die Rückadresse des Antwortbelegs entspricht wiederum der tatsächlichen Codex-ID. |

Beide Fälle sind bestanden. Queue-Fallback ist mit `--native` ausgeschlossen.
Es gibt kein `inbox_read`, keine vom Prüfer weitergereichte Rücknachricht und
keine manuell eingesetzte Absender-ID. Codex lädt den installierten Skill über
den normalen Skill-Input; beide Modelle rufen die installierten Helfer über
ihre Host-Werkzeuge auf. Die Testfreigabe erlaubt ausschließlich den exakten
vorbereiteten Versandbefehl an das jeweils eigene Claude-Testgespräch.

Der Aufbau nutzt einen eigenen stock Codex-App-Server mit kurzem privatem
Control-Socket und eine Claude-CLI mit Stream-JSON-Ein-/Ausgabe. Er ist kein
zusätzlicher interaktiver TUI-Test. Normale Codex-CLI-Starts und Resume am
Standardlistener wurden separat bereits nativ geprüft. Ein aktives Codex-
Werkzeug ist abgedeckt; Empfang während eines aktiven Claude-Werkzeugs wurde
in diesem Lauf nicht gesondert provoziert.

Die anfänglichen Abbrüche betrafen den Prüfer: Ein zu langer Standardpfad
überschritt `SUN_LEN`; gewöhnliche Dateistatus-Abfragen waren für den Windows-
Kompatibilitätssocket ungeeignet; die exakte Freigabeprüfung kannte zunächst
nur Windows PowerShell statt auch PowerShell 7. Der Prüfer verwendet jetzt
einen kurzen Socket, bestätigt die Verbindung per Initialize-RPC und erkennt
beide PowerShell-Varianten. Nach einer vor Ausführung abgelehnten Rückantwort
wurde ein neuer Test mit frischen Gesprächs-IDs gestartet. Unklare Zustellungen
werden weiterhin nicht automatisch wiederholt.

Implementierung: `scripts/probe-installed-native-roundtrip.mjs`, aufgerufen
durch `scripts/probe-package-install.mjs`. Lokaler Ergebnisbericht:
`artifacts/native-delivery/installed-roundtrip.json`. Beide Testfälle und die
Bereinigung sind dort erfolgreich protokolliert; enthalten sind nur Test-IDs,
Sendebelege, Testcodes und Werkzeugfreigaben, keine Anmeldedaten.



## Persönliche Installation am 19. September 2026

Beide bestehenden lokalen Plugin-Quellen wurden gesichert und aus dem Release
0.4.0-preview.3 aktualisiert. Der vorhandene persönliche Codex-Marketplace und
der lokale Claude-Marketplace blieben erhalten. Codex wurde über den offiziellen
Cachebuster-Helfer und `codex plugin add` aktualisiert, Claude über `plugin update`.

- Codex: `0.4.0-preview.3+codex.20260919103531`, installiert und aktiviert.
- Claude Code: `0.4.0-preview.3`, im Benutzerprofil installiert und aktiviert.
- Der stock Codex-App-Server lädt den aktuellen Skill aus dem neuen Cache und
  stellt die sieben bisherigen Postfach-Werkzeuge bereit. Der Prüfthread war
  temporär; kein Modell-Turn wurde gestartet.
- Claude bestätigt die gezielt geprüfte MCP-Verbindung als `Connected`.
- Peer-, MCP-, Broker-Bundle und Skill beider installierter Pakete stimmen per
  SHA-256 mit dem Release überein. Der relative Helferpfad im Skill funktioniert.
- `list --all` aus dem installierten Paket funktioniert. Es beobachtete eine
  Claude-IPC-Session und drei Codex-Queue-Kandidaten. Die Kandidaten sind kein
  Beleg für drei laufende oder empfangsbereite Codex-TUIs.

Prüfer: `scripts/probe-installed.mjs`; Bericht:
`artifacts/installed-host-probe.json`. Er enthält keine Nachrichten oder
Sitzungsinhalte. Es wurden keine Nachrichten verschickt und keine Modelle
aufgerufen. Die vorhandenen nativen Live-Nachweise sind separate Tests.

Laufende Codex- und Claude-Code-CLIs regulär neu starten und neue Sessions
verwenden, damit sie den aktualisierten Skill laden. Für diesen Betriebsweg
wurde kein Listener installiert, kein drittes Terminal eingerichtet und keine
weitere Codex-Installation vorgenommen.

## Alltagstest mit den persönlichen CLI-Installationen

Am 19. September 2026 hat der Benutzer den Hin- und Rückweg mit seinen normal
gestarteten Claude-Code- und Codex-CLI-Sessions bestätigt. Der Hinweg lief über
`codex queue`; die Antwort `VERBINDUNG_OK` kam über Claude-IPC automatisch in
der ursprünglichen Claude-Session an. Ein manuelles Abrufen der Antwort oder
ein zusätzlicher Listener war nicht nötig. Claude sandte keine weitere
Bestätigung, wodurch keine Antwortschleife entstand.

Zwischenzeitlich war die Codex-CLI geschlossen. Die Nachricht lag nachweislich
in ihrer Queue, obwohl die Erkennung weiterhin einen Writer-Lock-Kandidaten
anzeigte. Der Zielthread war als `source: cli` gespeichert; während der Prüfung
lief nur der separate Desktop-App-Server. Nach der Anleitung zum Wiederaufnehmen
der exakten CLI-Session bestätigte der Benutzer die erfolgreiche Rückantwort.
Ein Queue-Kandidat allein garantiert somit weiterhin keinen laufenden Empfänger.

Claude hatte zunächst erklärt, eine Antwort könne die Session nicht automatisch
aktivieren. Der Benutzerbericht korrigiert das ausdrücklich: Die Antwort wurde
ohne Nachfrage direkt zugestellt. Der manuelle Abruf gehört ausschließlich zum
optionalen alten Postfachablauf und ist keine Voraussetzung für Claude-IPC.

Der ausstehende Queue-Eintrag und die lebende Claude-Rückadresse wurden lesend
geprüft. Die erfolgreiche Rückantwort und deren automatische Zustellung sind
vom Benutzer berichtet, nicht durch einen weiteren automatisierten Modelltest
gemessen. Der abgegrenzte Beleg liegt in
`artifacts/native-delivery/personal-cli-roundtrip.json`.

Damit ist der normale Windows-CLI-Ablauf mit Queue-Fallback praktisch bestätigt.
Vollständig native Codex-Zustellung ohne zusätzliche Einrichtung sowie
Desktop-Empfang bleiben davon getrennte, offene Erweiterungen.

## Persönliches Update auf Preview.4

Am 19. September wurden beide bestehenden persönlichen Quellen gesichert und
über die vorhandenen Marketplace-CLI-Befehle aktualisiert. Installiert sind
Codex `0.4.0-preview.4+codex.20260919193553` und Claude `0.4.0-preview.4`.

Die Prüfung verwendete die inzwischen vorhandene Codex-CLI 0.155.1, Claude Code
2.1.278 und Node 22.16.0. Codex lädt den aktualisierten Skill aus dem neuen Cache;
Claude bestätigt die gezielte MCP-Verbindung. Bundles, Skill und beide neuen
Referenzdateien stimmen per SHA-256 mit dem Release überein. Alle sieben
Postfach-Werkzeuge und die lesende Peer-Erkennung funktionieren.

Die gesamte Testsuite bestand mit 47 Tests. Nach der Präzisierung der mehrdeutigen
`vscode`-Herkunft wurden die 14 betroffenen Erkennungs-, Status- und Versandtests
nochmals erfolgreich ausgeführt. Paket-/Host-Prüfungen riefen keine Modelle auf
und verschickten keine Nachrichten. Die vorherigen Live-Rundläufe bleiben
separate Nachweise. Bericht: `artifacts/installed-host-probe.json`.

Laufende CLIs neu starten und neue Gespräche verwenden, um den neuen Skill und
die aktualisierten MCP-Hinweise zu laden. Ein weiterer manueller Nachrichtentest
ist für diese Status- und Anleitungsänderung nicht Voraussetzung.

## Leere Codex-CLI vor der ersten Nachricht

Am 20. September 2026 lief eine gewöhnliche Codex-CLI 0.155.1, während
kein nativer Control-Socket vorhanden war. Zum Startzeitpunkt entstand ein
Writer-Lock ohne zugehörigen Datensatz in der Sitzungsdatenbank. Die Erkennung
übersprang ihn, weil sie Herkunft und Arbeitsordner nicht verlässlich bestimmen
konnte. Der Benutzer bestätigte anschließend: Nach einer ersten normalen
Nachricht wurde die CLI gefunden. Dies ist ein Benutzerbericht mit vorausgehender
Metadatenprüfung, kein automatisierter End-to-End-Test. Leere Locks werden
weiterhin nicht als adressierbare Empfänger ausgegeben.
