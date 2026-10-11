#!/usr/bin/env bash
# ==============================================================================
# Lichternacht Streckenplaner - One-Liner Installer für Debian 13 (Trixie) LXC
# ==============================================================================
set -e

# Farben für Terminal-Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${YELLOW}"
cat << "EOF"
  _      _      _     _                               _     _   
 | |    (_)    | |   | |                             | |   | |  
 | |     _  ___| |__ | |_ ___ _ __ _ __   __ _  ___| |__ | |_ 
 | |    | |/ __| '_ \| __/ _ \ '__| '_ \ / _` |/ __| '_ \| __|
 | |____| | (__| | | | ||  __/ |  | | | | (_| | (__| | | | |_ 
 |______|_|\___|_| |_|\__\___|_|  |_| |_|\__,_|\___|_| |_|\__|
           Strecken- & Beleuchtungsplaner (Bechhofen)
EOF
echo -e "${NC}"
echo -e "${BLUE}==>${NC} Starte Installation auf Debian 13 LXC..."

# 1. Root-Rechte prüfen
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}[Fehler]${NC} Dieses Installationsskript muss als root ausgeführt werden."
    echo -e "Bitte mit 'sudo bash install.sh' oder als root starten."
    exit 1
fi

# 2. Repository-URL ermitteln (per Parameter oder Umgebungsvariable)
REPO_URL="${1:-${GITHUB_REPO:-https://github.com/Schello805/Beleuchtungsplanung.git}}"

if [ -z "$REPO_URL" ]; then
    echo -e "${CYAN}Bitte gib die GitHub Repository-URL ein:${NC}"
    read -r -p "GitHub URL (z.B. https://github.com/nutzer/lichternacht.git): " REPO_URL
fi

if [ -z "$REPO_URL" ]; then
    echo -e "${RED}[Fehler]${NC} Keine Repository-URL angegeben. Abbruch."
    exit 1
fi

INSTALL_DIR="/opt/lichternacht"
PORT="${PORT:-3000}"

echo -e "${BLUE}==>${NC} Repository: ${CYAN}${REPO_URL}${NC}"
echo -e "${BLUE}==>${NC} Ziel-Verzeichnis: ${CYAN}${INSTALL_DIR}${NC}"
echo -e "${BLUE}==>${NC} Web-Port: ${CYAN}${PORT}${NC}"

# 3. System aktualisieren & Basispakete installieren
echo -e "\n${BLUE}==> [1/6]${NC} Aktualisiere Paketquellen und installiere Systemwerkzeuge..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    build-essential \
    python3

# 4. Node.js 22 LTS via NodeSource installieren (falls nicht vorhanden oder älter)
echo -e "\n${BLUE}==> [2/6]${NC} Prüfe und installiere Node.js 22 LTS..."
NEED_NODE=true
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v | tr -d 'v' | cut -d. -f1)
    if [ "$NODE_VER" -ge 22 ]; then
        echo -e "${GREEN}✓${NC} Node.js $(node -v) ist bereits installiert."
        NEED_NODE=false
    fi
fi

if [ "$NEED_NODE" = true ]; then
    echo -e "Richte NodeSource Repository für Node.js 22 ein..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
    echo -e "${GREEN}✓${NC} Node.js $(node -v) erfolgreich installiert."
fi

# 5. Repository klonen oder aktualisieren
echo -e "\n${BLUE}==> [3/6]${NC} Lade Projektdateien herunter..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "Verzeichnis existiert bereits, aktualisiere..."
    cd "$INSTALL_DIR"
    DB_BACKUP=""
    if [ -f "$INSTALL_DIR/data/streckenplaner.sqlite" ]; then
        DB_BACKUP=$(mktemp)
        cp "$INSTALL_DIR/data/streckenplaner.sqlite" "$DB_BACKUP"
    fi
    git fetch origin
    git reset --hard origin/main
    git checkout -B main origin/main
    if [ -n "$DB_BACKUP" ]; then
        mkdir -p "$INSTALL_DIR/data"
        cp "$DB_BACKUP" "$INSTALL_DIR/data/streckenplaner.sqlite"
        rm -f "$DB_BACKUP"
    fi
else
    mkdir -p "$INSTALL_DIR"
    git clone --branch main --single-branch "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 6. Abhängigkeiten installieren & Frontend bauen
echo -e "\n${BLUE}==> [4/6]${NC} Installiere npm-Abhängigkeiten und kompiliere Frontend..."
cd "$INSTALL_DIR"
npm ci || npm install
npm run build

# Stelle sicher, dass das Datenverzeichnis existiert und beschreibbar ist
mkdir -p "$INSTALL_DIR/data"

# 7. Systemd Service einrichten & aktivieren
echo -e "\n${BLUE}==> [5/6]${NC} Konfiguriere Systemd-Dienst (Autostart)..."
NODE_PATH=$(which node)
NPM_PATH=$(which npm)

cat > /etc/systemd/system/lichternacht.service << EOF
[Unit]
Description=Lichternacht Streckenplaner
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NPM_PATH} run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PORT}
EnvironmentFile=-/etc/lichternacht/lichternacht.env

[Install]
WantedBy=multi-user.target
EOF

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

chmod 755 "$INSTALL_DIR/update.sh" 2>/dev/null || true

systemctl daemon-reload
systemctl enable lichternacht
systemctl restart lichternacht

# 8. Status prüfen
echo -e "\n${BLUE}==> [6/6]${NC} Prüfe Dienst-Status..."
sleep 2
if systemctl is-active --quiet lichternacht; then
    echo -e "${GREEN}✓ Dienst läuft einwandfrei!${NC}"
else
    echo -e "${YELLOW}! Dienst startet noch oder hat Warnungen. Logs mit 'journalctl -u lichternacht -e' prüfen.${NC}"
fi

# IP-Adressen ermitteln
IP_ADDR=$(hostname -I | awk '{print $1}')

echo -e "\n${GREEN}========================================================================${NC}"
echo -e "${GREEN}  ✓ INSTALLATION ERFOLGREICH ABGESCHLOSSEN!${NC}"
echo -e "${GREEN}========================================================================${NC}"
echo -e "Die Anwendung ist ab sofort erreichbar unter:"
echo -e "  🌐 ${CYAN}http://${IP_ADDR}:${PORT}${NC}  (oder lokal: ${CYAN}http://localhost:${PORT}${NC})"
echo -e ""
echo -e "Befehle zur Verwaltung:"
echo -e "  • Status prüfen:   ${YELLOW}systemctl status lichternacht${NC}"
echo -e "  • Live-Logs:       ${YELLOW}journalctl -u lichternacht -f${NC}"
echo -e "  • Neustarten:      ${YELLOW}systemctl restart lichternacht${NC}"
echo -e "  • Aktualisieren:   ${YELLOW}/opt/lichternacht/update.sh${NC}"
echo -e "${GREEN}========================================================================${NC}\n"
