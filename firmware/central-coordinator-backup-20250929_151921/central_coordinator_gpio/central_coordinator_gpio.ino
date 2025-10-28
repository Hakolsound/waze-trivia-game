#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// Hardware Configuration
#define STATUS_LED_PIN 2
#define COMM_LED_PIN 4
#define MAX_GROUPS 15
#define MAX_ESP_NOW_PEERS 20  // ESP-NOW has a limit of 20 peers

// GPIO Serial pins for direct Pi connection
#define RX_PIN 16
#define TX_PIN 17

// Communication Configuration
#define SERIAL_BAUD 115200
#define SERIAL_BUFFER_SIZE 64
#define HEARTBEAT_TIMEOUT_MS 10000  // 10 seconds
#define COMMAND_TIMEOUT_MS 5000     // 5 seconds
#define SERIAL_COMMAND_MAX_LENGTH 64

// WiFi Channel Configuration
#define WIFI_SCAN_TIMEOUT_MS 10000  // 10 seconds max scan time
#define WIFI_CHANNEL_CHANGE_DELAY_MS 50
#define MIN_WIFI_CHANNEL 1
#define MAX_WIFI_CHANNEL 13      // EU channels 1-13
#define DEFAULT_WIFI_CHANNEL 13  // Default channel (same as buzzer firmware)
uint8_t currentWifiChannel = DEFAULT_WIFI_CHANNEL;

// Timing Configuration
#define STATUS_UPDATE_INTERVAL_MS 5000
#define PEER_CLEANUP_INTERVAL_MS 300000  // 5 minutes
#define COMM_LED_FLASH_DURATION_MS 10
#define COMM_LED_FLASH_INTERVAL_MS 100
#define LED_FAST_BLINK_MS 250
#define LED_SLOW_BLINK_MS 1000

// System Health Configuration
#define MAX_CONSECUTIVE_FAILURES 5
#define RECOVERY_RETRY_INTERVAL_MS 30000  // 30 seconds
#define HEALTH_CHECK_INTERVAL_MS 10000    // 10 seconds
#define PEER_INACTIVE_TIMEOUT_MS 300000   // 5 minutes

// Binary Protocol Configuration
#define BINARY_PROTOCOL_ENABLED true
#define TEXT_DEBUG_ENABLED false
#define CHECKSUM_SIZE 1
#define COMMAND_HEADER_SIZE 5
#define BUZZER_MESSAGE_SIZE 12
#define STATUS_MESSAGE_SIZE 17

// WiFi Channel Scanning Structures
typedef struct {
  uint8_t channel;
  int8_t rssi;        // Signal strength (negative dBm)
  uint8_t networkCount; // Number of networks on this channel
  uint8_t quality;    // Calculated quality score (0-100, higher is better)
} ChannelInfo;

ChannelInfo channelScanResults[13]; // Results for channels 1-13
bool channelScanInProgress = false;
unsigned long channelScanStartTime = 0;

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
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset, 5=correct_answer, 6=wrong_answer, 7=end_round
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
char currentGameId[16] = ""; // Fixed-size string to avoid heap fragmentation

// Non-blocking timing management
typedef struct {
  unsigned long nextExecution;
  unsigned long interval;
  bool enabled;
} Timer;

Timer statusUpdateTimer = {0, STATUS_UPDATE_INTERVAL_MS, true};
Timer channelScanTimer = {0, 1000, false}; // For WiFi scanning
Timer peerCommandTimer = {0, WIFI_CHANNEL_CHANGE_DELAY_MS, false}; // For staggering ESP-NOW commands
Timer peerCleanupTimer = {0, PEER_CLEANUP_INTERVAL_MS, true}; // Clean up inactive peers

// ESP-NOW Peer Management
typedef struct {
  uint8_t macAddress[6];
  uint8_t deviceId;
  bool isActive;
  unsigned long lastActivity;
  uint8_t peerIndex; // Index in ESP-NOW peer list
} ESPNowPeer;

ESPNowPeer espNowPeers[MAX_ESP_NOW_PEERS];
int activePeerCount = 0;

