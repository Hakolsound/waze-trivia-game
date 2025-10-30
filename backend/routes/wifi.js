const express = require('express');
const router = express.Router();

// WiFi channel management routes
// These will communicate with the ESP32 coordinator via serial

// Import ESP32Service - we'll need to pass it as a parameter when creating the router
module.exports = (esp32Service) => {

// WiFi scan endpoint - runs WiFi scan directly on Raspberry Pi
router.post('/scan', async (req, res) => {
  try {
    console.log('Starting WiFi scan on Raspberry Pi...');

    // Run iwlist scan command on the Pi (try nmcli as fallback)
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    let stdout, stderr;
    try {
      console.log('Executing: sudo iwlist wlan0 scan');
      ({ stdout, stderr } = await execAsync('sudo iwlist wlan0 scan', { timeout: 15000 }));
    } catch (iwlistError) {
      console.log('iwlist failed, trying nmcli as fallback...');
      try {
        ({ stdout, stderr } = await execAsync('nmcli -t -f SSID,BSSID,FREQ,CHAN,SIGNAL,SECURITY dev wifi list', { timeout: 15000 }));
        console.log('Using nmcli output instead of iwlist');
      } catch (nmcliError) {
        throw new Error(`Both iwlist and nmcli failed: iwlist=${iwlistError.message}, nmcli=${nmcliError.message}`);
      }
    }

    if (stderr && !stderr.includes('No such device')) {
      console.warn('iwlist stderr:', stderr);
    }

    console.log('WiFi scan completed, parsing results...');

    // Parse output (iwlist or nmcli format)
    let channels;
    if (stdout.includes('Cell ')) {
      // This is iwlist output
      channels = parseIwlistOutput(stdout);
    } else {
      // This is nmcli output
      channels = parseNmcliOutput(stdout);
    }

    // Debug: show how many networks were found
    const totalNetworks = channels.reduce((sum, ch) => sum + ch.networkCount, 0);
    console.log(`Total WiFi networks found: ${totalNetworks}`);

    console.log('Parsed WiFi scan results:', channels.map(ch =>
      `CH${ch.channel}: ${ch.score}pts (${ch.quality}) - RSSI:${ch.signal}dBm, Networks:${ch.networkCount}`
    ));

    // Find best channel for recommendation
    const bestChannel = channels.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    console.log('Recommended channel:', bestChannel.channel, 'with score:', bestChannel.score);

    res.json({
      success: true,
      currentChannel: 13, // Default, will be updated when ESP32 reports
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
    const { channel, confirmed } = req.body;

    if (!channel || channel < 1 || channel > 13) {
      return res.status(400).json({
        success: false,
        message: 'Channel must be between 1 and 13'
      });
    }

    // Check device status before allowing channel change
    const devices = await esp32Service.getDevices();
    const registeredDevices = devices.filter(d => d.device_id > 0);
    const onlineDevices = registeredDevices.filter(d => d.online === true);

    console.log(`Channel change request: ${onlineDevices.length}/${registeredDevices.length} devices online`);

    // If not all devices online and not confirmed, return warning
    if (!confirmed && onlineDevices.length < registeredDevices.length) {
      return res.status(400).json({
        success: false,
        needsConfirmation: true,
        message: `Only ${onlineDevices.length} of ${registeredDevices.length} buzzers are online`,
        deviceStatus: {
          total: registeredDevices.length,
          online: onlineDevices.length,
          offline: registeredDevices.length - onlineDevices.length
        }
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
      }, 3000); // 3 second timeout for channel change (ESP-NOW is fast)

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

// Parse iwlist scan output
function parseIwlistOutput(output) {
  console.log('Parsing iwlist output, total length:', output.length);

  const lines = output.split('\n');
  const channels = [];

  // Initialize channels 1-13 with default values
  for (let i = 1; i <= 13; i++) {
    channels[i] = {
      channel: i,
      signal: -90, // Default weak signal
      networkCount: 0,
      score: 10,   // Minimum score
      quality: 'poor'
    };
  }

  let currentCell = null;
  let cellCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Start of a new cell - iwlist format: "Cell XX - Address: ..."
    if (trimmed.startsWith('Cell ')) {
      // Save previous cell if it exists
      if (currentCell && currentCell.channel && currentCell.signalDbm !== undefined) {
        const channel = currentCell.channel;
        if (channel >= 1 && channel <= 13) {
          cellCount++;
          console.log(`Found network on channel ${channel}: RSSI=${currentCell.signalDbm}dBm`);
          channels[channel].networkCount++;
          if (currentCell.signalDbm > channels[channel].signal) {
            channels[channel].signal = currentCell.signalDbm;
          }
        }
      }

      currentCell = {};
    }

    // Channel information - format: "Channel:X"
    else if (trimmed.startsWith('Channel:') && currentCell) {
      const channelMatch = trimmed.match(/Channel:(\d+)/);
      if (channelMatch) {
        currentCell.channel = parseInt(channelMatch[1]);
      }
    }

    // Signal level - format: "Quality=X/70  Signal level=Y dBm"
    else if (trimmed.includes('Signal level=') && currentCell) {
      // Direct dBm format: "Signal level=-69 dBm"
      const signalMatch = trimmed.match(/Signal level=\s*(-?\d+)\s*dBm/);
      if (signalMatch) {
        currentCell.signalDbm = parseInt(signalMatch[1]);
      }
    }
  }

  // Process the last cell
  if (currentCell && currentCell.channel && currentCell.signalDbm !== undefined) {
    const channel = currentCell.channel;
    if (channel >= 1 && channel <= 13) {
      cellCount++;
      console.log(`Found network on channel ${channel}: RSSI=${currentCell.signalDbm}dBm`);
      channels[channel].networkCount++;
      if (currentCell.signalDbm > channels[channel].signal) {
        channels[channel].signal = currentCell.signalDbm;
      }
    }
  }

  console.log(`Total 2.4GHz networks found: ${cellCount}`);

  // Calculate quality scores for each channel
  const result = [];
  for (let i = 1; i <= 13; i++) {
    const ch = channels[i];

    // Calculate score based on signal strength and network count
    let signalScore = 0;
    if (ch.signal > -40) signalScore = 100;
    else if (ch.signal > -50) signalScore = 90;
    else if (ch.signal > -60) signalScore = 75;
    else if (ch.signal > -70) signalScore = 60;
    else if (ch.signal > -80) signalScore = 40;
    else signalScore = 20;

    // Network count penalty (more networks = lower score)
    const networkPenalty = Math.min(ch.networkCount * 5, 30);

    // Non-overlapping channel bonus (1, 6, 11 are preferred in 2.4GHz)
    const nonOverlappingBonus = [1, 6, 11].includes(ch.channel) ? 15 : 0;

    const totalScore = Math.max(10, signalScore - networkPenalty + nonOverlappingBonus);

    result.push({
      channel: ch.channel,
      signal: ch.signal,
      networkCount: ch.networkCount,
      score: totalScore,
      quality: totalScore > 90 ? 'excellent' :
              totalScore > 75 ? 'good' :
              totalScore > 60 ? 'fair' : 'poor'
    });
  }

  return result;
}

// Parse nmcli scan output (format: SSID:BSSID:FREQ:CHAN:SIGNAL:SECURITY)
function parseNmcliOutput(output) {
  console.log('Parsing nmcli output');
  const lines = output.split('\n');
  const channels = [];

  // Initialize channels 1-13 with default values
  for (let i = 1; i <= 13; i++) {
    channels[i] = {
      channel: i,
      signal: -90, // Default weak signal
      networkCount: 0,
      score: 10,   // Minimum score
      quality: 'poor'
    };
  }

  for (const line of lines) {
    if (!line.trim()) continue;

    // nmcli format: SSID:BSSID:FREQ:CHAN:SIGNAL:SECURITY
    const parts = line.split(':');
    if (parts.length >= 5) {
      const ssid = parts[0];
      const channel = parseInt(parts[3]);
      const signalPercent = parseInt(parts[4]);

      if (channel >= 1 && channel <= 13 && signalPercent >= 0 && signalPercent <= 100) {
        // Convert signal percentage to dBm approximation
        const signalDbm = -100 + (signalPercent * 0.5);

        channels[channel].networkCount++;
        if (signalDbm > channels[channel].signal) {
          channels[channel].signal = signalDbm;
        }
      }
    }
  }

  // Calculate quality scores for each channel
  const result = [];
  for (let i = 1; i <= 13; i++) {
    const ch = channels[i];

    // Calculate score based on signal strength and network count
    let signalScore = 0;
    if (ch.signal > -40) signalScore = 100;
    else if (ch.signal > -50) signalScore = 90;
    else if (ch.signal > -60) signalScore = 75;
    else if (ch.signal > -70) signalScore = 60;
    else if (ch.signal > -80) signalScore = 40;
    else signalScore = 20;

    // Network count penalty (more networks = lower score)
    const networkPenalty = Math.min(ch.networkCount * 5, 30);

    // Non-overlapping channel bonus (1, 6, 11 are preferred in 2.4GHz)
    const nonOverlappingBonus = [1, 6, 11].includes(ch.channel) ? 15 : 0;

    const totalScore = Math.max(10, signalScore - networkPenalty + nonOverlappingBonus);

    result.push({
      channel: ch.channel,
      signal: Math.round(ch.signal),
      networkCount: ch.networkCount,
      score: totalScore,
      quality: totalScore > 90 ? 'excellent' :
              totalScore > 75 ? 'good' :
              totalScore > 60 ? 'fair' : 'poor'
    });
  }

  return result;
}

  return router;
};
