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
Die App läuft unter einem einzigen Port auf [http://localhost:3001](http://localhost:3001).
