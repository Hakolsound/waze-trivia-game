#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <FastLED.h>

// Pre-define Command struct for forward declarations
typedef struct {
  uint8_t command;      // 1=arm, 2=disarm, 3=test, 4=reset, 5=correct_answer, 6=wrong_answer, 7=end_round, 8=change_channel
  uint8_t targetDevice; // 0=all, or specific device ID (for channel change: channel number)
  uint32_t timestamp;
  uint16_t sequenceId;  // For tracking acknowledgments
  uint8_t retryCount;   // Retry attempt counter
  uint8_t reserved;     // Padding to maintain alignment
} Command;

// Forward declarations for functions used before definition
void updateLedState();
void sendBuzzerPressWithRetry();
bool validateCommandForState(Command cmd);
void handleCommand(Command cmd);

// Hardware Configuration - MOVED TO BOTTOM FOR BETTER ORGANIZATION
// See consolidated constants below

// WS2812B LED Array - MOVED HERE after NUM_LEDS definition

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

// State validation and consistency functions - MOVED AFTER GLOBAL VARIABLES

// setWifiChannel and forceStateRecovery moved after global variables

// Color definitions
#define COLOR_OFF CRGB::Black
#define COLOR_ARMED CRGB::Blue
#define COLOR_ANSWERING_NOW CRGB::White
#define COLOR_CORRECT_ANSWER CRGB::Green
#define COLOR_WRONG_ANSWER CRGB::Red
#define COLOR_TEST CRGB::Yellow
#define COLOR_ERROR CRGB::Red
#define COLOR_STARTUP CRGB::Purple

// State management
bool isArmed = false;
bool buzzerPressed = false;
BuzzerState currentState = STATE_DISARMED;
BuzzerState previousState = STATE_DISARMED; // Track previous state for recovery
BuzzerState lastLedState = STATE_DISARMED; // Track last LED update state
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

// Buzzer press ACK tracking
bool waitingForPressAck = false;
unsigned long pressAckTimeout = 0;
uint8_t pressRetryCount = 0;
#define PRESS_ACK_TIMEOUT_MS 300  // Increased from 100ms to 300ms for reliability in crowded environments
#define MAX_PRESS_RETRIES 5       // Increased from 3 to 5 retries

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
BuzzerState stateBeforeBatteryMode = STATE_DISARMED; // Track state before battery mode
// Keep old constants for backward compatibility but mark as deprecated
#define BATTERY_MODE_TIMEOUT 10000  // 10 seconds display timeout (for ID + battery display) - DEPRECATED
#define BUTTON_HOLD_THRESHOLD 3000  // 3 seconds to activate battery mode - DEPRECATED

// Correct answer LED display timer (2 second decay)
unsigned long correctAnswerStartTime = 0;
#define CORRECT_ANSWER_DURATION 3000  // 2 seconds

// Timing Configuration for non-blocking operations
#define LOOP_DELAY_MS 10
#define BUTTON_DEBOUNCE_MS 50
#define LED_UPDATE_INTERVAL_MS 50
#define BATTERY_CHECK_INTERVAL_MS 60000
#define HEARTBEAT_INTERVAL_MS 5000
#define STATE_CHECK_INTERVAL_MS 1000
#define BATTERY_MODE_TIMEOUT_MS 10000
#define BATTERY_MODE_HOLD_THRESHOLD_MS 3000
#define ANSWER_FEEDBACK_TIMEOUT_MS 30000
#define PRESS_ACK_TIMEOUT_MS 300
#define MAX_PRESS_RETRIES 5

// Power and hardware configuration
#define WIFI_TX_POWER_RAW 84  // Raw value for ESP32 (21 dBm)
#define ADC_ATTENUATION ADC_11db  // 0-3.6V range for battery monitoring
#define FASTLED_CORRECTION TypicalLEDStrip

// LED configuration
#define LED_BRIGHTNESS 128
#define NUM_LEDS 23
#define LED_DATA_PIN 4
#define LED_TYPE WS2812B
#define LED_COLOR_ORDER GRB

// WS2812B LED Array
CRGB leds[NUM_LEDS];

// Device configuration
#define DEVICE_ID 6  // Change this for each group buzzer (1, 2, 3, etc.)
#define MAX_GROUPS 15
// Previous coordinator MAC address (backup)
// #define COORDINATOR_MAC {0x78, 0xE3, 0x6D, 0x1B, 0x13, 0x28}

