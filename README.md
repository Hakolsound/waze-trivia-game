# Waze Trivia Game System

A comprehensive multi-group trivia game system featuring ESP32-based wireless buzzers, real-time scoring, and multiple frontend interfaces.

## 🏗️ Architecture Overview

### Hardware Layer
- **Group Buzzers**: ESP32 nodes with 100mm arcade buzzers and LED indicators
- **Central Coordinator**: Master ESP32 managing all group buzzers with millisecond-precision timing
- **Raspberry Pi Server**: Runs the backend services and web interfaces

### Communication Flow
```
Group Buzzers → Central ESP32 → Raspberry Pi → Web Clients
     ↑              ↑              ↑
   ESP-NOW      Serial/HTTP    WebSocket/HTTP
```

### Software Components
- **Backend**: Node.js/Express server with SQLite database
- **Frontend**: Three responsive web applications
- **Hardware**: ESP32 firmware for buzzers and coordinator
- **Integration**: Firebase sync and real-time WebSocket updates

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- ESP32 development environment (Arduino IDE or PlatformIO)
- Hardware components (ESP32 boards, buzzers, LEDs)

### Installation

1. **Clone and install dependencies**:
```bash
git clone <repository-url>
cd waze-trivia-game
npm install
```

2. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start the server**:
```bash
npm start
# or for development:
npm run dev
```

4. **Access the interfaces**:
- Main page: http://localhost:3000
- Game Display: http://localhost:3000/display
- Host Control: http://localhost:3000/control
- Admin Config: http://localhost:3000/admin

## 🔧 Hardware Setup

### ESP32 Group Buzzer Wiring
```
ESP32 Pin | Component
----------|----------
GPIO 2    | 100mm Arcade Buzzer
GPIO 4    | Status LED
GPIO 0    | Buzzer Button (with pullup)
```

### Central Coordinator Wiring
```
ESP32 Pin | Component
----------|----------
GPIO 2    | Status LED
GPIO 4    | Communication LED
USB       | Serial connection to Raspberry Pi
```

### Firmware Programming

1. **Group Buzzer Firmware**:
   - Open `firmware/group-buzzer/group_buzzer.ino`
   - Update `DEVICE_ID` for each buzzer (1, 2, 3, etc.)
   - Update `coordinatorMAC` with central coordinator's MAC address
   - Flash to each ESP32 group buzzer

2. **Central Coordinator Firmware**:
   - Open `firmware/central-coordinator/central_coordinator.ino`
   - Note the MAC address displayed in serial monitor
   - Flash to central coordinator ESP32
   - Connect via USB to Raspberry Pi

## 🎮 User Interfaces

### Game Display (`/display`)
- Live question display with countdown timer
- Real-time buzzer results with delta timing
- Current scores and leaderboard
- Responsive design for projectors/TVs

### Host Control Panel (`/control`)
- Game flow controls (start/stop questions)
- Score management and point awarding
- Buzzer system controls (arm/disarm)
- Live system status monitoring

### Admin Configuration (`/admin`)
- Game setup and management
- Team configuration with colors and buzzer mapping
- Question management with media support
- System diagnostics and configuration

## 📊 Features

### Game Management
- ✅ Multiple simultaneous games
- ✅ Real-time score tracking
- ✅ Question timing and media support
- ✅ Customizable point values
- ✅ Game history and statistics

### Hardware Integration
- ✅ Millisecond-precision buzzer timing
- ✅ LED status indicators
- ✅ Wireless ESP-NOW communication
- ✅ Auto-discovery of buzzer devices
- ✅ Hardware diagnostics and testing

### Real-time Features
- ✅ WebSocket connections for live updates
- ✅ Instant buzzer press notifications
- ✅ Live score updates across all clients
- ✅ System status monitoring

### Additional Features
- ✅ Firebase integration for cloud sync
- ✅ Responsive web design
- ✅ RESTful API architecture
- ✅ SQLite database with sample data
- ✅ Error handling and recovery

## 📡 API Endpoints