// Error Recovery and System Health
typedef struct {
  unsigned long lastSuccessfulESPNow;
  unsigned long lastSuccessfulWiFi;
  unsigned long lastSuccessfulSerial;
  uint8_t consecutiveESPNowFailures;
  uint8_t consecutiveWiFiFailures;
  uint8_t consecutiveSerialFailures;
  bool espNowDegraded;
  bool wifiDegraded;
  bool serialDegraded;
  unsigned long lastRecoveryAttempt;
} SystemHealth;

SystemHealth systemHealth = {0, 0, 0, 0, 0, 0, false, false, false, 0};

// Error thresholds
#define MAX_CONSECUTIVE_FAILURES 5
#define RECOVERY_RETRY_INTERVAL 30000  // 30 seconds
#define HEALTH_CHECK_INTERVAL 10000    // 10 seconds

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
static uint8_t commandBuffer[SERIAL_BUFFER_SIZE];
static int commandBufferPos = 0;

// Timer management functions
bool isTimerReady(Timer* timer) {
  if (!timer->enabled) return false;
  unsigned long currentTime = millis();
  if (currentTime >= timer->nextExecution) {
    timer->nextExecution = currentTime + timer->interval;
    return true;
  }
  return false;
}

void resetTimer(Timer* timer) {
  timer->nextExecution = millis() + timer->interval;
}

void enableTimer(Timer* timer) {
  timer->enabled = true;
  resetTimer(timer);
}

void disableTimer(Timer* timer) {
  timer->enabled = false;
}

// ESP-NOW Peer Management Functions
int findPeerByMAC(const uint8_t* mac) {
  for (int i = 0; i < activePeerCount; i++) {
    if (memcmp(espNowPeers[i].macAddress, mac, 6) == 0) {
      return i;
    }
  }
  return -1;
}

int findPeerByDeviceId(uint8_t deviceId) {
  for (int i = 0; i < activePeerCount; i++) {
    if (espNowPeers[i].deviceId == deviceId && espNowPeers[i].isActive) {
      return i;
    }
  }
  return -1;
}

int addPeer(const uint8_t* mac, uint8_t deviceId) {
  // Check if peer already exists
  int existingIndex = findPeerByMAC(mac);
  if (existingIndex >= 0) {
    // Update existing peer
    espNowPeers[existingIndex].deviceId = deviceId;
    espNowPeers[existingIndex].lastActivity = millis();
    return existingIndex;
  }

  // Check if we have room for new peer
  if (activePeerCount >= MAX_ESP_NOW_PEERS) {
    Serial.println("ERROR: Maximum ESP-NOW peers reached, cannot add new peer");
    return -1;
  }

  // Find free slot (peer index in ESP-NOW)
  int freePeerIndex = -1;
  for (int i = 0; i < MAX_ESP_NOW_PEERS; i++) {
    bool slotUsed = false;
    for (int j = 0; j < activePeerCount; j++) {
      if (espNowPeers[j].peerIndex == i) {
        slotUsed = true;
        break;
      }
    }
    if (!slotUsed) {
      freePeerIndex = i;
      break;
    }
  }

  if (freePeerIndex == -1) {
    Serial.println("ERROR: No free ESP-NOW peer slots available");
    return -1;
  }

  // Add peer to ESP-NOW
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = currentWifiChannel;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA;

  esp_err_t result = esp_now_add_peer(&peerInfo);
  if (result != ESP_OK) {
    Serial.printf("ERROR: Failed to add ESP-NOW peer for device %d (error %d)\n", deviceId, result);
    return -1;
  }

  // Add to our tracking
  int newIndex = activePeerCount++;
  memcpy(espNowPeers[newIndex].macAddress, mac, 6);
  espNowPeers[newIndex].deviceId = deviceId;
  espNowPeers[newIndex].isActive = true;
  espNowPeers[newIndex].lastActivity = millis();
  espNowPeers[newIndex].peerIndex = freePeerIndex;

  Serial.printf("Added ESP-NOW peer: device %d at index %d\n", deviceId, freePeerIndex);
  return newIndex;
}

void removePeer(int peerIndex) {
  if (peerIndex < 0 || peerIndex >= activePeerCount) {
    return;
  }

  ESPNowPeer* peer = &espNowPeers[peerIndex];

  // Remove from ESP-NOW
  esp_err_t result = esp_now_del_peer(peer->macAddress);
  if (result != ESP_OK) {
    Serial.printf("Warning: Failed to remove ESP-NOW peer for device %d (error %d)\n", peer->deviceId, result);
  }

  // Remove from our tracking by shifting array
  for (int i = peerIndex; i < activePeerCount - 1; i++) {
    espNowPeers[i] = espNowPeers[i + 1];
  }
  activePeerCount--;

  Serial.printf("Removed ESP-NOW peer: device %d\n", peer->deviceId);
}

