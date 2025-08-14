let SerialPort, ReadlineParser;
try {
  const serialportModule = require('serialport');
  SerialPort = serialportModule.SerialPort;
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
} catch (error) {
  console.warn('SerialPort module not available, ESP32 will run in simulation mode');
}

class ESP32Service {
  constructor(io) {
    this.io = io;
    this.serialPort = null;
    this.parser = null;
    this.isConnectedFlag = false;
    this.buzzerStates = new Map();
    this.currentGameId = null;
    
    this.serialPortPath = process.env.ESP32_SERIAL_PORT || '/dev/ttyUSB0';
    this.baudRate = parseInt(process.env.ESP32_BAUD_RATE) || 115200;
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

      this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

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
        this.handleSerialData(data.trim());
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
        const [buzzerId, timestamp] = buzzerData.split(',');
        this.handleBuzzerPress(buzzerId, parseInt(timestamp));
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
      } else if (data.startsWith('ACK:')) {
        console.log('ESP32 Command acknowledged:', data.substring(4));
      } else if (data.startsWith('ERROR:')) {
        console.error('ESP32 Error:', data.substring(6));
      }
    } catch (error) {
      console.error('Error parsing ESP32 data:', error);
    }
  }

  handleBuzzerPress(buzzerId, timestamp) {
    if (!this.currentGameId) {
      console.warn('Buzzer pressed but no active game');
      return;
    }

    const buzzerData = {
      gameId: this.currentGameId,
      buzzer_id: buzzerId,
      timestamp: timestamp,
      groupId: this.getGroupIdByBuzzerId(buzzerId)
    };

    console.log('Buzzer press detected:', buzzerData);
    this.io.emit('buzzer-press', buzzerData);
  }

  getGroupIdByBuzzerId(buzzerId) {
    for (const [groupId, state] of this.buzzerStates) {
      if (state.buzzer_id === buzzerId) {
        return groupId;
      }
    }
    return buzzerId;
  }

  sendCommand(command) {
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

  simulateCommand(command) {
    setTimeout(() => {
      if (command === 'STATUS') {
        this.handleSerialData('STATUS:{"buzzer_1":{"armed":false},"buzzer_2":{"armed":false},"buzzer_3":{"armed":false},"buzzer_4":{"armed":false}}');
      } else if (command.startsWith('ARM')) {
        this.handleSerialData('ACK:ARMED');
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
      hardwareConnected: success
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
    // Return array of buzzer devices with their status and last seen time
    const devices = [];
    const now = Date.now();
    
    for (const [buzzerId, state] of this.buzzerStates) {
      devices.push({
        device_id: buzzerId,
        name: `Buzzer ${buzzerId}`,
        status: state.armed ? 'armed' : 'disarmed',
        last_seen: now,
        connected: this.isConnectedFlag,
        ...state
      });
    }
    
    // If no devices found but we're connected, return default set
    if (devices.length === 0 && this.isConnectedFlag) {
      for (let i = 1; i <= 4; i++) {
        devices.push({
          device_id: `buzzer_${i}`,
          name: `Buzzer ${i}`,
          status: 'disarmed',
          last_seen: now,
          connected: this.isConnectedFlag,
          armed: false
        });
      }
    }
    
    return devices;
  }

  updateBuzzerStates(statusData) {
    for (const [buzzerId, state] of Object.entries(statusData)) {
      this.buzzerStates.set(buzzerId, state);
    }
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