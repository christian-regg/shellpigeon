# Nachweis nativer Zustellung

Stand: 18. September 2026. Lokale Versuche unter Windows mit Node 22.16.0,
Codex CLI 0.154.0 und Claude Code 2.1.276.

**Fortschreibung:** Die folgende Seite dokumentiert den ersten Protokollnachweis.
Der anschließend integrierte Helfer und der erfolgreich geprüfte Antwortdialog
sind in [Integration 0.4.0-preview.2](native-integration.de.md) beschrieben.

**Weitere Klärung, 19. September:** Native Zustellung in normale CLI-Neustarts und
Resume ist mit vorhandenem Standardlistener belegt. [Details](codex-standard-endpoint.de.md)

## Ergebnis und Reichweite

Native Zustellung ist nachgewiesen. Ein eigener Nachrichtenbroker war bei diesen
Versuchen nicht beteiligt. Die Helfer transportieren Nachrichten ohne ein Modell
als Vermittler; die Zielmodelle wurden zur Empfangsbestätigung aufgerufen.

| Versuch | Ergebnis | Aussage |
|---|---|---|
| Claude: lokale Named Pipe, wartender Empfänger | Bestanden | Authentisierte Peer-Nachricht erreicht das richtige Gespräch; dessen Modell gibt den nur über IPC gesendeten Zufallscode zurück. |
| Codex: eigener App-Server über stdio, Leerlauf | Bestanden | Eigenständige Tool-Ausgabe startet einen Turn und erscheint als `functionCallOutput`. |
| Codex: eigener App-Server über stdio, laufender Turn | Bestanden | Zustellung bleibt im selben Turn; ein wartender Test-Toolaufruf wird nicht unterbrochen. |
| Codex: separater Control-Socket, stock Proxy und WebSocket, Leerlauf und laufender Turn | Beide bestanden | Dieselben Prüfungen funktionieren über Windows-IPC zwischen getrennten Prozessen. |
| Normal gestartete Codex-CLI: `codex queue` | Bestanden | Exakt adressierte Testsession verarbeitet die Nachricht als gewöhnliche Benutzereingabe und antwortet mit dem Prüf-Code. |
| Standard-Control-Socket bei laufender Codex-App und normaler CLI | Nicht erreichbar | Proxy meldete Windows-Fehler 10050, bevor ein Protokollhandshake möglich war. |
| Native Delegation in eine beliebige bereits geöffnete CLI oder Desktop-Aufgabe | Noch offen | Die Erreichbarkeit und Zuordnung ihres App-Servers ist durch den eigenen Testlistener nicht bewiesen. |

Der Claude-Empfänger war eine selbst gestartete `claude -p`-Session mit offenem
Stream-JSON-Eingang. Ein laufender interaktiver Claude in einem anderen Projekt
wurde nicht angeschrieben. Die Inbound-Einstellung `accept` galt nur für den
Testprozess; bestehende Benutzereinstellungen wurden nicht geändert.

Die Antworten wurden in den Ausgaben der jeweiligen Testgespräche nachgewiesen.
Ein automatisch adressierter Antwortdialog Claude ↔ Codex, Claudes Verhalten
während eines laufenden Tools und die TUI-Darstellung zugeschriebener Delegation
waren bei diesem ersten Nachweis noch nicht geprüft. Der Antwortdialog wurde anschließend erfolgreich ergänzt; siehe Fortschreibung oben. Ein angenommener Transport allein zählt nicht als
Empfang durch das Modell.

## Codex: der konkrete Vertrag

Das lokale experimentelle JSON-Schema enthält `TurnStartParams.toolOutput`.
Der fehlende Variantentyp `externalMessage` in `UserInput` schließt diesen Weg
also nicht aus. Die getestete Anfrage lautet:

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "<verifiziertes Ziel>",
    "input": [],
    "toolOutput": {
      "namespace": "codex_app",
      "name": "send_message_to_thread",
      "output": "<codex_delegation>\n  <source_thread_id><tatsächlicher Absenderthread></source_thread_id>\n  <input><XML-escaped Nachricht></input>\n</codex_delegation>"
    }
  }
}
```

Die Platzhalter sind schematisch. Der Helfer maskiert `&`, `<` und `>` und
verwendet im Versuch die tatsächliche `CODEX_THREAD_ID` als Absender.
Namespace, Toolname und Umschlag sind versionsabhängige Integrationsdetails.

Der Test für aktive Turns hält ein harmloses dynamisches Werkzeug
`asm_probe_gate` offen, sendet dann die Delegationsnachricht und prüft:

1. Die Antwort auf die Zustellung enthält dieselbe Turn-ID.
2. Der Turn ist vor Freigabe des Werkzeugs nicht beendet.
3. Nach Freigabe endet er erfolgreich und antwortet exakt mit dem neuen Prüf-Code.

Die offizielle Dokumentation beschreibt `toolOutput`, seine Darstellung als
`functionCallOutput` und die Übernahme in einen aktiven Turn:
[Codex App Server](https://learn.chatgpt.com/docs/app-server#start-a-turn).
Der konkrete Delegationsumschlag wurde zusätzlich anhand der installierten
Version und des bereitgestellten Agent-Peer-README nachvollzogen und im
Empfangstest verwendet.

### Zwei unterschiedliche Rahmungen

- `codex app-server --listen stdio://`: JSON-RPC als JSON-Zeilen.
- `codex app-server proxy`: Rohbyte-Tunnel zu einem Control-Socket, der einen
  WebSocket-Handshake und WebSocket-Frames erwartet.