// New coordinator MAC address
#define COORDINATOR_MAC {0xB0, 0xB2, 0x1C, 0x45, 0x85, 0x1C}
uint8_t coordinatorMAC[] = COORDINATOR_MAC; // Global coordinator MAC array

// Battery configuration
#define BATTERY_ADC_PIN 34
#define BATTERY_VOLTAGE_DIVIDER 2.0
#define BATTERY_MIN_VOLTAGE 3.0
#define BATTERY_MAX_VOLTAGE 4.2
#define ADC_RESOLUTION 4095
#define ADC_REFERENCE_VOLTAGE 3.3
#define BATTERY_CALIBRATION_FACTOR 1.098

// Safe timing functions to prevent millis() overflow
inline bool isTimeElapsed(unsigned long startTime, unsigned long interval) {
  unsigned long currentTime = millis();
  return (currentTime - startTime) >= interval;
}

inline unsigned long getTimeSince(unsigned long startTime) {
  return millis() - startTime;
}

// =========================================
// HARDWARE CONFIGURATION CONSTANTS
// =========================================
#define BUZZER_PIN 2
#define LED_PIN 4
#define BUZZER_BUTTON_PIN 5

// WiFi Channel Configuration
uint8_t currentWifiChannel = 13; // Default channel (must match coordinator default)

// Message structure for ESP-NOW communication
typedef struct {
  uint8_t messageType;  // 1=buzzer_press, 2=heartbeat, 3=status_update, 4=command_ack
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];      // Additional data if needed, data[0] = sequenceId for ACK
} Message;

// Command struct moved to top of file

// State validation and consistency functions
void setBuzzerState(BuzzerState newState) {
  if (currentState != newState) {
    previousState = currentState;
    currentState = newState;
    Serial.printf("[STATE] Device %d: %d -> %d\n", DEVICE_ID, previousState, currentState);

    // Force immediate LED update for critical state changes
    if (newState == STATE_ANSWERING_NOW || newState == STATE_CORRECT_ANSWER ||
        newState == STATE_WRONG_ANSWER) {
      updateLedState();
      lastRgbUpdate = millis(); // Prevent immediate re-update in loop
      lastLedState = newState; // Update tracking state
    }
  }
}

bool validateStateConsistency() {
  bool isConsistent = true;

  // Check for inconsistent state combinations
  if (currentState == STATE_ARMED && !isArmed) {
    Serial.printf("[STATE ERROR] Device %d: ARMED state but isArmed=false - fixing\n", DEVICE_ID);
    isArmed = true;
    isConsistent = false;
  }

  if ((currentState == STATE_ANSWERING_NOW || currentState == STATE_CORRECT_ANSWER ||
       currentState == STATE_WRONG_ANSWER) && !buzzerPressed) {
    Serial.printf("[STATE ERROR] Device %d: Answer state but buzzerPressed=false - fixing\n", DEVICE_ID);
    buzzerPressed = true;
    isConsistent = false;
  }

  if (currentState == STATE_DISARMED && isArmed) {
    Serial.printf("[STATE WARNING] Device %d: DISARMED state but isArmed=true - checking context\n", DEVICE_ID);
    // This is OK if we're in wrong answer state after disarm
    if (previousState != STATE_WRONG_ANSWER) {
      Serial.printf("[STATE ERROR] Device %d: DISARMED but isArmed=true - fixing\n", DEVICE_ID);
      isArmed = false;
      isConsistent = false;
    }
  }

  return isConsistent;
}

// Forward declarations moved to top of file

bool setWifiChannel(uint8_t channel) {
  // Validate channel range
  if (channel < 1 || channel > 13) {
    Serial.printf("[CHANNEL] ERROR: Invalid channel %d - must be 1-13\n", channel);
    return false;
  }

  // Always attempt to set the channel - don't trust the cached value
  // ESP-NOW initialization may have reset the channel
  Serial.printf("[CHANNEL] Setting channel to %d (was cached as %d)\n", channel, currentWifiChannel);

  esp_err_t result = esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  if (result != ESP_OK) {
    Serial.printf("[CHANNEL] ERROR: Failed to set channel %d (ESP error %d)\n", channel, result);
    return false;
  }

  currentWifiChannel = channel;
  Serial.printf("[CHANNEL] SUCCESS: Channel set to %d\n", channel);

  return true;
}

