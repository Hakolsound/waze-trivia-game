#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <FastLED.h>

// Hardware Configuration
#define BUZZER_PIN 2
#define LED_PIN 4
#define BUZZER_BUTTON_PIN 5

// WS2812B RGB LED Configuration
#define NUM_LEDS 23        // Number of LEDs in the strip (adjust as needed)
#define RGB_DATA_PIN 4    // Same pin as LED_PIN for WS2812B data
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define BRIGHTNESS 64     // 0-255, adjust for desired brightness

// Device Configuration
#define DEVICE_ID 3  // Change this for each group buzzer (1, 2, 3, etc.)
#define MAX_GROUPS 15

// Central coordinator MAC address
uint8_t coordinatorMAC[] = {0x78, 0xE3, 0x6D, 0x1B, 0x13, 0x28};

// WS2812B LED Array
CRGB leds[NUM_LEDS];

// Color definitions
#define COLOR_OFF CRGB::Black
#define COLOR_ARMED CRGB::Blue
#define COLOR_ANSWERING_NOW CRGB::White
#define COLOR_CORRECT_ANSWER CRGB::Green
#define COLOR_WRONG_ANSWER CRGB::Red
#define COLOR_TEST CRGB::Yellow
#define COLOR_ERROR CRGB::Red
#define COLOR_STARTUP CRGB::Purple

// Game states
enum BuzzerState {
  STATE_DISARMED,
  STATE_ARMED,
  STATE_ANSWERING_NOW,
  STATE_CORRECT_ANSWER,
  STATE_WRONG_ANSWER,
  STATE_TEST
};

// State management
bool isArmed = false;
bool buzzerPressed = false;
BuzzerState currentState = STATE_DISARMED;
unsigned long buzzerPressTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastButtonCheck = 0;
bool lastButtonState = HIGH;
bool ledState = false;
unsigned long lastLedBlink = 0;
unsigned long lastRgbUpdate = 0;
uint8_t blinkCounter = 0;
uint8_t chaserPosition = 0;

// Answer feedback timeout (fallback for older coordinator)
unsigned long answerFeedbackTimeout = 0;
bool waitingForAnswerFeedback = false;

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

  // Initialize FastLED
  FastLED.addLeds<LED_TYPE, RGB_DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(BRIGHTNESS);

  // Initial LED state
  setAllLeds(COLOR_OFF);
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

// RGB LED Helper Functions
void setAllLeds(CRGB color) {
  fill_solid(leds, NUM_LEDS, color);
  FastLED.show();
}

void setLedsPattern(CRGB color, int pattern) {
  switch (pattern) {
    case 0: // All LEDs same color
      setAllLeds(color);
      break;
    case 1: // Alternate pattern
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = (i % 2 == 0) ? color : COLOR_OFF;
      }
      FastLED.show();
      break;
    case 2: // Chase pattern (one LED at a time)
      fill_solid(leds, NUM_LEDS, COLOR_OFF);
      leds[blinkCounter % NUM_LEDS] = color;
      FastLED.show();
      blinkCounter++;
      break;
    case 3: // Breathing effect (fade in/out)
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
        leds[i].fadeToBlackBy(128 + (sin(millis() / 500.0) * 127));
      }
      FastLED.show();
      break;
  }
}

void flashLeds(CRGB color, int times, int duration) {
  for (int i = 0; i < times; i++) {
    setAllLeds(color);
    delay(duration);
    setAllLeds(COLOR_OFF);
    if (i < times - 1) delay(duration);
  }
}

void rainbowEffect() {
  static uint8_t hue = 0;
  fill_rainbow(leds, NUM_LEDS, hue, 7);
  FastLED.show();
  hue++;
}

// Enhanced LED Effects for Game States

void blueChaser() {
  // Blue fast chaser from max to 20% brightness
  fill_solid(leds, NUM_LEDS, COLOR_OFF);

  // Calculate brightness based on position (max at front, fade to 20% behind)
  for (int i = 0; i < 5; i++) { // Show 5 LEDs with fading trail
    int pos = (chaserPosition - i + NUM_LEDS) % NUM_LEDS;
    int brightness = 255 - (i * 47); // 255, 208, 161, 114, 67 (about 26% fade per step)
    if (brightness < 51) brightness = 51; // Minimum 20% brightness

    leds[pos] = COLOR_ARMED;
    leds[pos].fadeToBlackBy(255 - brightness);
  }

  FastLED.show();
  chaserPosition = (chaserPosition + 1) % NUM_LEDS;
}

