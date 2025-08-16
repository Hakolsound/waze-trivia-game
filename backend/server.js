require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const Database = require('./services/database');
const GameService = require('./services/gameService');
const ESP32Service = require('./services/esp32Service');
const FirebaseService = require('./services/firebaseService');

const gameRoutes = require('./routes/games');
const groupRoutes = require('./routes/groups');
const questionRoutes = require('./routes/questions');
const buzzerRoutes = require('./routes/buzzers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
const gameService = new GameService(db, io);
const esp32Service = new ESP32Service(io);
const firebaseService = new FirebaseService();

app.use('/api/games', gameRoutes(gameService));
app.use('/api/groups', groupRoutes(gameService));
app.use('/api/questions', questionRoutes(gameService));
app.use('/api/buzzers', buzzerRoutes(esp32Service));

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
  
  socket.on('buzzer-press', (data) => {
    gameService.handleBuzzerPress(data);
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

  socket.on('toggle-leaderboard', () => {
    // Broadcast leaderboard toggle to all display clients
    io.to('game-display').emit('show-leaderboard');
    console.log('Leaderboard toggle broadcasted to display clients');
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
      console.log(`Updating buzzer ${deviceId} status: ${isOnline ? 'online' : 'offline'}`);
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