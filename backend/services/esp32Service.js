let SerialPort, ReadlineParser, ByteLengthParser;
try {
  const serialportModule = require('serialport');
  SerialPort = serialportModule.SerialPort;
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
  ByteLengthParser = require('@serialport/parser-byte-length').ByteLengthParser;
} catch (error) {
  console.warn('SerialPort module not available, ESP32 will run in simulation mode');
}

const { EventEmitter } = require('events');

class ESP32Service extends EventEmitter {
  constructor(io, gameService = null) {
    super();
    this.io = io;
    this.gameService = gameService;
    this.serialPort = null;
    this.parser = null;
    this.isConnectedFlag = false;
    this.buzzerStates = new Map();
    this.currentGameId = null;

    this.serialPortPath = process.env.ESP32_SERIAL_PORT || '/dev/ttyUSB0';
    this.baudRate = parseInt(process.env.ESP32_BAUD_RATE) || 115200;

    // Binary protocol configuration
    this.binaryProtocolEnabled = process.env.BINARY_PROTOCOL_ENABLED !== 'false'; // Default to true
    this.binaryBuffer = Buffer.alloc(0);

    // Protocol constants
    this.MESSAGE_TYPES = {
      BUZZER_PRESS: 0x01,
      STATUS: 0x02
    };

    this.COMMAND_TYPES = {
      ARM: 0x01,
      DISARM: 0x02,
      TEST: 0x03,
      STATUS_REQUEST: 0x04,
      CORRECT_ANSWER: 0x05,
      WRONG_ANSWER: 0x06,
      END_ROUND: 0x07
    };

    this.MESSAGE_SIZES = {
      BUZZER_MESSAGE: 12,
      STATUS_MESSAGE: 17,
      COMMAND_MESSAGE: 8
    };
  }

  async initialize() {
    try {
      if (!SerialPort || !ReadlineParser) {
        console.log('ESP32 running in simulation mode (no SerialPort module)');
        this.isConnectedFlag = false;
        return;
      }

      console.log(`Attempting to connect to ESP32 on ${this.serialPortPath}`);
      
      this.serialPort = new SerialPort({
        path: this.serialPortPath,
        baudRate: this.baudRate,
        autoOpen: false
      });

      // Setup parser based on protocol mode
      if (this.binaryProtocolEnabled) {
        // For binary protocol, read raw bytes
        this.parser = this.serialPort;
      } else {
        // For text protocol, use line parser
        this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      }

      this.serialPort.on('open', () => {
        console.log('ESP32 Serial connection established');
        this.isConnectedFlag = true;
        this.sendCommand('STATUS');
      });

      this.serialPort.on('error', (err) => {
        console.warn('ESP32 Serial error (will continue without hardware):', err.message);
        this.isConnectedFlag = false;
      });

      this.serialPort.on('close', () => {
        console.log('ESP32 Serial connection closed');
        this.isConnectedFlag = false;
      });

      this.parser.on('data', (data) => {
        if (this.binaryProtocolEnabled) {
          this.handleBinaryData(data);
        } else {
          this.handleSerialData(data.trim());
        }
      });

      try {
        await this.openSerialPort();
      } catch (error) {
        console.warn('Could not connect to ESP32 hardware, continuing in simulation mode');
        this.isConnectedFlag = false;
      }

    } catch (error) {
      console.warn('ESP32 Service initialization failed, continuing without hardware:', error.message);
      this.isConnectedFlag = false;
    }
  }

