# Linux und Ubuntu unter WSL 2

Stand: 20. September 2026, Entwicklungsversion 0.5.0-preview.1.

## Umfang

Lokale Claude-Code- und Codex-CLI-Sessions unter demselben Linux-Benutzer und im selben PID-Namespace. In WSL 2 laufen beide CLIs, Node und ShellPigeon innerhalb derselben Distribution. Die Windows-Versionen und ihre persönlichen Installationen bleiben getrennt. Windows ↔ WSL, verschiedene WSL-Distributionen, macOS, OpenCode und entfernte Rechner gehören nicht zu diesem Meilenstein.

Zum Entwickeln und Testen wird das Linux-Dateisystem verwendet. Node 22.16.0, Codex 0.155.1 und Claude Code 2.1.278 wurden separat in einer Testumgebung installiert. Das Produkt installiert oder bündelt diese Programme nicht.

## Implementierung

- Prozessprüfung über /proc: gleicher Benutzer, passende Prozessstartkennung, identischer PID-Namespace und Abgleich vor/nach dem Lesen. Beendete, nicht lesbare und Zombie-Prozesse ergeben keinen bestätigten Peer.
- Claude: registrierte absolute Unix-Sockets statt Windows-Pipes. Registry, Prozessstart und PID-Domain müssen zusammenpassen; das Ziel muss tatsächlich ein Socket des aktuellen Benutzers sein. Symlinks und gewöhnliche Dateien werden abgewiesen. Die Discovery öffnet keine Probeverbindung zum Claude-Socket.
- Codex: direkte WebSocket-Verbindung zum bestehenden Unix-Control-Socket. Windows verwendet weiterhin den stock Proxy. Es wird kein Server gestartet und kein fremder Thread übernommen.
- Exakte Rückadressen, native Delegation, Queue-Fallback vor dem Versand und das Verbot automatischer Wiederholung bei unklarem Sendeausgang bleiben erhalten.
- Installation aus einem Linux-tar.gz über die nativen Plugin-Kommandos. Pfadkonflikte werden unter Linux unter Beachtung der Gross-/Kleinschreibung geprüft. Optionale Postfachdaten verwenden XDG_DATA_HOME oder ~/.local/share.

## Prüfungen

Der vollständige Satz umfasst 57 registrierte Tests: Windows 54 bestanden / 3 Linux-Prüfungen übersprungen; Ubuntu/WSL 51 bestanden / 6 Windows-Prüfungen übersprungen. Beide Läufe ohne Fehler. Getestet wurden auch nicht ausführbare PATH-Einträge, Unicode/Leerzeichen und unverändert übergebene Shell-Argumente.

Die Linux-Paketprüfung mit echten, nicht angemeldeten Host-Profilen ist bestanden: Entpacken des tar.gz in einen Pfad mit Leerzeichen/Umlaut, Installation beider Hosts, Wiederholung, synthetisches Versionsupdate, Laden der installierten Helfer und Skills, MCP-Anbindung, Reparatur, Deinstallation und Erhalt privater Testdaten. Dafür wurden keine Modelle aufgerufen.

Der echte Modell-Rundlauf mit installierten Paketen ist unter Linux in beiden Fällen bestanden:

| Fall | Nachweis |
|---|---|
| Codex im Leerlauf | Claude-Helfer sendet nativ; Codex antwortet über seinen installierten Helfer; derselbe Claude empfängt den zuvor unbekannten Antwortcode. |
| Codex mit offenem Werkzeug | Die Nachricht wird im bestehenden Turn angenommen, das Werkzeug bleibt ununterbrochen, nach dessen Freigabe trifft die Antwort bei demselben Claude ein. |

Der Test nutzt eigene temporäre Profile und einen stock Codex-App-Server. Die Anfrage wird als delegierte functionCallOutput-Nachricht gespeichert. Queue-Fallback ist in diesen beiden Fällen mit --native ausgeschlossen. Codex' Linux-Sandbox kann einen eigenen PID-Namespace besitzen; für die exakten Antwortbefehle wurde der vorgesehene Host-Zugriff freigegeben. Die bestehenden persönlichen Anmeldungen wurden nur in private Testprofile kopiert und anschliessend wieder entfernt. Testprofile und eigene Prozesse wurden bereinigt.

Auch der gewöhnliche Linux-TUI-Queue-Weg ist bestanden: Eine normale Codex-TUI wurde ohne Listener gestartet, nach ihrer ersten Antwort als Queue-Kandidat erkannt und von einer eigenen Claude-Session mit dem normalen Helfer angeschrieben. Die Queue-Quittung enthielt die exakte Claude-Rückadresse; die Codex-TUI verarbeitete den neuen Turn automatisch und gab den unbekannten Prüfcode korrekt aus. Der Nachweis beruht auf der tatsächlich dargestellten Assistentenantwort in der eigenen Test-TUI. Dieser zusätzliche Fall prüft die Queue-Zustellung; die Rückzustellung an Claude ist durch die beiden nativen Rundläufe separat belegt.

Die GitHub-CI-Matrix umfasst Windows und Ubuntu 24.04. Auf Ubuntu werden zusätzlich die gepinnten Host-CLIs in einem temporären Präfix installiert und die Paketinstallation ohne Anmeldungen oder Modellaufrufe geprüft.

Lokale Berichte sind ignorierte Artefakte; keine Anmeldungen, Testtranskripte oder persönlichen Profile werden in Quellarchiv, Release oder Git-Historie aufgenommen.

## Grenzen

Ein kontrollierter App-Server-Rundlauf ist separat vom Alltagstest einer gewöhnlichen Codex-TUI zu bewerten. Ein Writer-Lock bleibt ein unsicherer Queue-Kandidat. Ein leeres Codex-Gespräch kann vor seiner ersten Nachricht noch keine gespeicherten Metadaten besitzen. Die Host-Richtlinien gelten unverändert.

WSL-Tests allein belegen keine allgemeine Kompatibilität mit jeder Linux-Distribution, Architektur, Container-Konfiguration oder Sicherheitsrichtlinie. Der erste konkrete Zielstand ist Ubuntu auf x86-64, ergänzt um die unabhängige Ubuntu-CI. Die alte Ubuntu-20.04-WSL-Testumgebung ist ein Kompatibilitätstest, keine Empfehlung für eine Neuinstallation.