void forceStateRecovery() {
  Serial.printf("[STATE RECOVERY] Device %d starting state recovery\n", DEVICE_ID);

  // Clear all pending operations
  waitingForPressAck = false;
  waitingForAnswerFeedback = false;
  pressRetryCount = 0;
  batteryModeActivationPending = false;
  buttonPressActive = false;

  // Determine appropriate recovery state
  if (isArmed && !buzzerPressed) {
    setBuzzerState(STATE_ARMED);
  } else if (isArmed && buzzerPressed) {
    setBuzzerState(STATE_ANSWERING_NOW);
    waitingForAnswerFeedback = true;
    answerFeedbackTimeout = millis() + 30000;
  } else {
    setBuzzerState(STATE_DISARMED);
  }

  Serial.printf("[STATE RECOVERY] Device %d recovered to state %d\n", DEVICE_ID, currentState);
}

bool validateCommandForState(Command cmd) {
  // Command validation based on current state to prevent invalid transitions
  bool isValid = false;
  switch (cmd.command) {
    case 1: // ARM
      // Can arm from disarmed or wrong answer states
      isValid = (currentState == STATE_DISARMED || currentState == STATE_WRONG_ANSWER);
      break;

    case 2: // DISARM
      // Can disarm from any state - DISARM should always work to reset buzzers
      isValid = true;
      break;

    case 3: // TEST
      // Can test from any state
      isValid = true;
      break;

    case 4: // RESET
      // Can reset from any state
      isValid = true;
      break;

        case 5: // CORRECT_ANSWER
          // Can be in answering state, disarmed, or already correct (allow multiple correct commands)
          isValid = (currentState == STATE_ANSWERING_NOW || currentState == STATE_DISARMED || currentState == STATE_CORRECT_ANSWER);
          break;

        case 6: // WRONG_ANSWER
          // Can be in answering state, disarmed, or already wrong (allow multiple wrong commands)
          isValid = (currentState == STATE_ANSWERING_NOW || currentState == STATE_DISARMED || currentState == STATE_WRONG_ANSWER);
          break;

    case 7: // END_ROUND
      // Can end round from any state
      isValid = true;
      break;

    case 8: // CHANGE_CHANNEL
      // Can change channel from any state
      isValid = true;
      break;

    default:
      isValid = false;
      break;
  }

  // Debug logging for command validation
  if (!isValid) {
    Serial.printf("[CMD VALIDATION] Command %d rejected for device %d in state %d (armed: %d)\n", cmd.command, DEVICE_ID, currentState, isArmed);
  } else {
    Serial.printf("[CMD VALIDATION] Command %d accepted for device %d in state %d\n", cmd.command, DEVICE_ID, currentState);
  }

  return isValid;
}

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

  // Distinguish between Message (16 bytes) and Command (12 bytes) by length
  // Message: 1 (type) + 1 (deviceId) + 4 (timestamp) + 8 (data) + 2 (padding) = 16 bytes
  // Command: 1 (command) + 1 (target) + 4 (timestamp) + 2 (seq) + 1 (retry) + 1 (reserved) = 12 bytes

  if (len == 16) {
    // This is a Message (press ACK, END_ROUND, etc.)
    uint8_t messageType = incomingData[0];

    if (messageType == 5) {
      // This is a buzzer press ACK message
      // Protect against duplicate ACKs
      if (!waitingForPressAck && currentState == STATE_ANSWERING_NOW) {
        Serial.println("[PRESS] Ignoring duplicate ACK - already in ANSWERING_NOW state");
        return;
      }

      Serial.println("[PRESS] ACK received from coordinator - press confirmed!");
      waitingForPressAck = false;
      pressRetryCount = 0;

      // NOW change state to PRESSED (white flashing) - press is confirmed registered
      buzzerPressed = true;
      setBuzzerState(STATE_ANSWERING_NOW);
      // Note: LED update is handled automatically by setBuzzerState()

      // Start waiting for answer feedback with 30 second timeout
      waitingForAnswerFeedback = true;
      answerFeedbackTimeout = millis() + 30000;

      Serial.println("[PRESS] State changed to ANSWERING_NOW (white) - press confirmed on server");
      return;
    }

    if (messageType == 8) {
      // This is an END_ROUND ACK request - coordinator wants confirmation we reset
      Serial.println("[END_ROUND] ACK request received - sending confirmation");
      Message ackMsg;
      ackMsg.messageType = 8; // END_ROUND_ACK
      ackMsg.deviceId = DEVICE_ID;
      ackMsg.timestamp = millis();
      memset(ackMsg.data, 0, sizeof(ackMsg.data));
      esp_now_send(coordinatorMAC, (uint8_t*)&ackMsg, sizeof(ackMsg));
      return;
    }

    Serial.printf("[WARN] Unknown Message type: %d\n", messageType);
    return;
  }

  if (len == 12) {
    // This is a Command
    Command cmd;
    memcpy(&cmd, incomingData, sizeof(cmd));

    Serial.printf("Command data: cmd=%d, target=%d, timestamp=%lu\n",
                  cmd.command, cmd.targetDevice, cmd.timestamp);

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             recv_info->src_addr[0], recv_info->src_addr[1], recv_info->src_addr[2],
             recv_info->src_addr[3], recv_info->src_addr[4], recv_info->src_addr[5]);

    Serial.printf("Received %d bytes from %s\n", len, macStr);

    Serial.printf("[BUZZER] Received command: type=%d, target=%d, my_id=%d\n", cmd.command, cmd.targetDevice, DEVICE_ID);

    // Accept commands for broadcast (0) or specific device ID match
    if (cmd.targetDevice == 0 || cmd.targetDevice == DEVICE_ID) {
      Serial.printf("[BUZZER] Command accepted - processing (current state: %d, armed: %d)\n", currentState, isArmed);
      handleCommand(cmd);
    } else {
      Serial.printf("[BUZZER] Command rejected - target %d != my_id %d\n", cmd.targetDevice, DEVICE_ID);
    }
    return;
  }

  // Unknown length
  Serial.printf("[ERROR] Received unknown message length: %d bytes\n", len);
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
  analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_ATTENUATION); // Set pin-specific attenuation for 0-3.6V range

  // Test ADC immediately after configuration
  delay(100);
  uint32_t testADC = analogRead(BATTERY_ADC_PIN);
  Serial.print("ADC Test immediately after setup - Raw: ");
  Serial.print(testADC);
  Serial.print(", Voltage: ");
  Serial.println((float)testADC / ADC_RESOLUTION * ADC_REFERENCE_VOLTAGE);

  // Initialize FastLED
  FastLED.addLeds<LED_TYPE, LED_DATA_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS).setCorrection(FASTLED_CORRECTION);
  FastLED.setBrightness(LED_BRIGHTNESS);

  // Initial LED state
  setAllLeds(COLOR_OFF);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("Hardware pins initialized");
  
  // Initialize WiFi in station mode
  WiFi.mode(WIFI_STA);
  Serial.println("WiFi set to Station mode");

  // Set maximum TX power for better range in crowded environments
  esp_wifi_set_max_tx_power(WIFI_TX_POWER_RAW);
  Serial.printf("WiFi TX power set to %d (21 dBm)\n", WIFI_TX_POWER_RAW);

  // Wait for WiFi to initialize and get MAC
  delay(500);

  // Print MAC address for coordinator registration
  char macAddress[18];
  WiFi.macAddress().toCharArray(macAddress, sizeof(macAddress));
  Serial.print("Group Buzzer #");
  Serial.print(DEVICE_ID);
  Serial.print(" MAC Address: ");
  Serial.println(macAddress);

  // Verify MAC is valid
  if (strcmp(macAddress, "00:00:00:00:00:00") == 0) {
    Serial.println("WARNING: Invalid MAC address detected!");
    // Try restarting WiFi
    WiFi.disconnect();
    delay(100);
    WiFi.mode(WIFI_STA);
    delay(500);
    WiFi.macAddress().toCharArray(macAddress, sizeof(macAddress));
    Serial.print("Retry MAC: ");
    Serial.println(macAddress);
  }

  // Initialize ESP-NOW FIRST
  Serial.println("Initializing ESP-NOW...");
  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: Failed to initialize ESP-NOW");
    return;
  }
  Serial.println("ESP-NOW initialized successfully");

  // Register callbacks
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);
  Serial.println("ESP-NOW callbacks registered");

  // Set channel BEFORE adding peer
  Serial.printf("Setting WiFi channel to %d BEFORE adding peer\n", currentWifiChannel);
  if (!setWifiChannel(currentWifiChannel)) {
    Serial.printf("WARNING: Failed to set channel to %d before adding peer!\n", currentWifiChannel);
  }

  // Add coordinator as peer with explicit channel
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo)); // Clear the structure
  uint8_t coordMAC[] = COORDINATOR_MAC; // Use constant
  memcpy(peerInfo.peer_addr, coordMAC, 6);
  peerInfo.channel = currentWifiChannel; // Explicitly set peer channel
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

  // Print WiFi channel info to verify
  uint8_t primaryChan;
  wifi_second_chan_t secondChan;
  esp_wifi_get_channel(&primaryChan, &secondChan);
  Serial.print("WiFi Channel (final check): ");
  Serial.println(primaryChan);

  // Verify channel was set correctly
  if (primaryChan != currentWifiChannel) {
    Serial.printf("ERROR: Channel verification failed! Expected %d, got %d\n", currentWifiChannel, primaryChan);
    Serial.println("This will prevent communication with coordinator!");
  } else {
    Serial.printf("Channel verification successful: %d\n", primaryChan);
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
  // Solid red for wrong answer - stays red until end of round
  setAllLeds(COLOR_WRONG_ANSWER);
}