  openSerialPort() {
    return new Promise((resolve, reject) => {
      this.serialPort.open((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  handleSerialData(data) {
    try {
      console.log('ESP32 Data:', data);
      
      if (data.startsWith('BUZZER:')) {
        const buzzerData = data.substring(7);
        const [buzzerId, timestamp, deltaMs, position] = buzzerData.split(',');
        this.handleBuzzerPress(buzzerId, parseInt(timestamp), parseInt(deltaMs) || 0, parseInt(position) || 0);
      } else if (data.startsWith('STATUS:')) {
        // Parse STATUS:timestamp,armed=0,game=0,devices=1,presses=0 format
        const statusStr = data.substring(7);
        const parts = statusStr.split(',');
        const statusData = {};
        
        parts.forEach(part => {
          if (part.includes('=')) {
            const [key, value] = part.split('=');
            statusData[key] = isNaN(value) ? value : parseInt(value);
          }
        });
        
        this.updateBuzzerStates(statusData);
      } else if (data.startsWith('DEVICE:')) {
        // Parse DEVICE:1,online=1,armed=0,pressed=0,mac=EC:62:60:1D:E8:D4 format
        console.log('ESP32 Device Data:', data);
        this.parseDeviceData(data);
        
        // Emit to Socket.io clients
        this.io.emit('esp32-device-data', {
          esp32_data: data,
          timestamp: new Date().toISOString()
        });
        
        // Emit to gameService via EventEmitter
        this.emit('device-data', {
          esp32_data: data,
          timestamp: new Date().toISOString()
        });
      } else if (data.startsWith('ACK:')) {
        console.log('ESP32 Command acknowledged:', data.substring(4));
      } else if (data.startsWith('ERROR:')) {
        console.error('ESP32 Error:', data.substring(6));
      }
    } catch (error) {
      console.error('Error parsing ESP32 data:', error);
    }
  }

  // Binary Protocol Handlers
  handleBinaryData(data) {
    try {
      // Accumulate bytes in buffer
      this.binaryBuffer = Buffer.concat([this.binaryBuffer, data]);

      // Process complete messages
      while (this.binaryBuffer.length > 0) {
        const header = this.binaryBuffer[0];

        if (header === 0xAA) { // ESP32 → Pi message
          const messageType = this.binaryBuffer.length > 1 ? this.binaryBuffer[1] : null;

          if (messageType === this.MESSAGE_TYPES.BUZZER_PRESS) {
            if (this.binaryBuffer.length >= this.MESSAGE_SIZES.BUZZER_MESSAGE) {
              this.processBuzzerMessage(this.binaryBuffer.slice(0, this.MESSAGE_SIZES.BUZZER_MESSAGE));
              this.binaryBuffer = this.binaryBuffer.slice(this.MESSAGE_SIZES.BUZZER_MESSAGE);
            } else {
              break; // Wait for complete message
            }
          } else if (messageType === this.MESSAGE_TYPES.STATUS) {
            if (this.binaryBuffer.length >= this.MESSAGE_SIZES.STATUS_MESSAGE) {
              this.processStatusMessage(this.binaryBuffer.slice(0, this.MESSAGE_SIZES.STATUS_MESSAGE));
              this.binaryBuffer = this.binaryBuffer.slice(this.MESSAGE_SIZES.STATUS_MESSAGE);
            } else {
              break;
            }
          } else {
            // Unknown message type, skip this byte
            this.binaryBuffer = this.binaryBuffer.slice(1);
          }
        } else {
          // Invalid header, skip this byte
          this.binaryBuffer = this.binaryBuffer.slice(1);
        }
      }
    } catch (error) {
      console.error('Error processing binary data:', error);
      this.binaryBuffer = Buffer.alloc(0); // Reset buffer on error
    }
  }

  processBuzzerMessage(buffer) {
    // Verify checksum
    if (!this.verifyChecksum(buffer)) {
      console.warn('Invalid buzzer message checksum');
      return;
    }

    const deviceId = buffer[2];
    const timestamp = buffer.readUInt32LE(3);
    const deltaMs = buffer.readUInt16LE(7);
    const position = buffer[9];
    // buffer[10] is reserved byte
    // buffer[11] is checksum

    console.log(`Binary: Buzzer ${deviceId} pressed at ${deltaMs}ms (position ${position})`);

    this.handleBuzzerPress(deviceId.toString(), timestamp, deltaMs, position);
  }

  processStatusMessage(buffer) {
    if (!this.verifyChecksum(buffer)) {
      console.warn('Invalid status message checksum');
      return;
    }

    const deviceMask = buffer.readUInt16LE(2);
    const armedMask = buffer.readUInt16LE(4);
    const pressedMask = buffer.readUInt16LE(6);
    const timestamp = buffer.readUInt32LE(8);
    const gameId = buffer.readUInt32LE(12);

    console.log(`Binary Status: devices=0x${deviceMask.toString(16)}, armed=0x${armedMask.toString(16)}, pressed=0x${pressedMask.toString(16)}`);

    // Update device states from bitmasks
    this.updateDeviceStatesFromMasks(deviceMask, armedMask, pressedMask);
  }

  verifyChecksum(buffer) {
    let checksum = 0;
    for (let i = 0; i < buffer.length - 1; i++) {
      checksum ^= buffer[i];
    }
    return checksum === buffer[buffer.length - 1];
  }

  updateDeviceStatesFromMasks(deviceMask, armedMask, pressedMask) {
    // Update device states based on bitmasks
    for (let i = 0; i < 16; i++) {
      const deviceId = (i + 1).toString();
      const bitMask = 1 << i;

      if (deviceMask & bitMask) {
        // Device is online
        const existingState = this.buzzerStates.get(deviceId) || {};
        this.buzzerStates.set(deviceId, {
          ...existingState,
          online: true,
          armed: (armedMask & bitMask) !== 0,
          pressed: (pressedMask & bitMask) !== 0,
          last_seen: Date.now(),
          last_online: Date.now()
        });

        // Emit heartbeat for admin interface
        this.io.emit('buzzer-heartbeat', {
          device_id: deviceId,
          status: 'online',
          armed: (armedMask & bitMask) !== 0,
          pressed: (pressedMask & bitMask) !== 0,
          timestamp: Date.now()
        });
      }
    }

    // Emit status update
    this.io.emit('esp32-status', {
      connected: true,
      deviceMask,
      armedMask,
      pressedMask
    });
  }

  handleBuzzerPress(buzzerId, timestamp, deltaMs, position) {
    if (!this.currentGameId) {
      console.warn('Buzzer pressed but no active game');
      return;
    }

    // Convert ESP32 timestamp to JavaScript timestamp for gameService compatibility
    // GameService expects timestamp to be JavaScript Date.now() format
    const jsTimestamp = Date.now();

    const buzzerData = {
      gameId: this.currentGameId,
      buzzer_id: buzzerId,
      timestamp: jsTimestamp,
      deltaMs: deltaMs || 0,
      position: position || 0,
      groupId: this.getGroupIdByBuzzerId(buzzerId),
      esp32Timestamp: timestamp // Keep original ESP32 timestamp for reference
    };

    console.log('Physical buzzer press detected:', buzzerData);

    // Call gameService directly instead of emitting Socket.IO event
    if (this.gameService) {
      console.log('Calling gameService.handleBuzzerPress() directly for physical buzzer');
      console.log('Data being sent to gameService:', JSON.stringify(buzzerData, null, 2));
      this.gameService.handleBuzzerPress(buzzerData);
    } else {
      console.warn('GameService not available, cannot handle physical buzzer press');
    }

    // Still emit for admin interface and other listeners
    this.io.emit('buzzer-press', buzzerData);
  }

  getGroupIdByBuzzerId(buzzerId) {
    // ESP32Service doesn't have database access, so we return the buzzerId
    // GameService will handle the mapping from buzzer_id to actual group.id
    console.log(`[DEBUG] ESP32Service.getGroupIdByBuzzerId called with buzzerId: "${buzzerId}"`);
    return buzzerId;
  }

  sendCommand(command) {
    if (this.binaryProtocolEnabled) {
      // Parse text command and convert to binary
      return this.sendBinaryCommandFromText(command);
    } else {
      // Send text command
      if (this.isConnectedFlag && this.serialPort) {
        console.log('Sending ESP32 command:', command);
        this.serialPort.write(command + '\n');
        return true;
      } else {
        console.log('ESP32 not connected, simulating command:', command);
        this.simulateCommand(command);
        return false;
      }
    }
  }

  sendBinaryCommandFromText(command) {
    // Convert text commands to binary protocol
    if (command === 'ARM') {
      return this.sendBinaryCommand(this.COMMAND_TYPES.ARM, 0, parseInt(this.currentGameId) || 0);
    } else if (command === 'DISARM') {
      return this.sendBinaryCommand(this.COMMAND_TYPES.DISARM, 0, 0);
    } else if (command === 'STATUS') {
      return this.sendBinaryCommand(this.COMMAND_TYPES.STATUS_REQUEST, 0, 0);
    } else if (command.startsWith('TEST:')) {
      const deviceId = parseInt(command.substring(5)) || 0;
      return this.sendBinaryCommand(this.COMMAND_TYPES.TEST, deviceId, 0);
    } else if (command.startsWith('ARM_SPECIFIC:')) {
      // ARM_SPECIFIC is not supported in binary protocol yet, send as text
      if (this.isConnectedFlag && this.serialPort) {
        console.log('Sending ESP32 text command:', command);
        this.serialPort.write(command + '\n');
        return true;
      } else {
        console.log('ESP32 not connected, simulating command:', command);
        this.simulateCommand(command);
        return false;
      }
    } else {
      console.warn('Unknown command for binary protocol:', command);
      return false;
    }
  }

  sendBinaryCommand(command, targetDevice = 0, gameId = 0) {
    if (!this.isConnectedFlag || !this.serialPort) {
      console.log('ESP32 not connected, simulating binary command');
      return false;
    }

    const buffer = Buffer.alloc(this.MESSAGE_SIZES.COMMAND_MESSAGE);
    buffer[0] = 0xBB; // Command header
    buffer[1] = command;
    buffer[2] = targetDevice;
    buffer.writeUInt32LE(gameId, 3);

    // Calculate checksum
    let checksum = 0;
    for (let i = 0; i < 7; i++) {
      checksum ^= buffer[i];
    }
    buffer[7] = checksum;

    console.log(`Sending binary command: type=${command}, target=${targetDevice}, gameId=${gameId}`);
    this.serialPort.write(buffer);
    return true;
  }

  simulateCommand(command) {
    setTimeout(() => {
      if (command === 'STATUS') {
        this.handleSerialData('STATUS:{"buzzer_1":{"armed":false},"buzzer_2":{"armed":false},"buzzer_3":{"armed":false},"buzzer_4":{"armed":false}}');
      } else if (command === 'ARM') {
        this.handleSerialData('ACK:ARMED');
      } else if (command.startsWith('ARM_SPECIFIC:')) {
        const deviceList = command.substring(13);
        const deviceCount = deviceList.split(',').filter(id => id.trim().length > 0).length;
        this.handleSerialData(`ACK:ARM_SPECIFIC:${deviceCount}`);
      } else if (command === 'DISARM') {
        this.handleSerialData('ACK:DISARMED');
      }
    }, 100);
  }

  async armBuzzers(gameId) {
    this.currentGameId = gameId;
    const success = this.sendCommand('ARM');

    this.io.emit('buzzers-armed', { gameId });

    return {
      success: true,
      gameId,
      timestamp: Date.now(),
      hardwareConnected: success,
      message: success ? 'Buzzers armed successfully' : 'Buzzers armed (no hardware connected)'
    };
  }

  async armSpecificBuzzers(gameId, buzzerIds = []) {
    this.currentGameId = gameId;
    let success = true;

    if (buzzerIds.length === 0) {
      // No buzzers to arm
      console.log(`[ESP32] No buzzers to arm for game ${gameId}`);
      return {
        success: true,
        gameId,
        buzzerIds: [],
        timestamp: Date.now(),
        hardwareConnected: true,
        message: 'No buzzers to arm'
      };
    }

    // Send ARM_SPECIFIC command with comma-separated device IDs
    const deviceList = buzzerIds.join(',');
    console.log(`[ESP32] Arming specific buzzers: ${deviceList}`);
    const commandSuccess = this.sendCommand(`ARM_SPECIFIC:${deviceList}`);
    if (!commandSuccess) success = false;

    this.io.emit('buzzers-armed', { gameId, buzzerIds });

    return {
      success: true,
      gameId,
      buzzerIds,
      timestamp: Date.now(),
      hardwareConnected: success,
      message: success ? `Armed ${buzzerIds.length} specific buzzers successfully` : `Armed ${buzzerIds.length} specific buzzers (no hardware connected)`
    };
  }

  async disarmBuzzers() {
    const success = this.sendCommand('DISARM');
    this.currentGameId = null;
    
    this.io.emit('buzzers-disarmed');
    
    return {
      success: true,
      timestamp: Date.now(),
      hardwareConnected: success
    };
  }

  async testBuzzer(buzzerId) {
    const success = this.sendCommand(`TEST:${buzzerId}`);

    return {
      success: true,
      buzzerId,
      timestamp: Date.now(),
      hardwareConnected: success
    };
  }

  async sendCorrectAnswerFeedback(buzzerId) {
    console.log(`[ESP32] Sending correct answer feedback to buzzer ${buzzerId}`);
    const success = this.sendBinaryCommand(this.COMMAND_TYPES.CORRECT_ANSWER, buzzerId, parseInt(this.currentGameId) || 0);

    return {
      success: true,
      buzzerId,
      hardwareConnected: success,
      message: success ? 'Correct answer feedback sent' : 'Correct answer feedback simulated (no hardware)'
    };
  }

  async sendWrongAnswerFeedback(buzzerId) {
    console.log(`[ESP32] Sending wrong answer feedback to buzzer ${buzzerId}`);
    const success = this.sendBinaryCommand(this.COMMAND_TYPES.WRONG_ANSWER, buzzerId, parseInt(this.currentGameId) || 0);

    return {
      success: true,
      buzzerId,
      hardwareConnected: success,
      message: success ? 'Wrong answer feedback sent' : 'Wrong answer feedback simulated (no hardware)'
    };
  }

  async endRound(targetDevice = 0) {
    console.log(`[ESP32] Ending round for device ${targetDevice === 0 ? 'all' : targetDevice}`);
    const success = this.sendBinaryCommand(this.COMMAND_TYPES.END_ROUND, targetDevice, parseInt(this.currentGameId) || 0);

    return {
      success: true,
      targetDevice,
      hardwareConnected: success,
      message: success ? 'End round command sent' : 'End round command simulated (no hardware)'
    };
  }

  async getStatus() {
    this.sendCommand('STATUS');
    
    return {
      connected: this.isConnectedFlag,
      port: this.serialPortPath,
      baudRate: this.baudRate,
      currentGame: this.currentGameId,
      buzzerStates: Object.fromEntries(this.buzzerStates),
      lastUpdate: Date.now()
    };
  }

  async getBuzzerHistory(gameId) {
    return [];
  }

  async getDevices() {
    // Return array of buzzer devices with their actual status from ESP32 data
    const devices = [];
    const now = Date.now();
    const staleThreshold = 60000; // 60 seconds
    
    for (const [deviceId, state] of this.buzzerStates) {
      // Only include numeric device IDs (filter out false entries)
      if (!/^\d+$/.test(deviceId.toString())) continue;
      
      const timeSinceLastSeen = now - (state.last_seen || 0);
      // Device is online ONLY if ESP32 reported online=1 AND it's recent
      const isOnline = state.online === true && timeSinceLastSeen < staleThreshold;
      
      // For last_online: if device is currently online, use last_online or fallback to last_seen
      let lastOnlineTimestamp = null;
      if (isOnline) {
        // Currently online: use last_online if available, otherwise last_seen
        lastOnlineTimestamp = state.last_online || state.last_seen || now;
      } else {
        // Currently offline: only use last_online if it exists (when device was last online)
        lastOnlineTimestamp = state.last_online || null;
      }
      const timeSinceLastOnline = lastOnlineTimestamp ? now - lastOnlineTimestamp : null;
      
      devices.push({
        device_id: deviceId,
        name: `Buzzer ${deviceId}`,
        status: isOnline ? 'online' : 'offline',
        last_seen: state.last_seen || now,
        last_online: lastOnlineTimestamp || null,
        online: isOnline,
        armed: state.armed === true,
        pressed: state.pressed === true,
        mac: state.mac || '',
        time_since_last_seen: timeSinceLastSeen,
        time_since_last_online: timeSinceLastOnline,
        battery_percentage: state.battery_percentage || 0,
        battery_voltage: state.battery_voltage || 0.0
      });
    }
    
    // Don't create fake devices - only return actual ones from ESP32
    return devices;
  }

  parseDeviceData(deviceString) {
    try {
      const parts = deviceString.split(',');
      if (parts.length < 2) return;
      
      // Extract device ID
      const devicePart = parts[0];
      if (!devicePart.startsWith('DEVICE:')) return;
      const deviceId = devicePart.split(':')[1];
      
      if (!deviceId || !/^\d+$/.test(deviceId)) return;
      
      // Get existing state to preserve last_online timestamp
      const existingState = this.buzzerStates.get(deviceId) || {};
      
      // Parse parameters - default to offline
      const params = {
        last_seen: Date.now(), // Always update when we receive data
        last_online: existingState.last_online, // Preserve existing last_online
        online: false, // Default offline
        armed: false,
        pressed: false,
        battery_percentage: 0,  // Default battery percentage
        battery_voltage: 0.0    // Default battery voltage
      };
      
      for (let i = 1; i < parts.length; i++) {
        const [key, value] = parts[i].split('=');
        if (key && value !== undefined) {
          // Handle boolean values
          if (value === '1') {
            params[key] = true;
          } else if (value === '0') {
            params[key] = false;
          } else if (key === 'battery_percentage') {
            // Parse battery percentage as integer
            params[key] = parseInt(value) || 0;
          } else if (key === 'battery_voltage') {
            // Parse battery voltage as float
            params[key] = parseFloat(value) || 0.0;
          } else {
            // Keep as string for other values (like MAC addresses)
            params[key] = value;
          }
        }
      }
      
      // Update last_online timestamp when device is/comes online
      if (params.online === true) {
        params.last_online = Date.now();
      } else if (!params.last_online && existingState.last_online) {
        // Preserve existing last_online when going offline
        params.last_online = existingState.last_online;
      }
      
      // Store device state
      this.buzzerStates.set(deviceId, params);
      console.log(`Updated device ${deviceId}:`, params);

      // Emit heartbeat for admin interface if device is online
      if (params.online) {
        this.io.emit('buzzer-heartbeat', {
          device_id: deviceId,
          status: 'online',
          armed: params.armed,
          pressed: params.pressed,
          battery_percentage: params.battery_percentage,
          battery_voltage: params.battery_voltage,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('Error parsing device data:', error);
    }
  }

  updateBuzzerStates(statusData) {
    // Don't treat status keys as individual devices
    // Instead emit the overall ESP32 status
    this.io.emit('esp32-status', {
      connected: true,
      ...statusData
    });
  }

  isConnected() {
    return this.isConnectedFlag;
  }

  async close() {
    if (this.serialPort && this.serialPort.isOpen) {
      return new Promise((resolve) => {
        this.serialPort.close((err) => {
          if (err) console.error('Error closing ESP32 connection:', err);
          else console.log('ESP32 connection closed');
          resolve();
        });
      });
    }
  }
}

module.exports = ESP32Service;