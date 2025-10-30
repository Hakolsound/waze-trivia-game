#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// Hardware Configuration
#define STATUS_LED_PIN 2
#define COMM_LED_PIN 4
#define MAX_GROUPS 15

// GPIO Serial pins for direct Pi connection
#define RX_PIN 16
#define TX_PIN 17

// Communication Configuration
#define SERIAL_BAUD 115200
#define HEARTBEAT_TIMEOUT 10000  // 10 seconds

// Binary Protocol Configuration
#define BINARY_PROTOCOL_ENABLED true
#define TEXT_DEBUG_ENABLED true  // Set to true for debugging

// Device state tracking
typedef struct {
  uint8_t macAddress[6];
  uint8_t deviceId;
  bool isRegistered;
  bool isArmed;
  bool isPressed;
  unsigned long lastHeartbeat;
  bool isOnline;
  uint8_t batteryPercentage;  // Battery percentage (0-100)
  float batteryVoltage;       // Battery voltage (V)
} DeviceState;

// Message structures (must match group buzzer firmware)
typedef struct {
  uint8_t messageType;  // 1=buzzer_press, 2=heartbeat, 3=status_update, 4=command_ack
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];      // data[0] = sequenceId for ACK messages
} Message;

typedef struct {
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset, 5=correct_answer, 6=wrong_answer, 7=end_round
  uint8_t targetDevice; // 0=all, or specific device ID
  uint32_t timestamp;
  uint16_t sequenceId;  // New: for tracking acknowledgments
  uint8_t retryCount;   // New: retry attempt counter
  uint8_t reserved;     // Padding to maintain alignment
} Command;

// Binary Protocol Structures for Pi Communication
struct BuzzerMessage {
  uint8_t header = 0xAA;
  uint8_t messageType = 0x01;  // 0x01 = buzzer press
  uint8_t deviceId;
  uint32_t timestamp;
  uint16_t deltaMs;
  uint8_t position;
  uint8_t reserved;            // Padding byte to match Pi expectation
  uint8_t checksum;
} __attribute__((packed));

struct StatusMessage {
  uint8_t header = 0xAA;
  uint8_t messageType = 0x02;  // 0x02 = status
  uint16_t deviceMask;         // Bitmask of online devices (bits 0-14)
  uint16_t armedMask;          // Bitmask of armed devices
  uint16_t pressedMask;        // Bitmask of pressed devices
  uint32_t timestamp;
  uint32_t gameId;
  uint8_t checksum;
} __attribute__((packed));

struct CommandMessage {
  uint8_t header = 0xBB;       // Command marker
  uint8_t command;             // 1=arm, 2=disarm, 3=test, 4=status_req, 5=correct_answer, 6=wrong_answer, 7=end_round
  uint8_t targetDevice;        // 0=all, 1-15=specific device
  uint32_t gameId;
  uint8_t checksum;
} __attribute__((packed));

// Global state
DeviceState devices[MAX_GROUPS];
int registeredDeviceCount = 0;
bool systemArmed = false;
bool gameActive = false;
unsigned long gameStartTime = 0;
String currentGameId = "";

// Buzzer press tracking
typedef struct {
  uint8_t deviceId;
  uint32_t timestamp;
  uint32_t deltaMs;
  uint8_t position;
} BuzzerPress;

BuzzerPress buzzerOrder[MAX_GROUPS];
int buzzerPressCount = 0;

// END_ROUND reset tracking
typedef struct {
  uint8_t deviceId;
  bool confirmed;
  uint8_t retryCount;
  unsigned long lastAttempt;
} EndRoundStatus;

EndRoundStatus endRoundTracking[MAX_GROUPS];
bool endRoundInProgress = false;
unsigned long endRoundStartTime = 0;

#define END_ROUND_RETRY_INTERVAL_MS 200  // Retry every 200ms
#define END_ROUND_MAX_RETRIES 5          // Up to 5 retries (1 second total)

// Acknowledgment system configuration
#define MAX_PENDING_COMMANDS 20
#define ACK_TIMEOUT_MS 500  // Increased to prevent unnecessary retries when multiple commands are queued
#define MAX_RETRIES 2  // Reduced from 3 - with longer timeout, fewer retries needed
#define RETRY_DELAY_MS 100

// WiFi Channel Management Configuration
#define WIFI_CHANNEL_CHANGE_TIMEOUT_MS 5000  // 5 seconds for channel change coordination

// Commands that require acknowledgment (critical commands only)
#define CMD_ARM 1
#define CMD_DISARM 2
#define CMD_CORRECT_ANSWER 5
#define CMD_WRONG_ANSWER 6
#define CMD_END_ROUND 7
#define CMD_CHANGE_CHANNEL 8

// Binary protocol command codes (received from backend)
#define BIN_CMD_ARM 1
#define BIN_CMD_DISARM 2
#define BIN_CMD_TEST 3
#define BIN_CMD_STATUS_REQUEST 4
#define BIN_CMD_CORRECT_ANSWER 5
#define BIN_CMD_WRONG_ANSWER 6
#define BIN_CMD_END_ROUND 7
#define BIN_CMD_ARM_SPECIFIC 8
#define BIN_CMD_SCAN_CHANNELS 9
#define BIN_CMD_SET_CHANNEL 10

// WiFi Channel Management Structures


typedef struct {
  bool inProgress;
  unsigned long startTime;
  uint8_t targetChannel;
  uint8_t ackCount;
  uint8_t totalDevices;
  bool coordinatorChanged;
} ChannelChangeState;

// Pending command tracking
typedef struct {
  uint16_t sequenceId;
  uint8_t targetDevice;
  uint8_t command;
  unsigned long sentTime;
  uint8_t retryCount;
  bool isActive;
} PendingCommand;

// Global WiFi management state
ChannelChangeState channelChangeState = {false, 0, 0, 0, 0, false};

// Current WiFi channel (global variable)
uint8_t currentWifiChannel = 13; // Default channel

PendingCommand pendingCommands[MAX_PENDING_COMMANDS];
uint16_t nextSequenceId = 1;

// Binary protocol buffer for incoming commands
static uint8_t commandBuffer[32];
static int commandBufferPos = 0;

// Binary Protocol Helper Functions
uint8_t calculateChecksum(uint8_t* data, int len) {
  uint8_t checksum = 0;
  for (int i = 0; i < len; i++) {
    checksum ^= data[i];
  }
  return checksum;
}

bool verifyChecksum(uint8_t* data, int len) {
  uint8_t calculated = calculateChecksum(data, len - 1);
  return calculated == data[len - 1];
}

// =========================================
// WiFi Channel Management Functions
// =========================================

// Set WiFi channel for coordinator
bool setWifiChannel(uint8_t channel) {
  // Validate channel range
  if (channel < 1 || channel > 13) {
    Serial.printf("[CHANNEL] ERROR: Invalid channel %d - must be 1-13\n", channel);
    return false;
  }

  // Always attempt to set the channel
  Serial.printf("[CHANNEL] Setting coordinator channel to %d (was %d)\n", channel, currentWifiChannel);

  esp_err_t result = esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  if (result != ESP_OK) {
    Serial.printf("[CHANNEL] ERROR: Failed to set coordinator channel %d (ESP error %d)\n", channel, result);
    return false;
  }

  currentWifiChannel = channel;
  Serial.printf("[CHANNEL] SUCCESS: Coordinator channel set to %d\n", channel);
  return true;
}







// =========================================
// Channel Change Coordination Functions
// =========================================

