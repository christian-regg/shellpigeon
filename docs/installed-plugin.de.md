# Installiertes Plugin verwenden

**Distributionspaket Preview.5:** Für Neuinstallation, Updates, Reparatur und
Deinstallation auf anderen Rechnern die [Release-Anleitung](../INSTALL.md)
verwenden. Der gemeinsame Installer nutzt einen eigenen Marketplace; eine
vorhandene persönliche Entwicklungsinstallation wird nicht still ersetzt.

**CLI-Betrieb (ab Preview.3):** Normale Sessions auflisten und Nachrichten mit automatischem Codex-Queue-Fallback senden benötigt kein zusätzliches Terminal. Der enthaltene Listener-Einrichter ist optional und keine Voraussetzung für das Plugin-Update. [Normaler Ablauf und native Zusatzoption](codex-cli-operation.de.md)

**Installiert am 19. September 2026:** Beide persönlichen Plugins sind auf 0.4.0-preview.4 aktualisiert. Versionen, Paket-Prüfsummen, geladener Codex-Skill, MCP-Anbindung und lesende Session-Erkennung sind geprüft. [Installationsnachweis und Grenzen](native-integration.de.md#persönliches-update-auf-preview4)

Pakete ab Version 0.4.0-preview.4 enthalten zusätzlich klare Herkunfts-/Laufzeitstatus
und getrennte Skill-Referenzen für die optionalen Abläufe. Node.js ab 22.16 muss als `node` verfügbar sein; es wird noch nicht mitgeliefert. Die normale Nutzung benötigt kein zusätzliches Terminal.

## Alltag

Laufende CLI-Sessions nach dem Update regulär beenden. Claude Code und Codex CLI
wie gewohnt im gewünschten Projekt neu starten und neue Gespräche verwenden.
Dann beispielsweise „Liste die anderen Claude- und Codex-Sessions auf“ anweisen.
Für andere Projekte „Liste alle Sessions auf“ ergänzen. Zum Senden die genaue
Adresse oder den eindeutigen Namen aus dieser Liste verwenden.

Der neue Skill verwendet `dist/peer.cjs`: native Claude-IPC und einen vorhandenen
nativen Codex-Zugang, sonst automatisch die Codex-Queue. Eine beschäftigte Codex-
CLI verarbeitet Queue-Nachrichten nach ihrem aktuellen Turn. Es braucht weder
Postfachregistrierung noch Listener-Einrichtung für diesen Standardablauf.
[Direkte Befehle und Transportgrenzen](codex-cli-operation.de.md).

## Optional: bisherige dauerhafte Pull-Postfächer

Die folgenden Abschnitte beschreiben den weiterhin verfügbaren Postfachablauf
mit unverändertem Broker-Protokoll und Datenbankschema aus Version 0.3.0.
Für diesen gesonderten Ablauf müssen beide Gespräche denselben Projektordner nutzen.
Einmal pro Gespräch ein Postfach anmelden:

> Registriere für dieses Gespräch ein Postfach namens claude-reviewer (beziehungsweise codex-worker) mit session_register. Behalte den Handle privat.

Danach mit `sessions_list` die Gegenseite finden, per `message_send` senden und dort per `inbox_read` abrufen. Antworten erfolgen mit `message_reply`, Empfangsbestätigungen mit `message_ack`.

Die Postfach-Werkzeuge bleiben dieselben. **Dieser optionale Postfachablauf ruft keine Modelle automatisch auf.**

## Broker-Lebenszyklus

Der erste Werkzeugaufruf startet den gemeinsamen Broker bei Bedarf als unsichtbaren Hintergrundprozess. Weitere Adapter verbinden sich mit derselben Instanz. Dafür brauchen sie nur die Dateien im installierten Plugin-Paket.

Unter Windows liegen Daten in `%LOCALAPPDATA%\AgentSessionMessaging`, ansonsten unter `~/.local/share/AgentSessionMessaging`. `BRIDGE_DATA_DIR` überschreibt diesen Ort; für zusammenarbeitende Sessions muss er identisch sein. `BRIDGE_WORKSPACE` kann den Projektordner explizit setzen.

Die exklusiv gehaltene Transaktion in `broker-owner.sqlite` verhindert doppelte Broker. Ein Prozessabsturz gibt diese Betriebssystemsperre automatisch frei. `broker.lock` enthält nur die Instanzkennung und PID für Diagnose sowie die Kompatibilitätsprüfung mit alten Brokern. Ein tatsächlich noch lebender alter Broker wird nicht verdrängt.

Ohne authentisierte Anfragen beendet sich ein automatisch gestarteter Broker nach fünf Minuten. Registrierte, offene Adapter senden Heartbeats. Ein späterer Werkzeugaufruf startet den Broker wieder; Postfächer, Handles und Nachrichten bleiben erhalten. Die bestehende Nachrichtenfrist von 24 Stunden bleibt unverändert.

Version 0.3 verwendet Broker-Protokoll 2 und Datenbankschema 2. Ein laufender 0.2-Broker wird beim normalen Zugriff mit `PROTOCOL_MISMATCH` abgelehnt. `doctor` kann ihn diagnostizieren, `stop` ihn kontrolliert beenden. Neue Adapter starten danach den aktuellen Broker.

## Diagnose

Im installierten Plugin-Verzeichnis:

~~~powershell
node .\dist\broker.cjs doctor
node .\dist\broker.cjs stop
~~~

`stop` beendet ausschließlich die authentisierte Broker-Instanz. Offene Adapter können sie beim nächsten Aufruf erneut starten. Zum dauerhaften Beenden die betreffenden Sessions schließen oder das Plugin deaktivieren.

`doctor` arbeitet auch bei gestopptem Broker und zeigt `ready`, `stopped`, `not-initialized` oder `attention`. Nur `attention` liefert Exit-Code 1. Der Bericht enthält Dateibefunde, Schema, SQLite-Quick-Check, Besitzer-PID, Fristen und Loggrößen; weder Token noch Texte. Der Befehl startet keinen Broker, migriert nichts und repariert keine Dateien.

Startfehler erscheinen als Fehlercode mit Reparaturhinweis. Soweit Logging möglich ist, stehen Ereignisse zusätzlich in `broker.log` im Datenverzeichnis. Die MCP-Ausgabe auf stdout enthält ausschließlich Protokolldaten; Hintergrundprotokolle enthalten keine Nachrichtentexte oder Handles.

`BRIDGE_AUTOSTART=0` deaktiviert den Autostart für Tests oder manuell verwaltete Broker. Ungültige alte Sperrdateien werden nicht ungeprüft entfernt. Die Diagnose muss klären, ob deren PID noch lebt.

## Aufbewahrung und Bereinigung

Die Abruffrist beträgt weiterhin 24 Stunden. Standardmäßig löscht der laufende Broker Nachrichtentexte nach 7 Tagen und Nachrichtenmetadaten nach 30 Tagen. Die Fristen gelten auch für bestätigte Nachrichten; eine Bestätigung löscht nicht sofort.

Optional im Datenverzeichnis eine UTF-8-Datei `retention.json` anlegen:

~~~json
{"mode":"automatic","contentDays":7,"dedupDays":30}
~~~

Zulässig sind `automatic` oder `manual` und ganzzahlige Tage von 2 bis 3650; `dedupDays` muss mindestens `contentDays` sein. Ungültige Konfiguration verhindert den Start. Änderungen werden beim nächsten Broker-Start eingelesen und gelten für danach angelegte Nachrichten. Bestehende Fristen bleiben erhalten; `manual` pausiert auch deren automatische Bereinigung.

Jede Nachricht liefert `contentExpiresAt` und `retentionUntil` als Unix-Zeit in Millisekunden. Nach Textlöschung sind `body: ""` und `contentDeletedAt` gesetzt. Bis zum Löschen der Metadaten bleiben Sendewiederholungen mit unverändertem Schlüssel und Inhalt idempotent; ein gespeicherter SHA-256-Fingerabdruck erkennt abweichende Inhalte auch ohne Text. Der Fingerabdruck ist kein Verschlüsselungs- oder Anonymisierungsverfahren. Spätestens ab `retentionUntil` nicht mehr blind wiederholen: nach erfolgter Bereinigung kann derselbe Schlüssel eine neue Nachricht erzeugen. `message_status` liefert dann `NOT_FOUND`.

Antworten behalten die ursprüngliche Nachrichten-ID und Gesprächs-ID auch dann, wenn die ursprünglichen Metadaten schon gelöscht wurden. Neue Antworten auf gelöschte Originale sind nicht möglich; bereits gespeicherte Antworten bleiben innerhalb ihrer eigenen Frist wiederholbar.

Der Broker bereinigt alle 60 Sekunden maximal 1.000 Texte und 1.000 Metadatensätze pro Durchlauf. Im Stillstand erfolgt nichts. Manuelle Vorschau beziehungsweise Ausführung gegen einen laufenden Broker:

~~~powershell
node .\dist\broker.cjs prune
node .\dist\broker.cjs prune --apply
~~~

Ohne `--apply` gibt es keine Löschung. `due` zählt fällige Datensätze vor dem Durchlauf, `applied` die tatsächlich bearbeiteten Datensätze. Bei mehr als 1.000 fälligen Einträgen weitere Durchläufe ausführen. Die Wartung ist durch Broker-Token und Instanz-ID geschützt und wird nicht als MCP-Werkzeug angeboten.

`broker.log` und drei Archive sind auf jeweils 1 MiB begrenzt. Übermäßig große Logs aus 0.2 werden bei Übernahme auf ihren jüngsten vollständigen Ausschnitt gekürzt. Logfehler während des Betriebs erscheinen in `doctor`, ohne erfolgreiche Nachrichtenoperationen abzubrechen.

Die Bereinigung ist logisches Löschen, keine garantierte forensische Löschung: WAL, Dateisystem und Sicherungen können ältere Kopien enthalten. SQLite nutzt frei gewordene Seiten wieder; die Datei schrumpft nicht automatisch. Session-Lebenszyklus, Archivierung und Backup-Aufbewahrung folgen später.

## Update von 0.2 auf 0.3

1. Alte Sessions schließen, damit deren Adapter keinen Broker neu starten.
2. Mit dem bisherigen oder neuen `broker.cjs stop` den Broker beenden. Vor dem Kopieren prüfen, dass er beendet ist.
3. Das vollständige Datenverzeichnis einschließlich Token, Datenbank und etwaiger WAL-Dateien bei gestopptem Broker zusammenhängend sichern. Die Sicherung enthält private Daten und braucht dieselben Zugriffsrechte.
4. Beide Plugin-Pakete aktualisieren. Codex-Setup am dauerhaften Ort ausführen und über den persönlichen Marketplace neu installieren; Claude über den lokalen Marketplace aktualisieren.
5. Neue Sessions öffnen. Der erste Zugriff migriert Schema 1 atomar auf Schema 2. Bestehende Postfächer, Handles, Texte, ACKs und Antwortbezüge bleiben erhalten. Bestehende Texte erhalten volle 7 Tage, Metadaten volle 30 Tage ab Migration beziehungsweise die dann konfigurierte Dauer.
6. Mit `doctor` Version, Schema und Fristen prüfen.

Migration und Schema-Version werden in derselben SQLite-Transaktion geschrieben. Fehler oder ein Prozessabbruch vor dem Commit lassen Schema 1 wiederherstellbar. Schema-Versionen aus der Zukunft werden abgelehnt. Es gibt keinen automatischen Downgrade: 0.2 lehnt Schema 2 ab. Für eine Rückkehr müssen bei gestoppten Hosts die gesicherte Datenbank und passende Zugangsdaten zusammen wiederhergestellt werden; seit der Sicherung hinzugekommene Daten fehlen darin. Ein allgemeiner Backup-/Restore-Befehl ist noch nicht implementiert.

Fehlerhilfe:

| Code | Bedeutung und nächste Aktion |
|---|---|
| `TOKEN_INVALID` / `TOKEN_MISSING` | Bei bestehender Installation ursprünglichen Token aus Sicherung wiederherstellen; kein stiller Schlüsselwechsel. |
| `DESCRIPTOR_INVALID` | `broker.json` und Besitzer prüfen; erst bei gestopptem Broker reparieren, Datenbank/Token behalten. |
| `PROTOCOL_MISMATCH` | Beide Plugins aktualisieren, alten Broker stoppen, neue Sessions verwenden. |
| `STATE_ACCESS_DENIED` / `STATE_IO_ERROR` | Pfad, Zugriffsrechte, Speicherplatz und Dateisystem prüfen. |
| `OWNER_STATE_ERROR` / `LOCK_INVALID` | Besitzerzustand beziehungsweise Sperrdatei untersuchen; keinen lebenden Besitzer übergehen. |
| `MIGRATION_FAILED` / `DATABASE_START_FAILED` | Daten erhalten und Integrität, Rechte sowie Speicherplatz prüfen; keine Schema-Version manuell setzen. |
| `DATABASE_NEWER` | Kompatiblen Broker verwenden; kein Downgrade durch Änderung des Versionsfelds. |
| `RETENTION_INVALID` | Konfiguration auf zulässige Werte korrigieren. |
| `LOG_IO_ERROR` | Rechte und Speicherplatz für Logs prüfen. |

## Lokale Installation und Entwicklung

`npm run package` baut vollständige Pakete unter `artifacts/release/0.4.0-preview.4`. Die Pakete enthalten Peer-Helfer, MCP-Server, Broker und Skill, aber weder Datenbank noch Geheimnisse. Sie benötigen keine Repo-Dependencies nach dem Kopieren.

Für Codex wird das Paket über den persönlichen Marketplace eingebunden. Für die erste lokale Registrierung verwenden wir den Plugin-Creator-Scaffolder; für Updates dessen Cachebuster-Helfer und anschließend `codex plugin add agent-session-messaging@personal`. Der persönliche Marketplace liegt unter `~/.agents/plugins/marketplace.json`; die Plugin-Quelle liegt standardmäßig unter `~/plugins/agent-session-messaging`.

Claude erhält den eigenständigen Ordner `claude-marketplace` als lokalen Marketplace:

~~~powershell
claude plugin marketplace add "<absoluter Pfad zum claude-marketplace-Ordner>"
claude plugin install agent-session-messaging@agent-session-messaging-local --scope user
~~~

Codex 0.154.0 ersetzt in MCP-Argumenten weder `${PLUGIN_ROOT}` noch `${CLAUDE_PLUGIN_ROOT}`. Deshalb das Codex-Paket zuerst an seinen dauerhaften Ort kopieren und dort einmal `node .\setup.cjs` ausführen. Dieser mitgelieferte Einrichtungsschritt trägt den Node-Pfad und den MCP-Dateipfad ein; danach das Plugin über den persönlichen Marketplace installieren. Der Projekt-Arbeitsordner bleibt vom Host vorgegeben. Nach einem Umzug der Plugin-Quelle den Einrichtungsschritt und die Plugin-Installation wiederholen.

Der optionale Listener-Einrichter `setup-listener.ps1` ist davon unabhängig und
wird für dieses Plugin-Update nicht ausgeführt.

Die lokale Quelle muss nach der Registrierung erhalten bleiben. Bei einer Installation aus einem lokalen Ordner kann Claude das Plugin direkt dort laden. Deshalb werden die Pakete für den täglichen Betrieb aus dem Projektordner in eine dauerhafte lokale Quelle kopiert.

## Deinstallation

~~~powershell
codex plugin remove agent-session-messaging@personal
claude plugin uninstall agent-session-messaging@agent-session-messaging-local --scope user
~~~

Anschließend die betroffenen Sessions schließen. Der Hintergrund-Broker beendet sich nach seiner Leerlauffrist. Die Deinstallation behält private Postfächer und Nachrichten im Datenverzeichnis; ein Löschen dieser Daten ist eine separate Entscheidung.

## Grenzen

- CLI-Erkennung und Versand über den Peer-Helfer; die MCP-Werkzeuge dienen weiterhin den optionalen Pull-Postfächern. Keine eigene Codex-Oberfläche.
- Ohne nativen Codex-Zugang verwendet der Standardversand die Queue. Native Zustellung während eines laufenden Codex-Turns braucht weiterhin einen passenden erreichbaren Endpunkt.
- Lokaler Betrieb für einen Betriebssystembenutzer; noch kein eigener Windows-ACL-Installer.
- Die Erstinstallation auf diesem Entwicklungsrechner ist lokal. Ein öffentliches Release, ein allgemeiner Installer und eine gebündelte Node-Runtime sind noch nicht vorhanden.
- SQLite-Autostart und Pfadauflösung werden unter Windows getestet. macOS/Linux sind noch nicht nativ geprüft.

Quellen zur Host-Installation: [Claude Plugin-Marktplätze](https://code.claude.com/docs/en/plugin-marketplaces), [Codex Plugin-Paketierung](https://developers.openai.com/plugins/build/plugins).
