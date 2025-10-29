require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Add timestamps to all console output
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().split('T')[1].split('.')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');
};

console.log = (...args) => originalLog(`[${getTimestamp()}]`, ...args);
console.error = (...args) => originalError(`[${getTimestamp()}]`, ...args);
console.warn = (...args) => originalWarn(`[${getTimestamp()}]`, ...args);

const Database = require('./services/database');
const GameService = require('./services/gameService');
const ESP32Service = require('./services/esp32Service');
const FirebaseService = require('./services/firebaseService');

const gameRoutes = require('./routes/games');
const groupRoutes = require('./routes/groups');
const questionRoutes = require('./routes/questions');
const buzzerRoutes = require('./routes/buzzers');
const wifiRoutes = require('./routes/wifi');
const systemRoutes = require('./routes/system');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Make io available to routes
app.set('io', io);

// Handle favicon requests before any middleware
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // Return no content for favicon
});

// Console logging utility for monitoring
const consoleLogger = {
  log: (category, message, level = 'info') => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      category,
      message,
      level
    };

    // Send to control panel via socket
    io.to('control-panel').emit('console-log', logEntry);

    // Also log to server console with category prefix
    const prefix = `[${category.toUpperCase()}]`;
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warning':
        console.warn(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  },

  hardware: (message, level = 'info') => {
    consoleLogger.log('hardware', message, level);
  },

  game: (message, level = 'info') => {
    consoleLogger.log('game', message, level);
  },

  error: (message) => {
    consoleLogger.log('error', message, 'error');
  },

  warning: (message) => {
    consoleLogger.log('warning', message, 'warning');
  },

  info: (message) => {
    consoleLogger.log('info', message, 'info');
  }
};

// Make console logger globally available
global.consoleLogger = consoleLogger;

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Serve frontend static files
app.use('/admin', express.static(path.join(__dirname, '../frontend/admin-config')));
app.use('/display', express.static(path.join(__dirname, '../frontend/game-display')));
app.use('/control', express.static(path.join(__dirname, '../frontend/host-control')));
app.use('/virtual-buzzer', express.static(path.join(__dirname, '../frontend/virtual-buzzer')));
app.use('/shared', express.static(path.join(__dirname, '../frontend/shared')));

// Serve admin static files at root level since admin is the default page
app.get('/admin.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '../frontend/admin-config/admin.css'));
});

app.get('/admin.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, '../frontend/admin-config/admin.js'));
});

const db = new Database();
const esp32Service = new ESP32Service(io);
const gameService = new GameService(db, io, esp32Service);
const firebaseService = new FirebaseService();

// Set gameService reference in ESP32Service to enable direct calls
esp32Service.gameService = gameService;

app.use('/api/games', gameRoutes(gameService));
app.use('/api/groups', groupRoutes(gameService));
app.use('/api/questions', questionRoutes(gameService));
app.use('/api/buzzers', buzzerRoutes(esp32Service));
app.use('/api/wifi', wifiRoutes(esp32Service));
app.use('/api/system', systemRoutes(io, esp32Service, gameService));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: db.isConnected(),
      esp32: esp32Service.isConnected(),
      firebase: firebaseService.isConnected()
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-config/index.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/game-display/index.html'));
});