// Start coordinated channel change
bool startChannelChange(uint8_t targetChannel) {
  if (channelChangeState.inProgress) {
    Serial.println("[CHANNEL] Channel change already in progress");
    return false;
  }

  if (targetChannel < 1 || targetChannel > 13) {
    Serial.printf("[CHANNEL] ERROR: Invalid target channel %d\n", targetChannel);
    return false;
  }

  channelChangeState.inProgress = true;
  channelChangeState.startTime = millis();
  channelChangeState.targetChannel = targetChannel;
  channelChangeState.ackCount = 0;
  channelChangeState.totalDevices = registeredDeviceCount;
  channelChangeState.coordinatorChanged = false;

  Serial.printf("[CHANNEL] Starting coordinated channel change to %d (%d devices)\n",
                targetChannel, registeredDeviceCount);

  // Send CHANGE_CHANNEL command to all buzzers with ACK requirement
  uint8_t sent = 0;
  uint8_t failed = 0;

  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline) {
      if (sendCommandWithAck(devices[i].deviceId, CMD_CHANGE_CHANNEL)) {
        sent++;
      } else {
        failed++;
      }
    }
  }

  if (sent == 0) {
    Serial.println("[CHANNEL] ERROR: No devices accepted channel change command");
    channelChangeState.inProgress = false;
    return false;
  }

  Serial.printf("[CHANNEL] Sent channel change command to %d devices (%d failed)\n", sent, failed);
  return true;
}

// Handle channel change ACK from buzzer
void handleChannelChangeAck(uint8_t deviceId) {
  if (!channelChangeState.inProgress) return;

  channelChangeState.ackCount++;
  Serial.printf("[CHANNEL] Received ACK from device %d (%d/%d)\n",
                deviceId, channelChangeState.ackCount, channelChangeState.totalDevices);

  // Check if all devices have acknowledged
  if (channelChangeState.ackCount >= channelChangeState.totalDevices) {
    // All devices have ACK'd, now change coordinator channel
    Serial.println("[CHANNEL] All devices ACK'd - changing coordinator channel");

    esp_err_t result = esp_wifi_set_channel(channelChangeState.targetChannel, WIFI_SECOND_CHAN_NONE);
    if (result == ESP_OK) {
      channelChangeState.coordinatorChanged = true;
      currentWifiChannel = channelChangeState.targetChannel;
      Serial.printf("[CHANNEL] Coordinator channel changed to %d\n", currentWifiChannel);

      // Send success confirmation
      Serial.printf("WIFI_CHANNEL_CHANGED:%d\n", currentWifiChannel);
      channelChangeState.inProgress = false;
    } else {
      Serial.printf("[CHANNEL] ERROR: Failed to change coordinator channel (error %d)\n", result);
      // Keep channelChangeState.inProgress = true for timeout handling
    }
  }
}

// Process channel change timeout and retries
void processChannelChangeTimeout() {
  if (!channelChangeState.inProgress) return;

  unsigned long elapsed = millis() - channelChangeState.startTime;

  // Overall timeout
  if (elapsed > WIFI_CHANNEL_CHANGE_TIMEOUT_MS) {
    Serial.printf("[CHANNEL] Channel change timeout after %dms - %d/%d ACKs received\n",
                  WIFI_CHANNEL_CHANGE_TIMEOUT_MS, channelChangeState.ackCount, channelChangeState.totalDevices);

    // Send failure notification
    Serial.printf("WIFI_CHANNEL_CHANGE_FAILED:%d\n", channelChangeState.targetChannel);
    channelChangeState.inProgress = false;
    return;
  }

  // If coordinator already changed but some devices didn't ACK, that's OK
  // The coordinator is on the new channel and will handle device reconnections
  if (channelChangeState.coordinatorChanged && elapsed > 2000) { // Give 2 more seconds
    Serial.printf("[CHANNEL] Coordinator changed, %d/%d devices ACK'd - completing\n",
                  channelChangeState.ackCount, channelChangeState.totalDevices);
    Serial.printf("WIFI_CHANNEL_CHANGED:%d\n", currentWifiChannel);
    channelChangeState.inProgress = false;
  }
}

void sendBinaryBuzzerPress(uint8_t deviceId, uint32_t timestamp, uint16_t deltaMs, uint8_t position) {
  uint8_t buffer[12];

  // Build message manually to ensure little endian byte order
  buffer[0] = 0xAA;        // header
  buffer[1] = 0x01;        // messageType = buzzer press
  buffer[2] = deviceId;

  // Write timestamp as little endian (4 bytes)
  buffer[3] = timestamp & 0xFF;
  buffer[4] = (timestamp >> 8) & 0xFF;
  buffer[5] = (timestamp >> 16) & 0xFF;
  buffer[6] = (timestamp >> 24) & 0xFF;

  // Write deltaMs as little endian (2 bytes)
  buffer[7] = deltaMs & 0xFF;
  buffer[8] = (deltaMs >> 8) & 0xFF;

  buffer[9] = position;
  buffer[10] = 0;          // reserved

  // Calculate checksum for all bytes except the last
  buffer[11] = calculateChecksum(buffer, 11);

  Serial.write(buffer, sizeof(buffer));
  Serial.flush(); // Ensure immediate transmission

  Serial.printf("Sent binary buzzer press: device=%d, deltaMs=%d, position=%d\n",
                deviceId, deltaMs, position);
}

void sendBinaryStatus() {
  uint8_t buffer[17];  // StatusMessage size

  // Build device masks
  uint16_t deviceMask = 0;
  uint16_t armedMask = 0;
  uint16_t pressedMask = 0;

  for (int i = 0; i < registeredDeviceCount; i++) {
    uint8_t deviceBit = devices[i].deviceId - 1; // Convert to 0-based bit position
    if (deviceBit < 16) { // Safety check
      if (devices[i].isOnline) {
        deviceMask |= (1 << deviceBit);
      }
      if (devices[i].isArmed) {
        armedMask |= (1 << deviceBit);
      }
      if (devices[i].isPressed) {
        pressedMask |= (1 << deviceBit);
      }
    }
  }

  uint32_t timestamp = millis();
  uint32_t gameId = gameActive ? currentGameId.toInt() : 0;

  // Build message manually to ensure little endian byte order
  buffer[0] = 0xAA;        // header
  buffer[1] = 0x02;        // messageType = status

  // Write deviceMask as little endian (2 bytes)
  buffer[2] = deviceMask & 0xFF;
  buffer[3] = (deviceMask >> 8) & 0xFF;

  // Write armedMask as little endian (2 bytes)
  buffer[4] = armedMask & 0xFF;
  buffer[5] = (armedMask >> 8) & 0xFF;

  // Write pressedMask as little endian (2 bytes)
  buffer[6] = pressedMask & 0xFF;
  buffer[7] = (pressedMask >> 8) & 0xFF;

  // Write timestamp as little endian (4 bytes)
  buffer[8] = timestamp & 0xFF;
  buffer[9] = (timestamp >> 8) & 0xFF;
  buffer[10] = (timestamp >> 16) & 0xFF;
  buffer[11] = (timestamp >> 24) & 0xFF;

  // Write gameId as little endian (4 bytes)
  buffer[12] = gameId & 0xFF;
  buffer[13] = (gameId >> 8) & 0xFF;
  buffer[14] = (gameId >> 16) & 0xFF;
  buffer[15] = (gameId >> 24) & 0xFF;

  // Calculate checksum for all bytes except the last
  buffer[16] = calculateChecksum(buffer, 16);

  Serial.printf("[STATUS] Sending binary status: devices=%d, deviceMask=0x%04X, armedMask=0x%04X, pressedMask=0x%04X\n",
                registeredDeviceCount, deviceMask, armedMask, pressedMask);
  Serial.write(buffer, 17);  // Total message size is 17 bytes
  Serial.flush();

  // Send battery data as text after binary status (for per-device details)
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline) {
      Serial.print("DEVICE:");
      Serial.print(devices[i].deviceId);
      Serial.print(",online=1,battery_percentage=");
      Serial.print(devices[i].batteryPercentage);
      Serial.print(",battery_voltage=");
      Serial.println(devices[i].batteryVoltage, 2); // 2 decimal places
    }
  }
}

