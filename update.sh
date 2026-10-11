#!/usr/bin/env bash
# ==============================================================================
# Lichternacht Streckenplaner - Update-Skript für Debian 13 (Trixie) LXC
# ==============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}==>${NC} Starte Update für Lichternacht Streckenplaner..."

# 1. Root-Rechte prüfen
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}[Fehler]${NC} Dieses Skript muss als root ausgeführt werden."
    exit 1
fi

INSTALL_DIR="/opt/lichternacht"

if [ ! -d "$INSTALL_DIR" ]; then
    # Falls das Skript direkt im Projektverzeichnis aufgerufen wird
    INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

cd "$INSTALL_DIR"

# 2. Datenbank sichern (Sicherheitskopie vor Update)
if [ -f "$INSTALL_DIR/data/streckenplaner.sqlite" ]; then
    echo -e "${BLUE}==> [1/4]${NC} Sichere bestehende SQLite-Datenbank..."
    cp "$INSTALL_DIR/data/streckenplaner.sqlite" "$INSTALL_DIR/data/streckenplaner.backup-$(date +%Y%m%d_%H%M%S).sqlite"
    DB_BACKUP=$(mktemp)
    cp "$INSTALL_DIR/data/streckenplaner.sqlite" "$DB_BACKUP"
    echo -e "${GREEN}✓${NC} Backup erstellt."
fi

# 3. Neuesten Code von Git laden
echo -e "\n${BLUE}==> [2/4]${NC} Lade neueste Änderungen von GitHub..."
git fetch origin main
git reset --hard origin/main
git checkout -B main origin/main
if [ -n "${DB_BACKUP:-}" ]; then
    mkdir -p "$INSTALL_DIR/data"
    cp "$DB_BACKUP" "$INSTALL_DIR/data/streckenplaner.sqlite"
    rm -f "$DB_BACKUP"
fi

# 4. Abhängigkeiten aktualisieren & Frontend bauen
echo -e "\n${BLUE}==> [3/4]${NC} Installiere Abhängigkeiten und baue Frontend..."
npm install
npm run build

# 5. Dienst neustarten
echo -e "\n${BLUE}==> [4/4]${NC} Starte Systemd-Dienst neu..."
if systemctl list-unit-files | grep -q lichternacht.service; then
    # Die Version im Repository enthält sicherheitsrelevante Dienstoptionen
    # (z. B. die geschützte Environment-Datei). Lokale Zugangsdaten liegen
    # ausschließlich unter /etc/lichternacht und werden dabei nicht berührt.
    if [ -f "$INSTALL_DIR/lichternacht.service" ]; then
        cp "$INSTALL_DIR/lichternacht.service" /etc/systemd/system/lichternacht.service
        mkdir -p /etc/lichternacht
        if [ ! -f /etc/lichternacht/lichternacht.env ]; then
            cat > /etc/lichternacht/lichternacht.env << 'EOF'
# Vor einem öffentlichen Zugriff ausfüllen. Diese Datei bleibt ausschließlich auf dem Server.
AUTH_REQUIRED=true
ADMIN_EMAIL=admin@example.org
ADMIN_NAME=Administrator
ADMIN_PASSWORD=BITTE_HIER_EIN_LANGES_EINMALIGES_PASSWORT_SETZEN
EOF
            chmod 600 /etc/lichternacht/lichternacht.env
            echo -e "${YELLOW}!${NC} Administrator noch einrichten: /etc/lichternacht/lichternacht.env bearbeiten und Dienst neu starten."
        fi
        systemctl daemon-reload
    fi
    systemctl restart lichternacht
    sleep 2
    if systemctl is-active --quiet lichternacht; then
        echo -e "${GREEN}✓ Dienst 'lichternacht' erfolgreich neugestartet und aktiv!${NC}"
    else
        echo -e "${YELLOW}! Warnung: Dienst konnte nicht sauber starten. Logs prüfen: journalctl -u lichternacht -n 20${NC}"
    fi
else
    echo -e "${YELLOW}! Systemd-Dienst 'lichternacht' nicht registriert.${NC}"
fi

echo -e "\n${GREEN}========================================================================${NC}"
echo -e "${GREEN}  ✓ UPDATE ERFOLGREICH DURCHGEFÜHRT!${NC}"
echo -e "${GREEN}========================================================================${NC}\n"
