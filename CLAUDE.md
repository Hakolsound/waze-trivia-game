# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start development server with auto-restart
npm run dev

# Start production server
npm start

# Run tests
npm test

# Build all frontend applications
npm run build

# Build specific frontend apps
npm run build:game-display
npm run build:host-control
npm run build:admin-config
```

## Architecture Overview

This is a multi-component trivia game system with hardware integration:

### Core Components
- **Backend**: Express.js server (`backend/server.js`) with Socket.IO for real-time communication
- **Hardware Integration**: ESP32 service for serial communication with buzzer coordinator
- **Database**: SQLite database for games, teams, questions, and scores
- **Frontend Applications**: Multiple web interfaces served as static files

### Frontend Applications
- `frontend/admin-config/` - Game setup, team management, question configuration
- `frontend/game-display/` - Main game screen with questions, timer, scores
- `frontend/host-control/` - Host controls for managing game flow
- `frontend/virtual-buzzer/` - Software buzzer for testing
- `frontend/shared/` - Shared components and utilities

### Hardware Components
- `firmware/group-buzzer/` - ESP32 firmware for individual team buzzers
- `firmware/central-coordinator/` - ESP32 firmware for master controller that communicates with Pi via serial

### Communication Flow
```
Group Buzzers (ESP-NOW) → Central ESP32 (Serial) → Node.js Backend (WebSocket) → Web Clients
```

## Key Services

### Backend Services (`backend/services/`)
- `database.js` - SQLite database operations
- `gameService.js` - Core game logic and state management
- `esp32Service.js` - Serial communication with ESP32 coordinator
- `firebaseService.js` - Optional Firebase integration for cloud sync

### API Routes (`backend/routes/`)
- `games.js` - Game CRUD operations
- `groups.js` - Team management
- `questions.js` - Question management
- `buzzers.js` - Buzzer system control

## Real-time Features

The system uses Socket.IO for real-time updates:
- Buzzer press events with millisecond timing
- Live score updates across all clients
- Game state synchronization
- Question timing and media control

## Hardware Integration

### ESP32 Communication
- Central coordinator connects via USB serial (`/dev/ttyUSB0` or similar)
- Group buzzers communicate with coordinator via ESP-NOW protocol
- Buzzer presses are forwarded to backend with precise timing

### Configuration
- ESP32 serial port configured via `ESP32_SERIAL_PORT` environment variable
- Firmware requires MAC address configuration for ESP-NOW pairing

## Development Notes

### Environment Setup
- Copy `.env.example` to `.env` and configure required variables
- Firebase integration is optional (for cloud sync)
- Database is auto-created on first run

### Frontend Architecture
- No build system - vanilla HTML/CSS/JS served as static files
- Socket.IO client library for real-time communication
- Responsive designs for different screen sizes (projectors, tablets, phones)

### Testing
- Uses Jest for backend testing
- No automated tests currently exist - manual testing required
- Hardware testing via `/virtual-buzzer` interface

## Deployment

This system is designed for Raspberry Pi deployment:
- See `DEPLOYMENT.md` for Pi-specific setup instructions
- See `README-Pi-Deployment.md` for additional Pi deployment details
- Uses PM2 for process management in production
- Deployment scripts available in `deploy/` directory