void processBinaryCommands() {
  if (TEXT_DEBUG_ENABLED) {
    Serial.printf("[COORD] Processing binary commands... (%d bytes available)\n", Serial.available());
  }

  // Check if first byte is text (ARM_SPECIFIC starts with 'A' = 0x41)
  if (Serial.available() > 0) {
    uint8_t firstByte = Serial.peek();
    if (firstByte >= 0x20 && firstByte <= 0x7E) {
      // This looks like text, not binary - process as text command
      Serial.println("Detected text command, switching to text processing");
      handleSerialCommand();
      return;
    }
  }

  while (Serial.available()) {
    uint8_t byte = Serial.read();
    if (TEXT_DEBUG_ENABLED) {
      Serial.printf("Read byte: 0x%02X (pos=%d)\n", byte, commandBufferPos);
    }

    // Special debug for command header
    if (byte == 0xBB && commandBufferPos == 0) {
      Serial.printf("[COORD] Command header 0xBB detected - starting new command\n");
    }

    // Wait for command header
    if (commandBufferPos == 0 && byte != 0xBB) {
      if (TEXT_DEBUG_ENABLED) {
        Serial.printf("Skipping non-header byte: 0x%02X\n", byte);
      }
      continue;
    }

    commandBuffer[commandBufferPos++] = byte;

    // Process complete command message
    if (commandBufferPos >= sizeof(CommandMessage)) {
      Serial.printf("[COORD] Raw command buffer: ");
      for (int i = 0; i < sizeof(CommandMessage); i++) {
        Serial.printf("%02X ", commandBuffer[i]);
      }
      Serial.println();

      // Extract fields manually to avoid struct casting issues
      uint8_t header = commandBuffer[0];
      uint8_t command = commandBuffer[1];
      uint8_t targetDevice = commandBuffer[2];
      uint32_t gameId = (commandBuffer[6] << 24) | (commandBuffer[5] << 16) | (commandBuffer[4] << 8) | commandBuffer[3]; // little endian
      uint8_t receivedChecksum = commandBuffer[7];

      // Verify checksum
      uint8_t calculatedChecksum = calculateChecksum(commandBuffer, sizeof(CommandMessage) - 1);

      if (verifyChecksum(commandBuffer, sizeof(CommandMessage))) {
        Serial.printf("[COORD] Binary command received: type=%d, target=%d, gameId=%d (checksum OK: calc=0x%02X, recv=0x%02X)\n",
                     command, targetDevice, gameId, calculatedChecksum, receivedChecksum);
        Serial.printf("[COORD] Processing command type %d...\n", command);

        // Create CommandMessage struct for handleBinaryCommand
        CommandMessage cmd;
        cmd.header = header;
        cmd.command = command;
        cmd.targetDevice = targetDevice;
        cmd.gameId = gameId;
        cmd.checksum = receivedChecksum;

        handleBinaryCommand(cmd);
        Serial.printf("[COORD] Command type %d processed\n", command);
      } else {
        Serial.printf("ERROR:Invalid command checksum - calc=0x%02X, recv=0x%02X\n", calculatedChecksum, receivedChecksum);
        Serial.printf("Received command: header=0x%02X, cmd=%d, target=%d, gameId=%d\n",
                     header, command, targetDevice, gameId);
      }

      commandBufferPos = 0;
    }

    // Reset buffer if overflow
    if (commandBufferPos >= sizeof(commandBuffer)) {
      commandBufferPos = 0;
    }
  }
}

void handleBinaryCommand(CommandMessage cmd) {
  switch (cmd.command) {
    case BIN_CMD_ARM: // 1 - ARM
      currentGameId = String(cmd.gameId);
      armAllBuzzers();
      break;
    case BIN_CMD_DISARM: // 2 - DISARM
      if (cmd.targetDevice == 0) {
        // Disarm all buzzers
        disarmAllBuzzers();
      } else {
        // Disarm specific buzzer
        Serial.printf("[COORD] Received DISARM command for device %d - forwarding to buzzer\n", cmd.targetDevice);
        if (sendCommandWithAck(cmd.targetDevice, CMD_DISARM)) {
          // Update coordinator's internal state immediately when command is sent
          for (int i = 0; i < registeredDeviceCount; i++) {
            if (devices[i].deviceId == cmd.targetDevice) {
              devices[i].isArmed = false;
              break;
            }
          }
          Serial.printf("[COORD] DISARM command forwarded to device %d\n", cmd.targetDevice);
        } else {
          Serial.printf("[COORD] ERROR: Failed to disarm device %d\n", cmd.targetDevice);
        }
      }
      break;
    case BIN_CMD_TEST: // 3 - TEST
      testBuzzer(cmd.targetDevice);
      break;
    case BIN_CMD_STATUS_REQUEST: // 4 - STATUS_REQUEST
      if (BINARY_PROTOCOL_ENABLED) {
        sendBinaryStatus();
      } else {
        sendStatusToSerial();
      }
      break;
    case BIN_CMD_CORRECT_ANSWER: // 5 - CORRECT_ANSWER
      Serial.printf("[COORD] Received CORRECT_ANSWER command for device %d - forwarding to buzzer\n", cmd.targetDevice);
      sendCorrectAnswerFeedback(cmd.targetDevice);
      Serial.printf("[COORD] CORRECT_ANSWER command forwarded to device %d\n", cmd.targetDevice);
      break;
    case BIN_CMD_WRONG_ANSWER: // 6 - WRONG_ANSWER
      Serial.printf("[COORD] Received WRONG_ANSWER command for device %d - forwarding to buzzer\n", cmd.targetDevice);
      sendWrongAnswerFeedback(cmd.targetDevice);
      Serial.printf("[COORD] WRONG_ANSWER command forwarded to device %d\n", cmd.targetDevice);
      break;
    case BIN_CMD_END_ROUND: // 7 - END_ROUND
      Serial.printf("[COORD] Received END_ROUND command for device %d - forwarding to buzzer\n", cmd.targetDevice);
      endRoundReset(cmd.targetDevice);
      Serial.printf("[COORD] END_ROUND command forwarded to device %d\n", cmd.targetDevice);
      break;
    case BIN_CMD_ARM_SPECIFIC: // 8 - ARM_SPECIFIC
      {
        // Backend sends bitmask as 16-bit LE in bytes 2-3, gameId in bytes 4-7
        // cmd.targetDevice is actually the LOW byte of bitmask (byte 2)
        // cmd.gameId contains: [byte 3][byte 4][byte 5][byte 6] as a 32-bit LE value
        // So bitmask = byte 2 | (byte 3 << 8)
        uint16_t bitmask = cmd.targetDevice | ((cmd.gameId & 0xFF) << 8);
        uint32_t gameId = cmd.gameId >> 8;  // Shift out the bitmask high byte
        currentGameId = String(gameId);

        Serial.printf("[ARM_SPECIFIC] Binary command received: bitmask=0x%04X, gameId=%lu\n", bitmask, gameId);
        armSpecificBuzzersByBitmask(bitmask);
      }
      break;
    case BIN_CMD_SET_CHANNEL: // 10 - SET_CHANNEL
      {
        // Channel is encoded in targetDevice (1-13)
        uint8_t targetChannel = cmd.targetDevice;
        Serial.printf("[COORD] Received SET_CHANNEL command for channel %d\n", targetChannel);
        if (startChannelChange(targetChannel)) {
          Serial.printf("WIFI_CHANNEL_CHANGE_STARTED:%d\n", targetChannel);
        } else {
          Serial.printf("WIFI_CHANNEL_CHANGE_FAILED:%d\n", targetChannel);
        }
      }
      break;
    default:
      if (TEXT_DEBUG_ENABLED) {
        Serial.print("ERROR:Unknown binary command ");
        Serial.println(cmd.command);
      }
      break;
  }
}

// ESP-NOW callbacks
void OnDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           tx_info->des_addr[0], tx_info->des_addr[1], tx_info->des_addr[2],
           tx_info->des_addr[3], tx_info->des_addr[4], tx_info->des_addr[5]);

  Serial.printf("Send to %s: %s\n", macStr,
                status == ESP_NOW_SEND_SUCCESS ? "Success" : "Fail");
}

