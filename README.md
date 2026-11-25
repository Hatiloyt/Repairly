# Repairly

Repairly ist eine lokal startbare Community-Seite für Reparaturanleitungen zu Autos und Motorrädern. Konten, Anmeldung, Anleitungen und Bestätigungen funktionieren über einen kleinen Node-Server ohne zusätzliche Pakete.

## Starten

1. Node.js 22 oder neuer installieren.
2. Im Projektordner `npm start` ausführen.
3. `http://127.0.0.1:3000` im Browser öffnen.

Die Datenbank wird beim ersten Start als `data/repairly.json` angelegt. Sie wird nicht in Git eingecheckt. Zwei Beispielanleitungen werden beim ersten Start eingefügt.

## Funktionen

- Konten erstellen und anmelden; Passwörter werden mit scrypt gehasht und neue E-Mail-Konten müssen bestätigt werden.
- Anmeldung über bestätigte Google-, GitHub- oder Discord-Konten.
- Eine geschützte Sitzung wird in einem HttpOnly-Cookie gehalten.
- Reparaturanleitungen suchen und veröffentlichen, inklusive Arbeitsschritten und optionalen Teile-Links.
- Anleitungen einmal pro Mitglied bestätigen; die eigene Anleitung lässt sich nicht bestätigen.
- Unter Anleitungen kommentieren; Admins können Community-Beiträge als geprüft markieren.
- Öffentliche Profile mit Kurzbiografie, Profilbild, Banner und allen veröffentlichten Anleitungen.
- Mindestens ein Bild pro neuem Beitrag; das erste Bild erscheint als Vorschau in der Anzeigeliste. Weitere Bilder erscheinen an den ersten Arbeitsschritten.
- Anleitungen liken und Benachrichtigungen zu Likes, Kommentaren und Support-Antworten lesen.
- Support-Tickets im Profil weiterführen; Admins können im Admin-Panel im Nachrichtenverlauf antworten.
- Support-Tickets optional als private Discord-Threads öffnen. Antworten aus Discord erscheinen im Repairly-Verlauf.
- Admins können Beiträge im Admin-Panel ansehen, prüfen, testen, erstellen und löschen sowie Nutzer ins Team aufnehmen.
- Nach dem Veröffentlichen einer Anleitung erscheint eine kurze Konfetti-Animation mit Erfolgston.
- Wird eine Supportmeldung geschlossen, erhält ihr Absender beim nächsten Öffnen eine Benachrichtigung mit Konfetti und Erfolgston. Bei Gästen gilt dasselbe Gerät und derselbe Browser.
- Auto oder Motorrad im eigenen Profil speichern; der „Für dich“-Feed sortiert passende Anleitungen nach oben.
- Supportmeldungen absenden und im Admin-Panel bearbeiten.
- Online-Nutzer live sehen, Teammitglieder zu Admins machen und den Wartungsmodus einschalten.
- Kommentare an Anleitungen schreiben; Admins können Community-Anleitungen zusätzlich als geprüft markieren.
- Der Wartungsmodus aktualisiert offene Seiten automatisch und ohne Seitenreload.
- Helles/dunkles Design und Deutsch/Englisch.

Das bestehende Hansi-Konto erhält beim Serverstart die Admin-Rolle. Im Wartungsmodus sehen normale Besucher eine Wartungsseite; Admins können Reparaturen und Einstellungen weiter verwalten. Die Online-Liste zählt angemeldete Nutzer, deren offener Tab zuletzt innerhalb von 60 Sekunden ein Lebenszeichen gesendet hat.

Der Server bindet sich standardmäßig an `127.0.0.1`. Für einen Betrieb im Internet braucht es zusätzlich HTTPS und eine geeignete dauerhafte Datenbank. E-Mail-Versand ist optional; ohne ihn müssen Admins die Bestätigungscodes manuell weitergeben. Die Beispielanleitungen sind Anschauungsmaterial und keine fahrzeugspezifische Herstellerfreigabe.

## E-Mail-Bestätigung und Anmeldung verbinden

Kopiere `.env.example` nach `.env` und trage dort die Zugangsdaten ein. Die Datei wird lokal geladen und ist von Git ausgeschlossen. In der Produktion gehören dieselben Werte in die geheimen Umgebungsvariablen des Hosting-Anbieters.

- `REPAIRLY_PUBLIC_URL` ist die öffentliche Basisadresse, zum Beispiel `https://repairly.example`.
- `RESEND_API_KEY` und `REPAIRLY_FROM_EMAIL` versenden Bestätigungs-E-Mails über Resend. Die Absenderadresse muss in Resend eingerichtet sein.
- Für jeden gewünschten Anbieter `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` oder `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` hinterlegen. Nicht eingerichtete Anbieter werden in der Anmeldung ausgeblendet.