void cleanupInactivePeers() {
  unsigned long currentTime = millis();
  const unsigned long PEER_TIMEOUT = 300000; // 5 minutes

  for (int i = activePeerCount - 1; i >= 0; i--) {
    if (currentTime - espNowPeers[i].lastActivity > PEER_TIMEOUT) {
      Serial.printf("Cleaning up inactive peer: device %d (inactive for %lu ms)\n",
                    espNowPeers[i].deviceId, currentTime - espNowPeers[i].lastActivity);
      removePeer(i);
    }
  }
}

void updatePeerActivity(const uint8_t* mac) {
  int peerIndex = findPeerByMAC(mac);
  if (peerIndex >= 0) {
    espNowPeers[peerIndex].lastActivity = millis();
  }
}

// System Health Monitoring Functions
void recordESPNowSuccess() {
  systemHealth.lastSuccessfulESPNow = millis();
  systemHealth.consecutiveESPNowFailures = 0;
  if (systemHealth.espNowDegraded) {
    systemHealth.espNowDegraded = false;
    Serial.println("ESP-NOW: Recovered from degraded state");
  }
}

void recordESPNowFailure() {
  systemHealth.consecutiveESPNowFailures++;
  if (systemHealth.consecutiveESPNowFailures >= MAX_CONSECUTIVE_FAILURES && !systemHealth.espNowDegraded) {
    systemHealth.espNowDegraded = true;
    Serial.printf("ESP-NOW: Degraded state detected (%d consecutive failures)\n", systemHealth.consecutiveESPNowFailures);
    attemptESPNowRecovery();
  }
}

void recordWiFiSuccess() {
  systemHealth.lastSuccessfulWiFi = millis();
  systemHealth.consecutiveWiFiFailures = 0;
  if (systemHealth.wifiDegraded) {
    systemHealth.wifiDegraded = false;
    Serial.println("WiFi: Recovered from degraded state");
  }
}

void recordWiFiFailure() {
  systemHealth.consecutiveWiFiFailures++;
  if (systemHealth.consecutiveWiFiFailures >= MAX_CONSECUTIVE_FAILURES && !systemHealth.wifiDegraded) {
    systemHealth.wifiDegraded = true;
    Serial.printf("WiFi: Degraded state detected (%d consecutive failures)\n", systemHealth.consecutiveWiFiFailures);
    attemptWiFiRecovery();
  }
}

void recordSerialSuccess() {
  systemHealth.lastSuccessfulSerial = millis();
  systemHealth.consecutiveSerialFailures = 0;
  if (systemHealth.serialDegraded) {
    systemHealth.serialDegraded = false;
    Serial.println("Serial: Recovered from degraded state");
  }
}

void recordSerialFailure() {
  systemHealth.consecutiveSerialFailures++;
  if (systemHealth.consecutiveSerialFailures >= MAX_CONSECUTIVE_FAILURES && !systemHealth.serialDegraded) {
    systemHealth.serialDegraded = true;
    Serial.printf("Serial: Degraded state detected (%d consecutive failures)\n", systemHealth.consecutiveSerialFailures);
    attemptSerialRecovery();
  }
}

void attemptESPNowRecovery() {
  unsigned long currentTime = millis();
  if (currentTime - systemHealth.lastRecoveryAttempt < RECOVERY_RETRY_INTERVAL) {
    return; // Too soon to retry
  }

  systemHealth.lastRecoveryAttempt = currentTime;
  Serial.println("ESP-NOW: Attempting recovery...");

  // Reinitialize ESP-NOW
  esp_now_deinit();
  delay(100); // Short blocking delay for reinit

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW: Recovery failed - could not reinitialize");
    return;
  }

  // Re-register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // Re-add all active peers
  int recoveredPeers = 0;
  for (int i = 0; i < activePeerCount; i++) {
    if (espNowPeers[i].isActive) {
      esp_now_peer_info_t peerInfo = {};
      memcpy(peerInfo.peer_addr, espNowPeers[i].macAddress, 6);
      peerInfo.channel = currentWifiChannel;
      peerInfo.encrypt = false;
      peerInfo.ifidx = WIFI_IF_STA;

      if (esp_now_add_peer(&peerInfo) == ESP_OK) {
        recoveredPeers++;
      }
    }
  }

  Serial.printf("ESP-NOW: Recovery completed - %d/%d peers restored\n", recoveredPeers, activePeerCount);
}