// Handle incoming messages
void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
  // Reduced verbose logging to prevent coordinator overload
  // Only log for debugging when TEXT_DEBUG_ENABLED is true
  if (TEXT_DEBUG_ENABLED) {
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             recv_info->src_addr[0], recv_info->src_addr[1], recv_info->src_addr[2],
             recv_info->src_addr[3], recv_info->src_addr[4], recv_info->src_addr[5]);
    Serial.printf("Received %d bytes from: %s\n", len, macStr);
  }

  // Parse the message
  if (len == sizeof(Message)) {
    Message msg;
    memcpy(&msg, data, sizeof(msg));

    if (TEXT_DEBUG_ENABLED) {
      Serial.printf("Message type: %d, Device ID: %d\n", msg.messageType, msg.deviceId);
    }
    
    // Update device heartbeat first (registers device if new)
    updateDeviceHeartbeat(recv_info->src_addr, msg.deviceId);
    
    // Handle different message types
    switch (msg.messageType) {
      case 1: // buzzer_press
        Serial.printf("[ESP-NOW] Processing BUZZER_PRESS from device %d\n", msg.deviceId);
        handleBuzzerPress(msg);
        break;
      case 2: // heartbeat
        handleHeartbeat(msg);
        break;
      case 3: // status_update
        handleStatusUpdate(msg);
        break;
      case 4: // command_ack
        handleCommandAck(msg.data[0], msg.deviceId); // data[0] contains sequenceId
        break;
      case 8: // END_ROUND_ACK
        handleEndRoundAck(msg.deviceId);
        break;
      case 9: // CHANNEL_CHANGE_ACK
        handleChannelChangeAck(msg.deviceId);
        break;
      default:
        Serial.printf("Unknown message type: %d\n", msg.messageType);
        break;
    }
  } else {
    Serial.printf("Invalid message length: %d (expected %d)\n", len, sizeof(Message));
  }
}

void setup() {
  // Use USB serial for both Pi communication and debugging
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  
  // Initialize hardware pins
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(COMM_LED_PIN, OUTPUT);
  
  // Initial state
  digitalWrite(STATUS_LED_PIN, LOW);
  digitalWrite(COMM_LED_PIN, LOW);
  
  // Initialize device tracking
  for (int i = 0; i < MAX_GROUPS; i++) {
    devices[i].isRegistered = false;
    devices[i].isOnline = false;
    devices[i].isArmed = false;
    devices[i].isPressed = false;
    devices[i].deviceId = 0;
    devices[i].lastHeartbeat = 0;
    devices[i].batteryPercentage = 0;
    devices[i].batteryVoltage = 0.0;
  }
  
  // Initialize WiFi in station mode
  WiFi.mode(WIFI_STA);
  delay(500);

  // Set WiFi channel to default (13 - optimal for European ballroom with multiple APs)
  // Channel 13: Legal in Greece (ETSI), rarely used by venue WiFi, minimal Bluetooth overlap
  if (!setWifiChannel(currentWifiChannel)) {
    Serial.printf("WARNING: Failed to set initial WiFi channel to %d\n", currentWifiChannel);
  }

  // Set maximum TX power for better range in crowded ballroom (170 people)
  // Value 84 = 21 dBm (maximum allowed, default is ~78 = 19.5 dBm)
  esp_wifi_set_max_tx_power(84);
  Serial.println("WiFi TX power set to maximum (21 dBm)");
  
  // Print coordinator MAC address
  Serial.println("=== ESP32 Central Coordinator ===");
  Serial.print("MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.println("Using USB Serial for Pi communication");
  
  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: ESP-NOW init failed");
    return;
  }

  Serial.println("ESP-NOW initialized successfully");


  // Register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // Startup complete
  digitalWrite(STATUS_LED_PIN, HIGH);

  Serial.println("READY");
  Serial.println("Central Coordinator ready");
  sendStatusToSerial();
}

void loop() {
  unsigned long currentTime = millis();

  // PRIORITY: Check for serial commands from Raspberry Pi FIRST
  // Process all available serial data immediately to prevent buffer overflow
  static unsigned long lastSerialCheck = 0;
  static bool serialTimeoutLogged = false;

  if (Serial.available()) {
    serialTimeoutLogged = false; // Reset timeout flag when we see data
    if (TEXT_DEBUG_ENABLED) {
      Serial.printf("[COORD] Serial data detected: %d bytes available at time %lu (gap: %lu ms)\n",
                   Serial.available(), currentTime, currentTime - lastSerialCheck);
    }
    lastSerialCheck = currentTime;

    while (Serial.available()) {
      if (BINARY_PROTOCOL_ENABLED) {
        processBinaryCommands();
      } else {
        handleSerialCommand();
      }
    }

    if (TEXT_DEBUG_ENABLED) {
      Serial.printf("[COORD] Finished processing serial data (buffer now: %d bytes)\n", Serial.available());
    }
  } else {
    // Log if we haven't seen serial data for a while (every 5 seconds)
    if (!serialTimeoutLogged && currentTime - lastSerialCheck > 5000) {
      if (TEXT_DEBUG_ENABLED) {
        Serial.printf("[COORD] No serial data for %lu ms\n", currentTime - lastSerialCheck);
      }
      serialTimeoutLogged = true;
    }
  }
  
  // Check device timeouts
  checkDeviceTimeouts(currentTime);

  // Process pending acknowledgment commands
  processPendingCommands();

  // Process background END_ROUND retries
  processEndRoundRetries();


  // Process channel change coordination
  processChannelChangeTimeout();

  // Send periodic status updates
  static unsigned long lastStatusUpdate = 0;
  if (currentTime - lastStatusUpdate > 10000) {  // Every 10 seconds
    if (BINARY_PROTOCOL_ENABLED) {
      sendBinaryStatus();
    } else {
      sendStatusToSerial();
    }
    lastStatusUpdate = currentTime;
  }

  // Handle system LED status
  updateStatusLED();

  delay(1);  // Minimal delay - reduced from 10ms to prevent coordinator overload
}

void handleSerialCommand() {
  String command = Serial.readStringUntil('\n');
  command.trim();

  // For debugging - comment out in production to avoid clutter
  // Serial.print("Command: '");
  // Serial.print(command);
  // Serial.print("' (length: ");
  // Serial.print(command.length());
  // Serial.println(")");

  // Ignore empty commands
  if (command.length() == 0) {
    return;
  }

  if (command == "STATUS") {
    sendStatusToSerial();
  } else if (command == "ARM") {
    armAllBuzzers();
  } else if (command.startsWith("ARM_SPECIFIC:")) {
    String deviceList = command.substring(13);
    armSpecificBuzzers(deviceList);
  } else if (command == "DISARM") {
    disarmAllBuzzers();
  } else if (command.startsWith("TEST:")) {
    int deviceId = command.substring(5).toInt();
    testBuzzer(deviceId);
  } else if (command.startsWith("GAME_START:")) {
    String gameId = command.substring(11);
    startGame(gameId);
  } else if (command == "GAME_END") {
    endGame();
  } else if (command == "RESET") {
    resetSystem();
  } else {
    Serial.print("ERROR:Unknown command '");
    Serial.print(command);
    Serial.println("'");
  }
}

void handleBuzzerPress(Message msg) {
  Serial.printf("Buzzer press received from device %d (gameActive=%s, systemArmed=%s)\n",
                msg.deviceId, gameActive ? "true" : "false", systemArmed ? "true" : "false");

  // Always send ACK first to stop retry loop
  sendBuzzerPressAck(msg.deviceId);

  if (!gameActive && !systemArmed) {
    Serial.printf("[LATE_PRESS] Buzzer %d pressed after disarm - sending DISARM to sync state\n", msg.deviceId);
    // Send DISARM command to sync buzzer state (it thinks it's armed but game ended)
    sendCommandWithAck(msg.deviceId, CMD_DISARM);
    return;
  }

  // Check if already pressed
  for (int i = 0; i < buzzerPressCount; i++) {
    if (buzzerOrder[i].deviceId == msg.deviceId) {
      Serial.printf("[DUPLICATE] Buzzer %d already pressed, ignoring\n", msg.deviceId);
      return; // Already recorded, but ACK was already sent above
    }
  }

  // Calculate delta time
  uint32_t deltaMs = msg.timestamp - gameStartTime;

  // Record buzzer press
  if (buzzerPressCount < MAX_GROUPS) {
    buzzerOrder[buzzerPressCount].deviceId = msg.deviceId;
    buzzerOrder[buzzerPressCount].timestamp = msg.timestamp;
    buzzerOrder[buzzerPressCount].deltaMs = deltaMs;
    buzzerOrder[buzzerPressCount].position = buzzerPressCount + 1;
    buzzerPressCount++;
  }

  // Update device state
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == msg.deviceId) {
      devices[i].isPressed = true;
      break;
    }
  }

  // Send to Pi using binary or text protocol
  if (BINARY_PROTOCOL_ENABLED) {
    sendBinaryBuzzerPress(msg.deviceId, msg.timestamp, deltaMs, buzzerPressCount);
  } else {
    // Fallback text format
    Serial.print("BUZZER:");
    Serial.print(msg.deviceId);
    Serial.print(",");
    Serial.print(msg.timestamp);
    Serial.print(",");
    Serial.print(deltaMs);
    Serial.print(",");
    Serial.println(buzzerPressCount);
  }

  // Debug output (optional)
  if (TEXT_DEBUG_ENABLED) {
    Serial.print("BUZZER PRESS: Device ");
    Serial.print(msg.deviceId);
    Serial.print(" at ");
    Serial.print(deltaMs);
    Serial.println("ms");
  }
}

