const express = require('express');

module.exports = (gameService) => {
  const router = express.Router();

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