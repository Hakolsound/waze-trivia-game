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
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
  
  socket.on('join-game', (gameId) => {
    socket.join(`game-${gameId}`);
    gameService.getGameState(gameId).then(state => {
      socket.emit('game-state', state);
    });
  });
  
  socket.on('join-control', () => {
    socket.join('control-panel');
  });
  
  socket.on('buzzer-press', (data) => {
    gameService.handleBuzzerPress(data);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
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