app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/host-control/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-config/index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current global game status when client connects
  gameService.getGlobalGameStatus().then(globalStatus => {
    socket.emit('global-game-status', globalStatus);
  });
  
  socket.on('join-game', (gameId) => {
    socket.join(`game-${gameId}`);
    gameService.getGameState(gameId).then(state => {
      socket.emit('game-state', state);
    });
  });
  
  socket.on('join-control', () => {
    socket.join('control-panel');
  });
  
  socket.on('join-admin', () => {
    socket.join('admin-panel');
  });
  
  socket.on('join-display', () => {
    socket.join('game-display');
  });
  
  socket.on('buzzer-press', async (data) => {
    console.log('Buzzer press received:', data);

    // Handle the buzzer press through game service
    console.log('Calling gameService.handleBuzzerPress...');
    try {
      await gameService.handleBuzzerPress(data);
      console.log('gameService.handleBuzzerPress completed successfully');
    } catch (error) {
      console.error('Error in gameService.handleBuzzerPress:', error);
    }

    // Broadcast buzzer press to both control panel and display clients
    console.log('Broadcasting buzzer press to control panel and display clients');
    console.log('Control panel room size:', io.sockets.adapter.rooms.get('control-panel')?.size || 0);
    console.log('Display room size:', io.sockets.adapter.rooms.get('game-display')?.size || 0);

    io.to('control-panel').emit('buzzer-pressed', data);
    io.to('game-display').emit('buzzer-pressed', data);
    console.log('Buzzer press broadcast sent to all clients');
  });

  // Virtual buzzer events
  socket.on('virtual-buzzer-register', (data) => {
    console.log('Virtual buzzer registered:', data);
    // Track virtual buzzer registration
    socket.virtualBuzzerId = data.buzzerId;
    socket.virtualGroupId = data.groupId;
    socket.virtualTeamName = data.teamName;
    
    // Join game rooms for real-time updates
    if (gameService.getCurrentGlobalGame()) {
      socket.join(`game-${gameService.getCurrentGlobalGame()}`);
    }
    
    // Notify host control about virtual buzzer registration
    io.to('control-panel').emit('virtual-buzzer-register', data);
  });

  socket.on('request-buzzer-state', async () => {
    console.log('Virtual buzzer requesting current state');
    try {
      // Get current buzzer state from ESP32 service
      const buzzerStatus = await esp32Service.getStatus();
      const currentGame = gameService.getCurrentGlobalGame();

      // Check if any buzzers are currently armed by examining buzzer states
      let isArmed = false;
      if (buzzerStatus && buzzerStatus.buzzerStates) {
        // Check if any device is armed
        for (const [deviceId, state] of Object.entries(buzzerStatus.buzzerStates)) {
          if (state.armed === true) {
            isArmed = true;
            break;
          }
        }
      }

      // Send current state to requesting virtual buzzer
      socket.emit('buzzer-state-response', {
        armed: isArmed,
        gameActive: !!currentGame,
        timestamp: Date.now()
      });

      console.log(`Sent buzzer state to virtual buzzer: armed=${isArmed}, gameActive=${!!currentGame}`);
    } catch (error) {
      console.error('Error getting buzzer state for virtual buzzer:', error);
      // Send default state
      socket.emit('buzzer-state-response', {
        armed: false,
        gameActive: false,
        timestamp: Date.now()
      });
    }
  });

  socket.on('request-global-game', async () => {
    try {
      const gameStatus = await gameService.getGlobalGameStatus();
      socket.emit('global-game-changed', gameStatus);
    } catch (error) {
      console.error('Error sending global game status:', error);
    }
  });

  socket.on('request-teams', () => {
    // Send current teams if game is active
    if (gameService.getCurrentGlobalGame()) {
      gameService.getCurrentGlobalGameData().then(game => {
        if (game && game.groups) {
          socket.emit('teams-updated', game.groups);
        }
      });
    }
  });

  socket.on('get-game-state', async (gameId) => {
    try {
      const game = await gameService.getGame(gameId);
      socket.emit('game-state-response', game);
      console.log(`Game state sent for game ${gameId}`);
    } catch (error) {
      console.error('Error getting game state:', error);
      socket.emit('game-state-response', null);
    }
  });

  socket.on('show-leaderboard', (data) => {
    // Broadcast leaderboard show to all display clients with view parameter
    const viewData = data || { view: 'all' };
    io.to('game-display').emit('show-leaderboard', viewData);
    console.log(`Leaderboard show broadcasted to display clients (view: ${viewData.view})`);
  });

  socket.on('hide-leaderboard', () => {
    // Broadcast leaderboard hide to all display clients
    io.to('game-display').emit('hide-leaderboard');
    // console.log('Leaderboard hide broadcasted to display clients');  // Too verbose
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Clean up virtual buzzer registration
    if (socket.virtualBuzzerId) {
      console.log('Virtual buzzer disconnected:', socket.virtualBuzzerId);
      // Notify host control about virtual buzzer disconnection
      io.to('control-panel').emit('virtual-buzzer-disconnect', {
        buzzerId: socket.virtualBuzzerId,
        groupId: socket.virtualGroupId,
        teamName: socket.virtualTeamName
      });
    }
  });
});

// Listen for ESP32 device updates directly from the ESP32 service
esp32Service.on('device-data', (data) => {
  // Parse device data and update game service buzzer status
  if (data.esp32_data) {
    const deviceMatch = data.esp32_data.match(/^DEVICE:(\d+),.*online=(\d+)/);
    if (deviceMatch) {
      const deviceId = deviceMatch[1];
      const isOnline = deviceMatch[2] === '1';
      // console.log(`Updating buzzer ${deviceId} status: ${isOnline ? 'online' : 'offline'}`);  // Too verbose
      gameService.updateBuzzerOnlineStatus(deviceId, isOnline);
    }
  }
});

async function initialize() {
  try {
    await db.initialize();
    await esp32Service.initialize();
    await firebaseService.initialize();
    
    server.listen(PORT, () => {
      console.log(`Trivia Game Server running on port ${PORT}`);
      console.log(`Game Display: http://localhost:${PORT}/display`);
      console.log(`Host Control: http://localhost:${PORT}/control`);
      console.log(`Admin Panel: http://localhost:${PORT}/admin`);
      console.log(`Virtual Buzzer: http://pi.local:${PORT}/virtual-buzzer`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await db.close();
  await esp32Service.close();
  process.exit(0);
});

initialize();