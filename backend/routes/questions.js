const express = require('express');

module.exports = (gameService) => {
  const router = express.Router();

  router.get('/game/:gameId', async (req, res) => {
    try {
      const game = await gameService.getGame(req.params.gameId);
      res.json(game.questions);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const question = await gameService.db.get('SELECT * FROM questions WHERE id = ?', [req.params.id]);
      if (!question) {
        return res.status(404).json({ error: 'Question not found' });
      }
      res.json(question);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/game/:gameId', async (req, res) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const questionId = uuidv4();
      const { text, correct_answer, time_limit = 30, points = 100, media_url } = req.body;
      
      const maxOrder = await gameService.db.get(
        'SELECT MAX(question_order) as max_order FROM questions WHERE game_id = ?',
        [req.params.gameId]
      );
      const questionOrder = (maxOrder?.max_order || 0) + 1;
      
      await gameService.db.run(
        'INSERT INTO questions (id, game_id, text, correct_answer, time_limit, points, media_url, question_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [questionId, req.params.gameId, text, correct_answer, time_limit, points, media_url, questionOrder]
      );
      
      const question = await gameService.db.get('SELECT * FROM questions WHERE id = ?', [questionId]);
      res.status(201).json(question);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { text, correct_answer, time_limit, points, media_url } = req.body;
      await gameService.db.run(
        'UPDATE questions SET text = ?, correct_answer = ?, time_limit = ?, points = ?, media_url = ? WHERE id = ?',
        [text, correct_answer, time_limit, points, media_url, req.params.id]
      );
      
      const question = await gameService.db.get('SELECT * FROM questions WHERE id = ?', [req.params.id]);
      res.json(question);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await gameService.db.run('DELETE FROM questions WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/game/:gameId/reorder', async (req, res) => {
    try {
      const { questionIds } = req.body;
      
      for (let i = 0; i < questionIds.length; i++) {
        await gameService.db.run(
          'UPDATE questions SET question_order = ? WHERE id = ? AND game_id = ?',
          [i + 1, questionIds[i], req.params.gameId]
        );
      }
      
      const game = await gameService.getGame(req.params.gameId);
      res.json(game.questions);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};