void attemptWiFiRecovery() {
  unsigned long currentTime = millis();
  if (currentTime - systemHealth.lastRecoveryAttempt < RECOVERY_RETRY_INTERVAL) {
    return; // Too soon to retry
  }

  systemHealth.lastRecoveryAttempt = currentTime;
  Serial.println("WiFi: Attempting recovery...");

  // Force WiFi reconnection
  WiFi.disconnect();
  delay(1000); // Need blocking delay for WiFi operations

  WiFi.mode(WIFI_STA);
  delay(500);

  // Try to restore current channel
  esp_err_t result = esp_wifi_set_channel(currentWifiChannel, WIFI_SECOND_CHAN_NONE);
  if (result == ESP_OK) {
    Serial.printf("WiFi: Recovery successful - channel %d restored\n", currentWifiChannel);
    recordWiFiSuccess();
  } else {
    Serial.printf("WiFi: Recovery failed - could not restore channel %d\n", currentWifiChannel);
  }
}

void attemptSerialRecovery() {
  unsigned long currentTime = millis();
  if (currentTime - systemHealth.lastRecoveryAttempt < RECOVERY_RETRY_INTERVAL) {
    return; // Too soon to retry
  }

  systemHealth.lastRecoveryAttempt = currentTime;
  Serial.println("Serial: Attempting recovery...");

  // Reinitialize serial
  Serial.end();
  delay(100);
  Serial.begin(SERIAL_BAUD);

  Serial.println("Serial: Recovery completed - reinitialized");
  recordSerialSuccess();
}

void performSystemHealthCheck() {
  static unsigned long lastHealthCheck = 0;
  unsigned long currentTime = millis();

  if (currentTime - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return;
  }

  lastHealthCheck = currentTime;

  // Check for system-wide issues
  bool systemHealthy = true;

  if (systemHealth.espNowDegraded) {
    systemHealthy = false;
    Serial.println("HEALTH: ESP-NOW subsystem degraded");
  }

  if (systemHealth.wifiDegraded) {
    systemHealthy = false;
    Serial.println("HEALTH: WiFi subsystem degraded");
  }

  if (systemHealth.serialDegraded) {
    systemHealthy = false;
    Serial.println("HEALTH: Serial subsystem degraded");
  }

  if (systemHealthy) {
    Serial.println("HEALTH: All subsystems operational");
  } else {
    Serial.println("HEALTH: System operating in degraded mode");
  }
}

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

// Endianness handling functions (ESP32 is little-endian)
inline uint16_t readUint16LE(const uint8_t* buffer) {
  return (uint16_t)buffer[0] | ((uint16_t)buffer[1] << 8);
}

inline uint32_t readUint32LE(const uint8_t* buffer) {
  return (uint32_t)buffer[0] | ((uint32_t)buffer[1] << 8) |
         ((uint32_t)buffer[2] << 16) | ((uint32_t)buffer[3] << 24);
}

inline void writeUint16LE(uint8_t* buffer, uint16_t value) {
  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
}

inline void writeUint32LE(uint8_t* buffer, uint32_t value) {
  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
  buffer[2] = (value >> 16) & 0xFF;
  buffer[3] = (value >> 24) & 0xFF;
}

void sendBinaryBuzzerPress(uint8_t deviceId, uint32_t timestamp, uint16_t deltaMs, uint8_t position) {
  BuzzerMessage msg;
  msg.deviceId = deviceId;
  msg.timestamp = timestamp;
  msg.deltaMs = deltaMs;
  msg.position = position;

  // Calculate checksum for the packed structure (excluding checksum field)
  uint8_t* msgBytes = (uint8_t*)&msg;
  msg.checksum = calculateChecksum(msgBytes, sizeof(BuzzerMessage) - 1);

  Serial.write(msgBytes, sizeof(BuzzerMessage));
  Serial.flush(); // Ensure immediate transmission

  Serial.printf("Sent binary buzzer press: device=%d, deltaMs=%d, position=%d\n",
                deviceId, deltaMs, position);
}

