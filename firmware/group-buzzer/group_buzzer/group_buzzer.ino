\#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// Hardware Configuration
#define BUZZER_PIN 2
#define LED_PIN 4
#define BUZZER_BUTTON_PIN 5

// Device Configuration
#define DEVICE_ID 1  // Change this for each group buzzer (1, 2, 3, etc.)
#define MAX_GROUPS 15

// Central coordinator MAC address
uint8_t coordinatorMAC[] = {0x78, 0xE3, 0x6D, 0x1B, 0x13, 0x28};

// State management
bool isArmed = false;
bool buzzerPressed = false;
unsigned long buzzerPressTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastButtonCheck = 0;
bool lastButtonState = HIGH;
bool ledState = false;
unsigned long lastLedBlink = 0;

// Message structure for ESP-NOW communication
typedef struct {
  uint8_t messageType;  // 1=buzzer_press, 2=heartbeat, 3=status_update
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];      // Additional data if needed
} Message;

typedef struct {
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset
  uint8_t targetDevice; // 0=all, or specific device ID
  uint32_t timestamp;
} Command;

// ESP-NOW callback for sending data (ESP-IDF v5.x signature)
void OnDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           tx_info->des_addr[0], tx_info->des_addr[1], tx_info->des_addr[2],
           tx_info->des_addr[3], tx_info->des_addr[4], tx_info->des_addr[5]);

  Serial.printf("ESP-NOW Send Status to %s: %s\n", macStr,
                status == ESP_NOW_SEND_SUCCESS ? "Success" : "Fail");
}

