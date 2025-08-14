# Raspberry Pi Setup Guide - Waze Trivia Game

This guide walks through setting up a Raspberry Pi as the game server with a fixed IP address and hostname configuration.

## 📋 Prerequisites

- Raspberry Pi 4 (recommended) or Pi 3B+
- MicroSD card (32GB+ recommended)
- Raspberry Pi OS Lite (headless) or Desktop
- SSH access enabled
- Internet connection for initial setup

## 🔧 Initial Pi Configuration

### 1. Flash Raspberry Pi OS
- Download Raspberry Pi Imager
- Flash Raspberry Pi OS to SD card
- Enable SSH in advanced options
- Set username/password (recommended: `pi`/`waze2024`)
- Configure WiFi if needed

### 2. First Boot Setup
```bash
# SSH into the Pi (find IP with router admin or nmap)
ssh pi@<pi-ip-address>

# Update system
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y git curl vim htop
```

## 🌐 Network Configuration (Fixed IP)

### Configure Static IP Address

1. **Edit dhcpcd configuration**:
```bash
sudo nano /etc/dhcpcd.conf
```

2. **Add static IP configuration** (add to end of file):
```bash
# Static IP configuration for Waze Trivia Game
interface eth0
static ip_address=192.168.0.111/24
static routers=192.168.0.200
static domain_name_servers=8.8.8.8 8.8.4.4

# If using WiFi instead of Ethernet, use wlan0
# interface wlan0
# static ip_address=192.168.0.111/24
# static routers=192.168.0.200
# static domain_name_servers=8.8.8.8 8.8.4.4
```

3. **Set hostname to game.local**:
```bash
# Edit hostname file
sudo nano /etc/hostname
```
Replace content with:
```
game
```

4. **Update hosts file**:
```bash
sudo nano /etc/hosts
```
Change the line with `127.0.1.1` to:
```
127.0.1.1       game.local game
192.168.0.111   game.local game
```

5. **Enable mDNS (Avahi) for .local resolution**:
```bash
sudo apt install -y avahi-daemon avahi-utils
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon
```

6. **Restart networking**:
```bash
sudo systemctl restart dhcpcd
sudo reboot
```

7. **Verify configuration after reboot**:
```bash
# Check IP address
ip addr show

# Test hostname resolution
hostname
hostname -I

# Test internet connectivity
ping -c 4 8.8.8.8

# Test local network access
ping -c 4 192.168.0.200
```

## 📦 Node.js Installation

### Install Node.js 18.x (LTS)
```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js and npm
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher

# Install PM2 for process management
sudo npm install -g pm2
```

## 🎮 Trivia Game Application Setup

### 1. Clone and Setup Application
```bash
# Create application directory
sudo mkdir -p /opt/waze-trivia
sudo chown pi:pi /opt/waze-trivia
cd /opt/waze-trivia

# Clone repository (replace with your repo URL)
git clone <your-repo-url> .
# OR copy files from development machine:
# scp -r "/Users/ronpeer/Code Projects local/Waze Trivia Game/"* pi@192.168.0.111:/opt/waze-trivia/

# Install dependencies
npm install --production

# Create environment file for production
cp .env.example .env
```

### 2. Configure Production Environment
```bash
nano .env
```

Update with Pi-specific settings:
```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DB_PATH=/opt/waze-trivia/backend/database/trivia.db

# ESP32 Communication
ESP32_SERIAL_PORT=/dev/ttyUSB0
ESP32_BAUD_RATE=115200
ESP32_HTTP_PORT=8080

# Firebase Configuration (optional)
FIREBASE_PROJECT_ID=waze-trivia-prod
FIREBASE_PRIVATE_KEY_PATH=/opt/waze-trivia/config/firebase-key.json

# Game Configuration
DEFAULT_QUESTION_TIME=30
MAX_GROUPS=15
BUZZER_TIMEOUT=5000
```

### 3. Setup Database Directory
```bash
# Create database directory
mkdir -p /opt/waze-trivia/backend/database

# Set proper permissions
chmod 755 /opt/waze-trivia/backend/database
```

### 4. Test Application
```bash
# Test run
npm start

# Should see:
# Connected to SQLite database
# ESP32 running in simulation mode (until hardware connected)
# Trivia Game Server running on port 3000
```

## 🔌 ESP32 Hardware Setup

### 1. Install USB Serial Drivers
```bash
# Install USB serial support
sudo apt install -y setserial

# Add user to dialout group for USB access
sudo usermod -a -G dialout pi

# Logout and login again for group change
exit
ssh pi@192.168.0.111
```

### 2. Configure USB Serial Device
```bash
# Find connected ESP32 (connect central coordinator via USB)
lsusb
dmesg | grep tty

# Typical device will be /dev/ttyUSB0 or /dev/ttyACM0
# Update .env file with correct port
nano /opt/waze-trivia/.env

# Set correct port, e.g.:
ESP32_SERIAL_PORT=/dev/ttyUSB0
```

### 3. Test ESP32 Communication
```bash
# Check device permissions
ls -la /dev/ttyUSB*

# Test serial communication (optional)
sudo apt install -y screen
screen /dev/ttyUSB0 115200
# Press Ctrl+A then K to exit screen
```

