#!/bin/bash
# Pi Server Launcher Installation Script

echo "🚀 Installing Pi Server Launcher..."

# Create service user if it doesn't exist
if ! id "piserver" &>/dev/null; then
    echo "📝 Creating piserver user..."
    sudo useradd -r -s /bin/false piserver
fi

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install dependencies
echo "📦 Installing launcher dependencies..."
npm install

# Create systemd service
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/pi-server-launcher.service > /dev/null <<EOF
[Unit]
Description=Pi Server Launcher
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$(pwd)
Environment=NODE_ENV=production
ExecStart=/usr/bin/node launcher.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create launcher script for desktop
echo "🖥️  Creating desktop launcher..."
sudo tee /usr/local/bin/pi-launcher > /dev/null <<EOF
#!/bin/bash
cd $(pwd)
node launcher.js
EOF

sudo chmod +x /usr/local/bin/pi-launcher

# Create desktop shortcut if GUI environment exists
if [ ! -z "\$DISPLAY" ] && [ -d "/home/pi/Desktop" ]; then
    echo "🖱️  Creating desktop shortcut..."
    tee /home/pi/Desktop/Pi-Server-Launcher.desktop > /dev/null <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Pi Server Launcher
Comment=Launch Trivia or OSC Server
Exec=/usr/local/bin/pi-launcher
Icon=applications-system
Terminal=true
Categories=System;
EOF
    chmod +x /home/pi/Desktop/Pi-Server-Launcher.desktop
fi

# Enable but don't start the service (manual start preferred)
sudo systemctl daemon-reload
sudo systemctl enable pi-server-launcher.service

echo ""
echo "✅ Installation complete!"
echo ""
echo "Usage options:"
echo "  🖱️  Desktop: Double-click 'Pi Server Launcher' icon"
echo "  💻 Terminal: pi-launcher"
echo "  🔧 Direct: node launcher.js"
echo "  ⚙️  Service: sudo systemctl start pi-server-launcher"
echo ""
echo "Auto-start on boot: sudo systemctl enable pi-server-launcher"
echo "View logs: journalctl -u pi-server-launcher -f"
EOF