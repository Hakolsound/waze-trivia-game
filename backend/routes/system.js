const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

module.exports = (io, esp32Service, gameService) => {
  const router = express.Router();

  // Get system status
  router.get('/status', async (req, res) => {
    try {
      const status = {
        esp32: esp32Service.isConnectedFlag ? 'online' : 'offline',
        gameservice: 'running', // GameService is always running as part of the main process
        pm2: 'unknown'
      };

      // Check PM2 status
      try {
        const { stdout } = await execAsync('pm2 jlist');
        const pm2List = JSON.parse(stdout);
        const triviaProcess = pm2List.find(p => p.name && p.name.includes('trivia'));

        if (triviaProcess) {
          status.pm2 = triviaProcess.pm2_env.status === 'online' ? 'running' : 'stopped';
        } else {
          status.pm2 = 'not-found';
        }
      } catch (error) {
        // PM2 not available or not running
        status.pm2 = 'unavailable';
      }

      res.json(status);

      // Broadcast status to control panel
      io.to('control-panel').emit('system-status-update', status);

    } catch (error) {
      console.error('Error getting system status:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  });

  // Restart services
  router.post('/restart/:service', async (req, res) => {
    const { service } = req.params;

    try {
      let result = { success: false, message: 'Unknown service' };

      switch (service) {
        case 'esp32':
          // Reset ESP32 connection and circuit breaker
          if (esp32Service.serialPort) {
            esp32Service.serialPort.close();
            esp32Service.serialPort = null;
          }
          esp32Service.isConnectedFlag = false;
          esp32Service.circuitBreaker.failures = 0;
          esp32Service.circuitBreaker.state = 'CLOSED';

          // Try to reconnect
          await esp32Service.connect();

          result = {
            success: esp32Service.isConnectedFlag,
            message: esp32Service.isConnectedFlag ? 'ESP32 reconnected successfully' : 'ESP32 reconnection failed'
          };
          break;

        case 'gameservice':
          // GameService restart is not directly possible as it's part of the main process
          // Instead, we'll simulate a restart by clearing state
          gameService.activeGames.clear();

          result = {
            success: true,
            message: 'GameService state cleared - restart simulated'
          };
          break;

        case 'pm2':
          try {
            // Restart the PM2 process
            const { stdout, stderr } = await execAsync('pm2 restart all');
            result = {
              success: true,
              message: 'PM2 restart initiated successfully'
            };
          } catch (error) {
            result = {
              success: false,
              message: `PM2 restart failed: ${error.message}`
            };
          }
          break;

        default:
          result = {
            success: false,
            message: `Unknown service: ${service}`
          };
      }

      // Send result back to client
      res.json(result);

      // Emit result to control panel
      io.to('control-panel').emit('service-restart-result', {
        service,
        success: result.success,
        message: result.message
      });

      // Log the operation
      global.consoleLogger?.info(`Service restart attempt: ${service} - ${result.success ? 'SUCCESS' : 'FAILED'}: ${result.message}`);

    } catch (error) {
      console.error(`Error restarting service ${service}:`, error);
      const errorResult = {
        success: false,
        message: `Restart failed: ${error.message}`
      };

      res.status(500).json(errorResult);

      // Emit error to control panel
      io.to('control-panel').emit('service-restart-result', {
        service,
        success: false,
        message: error.message
      });
    }
  });

  return router;
};