## 🚀 Production Deployment with PM2

### 1. Create PM2 Configuration
```bash
nano /opt/waze-trivia/ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'waze-trivia-game',
    script: '/opt/waze-trivia/backend/server.js',
    cwd: '/opt/waze-trivia',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/waze-trivia/combined.log',
    out_file: '/var/log/waze-trivia/out.log',
    error_file: '/var/log/waze-trivia/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 4000,
    max_restarts: 10
  }]
}
```

### 2. Setup Logging
```bash
# Create log directory
sudo mkdir -p /var/log/waze-trivia
sudo chown pi:pi /var/log/waze-trivia

# Setup log rotation
sudo nano /etc/logrotate.d/waze-trivia
```

Add logrotate configuration:
```
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
```

### 3. Start Application with PM2
```bash
cd /opt/waze-trivia

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions shown (run the sudo command)

# Check status
pm2 status
pm2 logs waze-trivia-game
```

## 🔒 Security Configuration

### Secure SSH (Optional)
```bash
sudo nano /etc/ssh/sshd_config
```

Recommended changes:
```bash
# Disable root login
PermitRootLogin no

# Change default port (optional)
Port 2222

# Disable password auth if using keys
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

## 🌍 Access Points

After setup, access the trivia game at:

- **Main Dashboard**: http://game.local:3000 or http://192.168.0.111:3000
- **Game Display**: http://game.local:3000/display
- **Host Control**: http://game.local:3000/control  
- **Admin Panel**: http://game.local:3000/admin

## 📊 Monitoring & Maintenance

### 1. System Monitoring
```bash
# Check system resources
htop

# Check disk space
df -h

# Check application status
pm2 status
pm2 monit

# View logs
pm2 logs waze-trivia-game --lines 100

# Check network connectivity
ping -c 4 8.8.8.8
```

### 2. Application Management
```bash
# Restart application
pm2 restart waze-trivia-game

# Stop application
pm2 stop waze-trivia-game

# View detailed info
pm2 show waze-trivia-game

# Reload with zero-downtime
pm2 reload waze-trivia-game
```

### 3. Update Application
```bash
cd /opt/waze-trivia

# Stop application
pm2 stop waze-trivia-game

# Pull updates (if using git)
git pull origin main

# Install new dependencies
npm install --production

# Restart application
pm2 restart waze-trivia-game
```

## 🔧 Troubleshooting

### Common Issues

1. **Can't access via game.local**
   ```bash
   # Check Avahi service
   sudo systemctl status avahi-daemon
   
   # Restart if needed
   sudo systemctl restart avahi-daemon
   ```

2. **ESP32 not detected**
   ```bash
   # Check USB devices
   lsusb
   dmesg | tail -20
   
   # Check permissions
   ls -la /dev/ttyUSB*
   groups # Should include 'dialout'
   ```

3. **Application won't start**
   ```bash
   # Check PM2 logs
   pm2 logs waze-trivia-game
   
   # Check system resources
   htop
   df -h
   ```

4. **Network connectivity issues**
   ```bash
   # Check IP configuration
   ip addr show
   
   # Check routing
   ip route show
   
   # Test DNS
   nslookup google.com
   ```

### Performance Optimization

1. **Increase swap space** (if needed):
   ```bash
   sudo dphys-swapfile swapoff
   sudo nano /etc/dphys-swapfile
   # Set CONF_SWAPSIZE=1024
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   ```

2. **GPU memory split**:
   ```bash
   sudo raspi-config
   # Advanced Options -> Memory Split -> 16
   ```

## ✅ Final Verification

Run these commands to verify everything is working:

```bash
# System info
hostnamectl
ip addr show

# Network connectivity
ping -c 4 8.8.8.8
ping -c 4 192.168.0.200

# Application status
pm2 status
curl -s http://localhost:3000/health

# Access from another device
# http://game.local:3000
# http://192.168.0.111:3000
```

## 🎯 Quick Setup Script

Save this as `setup-pi.sh` for automated setup:

```bash
#!/bin/bash
set -e

echo "🎮 Setting up Waze Trivia Game on Raspberry Pi"

# Update system
sudo apt update && sudo apt upgrade -y

# Install packages
sudo apt install -y git curl vim htop avahi-daemon avahi-utils setserial

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# Create application directory
sudo mkdir -p /opt/waze-trivia
sudo chown pi:pi /opt/waze-trivia

# Add user to dialout group
sudo usermod -a -G dialout pi

# No firewall configuration needed for local network

# Setup log directory
sudo mkdir -p /var/log/waze-trivia
sudo chown pi:pi /var/log/waze-trivia

echo "✅ Basic setup complete!"
echo "📝 Next steps:"
echo "   1. Configure static IP in /etc/dhcpcd.conf"
echo "   2. Set hostname to 'game' in /etc/hostname"
echo "   3. Update /etc/hosts file"
echo "   4. Copy application files to /opt/waze-trivia"
echo "   5. Configure .env file"
echo "   6. Start application with PM2"
echo ""
echo "🌐 After reboot, access via http://game.local:3000"
```

---

**🎯 Your Raspberry Pi is now ready to host the Waze Trivia Game!**