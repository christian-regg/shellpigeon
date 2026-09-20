# Release-Vorbereitung: ShellPigeon 0.4.0-preview.7

Stand: 20. September 2026. Ziel ist eine öffentliche Windows-Preview für gewöhnliche Claude-Code- und Codex-CLI-Sessions.

## Fehlerkorrektur in Preview.7

Die abschließende Prüfung von Preview.6 fand einen sporadischen Windows-Zugriffsfehler beim Broker-Neustart. Der atomare Austausch von `broker.json` konnte mit gleichzeitig lesender Discovery kollidieren. Preview.7 wiederholt nur diesen Dateiaustausch begrenzt; dauerhafte Fehler und die bisherigen Daten bleiben erhalten. Der gezielte Regressionstest scheitert vorher und besteht nachher. 52 Tests und 1.000 Dateiaustausche bei regelmäßig lesenden Clients bestehen. [Ursache, Korrektur und Grenzen](windows-file-replacement.de.md).

## Projektname ab Preview.6

Der bestätigte öffentliche Name ist **ShellPigeon**, mit dem Untertitel „Local messaging between Claude Code and Codex sessions.“ Der vorgesehene Repository-Name ist `shellpigeon`. Anzeigenamen, Hilfetexte und Nachrichtenüberschriften verwenden ShellPigeon; Release- und Quell-ZIPs heißen `shellpigeon-<version>-windows.zip` beziehungsweise `shellpigeon-<version>-source.zip`.

Die bestehenden Plugin-/Marketplace-Kennungen `agent-session-messaging`, der Skill `session-messaging`, Transportkennungen und private Datenpfade bleiben kompatibel. Eine reine Namensänderung erfordert keine Migration. Bestehende Installationsverzeichnisse bleiben beim Update am bisherigen Ort. Persönliche Installationen werden durch den Build nicht aktualisiert.

Die Namensübernahme in Preview.6 ist geprüft: 50 Tests, Skill-/Plugin-Validierung und das neue ShellPigeon-ZIP einschließlich Installation, Wiederholung, synthetischem Versionsupdate, Reparatur und datenerhaltender Deinstallation in isolierten Profilen bestanden. Es wurden dabei keine Modelle aufgerufen und keine persönlichen Installationen geändert.

## Schritt 3: Projektstand sichern

Der CLI-Stand aus Preview.4 ist im lokalen Commit `c289ed0` gesichert. 47 Tests bestanden. Dokumentation und Changelog beschreiben Queue-Fallback, native Zustellung, Rückadressen, Statusgrenzen sowie den bestätigten Fall einer leeren Codex-CLI: Erst nach der ersten normalen Nachricht war sie über gespeicherte Metadaten auffindbar.

Persönliche Benutzer- und Projektpfade wurden aus aktuellen Beispielen entfernt. Die Prüfung der damaligen 126 Git-Blobs fand keine der geprüften Zugangsdatenmuster. Zwei historische Fassungen eines Installationsberichts enthalten frühere lokale Benutzerpfade. Die Prüfung ist musterbasiert und kein Nachweis, dass keinerlei Geheimnisse existieren. Rohberichte, Testprofile, private Sitzungsdaten und Upstream-Checkouts bleiben unter dem ignorierten `artifacts/`.

Für eine öffentliche Erstveröffentlichung ist ein Quell-Snapshot des geprüften aktuellen Commits ohne lokale Entwicklungshistorie vorgesehen. Das bestehende lokale Repository wird dafür nicht umgeschrieben.

## Schritt 4: Installation und Weitergabe

Preview.5 ergänzt einen gemeinsamen Node-Installer, einen eigenen distributierbaren Marketplace pro Host und vollständige Lizenztexte der tatsächlich gebündelten Bibliotheken. Installation benötigt weder Python noch lokal vorhandene Codex-Skills. Die Programme werden in einem permanent entpackten Release-Verzeichnis gehalten; der Installer registriert dieses über die vorhandenen Host-Befehle.