void flashingWhite() {
  // Flashing all white for "answering now"
  static bool flashState = false;
  flashState = !flashState;

  if (flashState) {
    setAllLeds(COLOR_ANSWERING_NOW);
  } else {
    setAllLeds(COLOR_OFF);
  }
}

void dancingGreen() {
  // Dancing green effect for correct answer
  static uint8_t dancePhase = 0;
  fill_solid(leds, NUM_LEDS, COLOR_OFF);

  // Create a wave pattern
  for (int i = 0; i < NUM_LEDS; i++) {
    int brightness = 128 + (127 * sin((i * 0.5) + (dancePhase * 0.1)));
    leds[i] = COLOR_CORRECT_ANSWER;
    leds[i].fadeToBlackBy(255 - brightness);
  }

  // Add some sparkle
  if (random(100) < 30) {
    leds[random(NUM_LEDS)] = CRGB::White;
  }

  FastLED.show();
  dancePhase++;
}

void sadRed() {
  // Sad red effect for wrong answer - slow dim pulsing
  static float pulsePhase = 0;
  pulsePhase += 0.02; // Very slow pulse

  int brightness = 80 + (40 * sin(pulsePhase)); // Dim pulse between 40-120
  CRGB sadColor = COLOR_WRONG_ANSWER;
  sadColor.fadeToBlackBy(255 - brightness);

  setAllLeds(sadColor);
}

void updateLedState() {
  switch (currentState) {
    case STATE_DISARMED:
      setAllLeds(COLOR_OFF);
      break;

    case STATE_ARMED:
      blueChaser();
      break;

    case STATE_ANSWERING_NOW:
      flashingWhite();
      break;

    case STATE_CORRECT_ANSWER:
      dancingGreen();
      break;

    case STATE_WRONG_ANSWER:
      sadRed();
      break;

    case STATE_TEST:
      rainbowEffect();
      break;
  }
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check button state (debounced)
  if (currentTime - lastButtonCheck > 50) {
    checkBuzzerButton();
    lastButtonCheck = currentTime;
  }
  
  // Handle answer feedback timeout (fallback for older coordinator)
  if (waitingForAnswerFeedback && currentTime > answerFeedbackTimeout) {
    waitingForAnswerFeedback = false;
    if (isArmed) {
      currentState = STATE_ARMED; // Return to armed state if no feedback received
    } else {
      currentState = STATE_DISARMED;
    }
    Serial.println("Answer feedback timeout - returning to previous state");
  }

  // Update LED state based on current game state
  if (currentTime - lastRgbUpdate > 50) { // Faster updates for smooth effects
    updateLedState();
    lastRgbUpdate = currentTime;
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
  currentState = STATE_ANSWERING_NOW; // Change to flashing white state immediately

  // Start waiting for answer feedback with 10 second timeout
  waitingForAnswerFeedback = true;
  answerFeedbackTimeout = millis() + 10000;

  // Start buzzer sound immediately (non-blocking)
  digitalWrite(BUZZER_PIN, HIGH);

  Serial.print("BUZZER PRESSED! Device: ");
  Serial.print(DEVICE_ID);
  Serial.print(" Time: ");
  Serial.println(buzzerPressTime);

  // Send buzzer press message
  Message msg;
  msg.messageType = 1; // buzzer_press
  msg.deviceId = DEVICE_ID;
  msg.timestamp = buzzerPressTime;
  memset(msg.data, 0, sizeof(msg.data)); // Clear data array

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  Serial.printf("Buzzer press message send result: %s\n", result == ESP_OK ? "SUCCESS" : "FAILED");

  // Play buzzer pattern in background
  playBuzzerPattern();
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

    case 5: // CORRECT_ANSWER
      correctAnswerFeedback();
      break;

    case 6: // WRONG_ANSWER
      wrongAnswerFeedback();
      break;

    case 7: // END_ROUND (return to armed state)
      endRoundReset();
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
    currentState = STATE_ARMED;
    digitalWrite(BUZZER_PIN, LOW);

    Serial.println("Buzzer ARMED");

    // Louder PWM confirmation beep
    unsigned long startTime = millis();
    unsigned long beepDuration = 200;
    unsigned long halfPeriod = 750; // ~667Hz tone

    while (millis() - startTime < beepDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }
  }
}

