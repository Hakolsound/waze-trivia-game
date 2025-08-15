const express = require('express');

module.exports = (gameService) => {
  const router = express.Router();

  router.get('/game/:gameId', async (req, res) => {
    try {
      const game = await gameService.getGame(req.params.gameId);
      res.json(game.groups);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const group = await gameService.db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
      if (!group) {
        return res.status(404).json({ error: 'Team not found' });
      }
      res.json(group);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/game/:gameId', async (req, res) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const groupId = uuidv4();
      const { name, color, buzzer_id } = req.body;
      
      const result = await gameService.db.run(
        'INSERT INTO groups (id, game_id, name, color, buzzer_id, position) VALUES (?, ?, ?, ?, ?, ?)',
        [groupId, req.params.gameId, name, color, buzzer_id, Date.now()]
      );
      
      const group = await gameService.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
      res.status(201).json(group);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { name, color, buzzer_id } = req.body;
      await gameService.db.run(
        'UPDATE groups SET name = ?, color = ?, buzzer_id = ? WHERE id = ?',
        [name, color, buzzer_id, req.params.id]
      );
      
      const group = await gameService.db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
      res.json(group);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await gameService.db.run('DELETE FROM groups WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};