void sendBinaryStatus() {
  StatusMessage msg;

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

  msg.deviceMask = deviceMask;
  msg.armedMask = armedMask;
  msg.pressedMask = pressedMask;
  msg.timestamp = millis();

  // Convert currentGameId to integer safely
  msg.gameId = gameActive ? atoi(currentGameId) : 0;

  // Calculate checksum for the packed structure (excluding checksum field)
  uint8_t* msgBytes = (uint8_t*)&msg;
  msg.checksum = calculateChecksum(msgBytes, sizeof(StatusMessage) - 1);

  Serial.write(msgBytes, sizeof(StatusMessage));
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
    case 5: // CORRECT_ANSWER
      sendCorrectAnswerFeedback(cmd.targetDevice);
      break;
    case 6: // WRONG_ANSWER
      sendWrongAnswerFeedback(cmd.targetDevice);
      break;
    case 7: // END_ROUND
      endRoundReset(cmd.targetDevice);
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

  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.printf("Send to %s: Success\n", macStr);
    recordESPNowSuccess();
  } else {
    Serial.printf("Send to %s: Failed\n", macStr);
    recordESPNowFailure();
  }
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
    
    // Update peer activity and device heartbeat
    updatePeerActivity(recv_info->src_addr);
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
      default:
        Serial.printf("Unknown message type: %d\n", msg.messageType);
        break;
    }
  } else {
    Serial.printf("Invalid message length: %d (expected %d)\n", len, sizeof(Message));
  }
}

// WiFi Channel Scanning Functions
void startChannelScan() {
  if (channelScanInProgress) {
    Serial.println("SCAN_BUSY:Channel scan already in progress");
    return;
  }

  Serial.println("SCAN_START:Starting WiFi channel scan...");
  channelScanInProgress = true;
  channelScanStartTime = millis();

  // Initialize results
  for (int i = 0; i < 13; i++) {
    channelScanResults[i].channel = i + 1;
    channelScanResults[i].rssi = -100; // Very weak signal as default
    channelScanResults[i].networkCount = 0;
    channelScanResults[i].quality = 0;
  }

  // Start WiFi scan (async)
  WiFi.scanNetworks(true, false, false, 300); // async, no SSID hiding, no BSSID, 300ms per channel
}

void processChannelScanResults() {
  if (!channelScanInProgress) return;

  int n = WiFi.scanComplete();

  if (n == WIFI_SCAN_RUNNING) {
    // Scan still in progress, check timeout
    if (millis() - channelScanStartTime > WIFI_SCAN_TIMEOUT) {
      WiFi.scanDelete();
      Serial.println("SCAN_TIMEOUT:Channel scan timed out");
      channelScanInProgress = false;
      return;
    }
    return; // Still scanning
  }

  if (n == WIFI_SCAN_FAILED) {
    Serial.println("SCAN_FAILED:WiFi scan failed");
    channelScanInProgress = false;
    return;
  }

  // Process scan results
  Serial.printf("SCAN_RESULTS:Found %d networks\n", n);

  // Count networks per channel
  for (int i = 0; i < n; ++i) {
    int channel = WiFi.channel(i);
    if (channel >= MIN_WIFI_CHANNEL && channel <= MAX_WIFI_CHANNEL) {
      int channelIndex = channel - 1; // 0-based array index
      channelScanResults[channelIndex].networkCount++;

      // Track the strongest signal on this channel
      int8_t rssi = WiFi.RSSI(i);
      if (rssi > channelScanResults[channelIndex].rssi) {
        channelScanResults[channelIndex].rssi = rssi;
      }
    }
  }

  // Calculate quality scores for each channel
  for (int i = 0; i < 13; i++) {
    uint8_t channel = i + 1;
    uint8_t networkCount = channelScanResults[i].networkCount;
    int8_t rssi = channelScanResults[i].rssi;

    // Quality calculation:
    // - Fewer networks = higher quality
    // - Stronger signal (less negative RSSI) = higher quality
    // - Some channels are preferred (1, 6, 11 are non-overlapping)

    uint8_t networkScore = 100 - (networkCount * 10); // -10 points per network
    networkScore = max(0, (int)networkScore);

    uint8_t signalScore = 0;
    if (rssi >= -30) signalScore = 100;      // Excellent signal
    else if (rssi >= -50) signalScore = 80;  // Good signal
    else if (rssi >= -70) signalScore = 60;  // Fair signal
    else if (rssi >= -80) signalScore = 40;  // Poor signal
    else signalScore = 20;                   // Very poor signal

    uint8_t channelBonus = 0;
    if (channel == 1 || channel == 6 || channel == 11) {
      channelBonus = 20; // Bonus for non-overlapping channels
    }

    channelScanResults[i].quality = min(100, (uint8_t)((networkScore + signalScore + channelBonus) / 2));
  }

  // Send results to control panel
  sendChannelScanResults();

  // Clean up scan
  WiFi.scanDelete();
  channelScanInProgress = false;
  Serial.println("SCAN_COMPLETE:Channel scan finished");
}

