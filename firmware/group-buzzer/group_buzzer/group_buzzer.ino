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
#define BRIGHTNESS 128     // 0-255, adjust for desired brightness

// Device Configuration
#define DEVICE_ID 4  // Change this for each group buzzer (1, 2, 3, etc.)
#define MAX_GROUPS 15

// Battery Monitoring Configuration
#define BATTERY_ADC_PIN 34        // ADC1_CH6 - GPIO34 for battery voltage reading
#define BATTERY_VOLTAGE_DIVIDER 2.0  // 100k/100k voltage divider (50% division)
#define BATTERY_MIN_VOLTAGE 3.0   // Minimum battery voltage (0%)
#define BATTERY_MAX_VOLTAGE 4.2   // Maximum battery voltage (100%)
#define ADC_RESOLUTION 4095       // 12-bit ADC resolution
#define ADC_REFERENCE_VOLTAGE 3.3 // ESP32 ADC reference voltage

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
  STATE_TEST,
  STATE_BATTERY_DISPLAY
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

// Battery monitoring variables
float batteryVoltage = 0.0;
uint8_t batteryPercentage = 0;
unsigned long lastBatteryCheck = 0;
unsigned long batteryCheckInterval = 60000;  // Start with 60 second interval

// Battery display mode variables
unsigned long buttonPressStartTime = 0;
bool buttonPressActive = false;
bool batteryModeActivationPending = false;
unsigned long batteryDisplayStartTime = 0;
bool idDisplayShown = false;  // Track if ID has been displayed
#define BATTERY_MODE_TIMEOUT 10000  // 10 seconds display timeout (for ID + battery display)
#define BUTTON_HOLD_THRESHOLD 3000  // 3 seconds to activate battery mode

// Correct answer LED display timer (2 second decay)
unsigned long correctAnswerStartTime = 0;
#define CORRECT_ANSWER_DURATION 3000  // 2 seconds

// Message structure for ESP-NOW communication
typedef struct {
  uint8_t messageType;  // 1=buzzer_press, 2=heartbeat, 3=status_update, 4=command_ack
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];      // Additional data if needed, data[0] = sequenceId for ACK
} Message;

