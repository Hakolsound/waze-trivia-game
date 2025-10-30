const express = require('express');
const router = express.Router();

// WiFi channel management routes
// These will communicate with the ESP32 coordinator via serial

// Import ESP32Service - we'll need to pass it as a parameter when creating the router
module.exports = (esp32Service) => {

// WiFi scan endpoint - communicates with ESP32 coordinator for real scanning
router.post('/scan', async (req, res) => {
  try {
    console.log('Starting WiFi scan via ESP32 coordinator...');

    // Clear any previous scan results
    esp32Service.channelScanResults = [];

    // Send scan command to ESP32
    const scanResult = await esp32Service.scanWifiChannels();
    console.log('ESP32 scan command result:', scanResult);

    // Wait for scan completion (ESP32 will emit 'wifi-scan-complete' event)
    const scanPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Scan timeout - ESP32 coordinator not responding'));
      }, 30000); // 30 second timeout

      const onScanComplete = (results) => {
        clearTimeout(timeout);
        esp32Service.removeListener('wifi-scan-complete', onScanComplete);
        esp32Service.removeListener('wifi-scan-failed', onScanFailed);
        resolve(results);
      };

      const onScanFailed = () => {
        clearTimeout(timeout);
        esp32Service.removeListener('wifi-scan-complete', onScanComplete);
        esp32Service.removeListener('wifi-scan-failed', onScanFailed);
        reject(new Error('ESP32 scan failed'));
      };

      esp32Service.once('wifi-scan-complete', onScanComplete);
      esp32Service.once('wifi-scan-failed', onScanFailed);
    });

    const scanData = await scanPromise;
    console.log('Scan completed, processing results...');

    // Get processed results from ESP32 service
    const processedResults = await esp32Service.getChannelScanResults();

    // Format results for frontend (matching expected format)
    const channels = processedResults.results.map(ch => ({
      channel: ch.channel,
      signal: ch.signal,
      networkCount: ch.networkCount,
      score: ch.quality, // ESP32 quality score (0-100)
      quality: ch.quality > 90 ? 'excellent' :
              ch.quality > 75 ? 'good' :
              ch.quality > 60 ? 'fair' : 'poor'
    }));

    console.log('Processed WiFi scan results:', channels.map(ch =>
      `CH${ch.channel}: ${ch.score}pts (${ch.quality}) - RSSI:${ch.signal}dBm, Networks:${ch.networkCount}`
    ));

    // Find best channel for recommendation
    const bestChannel = channels.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    console.log('Recommended channel:', bestChannel.channel, 'with score:', bestChannel.score);

    res.json({
      success: true,
      currentChannel: 13, // Will be updated to read from ESP32
      channels,
      recommendation: {
        channel: bestChannel.channel,
        score: bestChannel.score,
        quality: bestChannel.quality,
        reason: bestChannel.quality === 'excellent' ?
          'Best overall performance with low interference' :
          bestChannel.quality === 'good' ?
          'Good balance of signal and low interference' :
          'Acceptable performance, consider other options'
      }
    });

    // Emit results to control panel clients
    if (req.app.get('io')) {
      req.app.get('io').to('control-panel').emit('wifi-scan-results', {
        results: channels,
        recommendation: bestChannel
      });
    }
  } catch (error) {
    console.error('Error scanning WiFi channels:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to scan WiFi channels',
      error: error.message
    });
  }
});

router.get('/channels/results', async (req, res) => {
  try {
    const results = await esp32Service.getChannelScanResults();
    res.json(results);
  } catch (error) {
    console.error('Error getting channel results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get channel results'
    });
  }
});

router.get('/channels/best', async (req, res) => {
  try {
    // For now, simulate getting best channel (would be channel 11 with quality 95)
    const bestChannel = 11;
    const quality = 95;

    // Simulate channel change
    setTimeout(() => {
      if (req.app.get('io')) {
        req.app.get('io').emit('wifi-channel-changed', { channel: bestChannel });
      }
    }, 1000);

    res.json({
      success: true,
      channel: bestChannel,
      quality: quality
    });
  } catch (error) {
    console.error('Error getting best channel:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get best channel'
    });
  }
});

router.get('/channels/current', async (req, res) => {
  try {
    // For now, return current channel (would be retrieved from coordinator)
    res.json({
      success: true,
      channel: 13
    });
  } catch (error) {
    console.error('Error getting current channel:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get current channel'
    });
  }
});

// Set WiFi channel endpoint
router.post('/channel', async (req, res) => {
  try {
    const { channel } = req.body;

    if (!channel || channel < 1 || channel > 13) {
      return res.status(400).json({
        success: false,
        message: 'Channel must be between 1 and 13'
      });
    }

    console.log(`Starting WiFi channel change to ${channel} via ESP32 coordinator...`);

    // Send channel change command to ESP32
    const changeResult = await esp32Service.setWifiChannel(channel);
    console.log('ESP32 channel change command result:', changeResult);

    // Wait for channel change completion
    const changePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Channel change timeout - ESP32 coordinator not responding'));
      }, 10000); // 10 second timeout for channel change

      const onChangeComplete = (data) => {
        clearTimeout(timeout);
        esp32Service.removeListener('wifi-channel-changed', onChangeComplete);
        esp32Service.removeListener('wifi-channel-change-failed', onChangeFailed);
        resolve(data);
      };

      const onChangeFailed = (data) => {
        clearTimeout(timeout);
        esp32Service.removeListener('wifi-channel-changed', onChangeComplete);
        esp32Service.removeListener('wifi-channel-change-failed', onChangeFailed);
        reject(new Error(`Channel change failed: ${data.channel}`));
      };

      esp32Service.once('wifi-channel-changed', onChangeComplete);
      esp32Service.once('wifi-channel-change-failed', onChangeFailed);
    });

    const changeData = await changePromise;
    console.log(`WiFi channel successfully changed to ${changeData.channel}`);

    res.json({
      success: true,
      channel: channel,
      message: `WiFi channel changed to ${channel}`
    });

    // Emit to control panel clients (already handled by ESP32 service event)
    console.log(`WiFi channel changed to ${channel} - all devices coordinated`);

  } catch (error) {
    console.error('Error setting WiFi channel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change WiFi channel',
      error: error.message
    });
  }
});

  return router;
};
