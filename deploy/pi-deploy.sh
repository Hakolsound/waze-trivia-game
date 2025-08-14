#!/bin/bash
# Raspberry Pi Deployment Script for Waze Trivia Game
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Waze Trivia Game - Deployment Script${NC}"
echo "========================================"

# Check if running in correct directory
if [ ! -f "package.json" ] || [ ! -f "backend/server.js" ]; then
    echo -e "${RED}❌ Please run this script from the project root directory${NC}"
    exit 1
fi

# Check if running as pi user
if [ "$USER" != "pi" ]; then
    echo -e "${RED}❌ This script should be run as the 'pi' user${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Installing npm dependencies...${NC}"
npm install --production

echo -e "${YELLOW}📁 Creating database directory...${NC}"
mkdir -p backend/database

echo -e "${YELLOW}⚙️  Checking environment configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file from template...${NC}"
    cp .env.example .env
    echo -e "${BLUE}ℹ️  Please edit .env file with your configuration:${NC}"
    echo "   - Update ESP32_SERIAL_PORT if needed"
    echo "   - Configure Firebase settings if using cloud sync"
    echo ""
    read -p "Press Enter to continue after configuring .env file..."
fi

echo -e "${YELLOW}🔧 Setting up PM2 configuration...${NC}"
if [ ! -f "ecosystem.config.js" ]; then
    cat > ecosystem.config.js << 'EOF'
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
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 4000,
    max_restarts: 10
  }]
}
EOF
fi

echo -e "${YELLOW}🔍 Testing application...${NC}"
echo "Running quick health check..."
node backend/server.js &
SERVER_PID=$!
sleep 5

# Test if server started successfully
if kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Server started successfully${NC}"
    kill $SERVER_PID
    wait $SERVER_PID 2>/dev/null || true
else
    echo -e "${RED}❌ Server failed to start. Check logs above.${NC}"
    exit 1
fi

echo -e "${YELLOW}🚀 Starting application with PM2...${NC}"
pm2 delete waze-trivia-game 2>/dev/null || true  # Remove if exists
pm2 start ecosystem.config.js

echo -e "${YELLOW}💾 Saving PM2 configuration...${NC}"
pm2 save

echo -e "${YELLOW}🔄 Setting up PM2 startup on boot...${NC}"
pm2 startup | grep "sudo env" | bash || true

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo -e "${BLUE}🌐 Access Points:${NC}"
echo "   • Main Dashboard: http://game.local:3000"
echo "   • Game Display:   http://game.local:3000/display"
echo "   • Host Control:   http://game.local:3000/control"
echo "   • Admin Panel:    http://game.local:3000/admin"
echo ""
echo -e "${BLUE}📊 Management Commands:${NC}"
echo "   • Check status:   pm2 status"
echo "   • View logs:      pm2 logs waze-trivia-game"
echo "   • Restart:        pm2 restart waze-trivia-game"
echo "   • Stop:           pm2 stop waze-trivia-game"
echo ""
echo -e "${GREEN}🎮 Waze Trivia Game is now running!${NC}"