void sendChannelScanResults() {
  Serial.println("CHANNEL_SCAN_RESULTS:");

  for (int i = 0; i < 13; i++) {
    ChannelInfo info = channelScanResults[i];
    Serial.printf("CH%d:networks=%d,rssi=%d,quality=%d\n",
                  info.channel, info.networkCount, info.rssi, info.quality);
  }

  // Find and recommend best channel
  uint8_t bestChannel = currentWifiChannel;
  uint8_t bestQuality = 0;

  for (int i = 0; i < 13; i++) {
    if (channelScanResults[i].quality > bestQuality) {
      bestQuality = channelScanResults[i].quality;
      bestChannel = channelScanResults[i].channel;
    }
  }

  Serial.printf("RECOMMENDED_CHANNEL:%d (quality=%d)\n", bestChannel, bestQuality);
}

uint8_t selectBestChannel() {
  if (channelScanInProgress) {
    Serial.println("ERROR:Cannot select channel while scanning");
    return currentWifiChannel;
  }

  uint8_t bestChannel = currentWifiChannel;
  uint8_t bestQuality = 0;

  for (int i = 0; i < 13; i++) {
    if (channelScanResults[i].quality > bestQuality) {
      bestQuality = channelScanResults[i].quality;
      bestChannel = channelScanResults[i].channel;
    }
  }

  return bestChannel;
}

bool setWifiChannel(uint8_t channel) {
  if (channel < MIN_WIFI_CHANNEL || channel > MAX_WIFI_CHANNEL) {
    Serial.printf("ERROR:Invalid channel %d (must be %d-%d)\n", channel, MIN_WIFI_CHANNEL, MAX_WIFI_CHANNEL);
    return false;
  }

  if (channel == currentWifiChannel) {
    Serial.printf("INFO:Already on channel %d\n", channel);
    return true;
  }

  Serial.printf("SETTING_CHANNEL:%d\n", channel);

  // Set the WiFi channel
  esp_err_t result = esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  if (result != ESP_OK) {
    Serial.printf("ERROR:Failed to set channel %d (error %d)\n", channel, result);
    return false;
  }

  currentWifiChannel = channel;

  // Send channel change command to all registered buzzers
  sendChannelChangeToAllBuzzers(channel);

  Serial.printf("CHANNEL_SET:%d\n", channel);
  return true;
}

void sendChannelChangeToAllBuzzers(uint8_t channel) {
  Command cmd;
  cmd.command = 8; // New command: CHANGE_CHANNEL
  cmd.targetDevice = channel; // Use targetDevice to pass channel number
  cmd.timestamp = millis();

  Serial.printf("BROADCASTING_CHANNEL_CHANGE:%d to %d devices\n", channel, registeredDeviceCount);

  // Send to all registered devices without blocking delays
  for (int i = 0; i < registeredDeviceCount; i++) {
    esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
    // Remove blocking delay - ESP-NOW handles timing internally
  }

  // Also broadcast to catch any unregistered devices
  uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_now_send(broadcastMAC, (uint8_t*)&cmd, sizeof(cmd));
}