typedef struct {
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset, 5=correct_answer, 6=wrong_answer, 7=end_round
  uint8_t targetDevice; // 0=all, or specific device ID
  uint32_t timestamp;
  uint16_t sequenceId;  // New: for tracking acknowledgments
  uint8_t retryCount;   // New: retry attempt counter
  uint8_t reserved;     // Padding to maintain alignment
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

  // Initialize battery monitoring ADC
  pinMode(BATTERY_ADC_PIN, INPUT);
  analogReadResolution(12); // Set ADC to 12-bit resolution
  analogSetAttenuation(ADC_11db); // Set ADC attenuation for 0-3.3V range

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
  
  // Initial battery reading
  batteryVoltage = readBatteryVoltage();
  batteryPercentage = voltageToPercentage(batteryVoltage);
  updateBatteryCheckInterval();
  Serial.printf("Initial battery reading: %.2fV (%d%%)\n", batteryVoltage, batteryPercentage);

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

void greenDecay() {
  // 2-second green decay effect for correct answer
  unsigned long elapsed = millis() - correctAnswerStartTime;

  if (elapsed < CORRECT_ANSWER_DURATION) {
    // Calculate fade amount based on elapsed time (fade from full brightness to off)
    float progress = (float)elapsed / CORRECT_ANSWER_DURATION;
    int brightness = 255 * (1.0 - progress); // Start at 255, fade to 0

    CRGB greenColor = COLOR_CORRECT_ANSWER;
    greenColor.fadeToBlackBy(255 - brightness);
    setAllLeds(greenColor);
  } else {
    // 3 seconds have passed, return to appropriate state
    setAllLeds(COLOR_OFF);

    // Don't override wrong answer state (though this should not happen in normal operation)
    if (currentState != STATE_WRONG_ANSWER) {
      if (isArmed) {
        currentState = STATE_ARMED;
      } else {
        currentState = STATE_DISARMED;
      }
    }
  }
}

void sadRed() {
  // Sad red effect for wrong answer - slow dim pulsing
  static float pulsePhase = 0;
  pulsePhase += 0.05; // Very slow pulse

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
      greenDecay();
      break;

    case STATE_WRONG_ANSWER:
      sadRed();
      break;

    case STATE_TEST:
      rainbowEffect();
      break;

    case STATE_BATTERY_DISPLAY:
      displayBatteryLevel();
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

  // Handle battery mode activation
  if (batteryModeActivationPending && currentState != STATE_ARMED) {
    currentState = STATE_BATTERY_DISPLAY;
    idDisplayShown = false;  // Reset ID display flag
    playBatteryModeEntryAnimation();
    batteryModeActivationPending = false;
    batteryDisplayStartTime = currentTime;
    Serial.println("[BATTERY] Battery display mode activated");
  }

  // Handle battery mode timeout
  if (currentState == STATE_BATTERY_DISPLAY &&
      (currentTime - batteryDisplayStartTime > BATTERY_MODE_TIMEOUT)) {
    exitBatteryMode();
    Serial.println("[BATTERY] Battery display mode timeout - exiting");
  }
  
  // Handle answer feedback timeout (fallback for older coordinator)
  if (waitingForAnswerFeedback && currentTime > answerFeedbackTimeout) {
    waitingForAnswerFeedback = false;

    // Don't override wrong answer state - keep buzzers that answered wrong in red state until round ends
    if (currentState != STATE_WRONG_ANSWER) {
      if (isArmed) {
        currentState = STATE_ARMED; // Return to armed state if no feedback received
      } else {
        currentState = STATE_DISARMED;
      }
    }
    Serial.printf("Answer feedback timeout - Device %d preserving state %d\n", DEVICE_ID, currentState);
  }

  // Update LED state based on current game state
  if (currentTime - lastRgbUpdate > 50) { // Faster updates for smooth effects
    updateLedState();
    lastRgbUpdate = currentTime;
  }
  
  // Check battery level periodically
  checkBatteryLevel();

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

  // Handle battery display mode button exit
  if (currentState == STATE_BATTERY_DISPLAY && currentButtonState == LOW && lastButtonState == HIGH) {
    exitBatteryMode();
    lastButtonState = currentButtonState;
    return;
  }

  // Button pressed (active LOW) and buzzer is armed and not already pressed
  if (currentButtonState == LOW && lastButtonState == HIGH && isArmed && !buzzerPressed) {
    handleBuzzerPress();
  }

  // Battery mode activation detection (only when not armed)
  if (!isArmed && currentState != STATE_BATTERY_DISPLAY) {
    // Button just pressed - start silent timer
    if (currentButtonState == LOW && lastButtonState == HIGH) {
      buttonPressStartTime = millis();
      buttonPressActive = true;
      Serial.println("[BATTERY] Button press started - silent monitoring");
    }

    // Button released - cancel activation
    if (buttonPressActive && currentButtonState == HIGH && lastButtonState == LOW) {
      buttonPressActive = false;
      batteryModeActivationPending = false;
      Serial.println("[BATTERY] Button released - activation cancelled");
    }

    // Check for 3-second hold completion
    if (buttonPressActive && currentButtonState == LOW &&
        (millis() - buttonPressStartTime >= BUTTON_HOLD_THRESHOLD)) {
      batteryModeActivationPending = true;
      buttonPressActive = false;
      Serial.println("[BATTERY] 3-second hold completed - battery mode pending activation");
    }
  }

  lastButtonState = currentButtonState;
}

void handleBuzzerPress() {
  buzzerPressed = true;
  buzzerPressTime = millis();
  currentState = STATE_ANSWERING_NOW; // Change to flashing white state immediately

  // Update LEDs immediately to show white flashing
  updateLedState();

  // Start waiting for answer feedback with 30 second timeout
  waitingForAnswerFeedback = true;
  answerFeedbackTimeout = millis() + 30000;

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

  // Play buzzer pattern simultaneously with LED feedback
  playBuzzerPattern();
}

void sendCommandAck(uint16_t sequenceId) {
  // Send acknowledgment back to coordinator
  if (sequenceId == 0) {
    // No ACK required for this command
    return;
  }

  Message ackMsg;
  ackMsg.messageType = 4; // command_ack
  ackMsg.deviceId = DEVICE_ID;
  ackMsg.timestamp = millis();
  memset(ackMsg.data, 0, sizeof(ackMsg.data));
  ackMsg.data[0] = sequenceId; // Store sequence ID in data[0]

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&ackMsg, sizeof(ackMsg));
  Serial.printf("[ACK] Sent ACK for seq=%d, result: %s\n", sequenceId,
                result == ESP_OK ? "SUCCESS" : "FAILED");
}