- `--check` prüft Paketdateien, Host-Versionen und Konflikte vor Installationsänderungen.
- Auswahl von Codex, Claude oder beiden Hosts.
- Kein eigener Listener, Autostart, zusätzlicher Codex-Download oder Modell-Turn.
- Bestehende Installationen aus anderen Marketplaces werden ausdrücklich zur Migration gemeldet.
- Wiederholte Installation sowie Wiederholung nach einem Fehler sind möglich. Bereits erfolgreich aktualisierte Hosts werden bei einem Fehler des zweiten Hosts nicht zurückgerollt.
- Reparatur generiert die lokalen MCP-Pfade erneut; Deinstallation behält private Daten und Marketplace-Programmdateien.
- ZIP-Archiv, Datei-Inventar, SHA-256 und `THIRD-PARTY-NOTICES.txt` sind Bestandteil der Paketierung. Prüfsummen sind keine Signaturen.

## Validierung

50 Tests bestanden, einschließlich zusätzlicher Grenzen gegen falsche Marketplace-Ziele, doppelte Installationen, beschädigte Paketdateien und Pfade außerhalb des Pakets.

Der isolierte Installationstest entpackte das echte ZIP in einen Pfad mit Leerzeichen und Umlaut. Beide Hosts installierten es, wiederholten die Installation und aktualisierten eine synthetische ältere Manifestversion auf Preview.5. Die ältere Testversion dient der Prüfung der Host-Caches; sie ist kein eigenständiger historischer Release-Nachweis. Codex lud den Skill und alle sieben optionalen MCP-Werkzeuge; Claude meldete die MCP-Verbindung als verbunden. Installierte Helfer und Skills stimmten mit den Release-Prüfsummen überein. Reparatur und Deinstallation bestanden, ein privater Testdatensatz blieb erhalten. Testprofile wurden bereinigt. Keine Modelle oder Nachrichten wurden ausgelöst.

Geprüfte Umgebung: Codex 0.155.1, Claude Code 2.1.278, Node 22.16.0, natives Windows. Der Prüfer ist `scripts/probe-package-install.mjs`; der lokale Bericht liegt in `artifacts/package-install-probe.json`. Die früheren Live-Nachweise bleiben in [native-integration.de.md](native-integration.de.md) getrennt dokumentiert. Die persönlichen Installationen verbleiben bis zu einem gesonderten Update auf Preview.4.

Die Windows-GitHub-Actions-Datei verwendet auf Commit-IDs gepinnte offizielle Actions. Sie baut und prüft ohne persönliche Host-Anmeldungen und ohne Modelle. Aktuelle Ergebnisse stehen unter [GitHub Actions](https://github.com/christian-regg/shellpigeon/actions/workflows/windows.yml). Tests mit installierten Host-CLIs auf einem weiteren, frisch eingerichteten Windows-System stehen separat aus.

## Lizenz

ShellPigeon steht unter der [MIT-Lizenz](../LICENSE), mit dem Copyright-Hinweis „Copyright (c) 2026 Christian“ entsprechend dem bisherigen Autoreneintrag. `package.json`, Lockfile und beide Plugin-Manifeste tragen die Kennung `MIT`. Das Release enthält die vollständige Projektlizenz im Wurzelverzeichnis und in beiden Host-Paketen; das Quellarchiv enthält sie ebenfalls. Die bestehenden Lizenztexte der Abhängigkeiten bleiben separat erhalten.

## Veröffentlichung

Das öffentliche Repository ist [christian-regg/shellpigeon](https://github.com/christian-regg/shellpigeon). Seine Historie beginnt mit einem bereinigten Quell-Snapshot; die lokale Entwicklungshistorie wird nicht übertragen.

- Änderungen, Paketinventar, Lizenzdateien und Prüfsummen vor dem Upload prüfen.
- Den geprüften Quellstand hochladen und einen erfolgreichen Windows-CI-Lauf für dessen Commit abwarten.
- Erst danach die geprüften ZIP-/SHA-256-Dateien als Preview-Release anhängen.

Der öffentliche Release-Check (`--require-license`) prüft die Lizenzangabe und die enthaltenen Lizenzdateien zusätzlich zu Prüfsummen und Dateiinventar. Release-Status und veröffentlichte Pakete sind auf [GitHub](https://github.com/christian-regg/shellpigeon/releases) einsehbar.

Vollständige Desktop-Unterstützung, weitere Plattformen, eine gebündelte Node-Runtime, der allgemeine Windows-Daemon-Lebenszyklus sowie die zusätzliche Produktionshärtung der optionalen Postfächer sind separate Ausbaupunkte.