void handleHeartbeat(Message msg) {
  Serial.printf("Heartbeat from device %d\n", msg.deviceId);

  // Update device state
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == msg.deviceId) {
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      // IMPORTANT: Don't update armed/pressed state from heartbeats!
      // Coordinator is the source of truth for device states.
      // Only command ACKs should confirm state changes.
      // This prevents race conditions where heartbeats arrive before commands.
      // devices[i].isArmed = (msg.data[0] == 1);  // REMOVED
      // devices[i].isPressed = (msg.data[1] == 1);  // REMOVED

      // Parse battery data (added in group buzzer firmware)
      devices[i].batteryPercentage = msg.data[2];

      // Reconstruct battery voltage from two bytes
      uint16_t voltageInt = msg.data[3] | (msg.data[4] << 8);
      devices[i].batteryVoltage = voltageInt / 100.0; // Convert back to float

      // Flash comm LED
      digitalWrite(COMM_LED_PIN, HIGH);
      delay(10);
      digitalWrite(COMM_LED_PIN, LOW);

      // Temporarily disable automatic status on heartbeat to reduce serial noise
      // if (BINARY_PROTOCOL_ENABLED) {
      //   sendBinaryStatus();
      // }
      break;
    }
  }
}

void handleStatusUpdate(Message msg) {
  Serial.printf("Status update from device %d\n", msg.deviceId);

  // Update device state
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == msg.deviceId) {
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      // IMPORTANT: Don't update armed/pressed state from status updates!
      // Coordinator is the source of truth for device states.
      // Only command ACKs should confirm state changes.
      // This prevents race conditions where status updates arrive before commands.
      // devices[i].isArmed = (msg.data[0] == 1);  // REMOVED
      // devices[i].isPressed = (msg.data[1] == 1);  // REMOVED

      // Parse battery data from status update (uses data[3] and data[4], data[5] for battery)
      devices[i].batteryPercentage = msg.data[3];

      // Reconstruct battery voltage from two bytes
      uint16_t voltageInt = msg.data[4] | (msg.data[5] << 8);
      devices[i].batteryVoltage = voltageInt / 100.0; // Convert back to float

      // Flash comm LED
      digitalWrite(COMM_LED_PIN, HIGH);
      delay(10);
      digitalWrite(COMM_LED_PIN, LOW);

      // Temporarily disable automatic status to reduce serial noise
      // if (BINARY_PROTOCOL_ENABLED) {
      //   sendBinaryStatus();
      // } else {
      //   sendStatusToSerial();
      // }

      break;
    }
  }
}

void updateDeviceHeartbeat(const uint8_t *mac, uint8_t deviceId) {
  // Check if device already registered
  bool found = false;
  bool wasOffline = false;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId) {
      wasOffline = !devices[i].isOnline; // Detect offline→online transition
      memcpy(devices[i].macAddress, mac, 6);
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      found = true;

      // Sync state if device was offline and now came back online
      if (wasOffline) {
        syncDeviceState(deviceId);
        Serial.printf("Device %d reconnected - syncing state\n", deviceId);
      }
      break;
    }
  }
  
  // Register new device and add as ESP-NOW peer
  if (!found && registeredDeviceCount < MAX_GROUPS) {
    memcpy(devices[registeredDeviceCount].macAddress, mac, 6);
    devices[registeredDeviceCount].deviceId = deviceId;
    devices[registeredDeviceCount].isRegistered = true;
    devices[registeredDeviceCount].isOnline = true;

    // Add device as ESP-NOW peer for sending commands
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0; // Use same channel
    peerInfo.encrypt = false;
    peerInfo.ifidx = WIFI_IF_STA;

    esp_err_t result = esp_now_add_peer(&peerInfo);
    Serial.printf("Added device %d as ESP-NOW peer: %s\n", deviceId,
                  result == ESP_OK ? "SUCCESS" : "FAILED");
    devices[registeredDeviceCount].lastHeartbeat = millis();
    
    registeredDeviceCount++;
    
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    
    Serial.print("NEW_DEVICE:");
    Serial.print(deviceId);
    Serial.print(":");
    Serial.println(macStr);
    
    Serial.print("NEW DEVICE REGISTERED: ID=");
    Serial.print(deviceId);
    Serial.print(" MAC=");
    Serial.println(macStr);
    
    // Try to add as peer (but don't fail if it doesn't work)
    memset(&peerInfo, 0, sizeof(peerInfo));
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    peerInfo.ifidx = WIFI_IF_STA;
    
    esp_err_t addResult = esp_now_add_peer(&peerInfo);
    if (addResult == ESP_OK) {
      Serial.printf("Peer added successfully for device %d\n", deviceId);
    } else {
      Serial.printf("Warning: Could not add peer for device %d (error %d) - will use broadcast\n", deviceId, addResult);
    }

    // Sync current system state to new device
    syncDeviceState(deviceId);
    Serial.printf("New device %d registered - syncing current state\n", deviceId);
  }
}

// Acknowledgment System Functions
bool requiresAck(uint8_t command) {
  return (command == CMD_ARM || command == CMD_DISARM ||
          command == CMD_CORRECT_ANSWER || command == CMD_WRONG_ANSWER ||
          command == CMD_END_ROUND || command == CMD_CHANGE_CHANNEL);
}

uint16_t generateSequenceId() {
  uint16_t id = nextSequenceId++;
  if (nextSequenceId == 0) nextSequenceId = 1; // Skip 0
  return id;
}

int findPendingCommand(uint16_t sequenceId, uint8_t deviceId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (pendingCommands[i].isActive &&
        pendingCommands[i].sequenceId == sequenceId &&
        pendingCommands[i].targetDevice == deviceId) {
      return i;
    }
  }
  return -1;
}

int findFreePendingSlot() {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].isActive) {
      return i;
    }
  }
  return -1;
}

void addPendingCommand(uint16_t sequenceId, uint8_t targetDevice, uint8_t command) {
  int slot = findFreePendingSlot();
  if (slot >= 0) {
    pendingCommands[slot].sequenceId = sequenceId;
    pendingCommands[slot].targetDevice = targetDevice;
    pendingCommands[slot].command = command;
    pendingCommands[slot].sentTime = millis();
    pendingCommands[slot].retryCount = 0;
    pendingCommands[slot].isActive = true;

    Serial.printf("[ACK] Added pending command: seq=%d, dev=%d, cmd=%d\n",
                  sequenceId, targetDevice, command);
  } else {
    Serial.printf("[ACK] Warning: No free slots for pending command tracking\n");
  }
}

void handleCommandAck(uint16_t sequenceId, uint8_t deviceId) {
  int slot = findPendingCommand(sequenceId, deviceId);
  if (slot >= 0) {
    Serial.printf("[ACK] Received ACK from device %d for seq=%d, cmd=%d\n",
                  deviceId, sequenceId, pendingCommands[slot].command);
    pendingCommands[slot].isActive = false; // Mark as acknowledged
  } else {
    Serial.printf("[ACK] Warning: Received unexpected ACK from device %d, seq=%d\n",
                  deviceId, sequenceId);
  }
}

