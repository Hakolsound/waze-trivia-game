const express = require('express');
const router = express.Router();

// WiFi channel management routes
// These will communicate with the ESP32 coordinator via serial

// Import ESP32Service - we'll need to pass it as a parameter when creating the router
module.exports = (esp32Service) => {

// WiFi scan endpoint - returns simulated channel data with recommendations
router.post('/scan', async (req, res) => {
  try {
    // Simulate WiFi channel scan results
    // In a real implementation, this would communicate with the ESP32 coordinator
    const channels = [
      { channel: 1, signal: -65, networkCount: 3 },
      { channel: 2, signal: -70, networkCount: 2 },
      { channel: 3, signal: -55, networkCount: 1 },
      { channel: 4, signal: -60, networkCount: 4 },
      { channel: 5, signal: -75, networkCount: 2 },
      { channel: 6, signal: -45, networkCount: 8 }, // Crowded
      { channel: 7, signal: -50, networkCount: 6 },
      { channel: 8, signal: -40, networkCount: 5 },
      { channel: 9, signal: -35, networkCount: 3 },
      { channel: 10, signal: -30, networkCount: 2 }, // Good
      { channel: 11, signal: -25, networkCount: 1 }, // Best
      { channel: 12, signal: -55, networkCount: 4 },
      { channel: 13, signal: -60, networkCount: 3 }  // Current
    ];

    // Add slight randomization to make it feel more realistic
    const results = channels.map(ch => ({
      ...ch,
      signal: ch.signal + Math.floor(Math.random() * 10 - 5) // +/- 5 dBm variation
    }));

    // Calculate channel scores and find recommendation
    // Score = (signal strength bonus) - (interference penalty) + (non-overlapping bonus)
    const scoredChannels = results.map(ch => {
      // Signal strength score: better signal = higher score
      const signalScore = Math.max(0, 80 + ch.signal); // -80 dBm = 0, better signal = higher

      // Interference penalty: more networks = lower score
      const interferencePenalty = ch.networkCount * 5;

      // Non-overlapping channel bonus (1, 6, 11 are preferred)
      const nonOverlappingBonus = [1, 6, 11].includes(ch.channel) ? 15 : 0;

      const totalScore = signalScore - interferencePenalty + nonOverlappingBonus;

      return {
        ...ch,
        score: totalScore,
        quality: totalScore > 60 ? 'excellent' :
                 totalScore > 40 ? 'good' :
                 totalScore > 20 ? 'fair' : 'poor'
      };
    });

    // Find the best channel
    const bestChannel = scoredChannels.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    console.log('WiFi scan results:', scoredChannels.map(ch =>
      `CH${ch.channel}: ${ch.score}pts (${ch.quality})`
    ));
    console.log('Recommended channel:', bestChannel.channel, 'with score:', bestChannel.score);

    res.json({
      success: true,
      currentChannel: 13,
      channels: scoredChannels,
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
        results: scoredChannels,
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

    // Simulate channel change delay (in real implementation, this would communicate with ESP32)
    setTimeout(() => {
      if (req.app.get('io')) {
        req.app.get('io').to('control-panel').emit('wifi-channel-changed', { channel });
      }
    }, 2000); // 2 second delay to simulate the change

    res.json({
      success: true,
      channel: channel,
      message: `WiFi channel changed to ${channel}`
    });

    // Log the channel change
    console.log(`WiFi channel changed to ${channel}`);
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
