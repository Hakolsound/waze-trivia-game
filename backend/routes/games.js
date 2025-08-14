const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

module.exports = (gameService) => {
  const router = express.Router();

  // Configure multer for file uploads
  const uploadDir = path.join(__dirname, '../../public/uploads');
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const filename = `logo_${req.body.gameId || Date.now()}${ext}`;
      cb(null, filename);
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed'), false);
      }
      cb(null, true);
    }
  });

  // Branding endpoints
  router.get('/:id/branding', async (req, res) => {
    try {
      const branding = await gameService.getGameBranding(req.params.id);
      res.json(branding);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.put('/:id/branding', async (req, res) => {
    try {
      const branding = await gameService.updateGameBranding(req.params.id, req.body);
      res.json(branding);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/branding/reset', async (req, res) => {
    try {
      const branding = await gameService.resetGameBranding(req.params.id);
      res.json(branding);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/upload-logo', upload.single('logo'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const logoUrl = `/uploads/${req.file.filename}`;
      const gameId = req.body.gameId;
      
      if (gameId) {
        await gameService.updateGameBranding(gameId, { logo_url: logoUrl });
      }
      
      res.json({ logoUrl, filename: req.file.filename });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id/logo', async (req, res) => {
    try {
      const game = await gameService.getGame(req.params.id);
      if (game.logo_url) {
        const filename = path.basename(game.logo_url);
        const filePath = path.join(uploadDir, filename);
        
        try {
          await fs.unlink(filePath);
        } catch (fileError) {
          console.warn('Could not delete logo file:', fileError.message);
        }
        
        await gameService.updateGameBranding(req.params.id, { logo_url: null });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const games = await gameService.getAllGames();
      res.json(games);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const game = await gameService.getGame(req.params.id);
      res.json(game);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const game = await gameService.createGame(req.body);
      res.status(201).json(game);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      const game = await gameService.updateGameStatus(req.params.id, status);
      res.json(game);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/start-question/:questionIndex', async (req, res) => {
    try {
      const questionIndex = parseInt(req.params.questionIndex);
      const question = await gameService.startQuestion(req.params.id, questionIndex);
      res.json(question);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/end-question', async (req, res) => {
    try {
      await gameService.endQuestion(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/award-points', async (req, res) => {
    try {
      const { groupId, points } = req.body;
      const group = await gameService.awardPoints(req.params.id, groupId, points);
      res.json(group);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/:id/state', async (req, res) => {
    try {
      const state = await gameService.getGameState(req.params.id);
      res.json(state);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.post('/:id/reset', async (req, res) => {
    try {
      const game = await gameService.resetGame(req.params.id);
      res.json(game);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};