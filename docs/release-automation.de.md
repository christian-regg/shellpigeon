# Release-Entwürfe mit GitHub Actions

Der Workflow `Windows, Linux and release drafts` in `.github/workflows/windows.yml` verwendet für normale CI und Releases dieselben Prüfungen. Er veröffentlicht niemals selbst einen Release.

## Ablauf

| Auslöser | Ergebnis |
|---|---|
| Branch-Push, Pull Request oder manueller Workflow-Lauf | Tests und Builds für Windows/Ubuntu, Paketinstallation in isolierten Profilen, geprüfter Kandidat als CI-Artefakt. Keine Release- oder Tag-Erstellung. |
| Push eines passenden Versions-Tags | Derselbe Ablauf, anschließend ein GitHub-Release-Entwurf mit sechs Dateien. |
| Klick auf „Publish release“ nach abgeschlossenem Workflow | Manuelle Veröffentlichung des geprüften Entwurfs. |

Beide Plattformen führen Tests, Quellprüfung, Build, Paketprüfung und eine echte Installation ohne Anmeldungen oder Modellaufrufe durch. Node 22.16.0 und die Host-Versionen sind gepinnt. Auf Ubuntu wird zusätzlich das Quellarchiv des gleichen Commits erstellt.

Der Kandidat enthält Windows-ZIP, Linux-tar.gz und Quell-ZIP, jeweils mit SHA-256-Datei. Build-Belege müssen für Version, Commit und Dateihashes zusammenpassen. Das Quellarchiv darf keine Git-Historie enthalten. Ein zusätzlicher Manifest-Abgleich erfolgt unmittelbar vor dem Upload.

## Einen Release vorbereiten

1. Eine neue Version festlegen. `package.json`, beide Versionseinträge in `package-lock.json` und beide Host-Plugin-Manifeste müssen dieselbe Version enthalten. Versionsangaben in Dokumentation und im nativen Codex-Client ebenfalls nachführen.
2. Im Changelog eine nicht leere Überschrift `## <version> — YYYY-MM-DD` samt Release-Notizen eintragen. Änderungen prüfen und nach `main` mergen.
3. Den Versions-Tag auf den freigegebenen Commit setzen und pushen, zum Beispiel nach Vorbereitung dieser Version:

```sh
git tag -a v0.5.0-preview.2 <freigegebener-commit> -m "ShellPigeon 0.5.0-preview.2"
git push origin v0.5.0-preview.2
```

4. Den erfolgreichen Workflow abwarten. Sein letzter Job verlinkt den Entwurf auf GitHub. Notizen und sechs Downloads kontrollieren, dann „Publish release“ klicken.

Der Tag muss genau `v<package-version>` heißen und auf einen bereits in `main` enthaltenen Commit zeigen. Leere oder undatierte Release-Notizen blockieren einen Tag-Lauf. Versionskennungen mit einem Suffix wie `-preview.2` ergeben eine Vorabversion. Bereits veröffentlichte Versionen bekommen keinen neuen Entwurf.

## Probelauf und Wiederholung

Ein Pull Request prüft den gesamten Weg bis zum Artefakt `release-candidate`. Alternativ lässt sich der vorhandene Workflow unter **Actions → Windows, Linux and release drafts → Run workflow** auf einem Branch starten. Auch ein manueller Lauf auf einem Tag erstellt keinen Entwurf. Die CI-Artefakte werden 14 Tage aufbewahrt.

Der Upload-Code wird mit einer nachgebildeten GitHub-API auf Entwurfserstellung, passende und teilweise vorhandene Dateien, veränderte Tags sowie den Schutz veröffentlichter Releases geprüft. Ein echter Entwurf entsteht erst durch einen neuen freigegebenen Versions-Tag; für Probeläufe werden keine Test-Releases angelegt.

Bei einem unterbrochenen Upload den fehlgeschlagenen Entwurfs-Job mit denselben Artefakten erneut starten. Bereits vorhandene passende Dateien bleiben bestehen; nur fehlende Dateien werden ergänzt. Abweichende Dateien, fremde Commits und bereits veröffentlichte Releases führen zu einem Fehler. Der Workflow löscht oder ersetzt keine Release-Dateien. Ein kompletter Neubau kann aufgrund von Archiv-Zeitstempeln andere Prüfsummen erzeugen und wird daher nicht stillschweigend über einen vorhandenen Entwurf geschrieben.

## Berechtigungen und Grenzen

Build und Kandidatenprüfung haben nur `contents: read`. Ausschließlich der Tag-Job `draft` erhält `contents: write`; dessen Token wird nur dem Upload-Schritt übergeben. Er nutzt GitHubs eingebauten `GITHUB_TOKEN`, keine persönlichen Schlüssel. Checkouts behalten keine Git-Zugangsdaten. Alle verwendeten Actions sind auf Commit-IDs gepinnt.

Der bisherige Windows-Update-Test zwischen zwei veröffentlichten Versionen bleibt separat über `npm run release:upgrade` verfügbar. Die Release-Pipeline testet die Installation und das synthetische Update ihres neu gebauten Pakets auf beiden Plattformen. Authentifizierte Nachrichten-Rundläufe mit Modellen bleiben ausdrücklich gewählte lokale Prüfungen.
