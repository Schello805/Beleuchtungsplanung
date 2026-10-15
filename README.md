# 🕯️ Lichternacht Streckenplaner – Bechhofen (91572)

Ein modernes, präzises GIS- und Full-Stack-Webtool zur Planung, Zerschneidung und Helfer-Einteilung für die **Lichternacht Bechhofen**.

---

## ✨ Features & GIS-Architektur

1. **Erfassung & Vorschau (Preview vor dem Speichern):**
   - **Ganze Straße:** Holt Straßenverläufe direkt aus OpenStreetMap via Overpass API.
     - Automatische **„ß“ $\leftrightarrow$ „ss“-Toleranz** (z. B. *Ansbacher Straße* oder *Ansbacher Strasse*).
     - **Topologische Graph-Kettung:** Verbindet getrennte OSM-`way`-Elemente sauber zu zusammenhängenden Linienzügen.
     - Schnelle Autovervollständigung mit 148 Straßen aus Bechhofen.
   - **Teilstück (Interaktiv A $\rightarrow$ B):** Klick auf Startpunkt und Zielpunkt auf der Karte.
     - Exaktes **OSRM Fußgänger-Routing** ohne unerwünschte Stichstraßen oder Wendehämmer.
   - **Einzelner Punkt:** Klick auf die Karte (z. B. Brunnen, Trafostation) mit fester 0 m Kennzeichnung.

2. **Smarte Zerschneidung & Fairness-Logik:**
   - Einstellbare Abschnittslänge (Standard: 100 m).
   - Einstellbare minimale Restlänge (Standard: 50 m).
   - **Fairness-Garantie:** Wenn das allerletzte Teilstück kürzer als die Minimallänge ist (z. B. 18 m), wird es automatisch an den vorletzten Abschnitt angehängt (z. B. 118 m statt 100 m). Niemand muss für einen 15m-Stummel antreten!

3. **Verwaltung & Helfer-Zuweisung:**
   - Farbcodierte Abschnitte mit Hover-Tooltips und interaktiven Popups.
   - Schnelle Zuweisung über ein Dropdown (vorbereitet für ca. 30 Helfer).
   - Helferverwaltung: Beliebig umbenennen, neue Helfer ergänzen, löschen.

4. **Helfer-Statistik & Druckansicht (A4 / PDF):**
   - **Gerechtigkeits-Check:** Balkendiagramm mit Meter-Verteilung pro Helfer und Kennzeichnung von Über- oder Unterlastung.
   - **Druckansicht:** DIN-A4-optimierte Liste für den Veranstaltungsabend mit Helfernamen, zugeteilten Straßen, Meter-Summen und Unterschriftsfeldern zur Materialausgabe.

5. **Datenbank & Datensicherheit:**
   - Schnelle, persistente **SQLite-Datenbank** (`data/streckenplaner.sqlite`).
   - 1-Klick **JSON-Backup (Export & Import)** für Backups vor und nach der Veranstaltung.

---

## 🚀 Lokale Ausführung

### 1. Installation
```bash
npm install
```