void handleCommand(Command cmd) {
  Serial.printf("[CMD] Device %d received command: %d for target: %d, seq: %d\n",
                DEVICE_ID, cmd.command, cmd.targetDevice, cmd.sequenceId);

  // Cancel any pending battery mode activation on game command
  batteryModeActivationPending = false;
  buttonPressActive = false;

  // Exit battery mode immediately if currently active
  if (currentState == STATE_BATTERY_DISPLAY) {
    exitBatteryMode();
  }

  // Send acknowledgment first (for critical commands)
  sendCommandAck(cmd.sequenceId);

  switch (cmd.command) {
    case 1: // ARM
      Serial.printf("[CMD] Device %d executing ARM command\n", DEVICE_ID);
      armBuzzer();
      break;

    case 2: // DISARM
      Serial.printf("[CMD] Device %d executing DISARM command\n", DEVICE_ID);
      disarmBuzzer();
      break;

    case 3: // TEST
      Serial.printf("[CMD] Device %d executing TEST command\n", DEVICE_ID);
      testBuzzer();
      break;

    case 4: // RESET
      Serial.printf("[CMD] Device %d executing RESET command\n", DEVICE_ID);
      resetBuzzer();
      break;

    case 5: // CORRECT_ANSWER
      Serial.printf("[CMD] Device %d executing CORRECT_ANSWER command\n", DEVICE_ID);
      correctAnswerFeedback();
      break;

    case 6: // WRONG_ANSWER
      Serial.printf("[CMD] Device %d executing WRONG_ANSWER command\n", DEVICE_ID);
      wrongAnswerFeedback();
      break;

    case 7: // END_ROUND (return to armed state)
      Serial.printf("[CMD] Device %d executing END_ROUND command\n", DEVICE_ID);
      endRoundReset();
      break;

    default:
      Serial.printf("[CMD] Device %d received unknown command: %d\n", DEVICE_ID, cmd.command);
      break;
  }

  // Send status update after handling command
  sendStatusUpdate();
}

void armBuzzer() {
  // Don't arm buzzers that are in wrong answer state - they should stay red until round ends
  if (currentState == STATE_WRONG_ANSWER) {
    Serial.println("Buzzer in wrong answer state - ignoring ARM command until round ends");
    return;
  }

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

  // Don't override wrong answer state - keep buzzers that answered wrong in red state until round ends
  if (currentState != STATE_WRONG_ANSWER) {
    currentState = STATE_DISARMED;
  }

  digitalWrite(BUZZER_PIN, LOW);

  Serial.printf("Buzzer DISARMED - Device %d preserving state %d\n", DEVICE_ID, currentState);
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
  correctAnswerStartTime = millis(); // Start 2-second green decay timer

  // Play correct answer tone
  playCorrectAnswerTone();
}

