# 🚀 Deployment Guide - Waze Trivia Game

This guide covers deploying the Waze Trivia Game system to a Raspberry Pi using Git for easy setup and updates.

## 📋 Quick Deployment Overview

1. **Initial Pi Setup** → Run setup scripts
2. **Network Configuration** → Set static IP and hostname
3. **Repository Clone** → Download code from Git
4. **Application Deploy** → Install and start services
5. **Updates** → Easy Git-based updates

---

## 🎯 Method 1: Automated Deployment (Recommended)

### Step 1: Initial Raspberry Pi Setup

```bash
# SSH into your fresh Raspberry Pi
ssh pi@<pi-ip-address>

# Download and run the setup script
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/waze-trivia-game/main/deploy/pi-setup.sh | bash
```

### Step 2: Network Configuration

```bash
# Configure static IP (192.168.0.111) and hostname (game.local)
sudo /home/pi/waze-trivia-game/deploy/network-setup.sh

# System will reboot automatically
```

### Step 3: Clone Repository and Deploy

```bash
# After reboot, SSH back in
ssh pi@game.local  # or ssh pi@192.168.0.111

# Clone the repository
git clone https://github.com/YOUR_USERNAME/waze-trivia-game.git /opt/waze-trivia
cd /opt/waze-trivia

# Copy your Firebase key (if using Firebase)
scp path/to/your/firebase-key.json pi@game.local:/opt/waze-trivia/config/

# Deploy the application
./deploy/pi-deploy.sh
```

### Step 4: Verify Deployment

Visit: http://game.local:3000 or http://192.168.0.111:3000

---

## 🛠️ Method 2: Manual Step-by-Step Deployment

### Prerequisites
- Raspberry Pi with Raspberry Pi OS
- SSH access enabled
- Internet connection

### 1. System Updates and Prerequisites

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl vim htop avahi-daemon avahi-utils setserial

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
sudo npm install -g pm2

# Add pi user to dialout group
sudo usermod -a -G dialout pi
```

### 2. Network Configuration

```bash
# Configure static IP
sudo nano /etc/dhcpcd.conf
```

Add to the end:
```bash
# Static IP configuration for Waze Trivia Game
interface eth0
static ip_address=192.168.0.111/24
static routers=192.168.0.200
static domain_name_servers=8.8.8.8 8.8.4.4
```

```bash
# Set hostname
echo "game" | sudo tee /etc/hostname

# Update hosts file
sudo nano /etc/hosts
```

Update the 127.0.1.1 line:
```
127.0.1.1       game.local game
192.168.0.111   game.local game
```

```bash
# Restart and reboot
sudo systemctl restart dhcpcd
sudo reboot
```

### 3. Application Deployment

```bash
# Create directories
sudo mkdir -p /opt/waze-trivia /var/log/waze-trivia
sudo chown pi:pi /opt/waze-trivia /var/log/waze-trivia

# Clone repository
git clone https://github.com/YOUR_USERNAME/waze-trivia-game.git /opt/waze-trivia
cd /opt/waze-trivia

# Install dependencies
npm install --production

# Configure environment
cp .env.example .env
nano .env  # Update as needed

# Copy Firebase key (if using)
# scp firebase-key.json pi@game.local:/opt/waze-trivia/config/

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions shown
```

---

## 🔄 Updates and Maintenance

### Easy Updates via Git

```bash
cd /opt/waze-trivia

# Check for updates and apply
./deploy/pi-update.sh
```

### Manual Update Process

```bash
cd /opt/waze-trivia

# Stop application
pm2 stop waze-trivia-game

# Pull latest changes
git pull origin main

# Update dependencies
npm install --production

# Restart application
pm2 start waze-trivia-game
```

### Common Management Commands

```bash
# Check application status
pm2 status

# View logs
pm2 logs waze-trivia-game

# Restart application
pm2 restart waze-trivia-game

# Stop application
pm2 stop waze-trivia-game

# Monitor resources
pm2 monit
```

---

## 📊 System Monitoring

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# System resources
htop
df -h

# Network connectivity
ping -c 4 8.8.8.8
ping -c 4 192.168.0.200
```

### Log Files

