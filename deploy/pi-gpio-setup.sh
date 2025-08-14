#!/bin/bash
# GPIO Serial Setup for ESP32 Direct Connection
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔌 ESP32 GPIO Serial Setup${NC}"
echo "============================"

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Please run this script with sudo${NC}"
    exit 1
fi

echo -e "${YELLOW}🔧 Configuring Pi GPIO serial for ESP32...${NC}"

# Enable UART and disable console on serial
echo -e "${YELLOW}📝 Updating boot configuration...${NC}"

# Backup config files
cp /boot/config.txt /boot/config.txt.backup.$(date +%Y%m%d_%H%M%S)
cp /boot/cmdline.txt /boot/cmdline.txt.backup.$(date +%Y%m%d_%H%M%S)

# Enable UART in config.txt
if ! grep -q "enable_uart=1" /boot/config.txt; then
    echo "enable_uart=1" >> /boot/config.txt
    echo -e "${GREEN}✅ UART enabled in config.txt${NC}"
else
    echo -e "${BLUE}ℹ️  UART already enabled in config.txt${NC}"
fi

# Disable GPIO serial console to free up the port
if ! grep -q "dtoverlay=disable-bt" /boot/config.txt; then
    echo "dtoverlay=disable-bt" >> /boot/config.txt
    echo -e "${GREEN}✅ Bluetooth disabled to free up serial0${NC}"
else
    echo -e "${BLUE}ℹ️  Bluetooth already disabled${NC}"
fi

# Remove console from serial port in cmdline.txt
if grep -q "console=serial0,115200" /boot/cmdline.txt; then
    sed -i 's/console=serial0,115200 //g' /boot/cmdline.txt
    echo -e "${GREEN}✅ Serial console disabled${NC}"
else
    echo -e "${BLUE}ℹ️  Serial console already disabled${NC}"
fi

# Add pi user to dialout group for serial access
usermod -a -G dialout pi
echo -e "${GREEN}✅ Pi user added to dialout group${NC}"

echo -e "${YELLOW}🔗 GPIO Connection Guide:${NC}"
echo "Connect ESP32 to Pi GPIO pins:"
echo "  Pi GPIO 14 (Pin 8)  → ESP32 GPIO 16 (RX)"
echo "  Pi GPIO 15 (Pin 10) → ESP32 GPIO 17 (TX)"  
echo "  Pi 5V (Pin 2)       → ESP32 VIN"
echo "  Pi GND (Pin 6)      → ESP32 GND"
echo ""
echo -e "${YELLOW}⚙️  ESP32 Firmware Update Needed:${NC}"
echo "Update ESP32 firmware to use GPIO 16/17 for serial:"
echo "  #define RX_PIN 16"
echo "  #define TX_PIN 17"
echo "  Serial2.begin(115200, SERIAL_8N1, RX_PIN, TX_PIN);"
echo ""
echo -e "${YELLOW}🔧 Application Configuration:${NC}"
echo "Update .env file:"
echo "  ESP32_SERIAL_PORT=/dev/serial0"
echo ""
echo -e "${GREEN}✅ GPIO serial setup complete!${NC}"
echo -e "${YELLOW}⚠️  Reboot required to apply changes${NC}"

read -p "Reboot now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}🔄 Rebooting...${NC}"
    reboot
else
    echo -e "${YELLOW}ℹ️  Please reboot manually when convenient${NC}"
    echo "After reboot, test with: ls -la /dev/serial0"
fi