void wrongAnswerFeedback() {
  Serial.printf("[WRONG_ANSWER] Device %d receiving wrong answer feedback - switching to red state\n", DEVICE_ID);
  currentState = STATE_WRONG_ANSWER;
  isArmed = false; // Disarm the buzzer when wrong answer is received
  buzzerPressed = false; // Reset buzzer press state
  waitingForAnswerFeedback = false; // Clear timeout

  // Force immediate LED update to red
  setAllLeds(COLOR_WRONG_ANSWER);

  Serial.printf("[WRONG_ANSWER] Device %d red LEDs should now be visible\n", DEVICE_ID);

  // Play wrong answer tone
  playWrongAnswerTone();
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
  // Positive ascending buzz-in sound when buzzer is pressed
  int melody[] = {440, 550, 660}; // A4, C#5, E5 (ascending, pleasant)
  int noteDurations[] = {100, 100, 200}; // Quick-quick-longer

  for (int i = 0; i < 3; i++) {
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

void playCorrectAnswerTone() {
  // Triumphant ascending tone for correct answer
  int melody[] = {523, 659, 784, 1047}; // C5, E5, G5, C6 (major chord progression)
  int noteDurations[] = {150, 150, 150, 400}; // Building to triumphant finish

  for (int i = 0; i < 4; i++) {
    // Generate PWM tone
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(30); // Brief pause between notes
  }
}

void playWrongAnswerTone() {
  // Descending sad tone for wrong answer
  int melody[] = {392, 330, 294}; // G4, E4, D4 (descending, minor)
  int noteDurations[] = {200, 200, 400}; // Slower, more somber

  for (int i = 0; i < 3; i++) {
    // Generate PWM tone
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(50); // Pause between notes
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

// Battery monitoring functions
float readBatteryVoltage() {
  // Take multiple readings for stability
  uint32_t adcSum = 0;
  const int numReadings = 10;

  for (int i = 0; i < numReadings; i++) {
    adcSum += analogRead(BATTERY_ADC_PIN);
    delay(10);
  }

  uint32_t adcAverage = adcSum / numReadings;

  // Convert ADC reading to voltage
  float adcVoltage = (float)adcAverage / ADC_RESOLUTION * ADC_REFERENCE_VOLTAGE;

  // Account for voltage divider
  float batteryVoltage = adcVoltage * BATTERY_VOLTAGE_DIVIDER;

  // Debug output (only occasionally to avoid spam)
  static unsigned long lastDebugPrint = 0;
  if (millis() - lastDebugPrint > 10000) { // Print every 10 seconds
    Serial.printf("[BATTERY] ADC raw: %lu, ADC voltage: %.2fV, Battery voltage: %.2fV\n",
                  adcAverage, adcVoltage, batteryVoltage);
    lastDebugPrint = millis();
  }

  return batteryVoltage;
}

uint8_t voltageToPercentage(float voltage) {
  // LiPo discharge curve approximation
  if (voltage >= BATTERY_MAX_VOLTAGE) return 100;
  if (voltage <= BATTERY_MIN_VOLTAGE) return 0;

  // Linear approximation for simplicity
  float percentage = ((voltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)) * 100.0;
  return constrain((uint8_t)percentage, 0, 100);
}

void updateBatteryCheckInterval() {
  // Dynamic interval based on battery level
  if (batteryPercentage > 50) {
    batteryCheckInterval = 60000; // 60 seconds - preserve battery
  } else if (batteryPercentage > 20) {
    batteryCheckInterval = 30000; // 30 seconds - balanced monitoring
  } else if (batteryPercentage > 10) {
    batteryCheckInterval = 15000; // 15 seconds - frequent monitoring
  } else {
    batteryCheckInterval = 10000; // 10 seconds - critical monitoring
  }
}

void checkBatteryLevel() {
  unsigned long currentTime = millis();

  if (currentTime - lastBatteryCheck >= batteryCheckInterval) {
    batteryVoltage = readBatteryVoltage();
    batteryPercentage = voltageToPercentage(batteryVoltage);

    updateBatteryCheckInterval();
    lastBatteryCheck = currentTime;

    Serial.printf("Battery: %.2fV (%d%%) - Next check in %lus\n",
                  batteryVoltage, batteryPercentage, batteryCheckInterval / 1000);
  }
}

void sendHeartbeat() {
  // Update battery reading before sending heartbeat for real-time monitoring
  batteryVoltage = readBatteryVoltage();
  batteryPercentage = voltageToPercentage(batteryVoltage);

  Message msg;
  msg.messageType = 2; // heartbeat
  msg.deviceId = DEVICE_ID;
  msg.timestamp = millis();
  msg.data[0] = isArmed ? 1 : 0;
  msg.data[1] = buzzerPressed ? 1 : 0;

  // Add battery data to heartbeat
  msg.data[2] = batteryPercentage;  // Battery percentage (0-100)

  // Send battery voltage as two bytes (voltage * 100 to preserve 2 decimal places)
  uint16_t voltageInt = (uint16_t)(batteryVoltage * 100);
  msg.data[3] = voltageInt & 0xFF;        // Low byte
  msg.data[4] = (voltageInt >> 8) & 0xFF; // High byte

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  Serial.printf("Heartbeat sent to coordinator - Result: %s (Battery: %.2fV, %d%%)\n",
                result == ESP_OK ? "SUCCESS" : "FAILED", batteryVoltage, batteryPercentage);

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

  // Add battery data to status update
  msg.data[3] = batteryPercentage;  // Battery percentage (0-100)

  // Send battery voltage as two bytes (voltage * 100 to preserve 2 decimal places)
  uint16_t voltageInt = (uint16_t)(batteryVoltage * 100);
  msg.data[4] = voltageInt & 0xFF;        // Low byte
  msg.data[5] = (voltageInt >> 8) & 0xFF; // High byte

  esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));

  Serial.print("Status - Armed: ");
  Serial.print(isArmed);
  Serial.print(" Pressed: ");
  Serial.print(buzzerPressed);
  Serial.print(" RGB Active: ");
  Serial.println((leds[0].r > 0 || leds[0].g > 0 || leds[0].b > 0) ? "Yes" : "No");
}

// Battery Display Mode Functions

void playBatteryModeEntryAnimation() {
  Serial.println("[BATTERY] Playing entry animation with sweep tune");

  // Synchronized LED sweep + audio sweep
  int startFreq = 800;
  int endFreq = 1500;
  int stepDuration = 8; // milliseconds per step

  for (int i = 0; i < NUM_LEDS; i++) {
    // LED animation - progressive blue fill
    fill_solid(leds, i + 1, CRGB::Blue);
    FastLED.show();

    // Synchronized audio sweep
    int freq = startFreq + (i * (endFreq - startFreq) / NUM_LEDS);
    tone(BUZZER_PIN, freq, stepDuration);

    delay(stepDuration);
  }

  noTone(BUZZER_PIN);
  Serial.println("[BATTERY] Entry animation complete");

  // Small pause before showing ID
  delay(200);

  // Display buzzer ID first
  displayBuzzerID();

  // Mark ID as displayed
  idDisplayShown = true;

  // Pause between ID and battery display
  delay(500);
  Serial.println("[BATTERY] Switching to battery level display");
}

void displayBatteryLevel() {
  // If ID hasn't been shown yet, don't display battery (ID is shown in entry animation)
  if (!idDisplayShown) {
    return;
  }

  // Read current battery level
  readBatteryVoltage();

  // Calculate number of LEDs to light up (0-23)
  uint8_t ledCount = (batteryPercentage * NUM_LEDS) / 100;
  if (ledCount > NUM_LEDS) ledCount = NUM_LEDS;

  // Clear all LEDs first
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Determine single color based on battery percentage
  CRGB batteryColor;
  if (batteryPercentage < 26) {
    // 0-25%: Red (Critical)
    batteryColor = CRGB::Red;
  } else if (batteryPercentage < 52) {
    // 26-51%: Orange (Low)
    batteryColor = CRGB::Orange;
  } else if (batteryPercentage < 78) {
    // 52-77%: Yellow (Medium)
    batteryColor = CRGB::Yellow;
  } else {
    // 78-100%: Green (Good)
    batteryColor = CRGB::Green;
  }

  // Fill the calculated number of LEDs with the single battery color
  for (int i = 0; i < ledCount; i++) {
    leds[i] = batteryColor;
  }

  // Add gentle pulsing effect if battery is critical (< 26%)
  if (batteryPercentage < 26) {
    static unsigned long lastPulse = 0;
    static bool pulseBright = true;

    if (millis() - lastPulse > 500) { // Pulse every 500ms
      pulseBright = !pulseBright;
      lastPulse = millis();
    }

    // Apply brightness scaling to LEDs for pulsing effect
    if (!pulseBright) {
      for (int i = 0; i < ledCount; i++) {
        leds[i].nscale8(100);  // Dim to ~40% brightness
      }
    }
  }

  FastLED.show();
}

void exitBatteryMode() {
  Serial.println("[BATTERY] Exiting battery display mode");

  // Reset button press states
  buttonPressActive = false;
  batteryModeActivationPending = false;
  idDisplayShown = false;  // Reset ID display flag

  // Return to appropriate state
  if (isArmed) {
    currentState = STATE_ARMED;
  } else {
    currentState = STATE_DISARMED;
  }

  // Clear LEDs immediately
  setAllLeds(COLOR_OFF);
}

// Buzzer ID Display Functions

void displayBuzzerID() {
  Serial.printf("[ID] Displaying buzzer ID: %d\n", DEVICE_ID);

  uint8_t id = DEVICE_ID;
  uint8_t fullGroups = id / 5;      // Number of complete groups of 5
  uint8_t remainder = id % 5;       // Remaining individual LEDs

  Serial.printf("[ID] Groups of 5: %d, Remainder: %d\n", fullGroups, remainder);

  // Clear all LEDs
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Light up complete groups of 5
  for (int group = 0; group < fullGroups; group++) {
    int startLED = group * 7;  // 5 LEDs + 2 gap = 7 positions per group
    for (int i = 0; i < 5; i++) {
      if (startLED + i < NUM_LEDS) {  // Safety check
        leds[startLED + i] = CRGB::White;
      }
    }
  }

  // Light up remaining individual LEDs in next group
  if (remainder > 0) {
    int startLED = fullGroups * 7;
    for (int i = 0; i < remainder; i++) {
      if (startLED + i < NUM_LEDS) {  // Safety check
        leds[startLED + i] = CRGB::White;
      }
    }
  }

  FastLED.show();

  // Play audio pattern
  playIDAudio(fullGroups, remainder);
}

void playIDAudio(uint8_t dashes, uint8_t dots) {
  Serial.printf("[ID] Playing audio: %d dashes, %d dots\n", dashes, dots);

  // Play dashes (groups of 5)
  for (int i = 0; i < dashes; i++) {
    Serial.printf("[ID] Playing dash %d\n", i + 1);
    tone(BUZZER_PIN, 800, 400);  // Long tone - 800Hz for 400ms
    delay(400);
    noTone(BUZZER_PIN);
    delay(200);  // Gap between dashes
  }

  // Extra pause between groups and individuals if both exist
  if (dashes > 0 && dots > 0) {
    delay(200);
    Serial.println("[ID] Group separator pause");
  }

  // Play dots (individuals)
  for (int i = 0; i < dots; i++) {
    Serial.printf("[ID] Playing dot %d\n", i + 1);
    tone(BUZZER_PIN, 1200, 100);  // Short tone - 1200Hz for 100ms
    delay(100);
    noTone(BUZZER_PIN);
    delay(200);  // Gap between dots
  }

  noTone(BUZZER_PIN);
  Serial.println("[ID] Audio pattern complete");
}