# Pi Server Deployment Guide

## Overview
Two server options for your Pi:
1. **Trivia Game Server** - Full trivia game with web interface
2. **OSC Buzzer Server** - ESP32 buzzers → OSC messages for lighting/audio systems

## Quick Deploy to Pi

### 1. Copy Files to Pi
```bash
# From your Mac, copy the entire project to Pi
scp -r "Waze Trivia Game" pi@your-pi-ip:~/

# Or use rsync for faster updates
rsync -avz --exclude node_modules "Waze Trivia Game/" pi@your-pi-ip:~/trivia-system/
```

### 2. SSH into Pi and Install
```bash
ssh pi@your-pi-ip

cd ~/trivia-system/pi-server-launcher
npm install

# Make launcher executable
chmod +x launcher.js

# Optional: Install as system service
sudo cp install.sh /tmp/ && chmod +x /tmp/install.sh && /tmp/install.sh
```

### 3. Run Server Launcher
```bash
# Interactive menu
node launcher.js

# Direct launch trivia server
node launcher.js --mode=trivia

# Direct launch OSC server  
node launcher.js --mode=osc
```

## OSC Server Configuration

### ESP32 Setup
Your ESP32 coordinator should send buzzer data via UART in this format:
```
BUZZ:5:1234567890    // BUZZ:BuzzerID:Timestamp
STATUS:battery:85    // STATUS:key:value
ERROR:connection     // ERROR:message
```

### OSC Message Format
The server sends OSC messages to configured targets:
```
/buzzer/5    [5, 1234567890]           // Individual buzzer
/buzz        [5, 1234567890, "Buzzer 5"] // Generic buzz event
```

### Configuration (.env)
```bash
# Copy example config
cp osc-buzzer-server/.env.example osc-buzzer-server/.env

# Edit configuration
nano osc-buzzer-server/.env
```

Key settings:
```env
SERIAL_PORT=/dev/ttyUSB0
OSC_TARGETS=192.168.1.100:53000,192.168.1.101:53000
WEB_PORT=3001
```

## Network Setup

### Port Usage
- **Trivia Server**: 3000 (web), 3001 (admin)
- **OSC Server**: 3001 (web), 57121 (OSC out)
- **Launcher**: Interactive CLI only

### Firewall (if needed)
```bash
sudo ufw allow 3000
sudo ufw allow 3001
sudo ufw allow 57121
```

## Service Management

### Manual Control
```bash
# Start launcher
cd ~/trivia-system/pi-server-launcher
node launcher.js

# Kill any running servers
sudo pkill -f "node server.js"

# Check what's running on ports
sudo netstat -tulpn | grep :3000
```

### Auto-Start on Boot
```bash
# Enable systemd service (after running install.sh)
sudo systemctl enable pi-server-launcher
sudo systemctl start pi-server-launcher

# Check status
sudo systemctl status pi-server-launcher

# View logs
journalctl -u pi-server-launcher -f
```

## Development Workflow

### From Mac to Pi
```bash
# 1. Develop on Mac
cd "Waze Trivia Game"
# make changes...

# 2. Sync to Pi (faster than full copy)
rsync -avz --exclude node_modules ./ pi@your-pi-ip:~/trivia-system/

# 3. SSH and restart
ssh pi@your-pi-ip
cd ~/trivia-system/pi-server-launcher
node launcher.js
```

### Remote Debugging
```bash
# SSH with port forwarding to access web interfaces from Mac
ssh -L 3000:localhost:3000 -L 3001:localhost:3001 pi@your-pi-ip

# Now access from Mac browser:
# http://localhost:3000 - Trivia game
# http://localhost:3001 - OSC server web interface
```

## Hardware Integration

### ESP32 Coordinator for OSC Server
The ESP32 should connect via WiFi and send UDP packets to Pi, or via UART:

**UART Connection (Recommended):**
- ESP32 TX → Pi GPIO 14 (UART RX)  
- ESP32 RX → Pi GPIO 15 (UART TX)
- Ground → Ground
- Configure: `/dev/ttyAMA0` or `/dev/serial0`

**WiFi Connection (Alternative):**
- ESP32 connects to same network as Pi
- Sends UDP packets to Pi IP on configured port
- More flexible but requires network stability

### Testing Serial Connection
```bash
# Check available serial ports
ls /dev/tty*

# Test serial communication
sudo minicom -D /dev/ttyUSB0 -b 115200

# Or use screen
screen /dev/ttyUSB0 115200
```

## Troubleshooting

### Common Issues
```bash
# Port already in use
sudo lsof -i :3000
sudo kill -9 <PID>

# Serial port permission denied  
sudo usermod -a -G dialout pi
# Logout and login again

# Node.js not found
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Missing dependencies
cd ~/trivia-system/backend && npm install
cd ~/trivia-system/osc-buzzer-server && npm install
```

### Log Files
```bash
# System logs
journalctl -u pi-server-launcher -f

# Application logs (if running manually)
node launcher.js 2>&1 | tee server.log

# Check Pi system status
htop
df -h
free -h
vcgencmd measure_temp
```

## Architecture Summary

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   ESP32 Host    │    │   Pi Launcher    │    │  Client Apps    │
│                 │────│                  │────│                 │
│ • 15 Buzzers    │    │ • Server Select  │    │ • Web Browser   │
│ • ESP-NOW       │    │ • Port Mgmt      │    │ • QLab/Resolume │
│ • UART/WiFi     │    │ • Process Ctrl   │    │ • OSC Clients   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                        │
        │              ┌─────────┴─────────┐              │
        │              │                   │              │
        │         Trivia Server      OSC Server           │
        │        ┌─────────────┐   ┌─────────────┐       │
        └────────│ Socket.IO   │   │ OSC Client  │───────┘
                 │ SQLite      │   │ Serial Port │
                 │ Express     │   │ WebSocket   │
                 └─────────────┘   └─────────────┘
```

This setup gives you maximum flexibility to switch between trivia game mode and OSC lighting control mode without conflicts!