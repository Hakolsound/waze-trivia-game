const express = require('express');

module.exports = (esp32Service) => {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const status = await esp32Service.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/arm/:gameId', async (req, res) => {
    try {
      const result = await esp32Service.armBuzzers(req.params.gameId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/disarm', async (req, res) => {
    try {
      const result = await esp32Service.disarmBuzzers();
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/test/:buzzerId', async (req, res) => {
    try {
      const result = await esp32Service.testBuzzer(req.params.buzzerId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/history/:gameId', async (req, res) => {
    try {
      const history = await esp32Service.getBuzzerHistory(req.params.gameId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all buzzer devices and their status
  router.get('/devices', async (req, res) => {
    try {
      const devices = await esp32Service.getDevices();
      res.json(devices || []);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Arm all buzzers (without game ID - for testing purposes)
  router.post('/arm', async (req, res) => {
    try {
      const result = await esp32Service.armBuzzers('test-mode');
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Arm specific buzzers
  router.post('/arm-selected/:gameId', async (req, res) => {
    try {
      const { buzzerIds } = req.body;
      if (!buzzerIds || !Array.isArray(buzzerIds) || buzzerIds.length === 0) {
        return res.status(400).json({ error: 'buzzerIds array is required' });
      }

      const result = await esp32Service.armSpecificBuzzers(req.params.gameId, buzzerIds);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};