Der erste Proxy-Versuch mit JSON-Zeilen lieferte am Testlistener
`failed to upgrade control socket websocket connection`. Nach Umstellung auf
WebSocket bestanden die Empfangstests. Der WebSocket-Client nutzt
[ws](https://github.com/websockets/ws); diese Abhängigkeit wird inzwischen auch in den separaten Peer-Helfer eingebündelt. Der bestehende MCP-Adapter importiert sie nicht.

Codex verlangt ein privates Socket-Verzeichnis. Ein Socket direkt im geerbten
Projektverzeichnis wurde abgewiesen. Der Test erstellt deshalb ein eigenes
Unterverzeichnis und beschränkt unter Windows ausschließlich dessen ACL auf den
aktuellen Benutzer. Bestehende Verzeichnisse werden nicht umkonfiguriert.

## Claude: authentisierte Peer-Zustellung

Der Test wartet auf den registrierten Endpunkt seines eigenen Kindprozesses und
gleicht PID und Session-ID ab. Er liest ausschließlich dessen Peer-Schlüssel,
hält diesen im Prozessspeicher und schreibt ihn weder ins Terminal noch in den
Ergebnisbericht. Auf Windows kommt zuerst eine Auth-Zeile, danach eine
`type: "user"`-Nachricht mit `priority: "immediate"` und dem
`cross-session-message`-Umschlag.

Der Prüf-Code kam nur über diesen lokalen Socket an. Der Empfänger gab ihn in
derselben Session exakt zurück, im gemessenen Versuch nach etwa 2,7 Sekunden.
Die Registrierung nennt diese `-p`-Session `interactive`; entscheidend für die
Einordnung ist der tatsächlich verwendete Startmodus.

Die Herstellerdokumentation beschreibt Named Pipes, Authentisierung,
`-p`-Empfänger und pro Prozess gesetztes `crossSessionInbound`:
[Claude Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

## Wiederholen

Beim ersten Nachweis bestand die vollständige Testsuite mit 31 Tests, darunter drei neue Prüfungen für Umschlag-Escaping, kollidierende RPC-IDs und Sendewiederholungen bei Timeout. Die normalen Tests verwenden keine Modelle. Die ausdrücklich benannten
Live-Proben starten kleine Testgespräche und verwenden die vorhandene
CLI-Anmeldung und Modellauswahl.

```powershell
npm.cmd test
npm.cmd run native:discover
npm.cmd run native:claude
npm.cmd run native:codex
npm.cmd run native:socket
npm.cmd run native:socket -- --delivery
```

- `native:discover`: Nur Initialize und geladene Thread-IDs über den
  Standard-Proxy; startet weder Daemon noch Modell.
- `native:claude`: Eigener Empfänger, Initialbestätigung und eine IPC-Nachricht;
  keine Werkzeuge im Empfänger, Budgetgrenze im CLI-Aufruf.
- `native:codex`: Eigener stdio-App-Server, temporärer Thread, Leerlauf- und
  Aktiv-Test. Erwartet `CODEX_THREAD_ID` des tatsächlich sendenden Codex-Gesprächs.
- `native:socket`: Eigener kurzlebiger stock Listener und Proxy; ohne
  `--delivery` kein Modellaufruf. Mit `--delivery` laufen dieselben zwei
  Codex-Empfangstests über den Socket.

Die Proben enthalten keine automatische Sendewiederholung und keinen stillen
Queue-Fallback. Ein Timeout nach dem Senden kann einen unbekannten Zustellausgang
bedeuten. Ein späterer Adapter muss diesen Fall ausdrücklich behandeln.

Lokale, von Git ausgeschlossene Nachweise stehen unter
`artifacts/native-delivery/`: `claude.json`, `codex-stdio.json`,
`codex-proxy.json`, `explicit-socket.json`, `discovery.json` und
`queue-observation.json`. Die generierten Codex-Schemata liegen dort unter
`schema/`. Die Queue-Beobachtung stammt aus dem kontrollierten CLI-Terminaltest,
nicht aus einer zusätzlichen automatisierten Testfunktion.

## Konsequenz für die nächste Umsetzung

Die nächste Integration sollte native Endpunkte und ihre Fähigkeiten explizit
abbilden. Bei Claude ist der direkte Eingang belegt. Bei Codex ist zuerst der
App-Server einer normal gestarteten Zielsession verlässlich zu finden; ein neu
gestarteter Server übernimmt dieses Gespräch nicht automatisch.

Queue bleibt ein erkennbar anderer Zustellmodus. Gespeichert, am Transport
angenommen, vom Modell gelesen und fachlich erledigt bleiben unterschiedliche
Zustände. Mehrdeutige Ziele und unbekannte Sendeausgänge dürfen keinen geratenen
Empfänger oder automatischen Zweitversand auslösen.

Das ausgelieferte Plugin 0.3.0 bleibt bei seinen getesteten Pull-Postfächern.
Die inzwischen ergänzte native Integration ist im gebauten Vorschaupaket enthalten; die installierten Plugin-Caches wurden noch nicht aktualisiert.