void processPendingCommands() {
  unsigned long currentTime = millis();

  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].isActive) continue;

    if (currentTime - pendingCommands[i].sentTime > ACK_TIMEOUT_MS) {
      if (pendingCommands[i].retryCount < MAX_RETRIES) {
        // Retry the command
        pendingCommands[i].retryCount++;
        pendingCommands[i].sentTime = currentTime;

        Serial.printf("[ACK] Retrying command: seq=%d, dev=%d, cmd=%d, attempt=%d\n",
                      pendingCommands[i].sequenceId, pendingCommands[i].targetDevice,
                      pendingCommands[i].command, pendingCommands[i].retryCount);

        // Resend the command
        retrySendCommand(pendingCommands[i]);

      } else {
        // Max retries exceeded
        Serial.printf("[ACK] Command failed after %d retries: seq=%d, dev=%d, cmd=%d\n",
                      MAX_RETRIES, pendingCommands[i].sequenceId,
                      pendingCommands[i].targetDevice, pendingCommands[i].command);
        pendingCommands[i].isActive = false;
      }
    }
  }
}

void retrySendCommand(PendingCommand &pending) {
  // Find device MAC address
  uint8_t* targetMAC = nullptr;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == pending.targetDevice) {
      targetMAC = devices[i].macAddress;
      break;
    }
  }

  if (targetMAC) {
    Command cmd;
    cmd.command = pending.command;
    cmd.targetDevice = pending.targetDevice;
    cmd.timestamp = millis();
    cmd.sequenceId = pending.sequenceId; // Keep same sequence ID for retry
    cmd.retryCount = pending.retryCount;

    esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&cmd, sizeof(cmd));
    Serial.printf("[ACK] Retry send result: %s\n", result == ESP_OK ? "SUCCESS" : "FAILED");
  }
}

bool sendCommandWithAck(uint8_t targetDevice, uint8_t command) {
  // Find device MAC address
  uint8_t* targetMAC = nullptr;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == targetDevice) {
      targetMAC = devices[i].macAddress;
      break;
    }
  }

  if (!targetMAC) {
    Serial.printf("[ACK] Error: Could not find MAC for device %d\n", targetDevice);
    return false;
  }

  uint16_t seqId = generateSequenceId();

  Command cmd;
  cmd.command = command;
  cmd.targetDevice = targetDevice;
  cmd.timestamp = millis();
  cmd.sequenceId = seqId;
  cmd.retryCount = 0;

  esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&cmd, sizeof(cmd));

  if (result == ESP_OK) {
    addPendingCommand(seqId, targetDevice, command);
    Serial.printf("[ACK] Command sent with ACK: dev=%d, cmd=%d, seq=%d\n",
                  targetDevice, command, seqId);
    return true;
  } else {
    Serial.printf("[ACK] Failed to send command: dev=%d, cmd=%d\n", targetDevice, command);
    return false;
  }
}

bool sendCommandNoAck(uint8_t targetDevice, uint8_t command) {
  // Original fire-and-forget method for non-critical commands
  uint8_t* targetMAC = nullptr;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == targetDevice) {
      targetMAC = devices[i].macAddress;
      break;
    }
  }

  if (!targetMAC) {
    return false;
  }

  Command cmd;
  cmd.command = command;
  cmd.targetDevice = targetDevice;
  cmd.timestamp = millis();
  cmd.sequenceId = 0; // 0 indicates no ACK required
  cmd.retryCount = 0;

  esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&cmd, sizeof(cmd));
  return result == ESP_OK;
}

void syncDeviceState(uint8_t deviceId) {
  // Send current system state to a specific device
  // IMPORTANT: Use per-device state, NOT global systemArmed!
  // Global systemArmed doesn't reflect individual buzzer states during gameplay.

  // Find device and get its current state
  uint8_t* targetMAC = nullptr;
  bool deviceIsArmed = false;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId) {
      targetMAC = devices[i].macAddress;
      deviceIsArmed = devices[i].isArmed;  // Use per-device state!
      break;
    }
  }

  if (targetMAC) {
    Command cmd;
    cmd.command = deviceIsArmed ? 1 : 2; // 1=ARM, 2=DISARM based on device state
    cmd.targetDevice = deviceId;
    cmd.timestamp = millis();

    esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&cmd, sizeof(cmd));
    Serial.printf("State sync sent to device %d (%s): %s\n",
                  deviceId,
                  deviceIsArmed ? "ARM" : "DISARM",
                  result == ESP_OK ? "SUCCESS" : "FAILED");
  } else {
    Serial.printf("Error: Could not find MAC address for device %d\n", deviceId);
  }
}

void checkDeviceTimeouts(unsigned long currentTime) {
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline && (currentTime - devices[i].lastHeartbeat > HEARTBEAT_TIMEOUT)) {
      devices[i].isOnline = false;
      // IMPORTANT: Don't clear armed/pressed state on timeout!
      // Timeout only means we haven't received heartbeats, not that the buzzer's state changed.
      // The buzzer may still be armed/pressed physically.
      // Only clear state when we receive explicit commands or buzzer events.
      // devices[i].isArmed = false;   // REMOVED - don't clear armed state on timeout
      // devices[i].isPressed = false; // REMOVED - don't clear pressed state on timeout
      Serial.print("TIMEOUT:");
      Serial.println(devices[i].deviceId);
      Serial.print("Device timeout: ");
      Serial.println(devices[i].deviceId);
    }
  }
}

void armAllBuzzers() {
  Command cmd;
  cmd.command = 1; // ARM
  cmd.targetDevice = 0;
  cmd.timestamp = millis();
  
  gameStartTime = cmd.timestamp;
  systemArmed = true;
  buzzerPressCount = 0;
  
  // Clear previous presses
  for (int i = 0; i < MAX_GROUPS; i++) {
    buzzerOrder[i] = {0, 0, 0, 0};
    if (devices[i].isRegistered) {
      devices[i].isPressed = false;
    }
  }
  
  // Send to all registered devices individually with ACK reliability
  int sent = 0;
  int failed = 0;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isRegistered) {
      if (sendCommandWithAck(devices[i].deviceId, CMD_ARM)) {
        // Update coordinator's internal state immediately when command is sent
        devices[i].isArmed = true;
        sent++;
      } else {
        failed++;
      }
      delay(20); // Increased delay to reduce RF congestion with 15 buzzers
    }
  }

  Serial.printf("[ACK] ARM sent to %d devices (%d successful, %d failed)\n",
                registeredDeviceCount, sent, failed);

  Serial.println("ACK:ARMED");
  Serial.printf("Buzzers armed with ACK - Success: %d, Failed: %d\n", sent, failed);
}

void disarmAllBuzzers() {
  systemArmed = false;
  gameActive = false;
  currentGameId = "";

  // Send to all devices with ACK reliability
  int sent = 0;
  int failed = 0;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline) {
      if (sendCommandWithAck(devices[i].deviceId, CMD_DISARM)) {
        // Update coordinator's internal state immediately when command is sent
        devices[i].isArmed = false;
        sent++;
      } else {
        failed++;
      }
      delay(20); // Increased delay to reduce RF congestion with 15 buzzers
    }
  }

  Serial.printf("[ACK] DISARM sent to %d devices (%d successful, %d failed)\n",
                registeredDeviceCount, sent, failed);

  Serial.println("ACK:DISARMED");
  Serial.printf("Buzzers disarmed with ACK - Success: %d, Failed: %d\n", sent, failed);
}

