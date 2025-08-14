#!/bin/bash
# Raspberry Pi Update Script for Waze Trivia Game
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Waze Trivia Game - Update Script${NC}"
echo "===================================="

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

echo -e "${YELLOW}📡 Fetching latest changes...${NC}"
git fetch origin

echo -e "${YELLOW}📊 Checking for updates...${NC}"
BEHIND=$(git rev-list HEAD..origin/main --count)
if [ $BEHIND -eq 0 ]; then
    echo -e "${GREEN}✅ Already up to date!${NC}"
    exit 0
fi

echo -e "${BLUE}ℹ️  Found $BEHIND new commit(s)${NC}"
echo -e "${YELLOW}📋 Recent changes:${NC}"
git log --oneline HEAD..origin/main

echo ""
read -p "Continue with update? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Update cancelled${NC}"
    exit 0
fi

echo -e "${YELLOW}⏸️  Stopping application...${NC}"
pm2 stop waze-trivia-game || echo "Application not running"

echo -e "${YELLOW}💾 Backing up current database...${NC}"
if [ -f "backend/database/trivia.db" ]; then
    cp backend/database/trivia.db backend/database/trivia.db.backup.$(date +%Y%m%d_%H%M%S)
    echo "Database backed up"
fi

echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

echo -e "${YELLOW}📦 Updating dependencies...${NC}"
npm install --production

echo -e "${YELLOW}🔧 Checking configuration...${NC}"
if [ -f ".env.example" ] && [ -f ".env" ]; then
    # Check for new environment variables
    NEW_VARS=$(comm -23 <(grep "^[A-Z]" .env.example | cut -d= -f1 | sort) <(grep "^[A-Z]" .env | cut -d= -f1 | sort))
    if [ ! -z "$NEW_VARS" ]; then
        echo -e "${YELLOW}⚠️  New environment variables found:${NC}"
        echo "$NEW_VARS"
        echo -e "${BLUE}ℹ️  Please review and update your .env file${NC}"
    fi
fi

echo -e "${YELLOW}🔍 Testing updated application...${NC}"
node backend/server.js &
SERVER_PID=$!
sleep 5

if kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Updated server started successfully${NC}"
    kill $SERVER_PID
    wait $SERVER_PID 2>/dev/null || true
else
    echo -e "${RED}❌ Updated server failed to start${NC}"
    echo -e "${YELLOW}🔄 Rolling back...${NC}"
    git reset --hard HEAD~$BEHIND
    npm install --production
    pm2 start waze-trivia-game
    echo -e "${RED}❌ Update failed, rolled back to previous version${NC}"
    exit 1
fi

echo -e "${YELLOW}🚀 Starting updated application...${NC}"
pm2 start waze-trivia-game

echo -e "${YELLOW}💾 Saving PM2 configuration...${NC}"
pm2 save

echo -e "${GREEN}✅ Update complete!${NC}"
echo ""
echo -e "${BLUE}📊 Application Status:${NC}"
pm2 status

echo ""
echo -e "${BLUE}🌐 Access Points:${NC}"
echo "   • Main Dashboard: http://game.local:3000"
echo "   • Game Display:   http://game.local:3000/display"
echo "   • Host Control:   http://game.local:3000/control"
echo "   • Admin Panel:    http://game.local:3000/admin"
echo ""
echo -e "${GREEN}🎮 Waze Trivia Game updated successfully!${NC}"