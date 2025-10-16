#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ArduinoJson.h>

// Hardware Configuration
#define STATUS_LED_PIN 2
#define COMM_LED_PIN 4
#define MAX_GROUPS 8

// Communication Configuration
#define SERIAL_BAUD 115200
#define HEARTBEAT_TIMEOUT 10000  // 10 seconds
#define COMMAND_TIMEOUT 5000     // 5 seconds

// Device state tracking
typedef struct {
  uint8_t macAddress[6];
  uint8_t deviceId;
  bool isRegistered;
  bool isArmed;
  bool isPressed;
  unsigned long lastHeartbeat;
  unsigned long lastResponse;
  bool isOnline;
  uint8_t batteryPercentage;  // Battery percentage (0-100)
  float batteryVoltage;       // Battery voltage (V)
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
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  // Update device response tracking
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (memcmp(devices[i].macAddress, mac_addr, 6) == 0) {
      devices[i].lastResponse = millis();
      break;
    }
  }
  
  // Brief comm LED flash
  digitalWrite(COMM_LED_PIN, HIGH);
  delay(50);
  digitalWrite(COMM_LED_PIN, LOW);
}

void OnDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
  Message msg;
  memcpy(&msg, incomingData, sizeof(msg));
  
  // Update device heartbeat
  updateDeviceHeartbeat(mac, msg.deviceId);
  
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
      Serial.println("Unknown message type received");
      break;
  }
  
  // Brief comm LED flash
  digitalWrite(COMM_LED_PIN, HIGH);
  delay(25);
  digitalWrite(COMM_LED_PIN, LOW);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  
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
    devices[i].lastResponse = 0;
    devices[i].batteryPercentage = 0;
    devices[i].batteryVoltage = 0.0;
  }
  
  // Initialize WiFi in station mode
  WiFi.mode(WIFI_STA);
  
  // Print coordinator MAC address
  Serial.println("=== ESP32 Central Coordinator ===");
  Serial.print("Coordinator MAC Address: ");
  Serial.println(WiFi.macAddress());
  Serial.println("Waiting for group buzzers to connect...");
  
  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  
  // Register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);
  
  // Set ESP-NOW to promiscuous mode to receive from any device
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  
  // Startup complete - status LED on
  digitalWrite(STATUS_LED_PIN, HIGH);
  
  Serial.println("Central Coordinator initialized and ready");
  sendStatusToSerial();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check for serial commands from Raspberry Pi
  if (Serial.available()) {
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
  String command = Serial.readStringUntil('\n');
  command.trim();
  
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
    Serial.println("ERROR:Unknown command");
  }
}

void handleBuzzerPress(Message msg) {
  if (!gameActive) {
    Serial.println("ERROR:Buzzer press received but game not active");
    return;
  }
  
  // Check if this device already pressed
  for (int i = 0; i < buzzerPressCount; i++) {
    if (buzzerOrder[i].deviceId == msg.deviceId) {
      return; // Already recorded
    }
  }
  
  // Calculate delta time from game start
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
  
  // Send to Raspberry Pi
  StaticJsonDocument<200> json;
  json["type"] = "buzzer_press";
  json["device_id"] = msg.deviceId;
  json["timestamp"] = msg.timestamp;
  json["delta_ms"] = deltaMs;
  json["position"] = buzzerPressCount;
  json["game_id"] = currentGameId;
  
  Serial.print("BUZZER:");
  serializeJson(json, Serial);
  Serial.println();
  
  Serial.print("BUZZER:");
  Serial.print(msg.deviceId);
  Serial.print(",");
  Serial.println(msg.timestamp);
}

void handleHeartbeat(Message msg) {
  // Update device state from heartbeat data
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == msg.deviceId) {
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      devices[i].isArmed = (msg.data[0] == 1);
      devices[i].isPressed = (msg.data[1] == 1);

      // Parse battery data (added in group buzzer firmware)
      devices[i].batteryPercentage = msg.data[2];

      // Reconstruct battery voltage from two bytes
      uint16_t voltageInt = msg.data[3] | (msg.data[4] << 8);
      devices[i].batteryVoltage = voltageInt / 100.0; // Convert back to float

      break;
    }
  }
}

void handleStatusUpdate(Message msg) {
  // Similar to heartbeat but more detailed
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == msg.deviceId) {
      devices[i].lastHeartbeat = millis();
      devices[i].isOnline = true;
      devices[i].isArmed = (msg.data[0] == 1);
      devices[i].isPressed = (msg.data[1] == 1);

      // Parse battery data from status update (uses data[3] and data[4], data[5] for battery)
      devices[i].batteryPercentage = msg.data[3];

      // Reconstruct battery voltage from two bytes
      uint16_t voltageInt = msg.data[4] | (msg.data[5] << 8);
      devices[i].batteryVoltage = voltageInt / 100.0; // Convert back to float

      break;
    }
  }
}