void armSpecificBuzzers(String deviceList) {
  Serial.print("DEBUG:ARM_SPECIFIC received: ");
  Serial.println(deviceList);
  Serial.print("DEBUG:Registered device count: ");
  Serial.println(registeredDeviceCount);

  // Show registered devices
  Serial.print("DEBUG:Registered devices: ");
  for (int i = 0; i < registeredDeviceCount; i++) {
    Serial.print(devices[i].deviceId);
    if (i < registeredDeviceCount - 1) Serial.print(", ");
  }
  Serial.println();

  systemArmed = true;
  buzzerPressCount = 0;
  gameStartTime = millis();

  // Clear previous buzzer presses
  for (int i = 0; i < MAX_GROUPS; i++) {
    buzzerOrder[i] = {0, 0, 0, 0};
    if (devices[i].isRegistered) {
      devices[i].isPressed = false;
    }
  }

  // Parse comma-separated device IDs and send ARM command to each
  int startIndex = 0;
  int commaIndex = 0;
  int armedCount = 0;
  int sent = 0;
  int failed = 0;

  while (startIndex <= deviceList.length()) {
    commaIndex = deviceList.indexOf(',', startIndex);
    if (commaIndex == -1) {
      commaIndex = deviceList.length();
    }

    String deviceIdStr = deviceList.substring(startIndex, commaIndex);
    deviceIdStr.trim();

    if (deviceIdStr.length() > 0) {
      uint8_t deviceId = deviceIdStr.toInt();
      Serial.print("DEBUG:Parsing device ID: ");
      Serial.println(deviceId);

      // Find device by ID and send ARM command
      bool found = false;
      for (int i = 0; i < registeredDeviceCount; i++) {
        if (devices[i].deviceId == deviceId && devices[i].isOnline) {
          Serial.print("DEBUG:Found device ");
          Serial.print(deviceId);
          Serial.print(" at index ");
          Serial.println(i);

          if (sendCommandWithAck(deviceId, CMD_ARM)) {
            // Update coordinator's internal state immediately when command is sent
            devices[i].isArmed = true;
            armedCount++;
            sent++;
            Serial.print("DEBUG:Successfully armed device ");
            Serial.println(deviceId);
          } else {
            failed++;
            Serial.print("DEBUG:Failed to arm device ");
            Serial.println(deviceId);
          }
          found = true;
          delay(20); // Increased delay to reduce RF congestion with 15 buzzers
          break;
        }
      }
      if (!found) {
        Serial.print("DEBUG:Device ");
        Serial.print(deviceId);
        Serial.println(" not found in registered/online devices");
      }
    }

    startIndex = commaIndex + 1;
  }

  Serial.printf("[ACK] ARM_SPECIFIC sent to %d devices (%d successful, %d failed)\n",
                armedCount, sent, failed);

  Serial.print("ACK:ARM_SPECIFIC:");
  Serial.println(armedCount);
  Serial.printf("Specific buzzers armed with ACK - Success: %d, Failed: %d\n", sent, failed);
}

void armSpecificBuzzersByBitmask(uint16_t bitmask) {
  Serial.printf("[ARM_SPECIFIC] Bitmask function called: 0x%04X\n", bitmask);

  systemArmed = true;
  buzzerPressCount = 0;
  gameStartTime = millis();

  // Clear previous buzzer presses
  for (int i = 0; i < MAX_GROUPS; i++) {
    buzzerOrder[i] = {0, 0, 0, 0};
    if (devices[i].isRegistered) {
      devices[i].isPressed = false;
    }
  }

  int sent = 0;
  int failed = 0;
  int armedCount = 0;

  // Loop through all possible device IDs (1-15)
  for (uint8_t deviceId = 1; deviceId <= 15; deviceId++) {
    // Check if this device's bit is set in the bitmask
    if (bitmask & (1 << deviceId)) {
      Serial.printf("[ARM_SPECIFIC] Bitmask bit %d set, arming device %d\n", deviceId, deviceId);

      // Send ARM command directly without checking online status
      // The ACK system will handle retries if device is offline
      // This ensures instant re-arm for all devices in bitmask
      if (sendCommandWithAck(deviceId, CMD_ARM)) {
        // Update coordinator's internal state immediately when command is sent
        // Find device in array to update state
        for (int i = 0; i < registeredDeviceCount; i++) {
          if (devices[i].deviceId == deviceId) {
            devices[i].isArmed = true;
            break;
          }
        }
        armedCount++;
        sent++;
      } else {
        failed++;
        Serial.printf("[ARM_SPECIFIC] Failed to send ARM to device %d\n", deviceId);
      }
      // No delay - send commands as fast as possible for instant re-arm
      // ACK system handles reliability without artificial delays
    }
  }

  Serial.printf("[ACK] ARM_SPECIFIC sent to %d devices (%d successful, %d failed)\n",
                armedCount, sent, failed);
  Serial.printf("Specific buzzers armed with ACK - Success: %d, Failed: %d\n", sent, failed);
}

void testBuzzer(uint8_t deviceId) {
  Command cmd;
  cmd.command = 3; // TEST
  cmd.targetDevice = deviceId;
  cmd.timestamp = millis();
  
  if (deviceId == 0) {
    // Test all
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        delay(10);
      }
    }
    Serial.println("ACK:TEST_ALL");
    Serial.println("Testing all buzzers");
  } else {
    // Test specific device
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        Serial.print("ACK:TEST_");
        Serial.println(deviceId);
        Serial.print("Testing buzzer ");
        Serial.println(deviceId);
        return;
      }
    }
    Serial.print("ERROR:Device not found ");
    Serial.println(deviceId);
  }
}

void sendBuzzerPressAck(uint8_t deviceId) {
  // Send immediate ACK for buzzer press (fire-and-forget, no retry needed)
  // Find device MAC address
  uint8_t* targetMAC = nullptr;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId) {
      targetMAC = devices[i].macAddress;
      break;
    }
  }

  if (targetMAC) {
    // Create a simple ACK message (type 5 = buzzer_press_ack)
    Message ackMsg;
    ackMsg.messageType = 5; // buzzer_press_ack
    ackMsg.deviceId = deviceId;
    ackMsg.timestamp = millis();
    memset(ackMsg.data, 0, sizeof(ackMsg.data));

    esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&ackMsg, sizeof(ackMsg));
    if (result == ESP_OK) {
      Serial.printf("[PRESS_ACK] Sent to buzzer %d\n", deviceId);
    } else {
      Serial.printf("[PRESS_ACK] Failed to send to buzzer %d\n", deviceId);
    }
  }
}

void sendCorrectAnswerFeedback(uint8_t deviceId) {
  if (deviceId == 0) {
    // Broadcast to all devices
    Serial.println("[ESP32] Broadcasting correct answer feedback to ALL buzzers");
    int sent = 0;
    int failed = 0;
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline) {
        if (sendCommandWithAck(devices[i].deviceId, CMD_CORRECT_ANSWER)) {
          sent++;
        } else {
          failed++;
        }
      }
    }
    Serial.printf("Correct answer feedback broadcast: %d sent, %d failed\n", sent, failed);
    return;
  }

  Serial.printf("[ESP32] Sending correct answer feedback to buzzer %d\n", deviceId);

  if (sendCommandWithAck(deviceId, CMD_CORRECT_ANSWER)) {
    Serial.printf("Correct answer feedback sent to buzzer %d (with ACK)\n", deviceId);
  } else {
    Serial.printf("ERROR:Failed to send correct answer feedback to device %d\n", deviceId);
  }
}

void sendWrongAnswerFeedback(uint8_t deviceId) {
  if (deviceId == 0) {
    // Broadcast to all devices
    Serial.println("[ESP32] Broadcasting wrong answer feedback to ALL buzzers");
    int sent = 0;
    int failed = 0;
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline) {
        if (sendCommandWithAck(devices[i].deviceId, CMD_WRONG_ANSWER)) {
          sent++;
        } else {
          failed++;
        }
      }
    }
    Serial.printf("Wrong answer feedback broadcast: %d sent, %d failed\n", sent, failed);
    return;
  }

  Serial.printf("[ESP32] Sending wrong answer feedback to buzzer %d\n", deviceId);

  if (sendCommandWithAck(deviceId, CMD_WRONG_ANSWER)) {
    Serial.printf("Wrong answer feedback sent to buzzer %d (with ACK)\n", deviceId);
  } else {
    Serial.printf("ERROR:Failed to send wrong answer feedback to device %d\n", deviceId);
  }
}

