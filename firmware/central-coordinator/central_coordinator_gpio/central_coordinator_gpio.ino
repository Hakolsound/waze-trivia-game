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
#define TEXT_DEBUG_ENABLED false  // Set to true for debugging

// Device state tracking
typedef struct {
  uint8_t macAddress[6];
  uint8_t deviceId;
  bool isRegistered;
  bool isArmed;
  bool isPressed;
  unsigned long lastHeartbeat;
  bool isOnline;
} DeviceState;

// Message structures (must match group buzzer firmware)
typedef struct {
  uint8_t messageType;  // 1=buzzer_press, 2=heartbeat, 3=status_update
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];
} Message;

typedef struct {
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset
  uint8_t targetDevice; // 0=all, or specific device ID
  uint32_t timestamp;
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
  uint8_t command;             // 1=arm, 2=disarm, 3=test, 4=status_req
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

void sendBinaryBuzzerPress(uint8_t deviceId, uint32_t timestamp, uint16_t deltaMs, uint8_t position) {
  BuzzerMessage buzzerMsg;
  buzzerMsg.deviceId = deviceId;
  buzzerMsg.timestamp = timestamp;
  buzzerMsg.deltaMs = deltaMs;
  buzzerMsg.position = position;
  buzzerMsg.reserved = 0; // Clear reserved byte
  buzzerMsg.checksum = calculateChecksum((uint8_t*)&buzzerMsg, sizeof(buzzerMsg) - 1);

  Serial.write((uint8_t*)&buzzerMsg, sizeof(buzzerMsg));
  Serial.flush(); // Ensure immediate transmission

  Serial.printf("Sent binary buzzer press: device=%d, deltaMs=%d, position=%d\n",
                deviceId, deltaMs, position);
}

void sendBinaryStatus() {
  StatusMessage statusMsg;

  // Build device masks
  statusMsg.deviceMask = 0;
  statusMsg.armedMask = 0;
  statusMsg.pressedMask = 0;

  for (int i = 0; i < registeredDeviceCount; i++) {
    uint8_t deviceBit = devices[i].deviceId - 1; // Convert to 0-based bit position
    if (deviceBit < 16) { // Safety check
      if (devices[i].isOnline) {
        statusMsg.deviceMask |= (1 << deviceBit);
      }
      if (devices[i].isArmed) {
        statusMsg.armedMask |= (1 << deviceBit);
      }
      if (devices[i].isPressed) {
        statusMsg.pressedMask |= (1 << deviceBit);
      }
    }
  }

  statusMsg.timestamp = millis();
  statusMsg.gameId = gameActive ? currentGameId.toInt() : 0;
  statusMsg.checksum = calculateChecksum((uint8_t*)&statusMsg, sizeof(statusMsg) - 1);

  Serial.write((uint8_t*)&statusMsg, sizeof(statusMsg));
  Serial.flush();
}

void processBinaryCommands() {
  Serial.println("Processing binary commands...");
  while (Serial.available()) {
    uint8_t byte = Serial.read();
    Serial.printf("Read byte: 0x%02X (pos=%d)\n", byte, commandBufferPos);

    // Wait for command header
    if (commandBufferPos == 0 && byte != 0xBB) {
      continue;
    }

    commandBuffer[commandBufferPos++] = byte;

    // Process complete command message
    if (commandBufferPos >= sizeof(CommandMessage)) {
      CommandMessage* cmd = (CommandMessage*)commandBuffer;

      // Verify checksum
      if (verifyChecksum((uint8_t*)cmd, sizeof(CommandMessage))) {
        Serial.printf("Command received: type=%d, target=%d, gameId=%d\n", cmd->command, cmd->targetDevice, cmd->gameId);
        handleBinaryCommand(*cmd);
      } else {
        Serial.println("ERROR:Invalid command checksum");
        Serial.printf("Received command: header=0x%02X, cmd=%d, target=%d, gameId=%d\n",
                     cmd->header, cmd->command, cmd->targetDevice, cmd->gameId);
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
    case 1: // ARM
      currentGameId = String(cmd.gameId);
      armAllBuzzers();
      break;
    case 2: // DISARM
      disarmAllBuzzers();
      break;
    case 3: // TEST
      testBuzzer(cmd.targetDevice);
      break;
    case 4: // STATUS_REQUEST
      if (BINARY_PROTOCOL_ENABLED) {
        sendBinaryStatus();
      } else {
        sendStatusToSerial();
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
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           recv_info->src_addr[0], recv_info->src_addr[1], recv_info->src_addr[2],
           recv_info->src_addr[3], recv_info->src_addr[4], recv_info->src_addr[5]);
  
  Serial.printf("Received %d bytes from: %s\n", len, macStr);
  
  // Parse the message
  if (len == sizeof(Message)) {
    Message msg;
    memcpy(&msg, data, sizeof(msg));
    
    Serial.printf("Message type: %d, Device ID: %d\n", msg.messageType, msg.deviceId);
    
    // Update device heartbeat first (registers device if new)
    updateDeviceHeartbeat(recv_info->src_addr, msg.deviceId);
    
    // Handle different message types
    switch (msg.messageType) {
      case 1: // buzzer_press
        handleBuzzerPress(msg);
        break;
      case 2: // heartbeat
        handleHeartbeat(msg);
        break;
      case 3: // status_update
        handleStatusUpdate(msg);
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
  }
  
  // Initialize WiFi in station mode
  WiFi.mode(WIFI_STA);
  delay(500);
  
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

  // Check for serial commands from Raspberry Pi
  if (Serial.available()) {
    Serial.printf("Serial data available: %d bytes\n", Serial.available());
    if (BINARY_PROTOCOL_ENABLED) {
      processBinaryCommands();
    } else {
      handleSerialCommand();
    }
  }
  
  // Check device timeouts
  checkDeviceTimeouts(currentTime);
  
  // Send periodic status updates
  static unsigned long lastStatusUpdate = 0;
  if (currentTime - lastStatusUpdate > 5000) {
    if (BINARY_PROTOCOL_ENABLED) {
      sendBinaryStatus();
    } else {
      sendStatusToSerial();
    }
    lastStatusUpdate = currentTime;
  }
  
  // Handle system LED status
  updateStatusLED();
  
  delay(10);
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

  if (!gameActive && !systemArmed) {
    Serial.println("ERROR:Game not active and system not armed");
    return;
  }

  // Check if already pressed
  for (int i = 0; i < buzzerPressCount; i++) {
    if (buzzerOrder[i].deviceId == msg.deviceId) {
      return; // Already recorded
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
      devices[i].isArmed = (msg.data[0] == 1);
      devices[i].isPressed = (msg.data[1] == 1);
      
      // Flash comm LED
      digitalWrite(COMM_LED_PIN, HIGH);
      delay(10);
      digitalWrite(COMM_LED_PIN, LOW);

      // Send status update to Pi when heartbeat is received
      if (BINARY_PROTOCOL_ENABLED) {
        sendBinaryStatus();
      }
      break;
    }
  }
}

void handleStatusUpdate(Message msg) {
  handleHeartbeat(msg); // Same logic for now
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

void syncDeviceState(uint8_t deviceId) {
  // Send current system state to a specific device
  Command cmd;
  cmd.command = systemArmed ? 1 : 2; // 1=ARM, 2=DISARM
  cmd.targetDevice = deviceId;
  cmd.timestamp = millis();

  // Find device MAC address
  uint8_t* targetMAC = nullptr;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId) {
      targetMAC = devices[i].macAddress;
      break;
    }
  }

  if (targetMAC) {
    esp_err_t result = esp_now_send(targetMAC, (uint8_t*)&cmd, sizeof(cmd));
    Serial.printf("State sync sent to device %d (%s): %s\n",
                  deviceId,
                  systemArmed ? "ARM" : "DISARM",
                  result == ESP_OK ? "SUCCESS" : "FAILED");
  } else {
    Serial.printf("Error: Could not find MAC address for device %d\n", deviceId);
  }
}

void checkDeviceTimeouts(unsigned long currentTime) {
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline && (currentTime - devices[i].lastHeartbeat > HEARTBEAT_TIMEOUT)) {
      devices[i].isOnline = false;
      devices[i].isArmed = false;   // Clear armed state when device times out
      devices[i].isPressed = false; // Clear pressed state when device times out
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
  
  // Send to all registered devices individually for reliability
  esp_err_t result = ESP_OK;
  int sent = 0;
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isRegistered) {
      esp_err_t deviceResult = esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
      if (deviceResult != ESP_OK) {
        result = deviceResult; // Keep track of any failures
      } else {
        sent++;
      }
      delay(10); // Small delay between sends
    }
  }

  Serial.printf("ARM sent to %d devices\n", sent);
  
  Serial.println("ACK:ARMED");
  Serial.print("Buzzers armed - Broadcast result: ");
  Serial.println(result == ESP_OK ? "SUCCESS" : "FAILED");
}

void disarmAllBuzzers() {
  Command cmd;
  cmd.command = 2; // DISARM
  cmd.targetDevice = 0;
  cmd.timestamp = millis();
  
  systemArmed = false;
  gameActive = false;
  currentGameId = "";
  
  // Send to all devices
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline) {
      esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
      delay(10);
    }
  }
  
  Serial.println("ACK:DISARMED");
  Serial.println("Buzzers disarmed");
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