void setup() {
  // Initialize watchdog timer for system reliability
  #ifdef ESP32_WATCHDOG_ENABLED
    esp_task_wdt_init(30, true); // 30 second timeout, panic on timeout
    esp_task_wdt_add(NULL); // Add current task to watchdog
    Serial.println("Watchdog timer enabled (30s timeout)");
  #endif

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

  // Check for serial commands from Raspberry Pi (non-blocking)
  if (Serial.available()) {
    Serial.printf("Serial data available: %d bytes\n", Serial.available());
    if (BINARY_PROTOCOL_ENABLED) {
      processBinaryCommands();
    } else {
      handleSerialCommand();
    }
  }

  // Process channel scanning if in progress
  processChannelScanResults();

  // Check device timeouts
  checkDeviceTimeouts(currentTime);

  // Send periodic status updates (non-blocking)
  if (isTimerReady(&statusUpdateTimer)) {
    if (BINARY_PROTOCOL_ENABLED) {
      sendBinaryStatus();
    } else {
      sendStatusToSerial();
    }
  }

  // Clean up inactive ESP-NOW peers periodically
  if (isTimerReady(&peerCleanupTimer)) {
    cleanupInactivePeers();
  }

  // Perform system health checks
  performSystemHealthCheck();

  // Handle system LED status
  updateStatusLED();

  // Feed watchdog timer (if enabled)
  #ifdef ESP32_WATCHDOG_ENABLED
    esp_task_wdt_reset();
  #endif

  // Small yield to prevent watchdog issues (non-blocking)
  yield();
}