void updateLedState() {
  // Only update LEDs if state has changed
  if (currentState != lastLedState) {
    switch (currentState) {
      case STATE_DISARMED:
        setAllLeds(COLOR_OFF);
        break;

      case STATE_ARMED:
        setAllLeds(COLOR_ARMED);
        break;

      case STATE_ANSWERING_NOW:
        setAllLeds(COLOR_ANSWERING_NOW);
        break;

      case STATE_CORRECT_ANSWER:
        setAllLeds(COLOR_CORRECT_ANSWER);
        break;

      case STATE_WRONG_ANSWER:
        setAllLeds(COLOR_WRONG_ANSWER);
        break;

      case STATE_TEST:
        setAllLeds(COLOR_TEST);
        break;

      case STATE_BATTERY_DISPLAY:
        displayBatteryLevel();
        break;
    }

    // Only call FastLED.show() when state changes
    FastLED.show();
    lastLedState = currentState;
  } else {
    // Handle animated effects that need continuous updates
    switch (currentState) {
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
    }
  }
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check button state (debounced)
  if (currentTime - lastButtonCheck > BUTTON_DEBOUNCE_MS) {
    checkBuzzerButton();
    lastButtonCheck = currentTime;
  }

  // Handle battery mode activation
  if (batteryModeActivationPending && currentState != STATE_ARMED) {
    stateBeforeBatteryMode = currentState; // Save current state for restoration
    setBuzzerState(STATE_BATTERY_DISPLAY);
    idDisplayShown = false;  // Reset ID display flag
    playBatteryModeEntryAnimation();
    batteryModeActivationPending = false;
    batteryDisplayStartTime = currentTime;
    Serial.printf("[BATTERY] Battery display mode activated (was in state %d)\n", stateBeforeBatteryMode);
  }

  // Handle battery mode timeout
  if (currentState == STATE_BATTERY_DISPLAY &&
      (currentTime - batteryDisplayStartTime > BATTERY_MODE_TIMEOUT_MS)) {
    exitBatteryMode();
    Serial.println("[BATTERY] Battery display mode timeout - exiting");
  }

  // Handle buzzer press ACK timeout and retry
  if (waitingForPressAck && currentTime > pressAckTimeout) {
    pressRetryCount++;
    if (pressRetryCount < MAX_PRESS_RETRIES) {
      Serial.printf("[PRESS] ACK timeout, retrying (%d/%d)\n", pressRetryCount + 1, MAX_PRESS_RETRIES);
      sendBuzzerPressWithRetry();
    } else {
      Serial.println("[PRESS] ACK timeout after max retries, giving up");
      waitingForPressAck = false;
      pressRetryCount = 0;
    }
  }

  // Handle answer feedback timeout (fallback for older coordinator)
  if (waitingForAnswerFeedback && currentTime > answerFeedbackTimeout) {
    waitingForAnswerFeedback = false;
    Serial.printf("[TIMEOUT] Answer feedback timeout after 30s - should have received CORRECT_ANSWER or WRONG_ANSWER command!\n");

    // Don't override wrong answer state - keep buzzers that answered wrong in red state until round ends
    if (currentState != STATE_WRONG_ANSWER) {
      if (isArmed) {
        setBuzzerState(STATE_ARMED); // Return to armed state if no feedback received
        Serial.printf("[TIMEOUT] Device %d returning to ARMED state (no answer evaluation received)\n", DEVICE_ID);
      } else {
        setBuzzerState(STATE_DISARMED);
        Serial.printf("[TIMEOUT] Device %d going to DISARMED state (no answer evaluation received)\n", DEVICE_ID);
      }
    } else {
      Serial.printf("[TIMEOUT] Device %d staying in WRONG_ANSWER state\n", DEVICE_ID);
    }
  }

  // Periodic state consistency check
  static unsigned long lastStateCheck = 0;
  if (currentTime - lastStateCheck > STATE_CHECK_INTERVAL_MS) {
    validateStateConsistency();
    lastStateCheck = currentTime;
  }

  // Update LED state based on current game state
  if (currentTime - lastRgbUpdate > LED_UPDATE_INTERVAL_MS) {
    updateLedState();
    lastRgbUpdate = currentTime;
  }

  // Check battery level periodically
  checkBatteryLevel();

  // Send periodic heartbeat
  if (currentTime - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
    lastHeartbeat = currentTime;
  }

  // Small yield to prevent watchdog issues (non-blocking)
  yield();
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
  // DON'T change state yet - only change when ACK received
  // This allows player to press again if first attempt fails
  buzzerPressTime = millis();

  Serial.print("BUZZER PRESSED! Device: ");
  Serial.print(DEVICE_ID);
  Serial.print(" Time: ");
  Serial.println(buzzerPressTime);
  Serial.println("[PRESS] Staying in ARMED state until ACK - player can press again to help retry");

  // Send buzzer press message with ACK tracking
  sendBuzzerPressWithRetry();

  // Play buzzer sound to give feedback, but keep LED blue (armed)
  playBuzzerPattern();
}

