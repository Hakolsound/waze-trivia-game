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
  // Initialize GPIO serial for Pi communication
  Serial2.begin(SERIAL_BAUD, SERIAL_8N1, RX_PIN, TX_PIN);
  
  // Also initialize USB serial for debugging
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
  Serial2.println("=== ESP32 Central Coordinator ===");
  Serial2.print("MAC: ");
  Serial2.println(WiFi.macAddress());
  Serial2.println("Waiting for buzzers...");
  
  Serial.println("=== ESP32 Central Coordinator ===");
  Serial.print("MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.println("GPIO Serial: RX=16, TX=17");
  
  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial2.println("ERROR: ESP-NOW init failed");
    Serial.println("ERROR: ESP-NOW init failed");
    return;
  }
  
  Serial.println("ESP-NOW initialized successfully");
  
  // Register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);
  
  // Startup complete
  digitalWrite(STATUS_LED_PIN, HIGH);
  
  Serial2.println("READY");
  Serial.println("Central Coordinator ready");
  sendStatusToSerial();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check for serial commands from Raspberry Pi
  if (Serial2.available()) {
    handleSerialCommand();
  }
  
  // Check device timeouts
  checkDeviceTimeouts(currentTime);
  
  // Send periodic status updates
  static unsigned long lastStatusUpdate = 0;
  if (currentTime - lastStatusUpdate > 5000) {
    sendStatusToSerial();
    lastStatusUpdate = currentTime;
  }
  
  // Handle system LED status
  updateStatusLED();
  
  delay(10);
}

void handleSerialCommand() {
  String command = Serial2.readStringUntil('\n');
  command.trim();
  
  Serial.print("Command: ");
  Serial.println(command);
  
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
    Serial2.println("ERROR:Unknown command");
    Serial.println("ERROR:Unknown command");
  }
}

void handleBuzzerPress(Message msg) {
  if (!gameActive) {
    Serial2.println("ERROR:Game not active");
    Serial.println("ERROR:Game not active");
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
  
  // Send to Pi (simple format for now)
  Serial2.print("BUZZER:");
  Serial2.print(msg.deviceId);
  Serial2.print(",");
  Serial2.print(msg.timestamp);
  Serial2.print(",");
  Serial2.print(deltaMs);
  Serial2.print(",");
  Serial2.println(buzzerPressCount);
  
  Serial.print("BUZZER PRESS: Device ");
  Serial.print(msg.deviceId);
  Serial.print(" at ");
  Serial.print(deltaMs);
  Serial.println("ms");
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
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId) {
      memcpy(devices[i].macAddress, mac, 6);
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      found = true;
      break;
    }
  }
  
  // Register new device (don't add as peer yet - just track it)
  if (!found && registeredDeviceCount < MAX_GROUPS) {
    memcpy(devices[registeredDeviceCount].macAddress, mac, 6);
    devices[registeredDeviceCount].deviceId = deviceId;
    devices[registeredDeviceCount].isRegistered = true;
    devices[registeredDeviceCount].isOnline = true;
    devices[registeredDeviceCount].lastHeartbeat = millis();
    
    registeredDeviceCount++;
    
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    
    Serial2.print("NEW_DEVICE:");
    Serial2.print(deviceId);
    Serial2.print(":");
    Serial2.println(macStr);
    
    Serial.print("NEW DEVICE REGISTERED: ID=");
    Serial.print(deviceId);
    Serial.print(" MAC=");
    Serial.println(macStr);
    
    // Try to add as peer (but don't fail if it doesn't work)
    esp_now_peer_info_t peerInfo;
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
  }
}

void checkDeviceTimeouts(unsigned long currentTime) {
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline && (currentTime - devices[i].lastHeartbeat > HEARTBEAT_TIMEOUT)) {
      devices[i].isOnline = false;
      Serial2.print("TIMEOUT:");
      Serial2.println(devices[i].deviceId);
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
  
  // Use broadcast to reach all devices
  uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_err_t result = esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));
  
  Serial2.println("ACK:ARMED");
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
  
  Serial2.println("ACK:DISARMED");
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
    Serial2.println("ACK:TEST_ALL");
    Serial.println("Testing all buzzers");
  } else {
    // Test specific device
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        Serial2.print("ACK:TEST_");
        Serial2.println(deviceId);
        Serial.print("Testing buzzer ");
        Serial.println(deviceId);
        return;
      }
    }
    Serial2.print("ERROR:Device not found ");
    Serial2.println(deviceId);
  }
}

void startGame(String gameId) {
  currentGameId = gameId;
  gameActive = true;
  gameStartTime = millis();
  buzzerPressCount = 0;
  
  Serial2.print("ACK:GAME_START:");
  Serial2.println(gameId);
  Serial.print("Game started: ");
  Serial.println(gameId);
}

void endGame() {
  gameActive = false;
  disarmAllBuzzers();
  
  Serial2.println("ACK:GAME_END");
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
  
  Serial2.println("ACK:RESET");
  Serial.println("System reset");
}

void sendStatusToSerial() {
  // Simple status format (no JSON)
  Serial2.print("STATUS:");
  Serial2.print(millis());
  Serial2.print(",armed=");
  Serial2.print(systemArmed);
  Serial2.print(",game=");
  Serial2.print(gameActive);
  Serial2.print(",devices=");
  Serial2.print(registeredDeviceCount);
  Serial2.print(",presses=");
  Serial2.println(buzzerPressCount);
  
  // Device details
  for (int i = 0; i < registeredDeviceCount; i++) {
    Serial2.print("DEVICE:");
    Serial2.print(devices[i].deviceId);
    Serial2.print(",online=");
    Serial2.print(devices[i].isOnline);
    Serial2.print(",armed=");
    Serial2.print(devices[i].isArmed);
    Serial2.print(",pressed=");
    Serial2.print(devices[i].isPressed);
    Serial2.print(",mac=");
    for (int j = 0; j < 6; j++) {
      if (devices[i].macAddress[j] < 16) Serial2.print("0");
      Serial2.print(devices[i].macAddress[j], HEX);
      if (j < 5) Serial2.print(":");
    }
    Serial2.println();
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