void handleSerialCommand() {
  // Read command into fixed-size buffer to avoid heap allocation
  char commandBuffer[SERIAL_COMMAND_MAX_LENGTH];
  int bufferIndex = 0;

  // Read until newline or buffer full
  while (Serial.available() && bufferIndex < sizeof(commandBuffer) - 1) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') break;
    commandBuffer[bufferIndex++] = c;
  }
  commandBuffer[bufferIndex] = '\0'; // Null terminate

  // Trim whitespace
  char* command = commandBuffer;
  while (*command && (*command == ' ' || *command == '\t')) command++;
  char* end = command + strlen(command) - 1;
  while (end > command && (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r')) end--;
  *(end + 1) = '\0';

  // For debugging - comment out in production to avoid clutter
  // Serial.printf("Command: '%s' (length: %d)\n", command, strlen(command));

  // Ignore empty commands
  if (strlen(command) == 0) {
    return;
  }

  if (strcmp(command, "STATUS") == 0) {
    sendStatusToSerial();
  } else if (strcmp(command, "ARM") == 0) {
    armAllBuzzers();
  } else if (strcmp(command, "DISARM") == 0) {
    disarmAllBuzzers();
  } else if (strncmp(command, "TEST:", 5) == 0) {
    int deviceId = atoi(command + 5);
    testBuzzer(deviceId);
  } else if (strncmp(command, "GAME_START:", 11) == 0) {
    const char* gameIdStr = command + 11;
    startGame(gameIdStr);
  } else if (strcmp(command, "GAME_END") == 0) {
    endGame();
  } else if (strcmp(command, "RESET") == 0) {
    resetSystem();
  } else if (strcmp(command, "SCAN_CHANNELS") == 0) {
    startChannelScan();
  } else if (strcmp(command, "GET_BEST_CHANNEL") == 0) {
    uint8_t bestChannel = selectBestChannel();
    Serial.printf("BEST_CHANNEL:%d\n", bestChannel);
  } else if (strncmp(command, "SET_CHANNEL:", 12) == 0) {
    uint8_t channel = atoi(command + 12);
    setWifiChannel(channel);
  } else if (strcmp(command, "GET_CURRENT_CHANNEL") == 0) {
    Serial.printf("CURRENT_CHANNEL:%d\n", currentWifiChannel);
  } else {
    Serial.printf("ERROR:Unknown command '%s'\n", command);
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
      
      // Flash comm LED (non-blocking using state machine)
      static unsigned long commLedStartTime = 0;
      static bool commLedState = false;
      unsigned long currentTime = millis();

      if (!commLedState && (commLedStartTime == 0 || currentTime - commLedStartTime > COMM_LED_FLASH_INTERVAL_MS)) {
        // Start flash
        digitalWrite(COMM_LED_PIN, HIGH);
        commLedState = true;
        commLedStartTime = currentTime;
      } else if (commLedState && currentTime - commLedStartTime > COMM_LED_FLASH_DURATION_MS) {
        // End flash
        digitalWrite(COMM_LED_PIN, LOW);
        commLedState = false;
        commLedStartTime = 0;
      }

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
    devices[registeredDeviceCount].lastHeartbeat = millis();

    // Add device as ESP-NOW peer using new peer management system
    int peerIndex = addPeer(mac, deviceId);
    if (peerIndex >= 0) {
      Serial.printf("Added device %d as ESP-NOW peer (index %d)\n", deviceId, peerIndex);
    } else {
      Serial.printf("Warning: Could not add peer for device %d - will use broadcast\n", deviceId);
    }

    registeredDeviceCount++;

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    Serial.printf("NEW_DEVICE:%d:%s\n", deviceId, macStr);
    Serial.printf("NEW DEVICE REGISTERED: ID=%d MAC=%s\n", deviceId, macStr);

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
      // Remove blocking delay - ESP-NOW handles timing internally
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
      // Remove blocking delay - ESP-NOW handles timing internally
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
        // Remove blocking delay - ESP-NOW handles timing internally
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

void sendCorrectAnswerFeedback(uint8_t deviceId) {
  Command cmd;
  cmd.command = 5; // CORRECT_ANSWER
  cmd.targetDevice = deviceId;
  cmd.timestamp = millis();

  if (deviceId == 0) {
    Serial.println("ERROR:Correct answer feedback requires specific device ID");
    return;
  }

  // Send to specific device that answered correctly
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId && devices[i].isOnline) {
      esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
      Serial.printf("Correct answer feedback sent to buzzer %d\n", deviceId);
      return;
    }
  }
  Serial.printf("ERROR:Device %d not found for correct answer feedback\n", deviceId);
}

void sendWrongAnswerFeedback(uint8_t deviceId) {
  Command cmd;
  cmd.command = 6; // WRONG_ANSWER
  cmd.targetDevice = deviceId;
  cmd.timestamp = millis();

  if (deviceId == 0) {
    Serial.println("ERROR:Wrong answer feedback requires specific device ID");
    return;
  }

  // Send to specific device that answered incorrectly
  for (int i = 0; i < registeredDeviceCount; i++) {
    if (devices[i].deviceId == deviceId && devices[i].isOnline) {
      esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
      Serial.printf("Wrong answer feedback sent to buzzer %d\n", deviceId);
      return;
    }
  }
  Serial.printf("ERROR:Device %d not found for wrong answer feedback\n", deviceId);
}

void endRoundReset(uint8_t deviceId) {
  Command cmd;
  cmd.command = 7; // END_ROUND
  cmd.targetDevice = deviceId;
  cmd.timestamp = millis();

  if (deviceId == 0) {
    // End round for all devices
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].isOnline) {
        devices[i].isPressed = false; // Reset pressed state
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        // Remove blocking delay - ESP-NOW handles timing internally
      }
    }
    Serial.println("End round reset sent to all buzzers");
  } else {
    // End round for specific device
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        devices[i].isPressed = false; // Reset pressed state
        esp_now_send(devices[i].macAddress, (uint8_t*)&cmd, sizeof(cmd));
        Serial.printf("End round reset sent to buzzer %d\n", deviceId);
        return;
      }
    }
    Serial.printf("ERROR:Device %d not found for end round reset\n", deviceId);
  }
}

void startGame(const char* gameId) {
  strncpy(currentGameId, gameId, sizeof(currentGameId) - 1);
  currentGameId[sizeof(currentGameId) - 1] = '\0'; // Ensure null termination

  gameActive = true;
  gameStartTime = millis();
  buzzerPressCount = 0;

  Serial.printf("ACK:GAME_START:%s\n", gameId);
  Serial.printf("Game started: %s\n", gameId);
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
      // Remove blocking delay - ESP-NOW handles timing internally
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
    if (currentTime - lastLedUpdate > LED_FAST_BLINK_MS) {
      ledState = !ledState;
      digitalWrite(STATUS_LED_PIN, ledState);
      lastLedUpdate = currentTime;
    }
  } else if (systemArmed) {
    // Slow blink when armed
    if (currentTime - lastLedUpdate > LED_SLOW_BLINK_MS) {
      ledState = !ledState;
      digitalWrite(STATUS_LED_PIN, ledState);
      lastLedUpdate = currentTime;
    }
  } else {
    // Solid on when idle
    digitalWrite(STATUS_LED_PIN, HIGH);
  }
}