void disarmBuzzer() {
  isArmed = false;
  buzzerPressed = false;
  currentState = STATE_DISARMED;
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("Buzzer DISARMED");
}

void testBuzzer() {
  Serial.println("Testing buzzer");

  BuzzerState previousState = currentState;
  currentState = STATE_TEST;

  // Test sequence: Rainbow effect with louder buzzer
  int testFreqs[] = {800, 1000, 1200}; // Different test frequencies

  for (int i = 0; i < 3; i++) {
    // Generate louder PWM tone for test
    unsigned long startTime = millis();
    unsigned long testDuration = 300;
    unsigned long halfPeriod = 500000 / testFreqs[i];

    while (millis() - startTime < testDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(100);
  }

  // Brief rainbow effect
  for (int i = 0; i < 50; i++) {
    rainbowEffect();
    delay(20);
  }

  // Restore previous state
  currentState = previousState;
}

void resetBuzzer() {
  Serial.println("Resetting buzzer");

  isArmed = false;
  buzzerPressed = false;
  ledState = false;
  blinkCounter = 0;
  chaserPosition = 0;
  currentState = STATE_DISARMED;

  digitalWrite(BUZZER_PIN, LOW);

  // Reset confirmation pattern
  startupSequence();
}

void correctAnswerFeedback() {
  Serial.println("Correct answer feedback");
  currentState = STATE_CORRECT_ANSWER;
  buzzerPressed = false; // Reset buzzer press state
  waitingForAnswerFeedback = false; // Clear timeout
}

void wrongAnswerFeedback() {
  Serial.println("Wrong answer feedback");
  currentState = STATE_WRONG_ANSWER;
  buzzerPressed = false; // Reset buzzer press state
  waitingForAnswerFeedback = false; // Clear timeout
}

void endRoundReset() {
  Serial.println("End round - returning to armed state");
  buzzerPressed = false;
  waitingForAnswerFeedback = false; // Clear timeout
  if (isArmed) {
    currentState = STATE_ARMED;
  } else {
    currentState = STATE_DISARMED;
  }
}

void playBuzzerPattern() {
  // Victory pattern when buzzer is pressed - Much louder and longer
  int melody[] = {523, 659, 784, 1047}; // C, E, G, C (octave higher)
  int noteDurations[] = {300, 300, 300, 600}; // Longer durations

  for (int i = 0; i < 4; i++) {
    // Generate PWM tone for much louder output
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i]; // Half period in microseconds

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    // Brief pause between notes
    delay(50);
  }
}

void startupSequence() {
  Serial.println("Running startup sequence");

  // RGB startup pattern - chase effect
  for (int cycle = 0; cycle < 3; cycle++) {
    for (int i = 0; i < NUM_LEDS; i++) {
      fill_solid(leds, NUM_LEDS, COLOR_OFF);
      leds[i] = COLOR_STARTUP;
      FastLED.show();
      delay(100);
    }
  }

  // Rainbow wave effect
  for (int cycle = 0; cycle < 100; cycle++) {
    rainbowEffect();
    delay(20);
  }

  // Final flash
  flashLeds(COLOR_STARTUP, 3, 200);

  // Buzzer startup beep - louder PWM tone
  unsigned long startTime = millis();
  unsigned long beepDuration = 500; // Longer beep
  unsigned long halfPeriod = 1000; // 500Hz tone

  while (millis() - startTime < beepDuration) {
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(halfPeriod);
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(halfPeriod);
  }

  // Turn off LEDs
  setAllLeds(COLOR_OFF);

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
  msg.data[2] = (leds[0].r > 0 || leds[0].g > 0 || leds[0].b > 0) ? 1 : 0; // RGB LED status

  esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));

  Serial.print("Status - Armed: ");
  Serial.print(isArmed);
  Serial.print(" Pressed: ");
  Serial.print(buzzerPressed);
  Serial.print(" RGB Active: ");
  Serial.println((leds[0].r > 0 || leds[0].g > 0 || leds[0].b > 0) ? "Yes" : "No");
}