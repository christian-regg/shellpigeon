# Windows-Dateiaustausch beim Broker-Neustart

## Befund und Ursache

Die Qualitätsprüfung von Preview.6 scheiterte einmal beim Test des automatischen Broker-Neustarts mit STATE_ACCESS_DENIED für broker.json. Fünf isolierte Wiederholungen bestanden; der Fehler blieb zunächst offen.

Der Konflikt lässt sich ohne Broker und ohne simulierte Dateisystemfehler nachstellen: Ein unter Node.js offen gehaltener Windows-Lesehandle auf die Zieldatei lässt rename einer vollständig geschriebenen temporären Datei mit EPERM scheitern. Gleichzeitige Discovery-Lesezugriffe können deshalb die Veröffentlichung des neuen Broker-Deskriptors kurz blockieren. Der bisherige Code unternahm nur einen Versuch; writeDescriptor meldete den Fehler als STATE_ACCESS_DENIED und der neue Broker beendete seinen Start.

Der ursprüngliche Fehlerbericht enthält keine Rohdaten des Windows-Systemaufrufs. Der direkte Versuch belegt denselben problematischen Dateiaustauschpfad und liefert EPERM/rename. Offene Handles und deren Freigabemodus beeinflussen Lösch-/Umbenennungszugriffe auch laut [Microsofts CreateFile-Dokumentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

## Korrektur in Preview.7

[atomic-file.ts](../src/atomic-file.ts) wiederholt ausschließlich das atomare Ersetzen unter Windows bei EACCES, EPERM oder EBUSY. Es gibt höchstens sechs Wiederholungen mit 10, 20, 40, 80, 160 und 320 Millisekunden Pause, insgesamt 630 Millisekunden geplanter Wartezeit zusätzlich zu Dateisystemlaufzeit und Scheduling.

Die ursprüngliche Datei bleibt bis zum erfolgreichen Austausch erhalten. Dauerhafte Zugriffsprobleme werden weiterhin als Fehler gemeldet; die temporäre Datei wird bereinigt. Andere Fehler und andere Betriebssysteme werden nicht erneut versucht. Die exklusive Veröffentlichung des geheimen Tokens bleibt unverändert. Nachrichtenversand wird durch diese Korrektur nicht wiederholt.

## Nachweise

- [Windows-Regressionstests](../tests/atomic-file.test.ts) verwenden echte Node-Dateihandles: Kurzzeitige Sperre wird überstanden; eine anhaltende Sperre bricht begrenzt ab und lässt den bisherigen Inhalt bestehen.
- Der Test für die kurzzeitige Sperre scheitert mit der vorherigen Implementierung und besteht nach der Korrektur.
- Acht parallel lesende Clients mit jeweils fünf Millisekunden gehaltenem Handle und 100 Millisekunden Discovery-Pause: vorher EPERM beim ersten Austausch; nachher 1.000 erfolgreiche Austausche ohne Lesefehler oder unvollständiges JSON.
- Acht dauerhaft ohne Pause lesende Clients können die Datei weiterhin länger als das Wiederholungsbudget blockieren. Der beobachtete Abbruch ist die beabsichtigte Grenze, kein Nachweis beliebiger Dauerlastfestigkeit.
- Der zuvor sporadisch fehlgeschlagene Broker-Neustarttest besteht in zehn aufeinanderfolgenden gezielten Läufen.
- Installation, Wiederholung, synthetisches Versionsupdate, Reparatur und datenerhaltende Deinstallation des Preview.7-ZIPs bestehen in isolierten Codex-/Claude-Profilen, ohne Modellaufrufe.
- Die vollständige lokale Suite besteht mit 52 Tests, ohne übersprungene Tests auf Windows. Bestehende Tests prüfen unter anderem Geheimniserhalt, Broker-Absturz/Neustart, beschädigte Metadaten und exklusive Erstinitialisierung.

Geprüfte Umgebung: natives Windows und Node.js 22.16.0. Dies ersetzt keinen unabhängigen Windows-/Dauerlasttest oder den ersten GitHub-CI-Lauf. Persönliche Plugin-Installationen werden durch Build und temporäre Paketprüfungen nicht geändert.