void updateDeviceHeartbeat(const uint8_t *mac, uint8_t deviceId) {
  // Check if device is already registered
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
  
  // Register new device
  if (!found && registeredDeviceCount < MAX_GROUPS) {
    memcpy(devices[registeredDeviceCount].macAddress, mac, 6);
    devices[registeredDeviceCount].deviceId = deviceId;
    devices[registeredDeviceCount].isRegistered = true;
    devices[registeredDeviceCount].isOnline = true;
    devices[registeredDeviceCount].lastHeartbeat = millis();
    
    // Add as ESP-NOW peer
    esp_now_peer_info_t peerInfo;
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
      registeredDeviceCount++;
      Serial.print("NEW_DEVICE:");
      Serial.print(deviceId);
      Serial.print(":");
      for (int j = 0; j < 6; j++) {
        Serial.print(mac[j], HEX);
        if (j < 5) Serial.print(":");
      }
      Serial.println();
    }
  }
}

void checkDeviceTimeouts(unsigned long currentTime) {
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].isOnline && (currentTime - devices[i].lastHeartbeat > HEARTBEAT_TIMEOUT)) {
      devices[i].isOnline = false;
      Serial.print("DEVICE_TIMEOUT:");
      Serial.println(devices[i].deviceId);
    }
  }
}

void armAllBuzzers() {
  Command cmd;
  cmd.command = 1; // ARM
  cmd.targetDevice = 0; // All devices
  cmd.timestamp = millis();
  
  gameStartTime = cmd.timestamp;
  systemArmed = true;
  buzzerPressCount = 0;
  
  // Clear previous buzzer presses
  for (int i = 0; i < MAX_GROUPS; i++) {
    buzzerOrder[i] = {0, 0, 0, 0};
    if (devices[i].isRegistered) {
      devices[i].isPressed = false;
    }
  }
  
  // Broadcast command to all devices
  uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));
  
  Serial.println("ACK:ARMED");
}

void disarmAllBuzzers() {
  Command cmd;
  cmd.command = 2; // DISARM
  cmd.targetDevice = 0; // All devices
  cmd.timestamp = millis();

  systemArmed = false;
  gameActive = false;
  currentGameId = "";

  // Broadcast command to all devices
  uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));

  Serial.println("ACK:DISARMED");
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

  Command cmd;
  cmd.command = 1; // ARM
  cmd.timestamp = millis();

  gameStartTime = cmd.timestamp;
  systemArmed = true;
  buzzerPressCount = 0;

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
        if (devices[i].deviceId == deviceId) {
          Serial.print("DEBUG:Found device ");
          Serial.print(deviceId);
          Serial.print(" at index ");
          Serial.println(i);
          cmd.targetDevice = deviceId;
          esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
          armedCount++;
          found = true;
          break;
        }
      }
      if (!found) {
        Serial.print("DEBUG:Device ");
        Serial.print(deviceId);
        Serial.println(" not found in registered devices");
      }
    }

    startIndex = commaIndex + 1;
  }

  Serial.print("ACK:ARM_SPECIFIC:");
  Serial.println(armedCount);
}

void testBuzzer(uint8_t deviceId) {
  Command cmd;
  cmd.command = 3; // TEST
  cmd.targetDevice = deviceId; // Specific device or 0 for all
  cmd.timestamp = millis();
  
  if (deviceId == 0) {
    // Test all devices
    uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));
    Serial.println("ACK:TEST_ALL");
  } else {
    // Test specific device
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId) {
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        Serial.print("ACK:TEST_");
        Serial.println(deviceId);
        return;
      }
    }
    Serial.print("ERROR:Device ");
    Serial.print(deviceId);
    Serial.println(" not found");
  }
}

void startGame(String gameId) {
  currentGameId = gameId;
  gameActive = true;
  gameStartTime = millis();
  buzzerPressCount = 0;
  
  Serial.print("ACK:GAME_START:");
  Serial.println(gameId);
}

void endGame() {
  gameActive = false;
  disarmAllBuzzers();
  
  Serial.println("ACK:GAME_END");
}

void resetSystem() {
  // Reset all state
  systemArmed = false;
  gameActive = false;
  currentGameId = "";
  buzzerPressCount = 0;
  
  // Send reset command to all devices
  Command cmd;
  cmd.command = 4; // RESET
  cmd.targetDevice = 0; // All devices
  cmd.timestamp = millis();
  
  uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));
  
  Serial.println("ACK:RESET");
}

void sendStatusToSerial() {
  StaticJsonDocument<512> json;
  
  json["timestamp"] = millis();
  json["system_armed"] = systemArmed;
  json["game_active"] = gameActive;
  json["game_id"] = currentGameId;
  json["device_count"] = registeredDeviceCount;
  json["buzzer_presses"] = buzzerPressCount;
  
  JsonArray devicesArray = json.createNestedArray("devices");
  for (int i = 0; i < registeredDeviceCount; i++) {
    JsonObject device = devicesArray.createNestedObject();
    device["id"] = devices[i].deviceId;
    device["online"] = devices[i].isOnline;
    device["armed"] = devices[i].isArmed;
    device["pressed"] = devices[i].isPressed;
    device["last_heartbeat"] = devices[i].lastHeartbeat;

    // Add battery data to JSON status
    device["battery_percentage"] = devices[i].batteryPercentage;
    device["battery_voltage"] = devices[i].batteryVoltage;

    String macStr = "";
    for (int j = 0; j < 6; j++) {
      macStr += String(devices[i].macAddress[j], HEX);
      if (j < 5) macStr += ":";
    }
    device["mac"] = macStr;
  }
  
  Serial.print("STATUS:");
  serializeJson(json, Serial);
  Serial.println();
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
    // Slow blink when armed but no game
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