// ESP-NOW callback for receiving data (ESP-IDF v5.x signature)
void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
  Serial.printf("ESP-NOW received %d bytes\n", len);

  Command cmd;
  memcpy(&cmd, incomingData, sizeof(cmd));

  Serial.printf("Command data: cmd=%d, target=%d, timestamp=%lu\n",
                cmd.command, cmd.targetDevice, cmd.timestamp);
  
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           recv_info->src_addr[0], recv_info->src_addr[1], recv_info->src_addr[2],
           recv_info->src_addr[3], recv_info->src_addr[4], recv_info->src_addr[5]);

  Serial.printf("Received %d bytes from %s\n", len, macStr);
  
  if (cmd.targetDevice == 0 || cmd.targetDevice == DEVICE_ID) {
    handleCommand(cmd);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);  // Give serial time to initialize
  
  Serial.println("\n=== ESP32 Group Buzzer Starting ===");
  
  // Initialize hardware pins
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_BUTTON_PIN, INPUT_PULLUP);
  
  // Initial LED state
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("Hardware pins initialized");
  
  // Initialize WiFi in station mode
  WiFi.mode(WIFI_STA);
  Serial.println("WiFi set to Station mode");
  
  // Wait for WiFi to initialize and get MAC
  delay(500);
  
  // Print MAC address for coordinator registration
  String macAddress = WiFi.macAddress();
  Serial.print("Group Buzzer #");
  Serial.print(DEVICE_ID);
  Serial.print(" MAC Address: ");
  Serial.println(macAddress);
  
  // Verify MAC is valid
  if (macAddress == "00:00:00:00:00:00") {
    Serial.println("WARNING: Invalid MAC address detected!");
    // Try restarting WiFi
    WiFi.disconnect();
    delay(100);
    WiFi.mode(WIFI_STA);
    delay(500);
    macAddress = WiFi.macAddress();
    Serial.print("Retry MAC: ");
    Serial.println(macAddress);
  }
  
  // Initialize ESP-NOW
  Serial.println("Initializing ESP-NOW...");
  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: Failed to initialize ESP-NOW");
    return;
  }
  Serial.println("ESP-NOW initialized successfully");
  
  // Print WiFi channel info
  uint8_t primaryChan;
  wifi_second_chan_t secondChan;
  esp_wifi_get_channel(&primaryChan, &secondChan);
  Serial.print("WiFi Channel: ");
  Serial.println(primaryChan);
  
  // Register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);
  Serial.println("ESP-NOW callbacks registered");
  
  // Add coordinator as peer
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo)); // Clear the structure
  memcpy(peerInfo.peer_addr, coordinatorMAC, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA; // Set the interface
  
  esp_err_t addPeerResult = esp_now_add_peer(&peerInfo);
  if (addPeerResult != ESP_OK) {
    Serial.print("ERROR: Failed to add coordinator peer - Error: ");
    Serial.println(addPeerResult);
  } else {
    Serial.println("Coordinator peer added successfully");
    
    // Print coordinator MAC for verification
    Serial.print("Coordinator MAC: ");
    for (int i = 0; i < 6; i++) {
      if (coordinatorMAC[i] < 16) Serial.print("0");
      Serial.print(coordinatorMAC[i], HEX);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
  }
  
  // Startup sequence - LED blink pattern
  startupSequence();
  
  Serial.println("=== Group Buzzer initialized and ready ===");
  sendHeartbeat();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check button state (debounced)
  if (currentTime - lastButtonCheck > 50) {
    checkBuzzerButton();
    lastButtonCheck = currentTime;
  }
  
  // Handle LED blinking when armed
  if (isArmed && currentTime - lastLedBlink > 500) {
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
    lastLedBlink = currentTime;
  }
  
  // Send periodic heartbeat
  if (currentTime - lastHeartbeat > 5000) {
    sendHeartbeat();
    lastHeartbeat = currentTime;
  }
  
  // Small delay to prevent watchdog issues
  delay(10);
}

void checkBuzzerButton() {
  bool currentButtonState = digitalRead(BUZZER_BUTTON_PIN);
  
  // Button pressed (active LOW) and buzzer is armed and not already pressed
  if (currentButtonState == LOW && lastButtonState == HIGH && isArmed && !buzzerPressed) {
    handleBuzzerPress();
  }
  
  lastButtonState = currentButtonState;
}

void handleBuzzerPress() {
  buzzerPressed = true;
  buzzerPressTime = millis();
  
  // Immediate feedback
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  
  // Send buzzer press message
  Message msg;
  msg.messageType = 1; // buzzer_press
  msg.deviceId = DEVICE_ID;
  msg.timestamp = buzzerPressTime;
  
  esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  
  Serial.print("BUZZER PRESSED! Device: ");
  Serial.print(DEVICE_ID);
  Serial.print(" Time: ");
  Serial.println(buzzerPressTime);
  
  // Buzzer sound pattern
  playBuzzerPattern();
  
  // Keep LED on to indicate this buzzer was pressed
  digitalWrite(LED_PIN, HIGH);
}

void handleCommand(Command cmd) {
  Serial.print("Received command: ");
  Serial.print(cmd.command);
  Serial.print(" for device: ");
  Serial.println(cmd.targetDevice);
  
  switch (cmd.command) {
    case 1: // ARM
      armBuzzer();
      break;
      
    case 2: // DISARM
      disarmBuzzer();
      break;
      
    case 3: // TEST
      testBuzzer();
      break;
      
    case 4: // RESET
      resetBuzzer();
      break;
      
    default:
      Serial.println("Unknown command");
      break;
  }
  
  // Send status update after handling command
  sendStatusUpdate();
}

void armBuzzer() {
  if (!isArmed) {
    isArmed = true;
    buzzerPressed = false;
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    
    Serial.println("Buzzer ARMED");
    
    // Brief confirmation beep
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void disarmBuzzer() {
  isArmed = false;
  buzzerPressed = false;
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("Buzzer DISARMED");
  
  // Double beep for disarm confirmation
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}

void testBuzzer() {
  Serial.println("Testing buzzer");
  
  // Test sequence: LED and buzzer
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
  }
  
  // Restore previous state
  if (isArmed) {
    digitalWrite(LED_PIN, ledState);
  } else {
    digitalWrite(LED_PIN, LOW);
  }
}

void resetBuzzer() {
  Serial.println("Resetting buzzer");
  
  isArmed = false;
  buzzerPressed = false;
  ledState = false;
  
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  
  // Reset confirmation pattern
  startupSequence();
}

void playBuzzerPattern() {
  // Victory pattern when buzzer is pressed
  int melody[] = {523, 659, 784}; // C, E, G
  int noteDurations[] = {200, 200, 400};
  
  for (int i = 0; i < 3; i++) {
    // Simple tone generation (basic square wave)
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(500000 / melody[i]);
    digitalWrite(BUZZER_PIN, LOW);
    delay(noteDurations[i]);
  }
}

void startupSequence() {
  Serial.println("Running startup sequence");
  
  // LED startup pattern
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
  
  // Buzzer startup beep
  digitalWrite(BUZZER_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("Startup sequence complete");
}

void sendHeartbeat() {
  Message msg;
  msg.messageType = 2; // heartbeat
  msg.deviceId = DEVICE_ID;
  msg.timestamp = millis();
  msg.data[0] = isArmed ? 1 : 0;
  msg.data[1] = buzzerPressed ? 1 : 0;
  
  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  Serial.print("Heartbeat sent to coordinator - Result: ");
  Serial.println(result == ESP_OK ? "SUCCESS" : "FAILED");
  
  if (result != ESP_OK) {
    Serial.print("Error code: ");
    Serial.println(result);
  }
}

void sendStatusUpdate() {
  Message msg;
  msg.messageType = 3; // status_update
  msg.deviceId = DEVICE_ID;
  msg.timestamp = millis();
  msg.data[0] = isArmed ? 1 : 0;
  msg.data[1] = buzzerPressed ? 1 : 0;
  msg.data[2] = digitalRead(LED_PIN);
  
  esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  
  Serial.print("Status - Armed: ");
  Serial.print(isArmed);
  Serial.print(" Pressed: ");
  Serial.print(buzzerPressed);
  Serial.print(" LED: ");
  Serial.println(digitalRead(LED_PIN));
}