void sendBuzzerPressWithRetry() {
  Message msg;
  msg.messageType = 1; // buzzer_press
  msg.deviceId = DEVICE_ID;
  msg.timestamp = buzzerPressTime;
  memset(msg.data, 0, sizeof(msg.data));

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));

  if (result == ESP_OK) {
    Serial.printf("[PRESS] Sent (attempt %d/%d)\n", pressRetryCount + 1, MAX_PRESS_RETRIES);
    waitingForPressAck = true;
    // Exponential backoff: base timeout + (retry_count * 50ms)
    uint32_t timeoutMs = PRESS_ACK_TIMEOUT_MS + (pressRetryCount * 50);
    pressAckTimeout = millis() + timeoutMs;
    Serial.printf("[PRESS] ACK timeout set to %dms\n", timeoutMs);
  } else {
    Serial.printf("[PRESS] Send FAILED (attempt %d/%d), error: %d\n", pressRetryCount + 1, MAX_PRESS_RETRIES, result);
    // Exponential backoff delay before retry
    pressRetryCount++;
    if (pressRetryCount < MAX_PRESS_RETRIES) {
      uint32_t delayMs = 50 + (pressRetryCount * 100); // 50ms, 150ms, 250ms, 350ms, 450ms
      Serial.printf("[PRESS] Retrying in %dms...\n", delayMs);
      delay(delayMs);
      sendBuzzerPressWithRetry();
    } else {
      Serial.println("[PRESS] Max retries reached, giving up");
      waitingForPressAck = false;
      pressRetryCount = 0;
    }
  }
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
  Serial.printf("[CMD] Device %d received command: %d for target: %d, seq: %d, current state: %d\n",
                DEVICE_ID, cmd.command, cmd.targetDevice, cmd.sequenceId, currentState);

  // Validate command based on current state
  if (!validateCommandForState(cmd)) {
    Serial.printf("[CMD] Command %d rejected - invalid for current state %d\n", cmd.command, currentState);
    // Still send ACK to prevent coordinator from retrying
    sendCommandAck(cmd.sequenceId);
    return;
  }

  Serial.printf("[CMD] Command %d validated and will be executed in state %d\n", cmd.command, currentState);

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
      Serial.printf("[CMD] Device %d executing CORRECT_ANSWER command - changing to GREEN state\n", DEVICE_ID);
      correctAnswerFeedback();
      Serial.printf("[CMD] CORRECT_ANSWER completed - buzzer should now be GREEN (state: %d)\n", currentState);
      // Force immediate LED update for correct answer
      updateLedState();
      Serial.printf("[CMD] Forced LED update for CORRECT_ANSWER\n");
      break;

    case 6: // WRONG_ANSWER
      Serial.printf("[CMD] Device %d executing WRONG_ANSWER command - changing to RED state\n", DEVICE_ID);
      wrongAnswerFeedback();
      Serial.printf("[CMD] WRONG_ANSWER completed - buzzer should now be RED (state: %d)\n", currentState);
      // Force immediate LED update for wrong answer
      updateLedState();
      Serial.printf("[CMD] Forced LED update for WRONG_ANSWER\n");
      break;

    case 7: // END_ROUND (return to armed state)
      Serial.printf("[CMD] Device %d executing END_ROUND command - resetting to DISARMED\n", DEVICE_ID);
      endRoundReset();
      Serial.printf("[CMD] END_ROUND completed - buzzer should now be BLACK (state: %d)\n", currentState);
      break;

    case 8: // CHANGE_CHANNEL
      Serial.printf("[CMD] Device %d executing CHANGE_CHANNEL command\n", DEVICE_ID);
      // For now, assume coordinator sends channel as targetDevice (limited to 1-15)
      // In future, could extend Command struct to include channel data
      setWifiChannel(cmd.targetDevice);
      break;

    default:
      Serial.printf("[CMD] Device %d received unknown command: %d\n", DEVICE_ID, cmd.command);
      break;
  }

  // Send status update after handling command
  sendStatusUpdate();
}