Als Callback-Adresse beim Anbieter exakt `https://DEINE-DOMAIN/api/auth/oauth/google/callback`, `https://DEINE-DOMAIN/api/auth/oauth/github/callback` oder `https://DEINE-DOMAIN/api/auth/oauth/discord/callback` eintragen. Die Domain muss mit `REPAIRLY_PUBLIC_URL` übereinstimmen. Bei lokalen OAuth-Tests `http://127.0.0.1:3000` als Basisadresse und dieselbe Callback-Adresse mit `/api/auth/oauth/…/callback` registrieren.

Neue E-Mail/Passwort-Konten können sich erst nach der Bestätigung anmelden. Ohne E-Mail-Konfiguration wird ein sechsstelliger Code erzeugt und im Admin-Panel unter **E-Mail-Codes** angezeigt; er gilt 24 Stunden und kann einmal verwendet werden. Derselbe Code wird zusätzlich im Server-Terminal ausgegeben. Wenn E-Mail-Versand konfiguriert ist, wird der Code zusammen mit dem Bestätigungslink per E-Mail verschickt. Google-, GitHub- und Discord-Anmeldungen werden nur akzeptiert, wenn der jeweilige Anbieter eine bestätigte E-Mail-Adresse meldet. Für Discord-OAuth sind `DISCORD_CLIENT_ID` und `DISCORD_CLIENT_SECRET` nötig; sie sind unabhängig vom Discord-Support-Bot.

## Discord-Support verbinden

Repairly nutzt einen Discord-Bot und private Threads in einem normalen Textkanal. Erstelle im Discord Developer Portal einen Bot, füge ihn deinem Server hinzu und aktiviere im Bot-Bereich den privilegierten **Message Content Intent**. Gib dem Bot im Support-Kanal die Rechte **View Channel**, **Send Messages**, **Create Private Threads**, **Send Messages in Threads**, **Manage Threads** und **Read Message History**. Teammitglieder brauchen **Manage Threads**, um private Tickets zu sehen.

Setze auf dem Server die Umgebungsvariablen `DISCORD_BOT_TOKEN` und `DISCORD_SUPPORT_CHANNEL_ID`. Der Token gehört ausschließlich in die geheime Server-Konfiguration und nie in `script.js`, Git oder einen öffentlichen Chat. Lokal in PowerShell:

```powershell
$env:DISCORD_BOT_TOKEN = "DEIN_BOT_TOKEN"
$env:DISCORD_SUPPORT_CHANNEL_ID = "ID_DES_SUPPORT_TEXTKANALS"
npm start
```

Neue Website-Tickets erstellen dann einen privaten Thread. Teammitglieder können dort antworten; die Antwort wird in Repairly gespeichert und löst eine Benachrichtigung aus. Statusänderungen aus dem Admin-Panel archivieren den Thread oder öffnen ihn wieder. Ohne beide Variablen bleiben Support-Tickets wie bisher in Repairly und das Admin-Panel zeigt den Discord-Verbindungsstatus an.

## Öffentlich veröffentlichen (Beispiel: Render)

Repairly ist eine Node-Web-App mit Server und API. Auf Render deshalb **Web Service** wählen, nicht Static Site. Das Projekt in ein Git-Repository hochladen und dieses mit Render verbinden. `data/repairly.json` bleibt durch `.gitignore` außerhalb des Repositories.

Beim Render-Service `npm install` als Build Command und `npm start` als Start Command verwenden. `NODE_ENV=production` einschalten. Der Server bindet dann standardmäßig an `0.0.0.0` und liest den von Render vorgegebenen Port.

Die aktuelle Speicherung ist eine JSON-Datei. Für den Einstieg einen persistenten Datenträger bei Render anhängen, dessen Mount Path `/var/data` ist, und `REPAIRLY_DATA_DIR=/var/data` setzen. Ohne persistenten Datenträger gehen neue Konten und Inhalte bei einem Neustart oder Deploy verloren. Ein Datenträger ist auf Render kostenpflichtig und erlaubt nur eine Server-Instanz. Für mehr Nutzer sollte die Dateispeicherung durch PostgreSQL ersetzt werden.

Das lokale Hansi-Konto wird nicht automatisch mit dem Code veröffentlicht. Auf der neuen Website ein Hansi-Konto anlegen, angemeldet im Browser `fetch('/api/session').then(r => r.json()).then(({user}) => console.log(user.id))` ausführen und die angezeigte ID als Render-Variable `REPAIRLY_OWNER_ID` eintragen. Beim nächsten Start bekommt genau dieses Konto Admin-Rechte. Die Datenbank bleibt nur über den Repairly-Server erreichbar; sie sollte nicht direkt für Besucher freigegeben werden.
