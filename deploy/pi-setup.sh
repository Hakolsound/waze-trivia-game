#!/bin/bash
# Raspberry Pi Initial Setup Script for Waze Trivia Game
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎮 Waze Trivia Game - Raspberry Pi Setup${NC}"
echo "=========================================="

# Check if running as pi user
if [ "$USER" != "pi" ]; then
    echo -e "${RED}❌ This script should be run as the 'pi' user${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${YELLOW}📦 Installing required packages...${NC}"
sudo apt install -y git curl vim htop avahi-daemon avahi-utils setserial

echo -e "${YELLOW}📦 Installing Node.js 18.x...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

echo -e "${YELLOW}📦 Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 already installed: $(pm2 --version)"
fi

echo -e "${YELLOW}👤 Adding pi user to dialout group for USB access...${NC}"
sudo usermod -a -G dialout pi

echo -e "${YELLOW}📁 Creating application directory...${NC}"
sudo mkdir -p /opt/waze-trivia
sudo chown pi:pi /opt/waze-trivia

echo -e "${YELLOW}📁 Creating log directory...${NC}"
sudo mkdir -p /var/log/waze-trivia
sudo chown pi:pi /var/log/waze-trivia

echo -e "${YELLOW}🔧 Setting up log rotation...${NC}"
sudo tee /etc/logrotate.d/waze-trivia > /dev/null << 'EOF'
/var/log/waze-trivia/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    copytruncate
    notifempty
    su pi pi
}
EOF

echo -e "${GREEN}✅ Basic setup complete!${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo "   1. Configure static IP: sudo nano /etc/dhcpcd.conf"
echo "   2. Set hostname: sudo nano /etc/hostname"
echo "   3. Update hosts file: sudo nano /etc/hosts"
echo "   4. Clone repository: git clone <repo-url> /opt/waze-trivia"
echo "   5. Configure Firebase: copy firebase-key.json to config/"
echo "   6. Run: /opt/waze-trivia/deploy/pi-deploy.sh"
echo ""
echo -e "${YELLOW}⚠️  Please reboot after network configuration changes${NC}"