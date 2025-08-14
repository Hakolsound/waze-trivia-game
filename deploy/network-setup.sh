#!/bin/bash
# Network Configuration Script for Raspberry Pi
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🌐 Raspberry Pi Network Setup${NC}"
echo "=============================="

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Please run this script with sudo${NC}"
    exit 1
fi

# Configuration variables
STATIC_IP="192.168.0.111"
GATEWAY="192.168.0.200"
DNS1="8.8.8.8"
DNS2="8.8.4.4"
HOSTNAME="game"
INTERFACE="eth0"  # Change to wlan0 for WiFi

echo -e "${YELLOW}🔧 Configuring static IP address...${NC}"
echo "IP: $STATIC_IP"
echo "Gateway: $GATEWAY"
echo "DNS: $DNS1, $DNS2"
echo "Interface: $INTERFACE"
echo ""

# Backup original dhcpcd.conf
cp /etc/dhcpcd.conf /etc/dhcpcd.conf.backup.$(date +%Y%m%d_%H%M%S)

# Check if static IP configuration already exists
if grep -q "interface $INTERFACE" /etc/dhcpcd.conf; then
    echo -e "${YELLOW}⚠️  Static IP configuration already exists${NC}"
    echo "Current configuration:"
    grep -A 4 "interface $INTERFACE" /etc/dhcpcd.conf
    echo ""
    read -p "Replace existing configuration? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⏹️  Network configuration skipped${NC}"
        exit 0
    fi
    
    # Remove existing configuration
    sed -i "/^# Static IP configuration for Waze Trivia Game/,+4d" /etc/dhcpcd.conf
    sed -i "/^interface $INTERFACE/,+3d" /etc/dhcpcd.conf
fi

# Add static IP configuration
cat >> /etc/dhcpcd.conf << EOF

# Static IP configuration for Waze Trivia Game
interface $INTERFACE
static ip_address=$STATIC_IP/24
static routers=$GATEWAY
static domain_name_servers=$DNS1 $DNS2
EOF

echo -e "${GREEN}✅ Static IP configuration added${NC}"

echo -e "${YELLOW}🏷️  Setting hostname to '$HOSTNAME'...${NC}"
echo $HOSTNAME > /etc/hostname

# Update hosts file
cp /etc/hosts /etc/hosts.backup.$(date +%Y%m%d_%H%M%S)
sed -i "s/127\.0\.1\.1.*/127.0.1.1\t$HOSTNAME.local $HOSTNAME/" /etc/hosts

# Add static IP to hosts file
if ! grep -q "$STATIC_IP" /etc/hosts; then
    echo "$STATIC_IP	$HOSTNAME.local $HOSTNAME" >> /etc/hosts
fi

echo -e "${GREEN}✅ Hostname configured${NC}"

echo -e "${YELLOW}📡 Ensuring Avahi daemon is enabled...${NC}"
systemctl enable avahi-daemon
systemctl start avahi-daemon

echo -e "${YELLOW}🔄 Restarting networking services...${NC}"
systemctl restart dhcpcd

echo -e "${GREEN}✅ Network configuration complete!${NC}"
echo ""
echo -e "${BLUE}📋 Configuration Summary:${NC}"
echo "   • Static IP: $STATIC_IP"
echo "   • Gateway: $GATEWAY"
echo "   • DNS: $DNS1, $DNS2"
echo "   • Hostname: $HOSTNAME.local"
echo "   • Interface: $INTERFACE"
echo ""
echo -e "${YELLOW}⚠️  A reboot is recommended to fully apply changes${NC}"
echo ""
echo -e "${BLUE}🧪 After reboot, test with:${NC}"
echo "   • ping -c 4 8.8.8.8"
echo "   • ping -c 4 $GATEWAY"
echo "   • hostname -I"
echo ""

read -p "Reboot now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}🔄 Rebooting...${NC}"
    reboot
else
    echo -e "${YELLOW}ℹ️  Please reboot manually when convenient${NC}"
fi