```bash
# PM2 logs
pm2 logs waze-trivia-game

# System logs
journalctl -u avahi-daemon
journalctl -f  # Follow all logs

# Log files location
ls -la /var/log/waze-trivia/
```

---

## 🔧 Configuration Files

### Environment Variables (.env)
```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DB_PATH=./backend/database/trivia.db

# ESP32 Communication
ESP32_SERIAL_PORT=/dev/ttyUSB0
ESP32_BAUD_RATE=115200

# Firebase (optional)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_PATH=./config/firebase-key.json

# Game Settings
DEFAULT_QUESTION_TIME=30
MAX_GROUPS=15
BUZZER_TIMEOUT=5000
```

### PM2 Configuration (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'waze-trivia-game',
    script: './backend/server.js',
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
    restart_delay: 4000,
    max_restarts: 10
  }]
}
```

---

## 🌐 Access Points

After successful deployment:

| Interface | URL | Description |
|-----------|-----|-------------|
| **Main Dashboard** | http://game.local:3000 | System overview and navigation |
| **Game Display** | http://game.local:3000/display | Main screen for questions/scores |
| **Host Control** | http://game.local:3000/control | Game management interface |
| **Admin Panel** | http://game.local:3000/admin | Configuration and setup |

Alternative IP access: http://192.168.0.111:3000

---

## 🔍 Troubleshooting

### Common Issues

1. **Can't access via game.local**
   ```bash
   sudo systemctl restart avahi-daemon
   avahi-browse -at  # Check mDNS services
   ```

2. **Application won't start**
   ```bash
   pm2 logs waze-trivia-game
   cd /opt/waze-trivia && npm start  # Test manually
   ```

3. **ESP32 not detected**
   ```bash
   lsusb  # Check USB devices
   ls -la /dev/ttyUSB*  # Check permissions
   groups  # Should include 'dialout'
   ```

4. **Database issues**
   ```bash
   ls -la /opt/waze-trivia/backend/database/
   # Check file permissions and disk space
   df -h
   ```

### Recovery Procedures

1. **Restore from backup**
   ```bash
   cd /opt/waze-trivia/backend/database
   ls trivia.db.backup.*
   cp trivia.db.backup.YYYYMMDD_HHMMSS trivia.db
   pm2 restart waze-trivia-game
   ```

2. **Reset to factory state**
   ```bash
   rm /opt/waze-trivia/backend/database/trivia.db
   pm2 restart waze-trivia-game
   # Database will be recreated with sample data
   ```

3. **Complete reinstall**
   ```bash
   pm2 delete waze-trivia-game
   rm -rf /opt/waze-trivia
   # Re-run deployment process
   ```

---

## 📈 Performance Optimization

### For Raspberry Pi 3/4

```bash
# Increase GPU memory split
sudo raspi-config
# Advanced Options → Memory Split → 16

# Increase swap if needed
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # CONF_SWAPSIZE=1024
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
```

### PM2 Optimization

```bash
# Monitor performance
pm2 monit

# Adjust memory restart threshold in ecosystem.config.js
max_memory_restart: '300M'  # For Pi 3
max_memory_restart: '500M'  # For Pi 4
```

---

## 🔒 Security Considerations

### SSH Security (Optional)
```bash
sudo nano /etc/ssh/sshd_config
```

Recommended changes:
```
PermitRootLogin no
Port 2222  # Optional: Change default port
PasswordAuthentication no  # If using SSH keys
```

### File Permissions
```bash
# Ensure proper permissions
sudo chown -R pi:pi /opt/waze-trivia
chmod 600 /opt/waze-trivia/config/firebase-key.json
chmod 755 /opt/waze-trivia/deploy/*.sh
```

---

## 📞 Support

### Getting Help
- Check logs: `pm2 logs waze-trivia-game`
- System status: `pm2 status && systemctl status avahi-daemon`
- Network test: `ping game.local && curl http://localhost:3000/health`

### Backup Important Files
- Database: `/opt/waze-trivia/backend/database/trivia.db`
- Configuration: `/opt/waze-trivia/.env`
- Firebase key: `/opt/waze-trivia/config/firebase-key.json`

---

**🎮 Your Waze Trivia Game is ready to host epic game nights!**