### Games
- `GET /api/games` - List all games
- `POST /api/games` - Create new game
- `GET /api/games/:id` - Get game details
- `PUT /api/games/:id/status` - Update game status
- `POST /api/games/:id/start-question/:index` - Start question
- `POST /api/games/:id/end-question` - End current question

### Teams/Groups
- `GET /api/groups/game/:gameId` - Get teams for game
- `POST /api/groups/game/:gameId` - Add team to game
- `PUT /api/groups/:id` - Update team
- `DELETE /api/groups/:id` - Remove team

### Questions
- `GET /api/questions/game/:gameId` - Get questions for game
- `POST /api/questions/game/:gameId` - Add question to game
- `PUT /api/questions/:id` - Update question
- `DELETE /api/questions/:id` - Remove question

### Buzzers
- `GET /api/buzzers/status` - Get buzzer system status
- `POST /api/buzzers/arm/:gameId` - Arm buzzers for game
- `POST /api/buzzers/disarm` - Disarm all buzzers
- `POST /api/buzzers/test/:buzzerId` - Test specific buzzer

## 🔌 WebSocket Events

### Client → Server
- `join-game` - Join game room for updates
- `join-control` - Join host control room
- `buzzer-press` - Manual buzzer press (testing)

### Server → Client
- `game-state` - Complete game state update
- `question-start` - Question started with timing
- `question-end` - Question ended with results
- `buzzer-pressed` - Real-time buzzer press
- `score-update` - Score change notification
- `game-reset` - Game has been reset

## 🛠️ Configuration

### Environment Variables
```env
PORT=3000                          # Server port
DB_PATH=./backend/database/trivia.db  # Database location
ESP32_SERIAL_PORT=/dev/ttyUSB0     # ESP32 serial port
ESP32_BAUD_RATE=115200             # Serial communication speed
FIREBASE_PROJECT_ID=your-project-id # Optional Firebase project
```

### ESP32 Configuration
Update these constants in the firmware:
- `DEVICE_ID` - Unique ID for each group buzzer
- `coordinatorMAC` - MAC address of central coordinator
- `MAX_GROUPS` - Maximum number of groups (default: 15)

## 📈 System Monitoring

### Health Check
- Endpoint: `GET /health`
- Returns: Database, ESP32, and Firebase connection status

### Logs and Diagnostics
- Serial output from ESP32 coordinator
- WebSocket connection status
- Database query performance
- Real-time device heartbeats

## 🔧 Troubleshooting

### Common Issues

1. **ESP32 Connection Failed**
   - Check USB cable and port permissions
   - Verify ESP32 firmware is flashed correctly
   - Confirm serial port in `.env` matches actual port

2. **Buzzers Not Responding**
   - Check ESP-NOW MAC addresses match
   - Verify power connections to buzzers
   - Test individual buzzers using host control panel

3. **Database Errors**
   - Ensure SQLite database directory exists
   - Check file permissions
   - Try deleting database file to regenerate

4. **WebSocket Connection Issues**
   - Check firewall settings
   - Verify port 3000 is accessible
   - Clear browser cache and restart

## 📦 Development

### Project Structure
```
├── backend/              # Node.js server
│   ├── database/        # SQLite database
│   ├── routes/          # API endpoints
│   ├── services/        # Business logic
│   └── models/          # Data models
├── frontend/            # Web applications
│   ├── game-display/    # Main game screen
│   ├── host-control/    # Host control panel
│   └── admin-config/    # Admin interface
├── firmware/            # ESP32 code
│   ├── group-buzzer/    # Individual buzzer firmware
│   └── central-coordinator/  # Master controller
└── public/              # Static assets
```

### Development Commands
```bash
npm run dev        # Start with nodemon for auto-restart
npm test           # Run test suite
npm run build      # Build all frontend apps
npm start          # Start production server
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and test thoroughly
4. Commit with clear messages: `git commit -m "Add feature"`
5. Push and create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- ESP32 community for ESP-NOW examples
- Socket.IO for real-time communication
- SQLite for embedded database solution
- Firebase for cloud integration capabilities

---

**Built with ❤️ for the Waze team's trivia nights!**