void armBuzzer() {
  // Force-reset if in wrong answer state (missed END_ROUND) - prevents stuck state
  if (currentState == STATE_WRONG_ANSWER) {
    Serial.println("[ARM] Buzzer in wrong answer state - forcing reset before arming (missed END_ROUND?)");
    endRoundReset(); // Force reset to clear wrong state
  }

  if (!isArmed) {
    isArmed = true;
    buzzerPressed = false;
    setBuzzerState(STATE_ARMED);
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

  // IMPORTANT: Don't clear buzzerPressed if we're in answer feedback states
  // The validation logic needs buzzerPressed=true to keep the answer states valid
  if (currentState != STATE_WRONG_ANSWER && currentState != STATE_CORRECT_ANSWER) {
    buzzerPressed = false;
    setBuzzerState(STATE_DISARMED);
  }
  // else: Keep buzzerPressed=true to maintain answer state validity

  digitalWrite(BUZZER_PIN, LOW);

  Serial.printf("Buzzer DISARMED - Device %d preserving state %d, buzzerPressed=%d\n", DEVICE_ID, currentState, buzzerPressed);
}

void testBuzzer() {
  Serial.println("Testing buzzer");

  BuzzerState previousState = currentState;
  setBuzzerState(STATE_TEST);

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
  setBuzzerState(STATE_DISARMED);

  digitalWrite(BUZZER_PIN, LOW);

  // Reset confirmation pattern
  startupSequence();
}

void correctAnswerFeedback() {
  Serial.println("Correct answer feedback");
  setBuzzerState(STATE_CORRECT_ANSWER);
  buzzerPressed = false; // Reset buzzer press state
  waitingForAnswerFeedback = false; // Clear timeout
  correctAnswerStartTime = millis(); // Start 2-second green decay timer

  // Play correct answer tone
  playCorrectAnswerTone();
}

void wrongAnswerFeedback() {
  Serial.printf("[WRONG_ANSWER] Device %d receiving wrong answer feedback - switching to red state\n", DEVICE_ID);
  setBuzzerState(STATE_WRONG_ANSWER);
  isArmed = false; // Disarm the buzzer when wrong answer is received
  buzzerPressed = false; // Reset buzzer press state
  waitingForAnswerFeedback = false; // Clear timeout

  // Note: LED update is handled automatically by setBuzzerState() for critical state changes
  Serial.printf("[WRONG_ANSWER] Device %d red LEDs should now be visible\n", DEVICE_ID);

  // Play wrong answer tone
  playWrongAnswerTone();
}

void endRoundReset() {
  Serial.println("[END_ROUND] Resetting buzzer state");

  // Clear all pending states
  buzzerPressed = false;
  waitingForAnswerFeedback = false;
  waitingForPressAck = false;
  pressRetryCount = 0;

  // Force state to disarmed regardless of previous state
  // This ensures wrong answer state is cleared even if buzzer wasn't armed
  isArmed = false;
  setBuzzerState(STATE_DISARMED);

  Serial.printf("[END_ROUND] Device %d reset to DISARMED (ready for next question)\n", DEVICE_ID);
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

  // Debug: Print each reading
  Serial.print("[BATTERY DEBUG] Individual ADC readings: ");
  for (int i = 0; i < numReadings; i++) {
    uint32_t reading = analogRead(BATTERY_ADC_PIN);
    Serial.print(reading);
    Serial.print(" ");
    adcSum += reading;
    delay(10);
  }
  Serial.println();

  uint32_t adcAverage = adcSum / numReadings;
  Serial.print("[BATTERY DEBUG] ADC average: ");
  Serial.println(adcAverage);

  // Convert ADC reading to voltage
  float adcVoltage = (float)adcAverage / ADC_RESOLUTION * ADC_REFERENCE_VOLTAGE;

  // Account for voltage divider
  float batteryVoltage = adcVoltage * BATTERY_VOLTAGE_DIVIDER;

  // Apply calibration factor to correct for resistor tolerances and ADC variations
  batteryVoltage *= BATTERY_CALIBRATION_FACTOR;

  // Debug output (only occasionally to avoid spam)
  static unsigned long lastDebugPrint = 0;
  if (millis() - lastDebugPrint > 10000) { // Print every 10 seconds
    Serial.printf("[BATTERY] ADC raw: %lu, ADC voltage: %.2fV, Battery voltage (calibrated): %.2fV\n",
                  adcAverage, adcVoltage, batteryVoltage);
    lastDebugPrint = millis();
  }

  return batteryVoltage;
}

uint8_t voltageToPercentage(float voltage) {
  // Detailed LiPo discharge curve for 1-2% precision
  // Based on typical single-cell LiPo discharge characteristics under moderate load
  // Format: {voltage, percentage}
  const float dischargeCurve[][2] = {
    {4.20, 100}, {4.19, 99}, {4.18, 98}, {4.17, 97}, {4.16, 96},
    {4.15, 95}, {4.14, 94}, {4.13, 93}, {4.12, 92}, {4.11, 91},
    {4.10, 90}, {4.09, 89}, {4.08, 88}, {4.07, 87}, {4.06, 86},
    {4.05, 85}, {4.04, 84}, {4.03, 83}, {4.02, 82}, {4.01, 81},
    {4.00, 80}, {3.99, 79}, {3.98, 78}, {3.97, 77}, {3.96, 76},
    {3.95, 75}, {3.94, 74}, {3.93, 73}, {3.92, 72}, {3.91, 71},
    {3.90, 70}, {3.89, 68}, {3.88, 66}, {3.87, 64}, {3.86, 62},
    {3.85, 60}, {3.84, 58}, {3.83, 56}, {3.82, 54}, {3.81, 52},
    {3.80, 50}, {3.79, 48}, {3.78, 46}, {3.77, 44}, {3.76, 42},
    {3.75, 40}, {3.74, 38}, {3.73, 36}, {3.72, 34}, {3.71, 32},
    {3.70, 30}, {3.69, 29}, {3.68, 28}, {3.67, 27}, {3.66, 26},
    {3.65, 25}, {3.64, 24}, {3.63, 23}, {3.62, 22}, {3.61, 21},
    {3.60, 20}, {3.58, 18}, {3.56, 16}, {3.54, 14}, {3.52, 12},
    {3.50, 10}, {3.45, 7}, {3.40, 4}, {3.30, 2}, {3.00, 0}
  };

  const int curveSize = sizeof(dischargeCurve) / sizeof(dischargeCurve[0]);

  // Handle edge cases
  if (voltage >= dischargeCurve[0][0]) return 100;
  if (voltage <= dischargeCurve[curveSize - 1][0]) return 0;

  // Linear interpolation between curve points
  for (int i = 0; i < curveSize - 1; i++) {
    if (voltage >= dischargeCurve[i + 1][0]) {
      float v1 = dischargeCurve[i][0];
      float v2 = dischargeCurve[i + 1][0];
      float p1 = dischargeCurve[i][1];
      float p2 = dischargeCurve[i + 1][1];

      // Linear interpolation between two points
      float percentage = p1 + (voltage - v1) * (p2 - p1) / (v2 - v1);
      return constrain((uint8_t)percentage, 0, 100);
    }
  }

  return 0;
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

  // Restore the state we were in before battery mode
  // But validate that it's still appropriate
  BuzzerState targetState = stateBeforeBatteryMode;

  // Validate the target state is still appropriate
  if (targetState == STATE_ARMED && !isArmed) {
    Serial.println("[BATTERY] Correcting state - was ARMED but no longer armed");
    targetState = STATE_DISARMED;
  } else if ((targetState == STATE_ANSWERING_NOW || targetState == STATE_CORRECT_ANSWER ||
              targetState == STATE_WRONG_ANSWER) && !buzzerPressed) {
    Serial.println("[BATTERY] Correcting state - was answer state but buzzer not pressed");
    targetState = isArmed ? STATE_ARMED : STATE_DISARMED;
  }

  setBuzzerState(targetState);
  Serial.printf("[BATTERY] Restored to state %d (was %d before battery mode)\n", currentState, stateBeforeBatteryMode);

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