### 2. Entwicklungsserver starten
Startet das Express-Backend (Port 3001) und das Vite-Frontend (Port 5173) parallel:
```bash
npm run dev
```
Öffne anschließend [http://localhost:5173](http://localhost:5173) im Browser.

### 3. Produktions-Build & Start
```bash
npm run build
npm start
```
Die App läuft unter einem einzigen Port auf [http://localhost:3000](http://localhost:3000) (oder Port 3001).

---

## 🐧 Installation auf Debian 13 (Trixie) LXC (Proxmox / Linux Container)

Die Anwendung ist für den autonomen Betrieb in einem Proxmox/Debian 13 Container optimiert.

### One-Liner Installation:
In der Konsole des Debian 13 LXC-Containers einfach folgenden Befehl ausführen:
```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/Beleuchtungsplanung/main/install.sh | bash
```

**Was das Skript automatisch erledigt:**
1. Installiert Node.js 22 LTS, Git und Systemtools.
2. Klont das Repository nach `/opt/lichternacht`.
3. Baut das Vite-Frontend und richtet eine leere SQLite-Datenbank ein. Straßen, Abschnitte und Helfer werden erst durch Import oder manuelle Eingabe angelegt.
4. Erstellt und aktiviert den Systemd-Dienst `lichternacht.service` mit automatischem Neustart bei Systemstart.
5. Gibt die direkte IP-Adresse des Containers aus (z. B. `http://192.168.1.xxx:3000`).

### One-Liner Update:
Wann immer du Änderungen auf GitHub pushst, kannst du den Container mit einem einzigen Befehl aktualisieren (bestehende Datenbank wird automatisch gesichert):
```bash
/opt/lichternacht/update.sh
```
oder per Remote-Befehl:
```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/Beleuchtungsplanung/main/update.sh | bash
```

---

## 🕯️ Material- & Kerzenrechner
- Einstellbarer Lichterabstand (Standard: **2,0 Meter**, konfigurierbar auf 1,5m, 2m, 2,5m, 3m).
- Einstellbare Reserve (Standard: **+10%** Puffer für Wind/Bruch).
- Automatische Berechnung der Gesamtanzahl an Windlichtern/Kerzen sowie Kartonrechner (Packungen à 50 und 100 Stück).
- Anzeige des individuellen Materialbedarfs pro Helfer in der Helferliste, auf den ausgedruckten Laufzetteln und im CSV-Export.

---

## 🔐 Öffentlicher Betrieb: Anmeldung und Rechte

Vor einer Freigabe ins Internet muss ein Admin-Konto direkt auf dem Server eingerichtet werden. Das Passwort gehört **nie** nach GitHub und nicht in die SQLite-Datenbank als Klartext.

```bash
sudo nano /etc/lichternacht/lichternacht.env
```

```ini
AUTH_REQUIRED=true
ADMIN_EMAIL=deine-adresse@example.org
ADMIN_NAME=Michael
ADMIN_PASSWORD=ein-langes-einmaliges-passwort-mit-mindestens-12-zeichen
# Nur für den Versand von Helfer-Informationen nötig:
SMTP_PASSWORD=dein-smtp-passwort
```

Danach `sudo systemctl restart lichternacht`. Beim ersten Start erzeugt die Anwendung daraus das Admin-Konto und speichert ausschließlich einen sicheren Passwort-Hash. Ohne eingerichtetes Admin-Konto bleibt der Produktionsserver bewusst auf `127.0.0.1` beschränkt.

Rollen: **Administrator** (Einstellungen, Backups und Benutzer), **Planung** (Plan und Helfer ändern) und **Lesen** (nur ansehen). Administratoren können weitere Zugänge direkt über „Benutzer“ in der Anwendung anlegen.

Die Druckansicht erzeugt pro Helfer einen eigenen öffentlichen Link unter `/helfer/<zufälliger-token>`. Dieser ist nur lesbar und liefert ausschließlich den betreffenden Bereich – nie die Planungsoberfläche oder Stationsliste. Dafür in den globalen Einstellungen die öffentliche HTTPS-Adresse hinterlegen.

Für E-Mails werden SMTP-Host, Port, Benutzer und Absender unter **Admin → Einstellungen & Anleitung** gepflegt. Das SMTP-Passwort bleibt ausschließlich in `/etc/lichternacht/lichternacht.env`. Die Helferliste kann eine Spalte **E-Mail** enthalten; sie wird beim Excel-/CSV-Import übernommen und in beiden Exporten ausgegeben. Vor einem Serienversand zuerst eine Testmail senden.

Für die echte Internetfreigabe zusätzlich einen Reverse Proxy mit HTTPS (z. B. Caddy oder Nginx) und eine Firewall einsetzen. Port 3000 sollte dabei nicht direkt aus dem Internet erreichbar sein.