void endRoundReset(uint8_t deviceId) {
  if (deviceId == 0) {
    // End round for all devices - start background retry tracking
    Serial.println("[END_ROUND] Starting END_ROUND broadcast with ACK tracking");

    endRoundInProgress = true;
    endRoundStartTime = millis();

    // Initialize tracking for all online devices
    int trackingCount = 0;
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline && trackingCount < MAX_GROUPS) {
        endRoundTracking[trackingCount].deviceId = devices[i].deviceId;
        endRoundTracking[trackingCount].confirmed = false;
        endRoundTracking[trackingCount].retryCount = 0;
        endRoundTracking[trackingCount].lastAttempt = 0;
        trackingCount++;

        devices[i].isPressed = false; // Reset pressed state
      }
    }

    // Send first attempt to all devices
    sendEndRoundCommand(0); // Will be picked up by background retry loop

    Serial.printf("[END_ROUND] Tracking %d devices for reset confirmation\n", trackingCount);
  } else {
    // End round for specific device - simple fire-and-forget
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        devices[i].isPressed = false; // Reset pressed state
        sendEndRoundCommand(deviceId);
        Serial.printf("[END_ROUND] Sent to buzzer %d (no tracking for single device)\n", deviceId);
        return;
      }
    }
    Serial.printf("ERROR:Device %d not found for end round reset\n", deviceId);
  }
}

void sendEndRoundCommand(uint8_t deviceId) {
  // Send END_ROUND as Message type 8 (not Command struct)
  // Buzzers will respond with Message type 8 (END_ROUND_ACK)
  Message msg;
  msg.messageType = 8; // END_ROUND request
  msg.deviceId = 0;    // From coordinator
  msg.timestamp = millis();
  memset(msg.data, 0, sizeof(msg.data));

  if (deviceId == 0) {
    // Broadcast to all devices
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&msg, sizeof(msg));
        delay(20); // Increased delay to reduce RF congestion
      }
    }
  } else {
    // Send to specific device
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&msg, sizeof(msg));
        break;
      }
    }
  }
}

void handleEndRoundAck(uint8_t deviceId) {
  if (!endRoundInProgress) {
    return; // Not tracking END_ROUND, ignore
  }

  // Mark device as confirmed
  for (int i = 0; i < MAX_GROUPS; i++) {
    if (endRoundTracking[i].deviceId == deviceId && !endRoundTracking[i].confirmed) {
      endRoundTracking[i].confirmed = true;
      Serial.printf("[END_ROUND] ACK received from device %d\n", deviceId);

      // Check if all devices confirmed
      bool allConfirmed = true;
      int confirmedCount = 0;
      int totalCount = 0;
      for (int j = 0; j < MAX_GROUPS; j++) {
        if (endRoundTracking[j].deviceId != 0) {
          totalCount++;
          if (endRoundTracking[j].confirmed) {
            confirmedCount++;
          } else {
            allConfirmed = false;
          }
        }
      }

      if (allConfirmed) {
        Serial.printf("[END_ROUND] All %d devices confirmed reset!\n", totalCount);
        endRoundInProgress = false;
      } else {
        Serial.printf("[END_ROUND] Progress: %d/%d devices confirmed\n", confirmedCount, totalCount);
      }
      return;
    }
  }
}

void processEndRoundRetries() {
  if (!endRoundInProgress) {
    return;
  }

  unsigned long now = millis();

  // Check for unconfirmed devices and retry
  for (int i = 0; i < MAX_GROUPS; i++) {
    if (endRoundTracking[i].deviceId != 0 && !endRoundTracking[i].confirmed) {
      // Check if it's time to retry
      if (now - endRoundTracking[i].lastAttempt >= END_ROUND_RETRY_INTERVAL_MS) {
        if (endRoundTracking[i].retryCount < END_ROUND_MAX_RETRIES) {
          // Retry sending END_ROUND to this specific device
          Serial.printf("[END_ROUND] Retry %d/%d for device %d\n",
                        endRoundTracking[i].retryCount + 1,
                        END_ROUND_MAX_RETRIES,
                        endRoundTracking[i].deviceId);

          sendEndRoundCommand(endRoundTracking[i].deviceId);
          endRoundTracking[i].lastAttempt = now;
          endRoundTracking[i].retryCount++;
        } else {
          // Max retries reached - mark as "confirmed" to stop retrying
          Serial.printf("[END_ROUND] WARNING: Device %d failed to ACK after %d retries - giving up\n",
                        endRoundTracking[i].deviceId, END_ROUND_MAX_RETRIES);
          endRoundTracking[i].confirmed = true; // Give up, but log warning
        }
      }
    }
  }

  // Check if all devices are now confirmed (or gave up)
  bool allDone = true;
  for (int i = 0; i < MAX_GROUPS; i++) {
    if (endRoundTracking[i].deviceId != 0 && !endRoundTracking[i].confirmed) {
      allDone = false;
      break;
    }
  }

  if (allDone && (now - endRoundStartTime > 500)) {
    // All done (either confirmed or gave up) and at least 500ms passed
    Serial.println("[END_ROUND] Reset process complete (with possible failures)");
    endRoundInProgress = false;
  }
}

void startGame(String gameId) {
  currentGameId = gameId;
  gameActive = true;
  gameStartTime = millis();
  buzzerPressCount = 0;
  
  Serial.print("ACK:GAME_START:");
  Serial.println(gameId);
  Serial.print("Game started: ");
  Serial.println(gameId);
}

void endGame() {
  gameActive = false;
  disarmAllBuzzers();
  
  Serial.println("ACK:GAME_END");
  Serial.println("Game ended");
}

void resetSystem() {
  systemArmed = false;
  gameActive = false;
  currentGameId = "";
  buzzerPressCount = 0;
  
  Command cmd;
  cmd.command = 4; // RESET
  cmd.targetDevice = 0;
  cmd.timestamp = millis();
  
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline) {
      esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
      delay(10);
    }
  }
  
  Serial.println("ACK:RESET");
  Serial.println("System reset");
}

void sendStatusToSerial() {
  // Simple status format (no JSON)
  Serial.print("STATUS:");
  Serial.print(millis());
  Serial.print(",armed=");
  Serial.print(systemArmed);
  Serial.print(",game=");
  Serial.print(gameActive);
  Serial.print(",devices=");
  Serial.print(registeredDeviceCount);
  Serial.print(",presses=");
  Serial.println(buzzerPressCount);

  // Device details
  for (int i = 0; i < registeredDeviceCount; i++) {
    Serial.print("DEVICE:");
    Serial.print(devices[i].deviceId);
    Serial.print(",online=");
    Serial.print(devices[i].isOnline);
    Serial.print(",armed=");
    Serial.print(devices[i].isArmed);
    Serial.print(",pressed=");
    Serial.print(devices[i].isPressed);
    Serial.print(",battery_percentage=");
    Serial.print(devices[i].batteryPercentage);
    Serial.print(",battery_voltage=");
    Serial.print(devices[i].batteryVoltage, 2); // 2 decimal places
    Serial.print(",mac=");
    for (int j = 0; j < 6; j++) {
      if (devices[i].macAddress[j] < 16) Serial.print("0");
      Serial.print(devices[i].macAddress[j], HEX);
      if (j < 5) Serial.print(":");
    }
    Serial.println();
  }
}

void updateStatusLED() {
  static unsigned long lastLedUpdate = 0;
  static bool ledState = false;
  unsigned long currentTime = millis();
  
  if (gameActive && systemArmed) {
    // Fast blink when game active
    if (currentTime - lastLedUpdate > 250) {
      ledState = !ledState;
      digitalWrite(STATUS_LED_PIN, ledState);
      lastLedUpdate = currentTime;
    }
  } else if (systemArmed) {
    // Slow blink when armed
    if (currentTime - lastLedUpdate > 1000) {
      ledState = !ledState;
      digitalWrite(STATUS_LED_PIN, ledState);
      lastLedUpdate = currentTime;
    }
  } else {
    // Solid on when idle
    digitalWrite(STATUS_LED_PIN, HIGH);
  }
}