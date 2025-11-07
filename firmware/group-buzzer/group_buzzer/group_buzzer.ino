#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <FastLED.h>
#include <Preferences.h>

// Command constants
#define CMD_ARM 1
#define CMD_DISARM 2
#define CMD_TEST 3
#define CMD_RESET 4
#define CMD_CORRECT_ANSWER 5
#define CMD_WRONG_ANSWER 6
#define CMD_END_ROUND 7
#define CMD_CHANGE_CHANNEL 8

// Pre-define structs for forward declarations
typedef struct {
  uint8_t command;
  uint8_t targetDevice;
  uint32_t timestamp;
  uint16_t sequenceId;
  uint8_t retryCount;
  uint8_t reserved;
} Command;

typedef struct {
  uint8_t messageType;
  uint8_t deviceId;
  uint32_t timestamp;
  uint8_t data[8];
} Message;

// Forward declarations
void updateLedState();
void sendBuzzerPressWithRetry();
bool validateCommandForState(Command cmd);
void handleCommand(Command cmd);
void sendChannelChangeAck();
void setBuzzerState(int newState);
void setWifiChannel(uint8_t channel);

// =========================================
// HARDWARE CONFIGURATION
// =========================================
#define BUZZER_PIN 2
#define LED_PIN 4
#define BUZZER_BUTTON_PIN 5
#define BATTERY_ADC_PIN 34
#define LED_DATA_PIN 4
#define NUM_LEDS 23

// =========================================
// NVS CONFIGURATION
// =========================================
Preferences preferences;
#define NVS_NAMESPACE "buzzer"
#define NVS_ID_KEY "device_id"
#define NVS_CHANNEL_KEY "wifi_channel"

// =========================================
// DEVICE CONFIGURATION (loaded from NVS)
// =========================================
uint8_t DEVICE_ID = 15;  // Default, will be loaded from NVS
uint8_t DEFAULT_WIFI_CHANNEL = 13;  // Default, will be loaded from NVS
uint8_t currentWifiChannel = 13;

#define MAX_GROUPS 15
#define COORDINATOR_MAC {0xB0, 0xB2, 0x1C, 0x45, 0x85, 0x1C}
uint8_t coordinatorMAC[] = COORDINATOR_MAC;

// =========================================
// LED CONFIGURATION
// =========================================
#define LED_TYPE WS2812B
#define LED_COLOR_ORDER GRB
#define LED_BRIGHTNESS 128
#define FASTLED_CORRECTION TypicalLEDStrip
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
#define COLOR_SCANNING CRGB::Yellow

// =========================================
// GAME STATE DEFINITIONS
// =========================================
enum BuzzerState {
  STATE_DISARMED,
  STATE_ARMED,
  STATE_ANSWERING_NOW,
  STATE_CORRECT_ANSWER,
  STATE_WRONG_ANSWER,
  STATE_TEST,
  STATE_BATTERY_DISPLAY,
  STATE_ID_PROGRAMMING,
  STATE_CHANNEL_PROGRAMMING
};

// State management
bool isArmed = false;
bool buzzerPressed = false;
BuzzerState currentState = STATE_DISARMED;
BuzzerState previousState = STATE_DISARMED;
BuzzerState lastLedState = STATE_DISARMED;
BuzzerState stateBeforeBatteryMode = STATE_DISARMED;
unsigned long buzzerPressTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastButtonCheck = 0;
bool lastButtonState = HIGH;
bool ledState = false;
unsigned long lastLedBlink = 0;
unsigned long lastRgbUpdate = 0;
uint8_t blinkCounter = 0;
uint8_t chaserPosition = 0;

// =========================================
// TIMING CONFIGURATION
// =========================================
#define LOOP_DELAY_MS 10
#define BUTTON_DEBOUNCE_MS 50
#define LED_UPDATE_INTERVAL_MS 50
#define BATTERY_CHECK_INTERVAL_MS 60000
#define HEARTBEAT_INTERVAL_MS 5000
#define STATE_CHECK_INTERVAL_MS 1000
#define PRESS_ACK_TIMEOUT_MS 300
#define MAX_PRESS_RETRIES 5
#define ANSWER_FEEDBACK_TIMEOUT_MS 30000
#define CORRECT_ANSWER_DURATION 3000

// Battery mode timing
#define ID_DISPLAY_DURATION 5000
#define BATTERY_DISPLAY_DURATION 8000
#define BATTERY_MODE_TIMEOUT (ID_DISPLAY_DURATION + BATTERY_DISPLAY_DURATION)
#define BUTTON_HOLD_THRESHOLD 3000

// ID Programming timing
#define ID_HOLD_THRESHOLD_MS 8000
#define ID_CONFIRM_TIMEOUT_MS 3000
#define ID_MIN 1
#define ID_MAX 15

// Channel Programming timing
#define CHANNEL_HOLD_THRESHOLD_MS 8000
#define CHANNEL_CONFIRM_TIMEOUT_MS 3000
#define CHANNEL_MIN 1
#define CHANNEL_MAX 13
#define DOUBLE_PRESS_WINDOW_MS 1000  // Time window for detecting double-press

// =========================================
// ANSWER FEEDBACK STATE
// =========================================
unsigned long answerFeedbackTimeout = 0;
bool waitingForAnswerFeedback = false;
unsigned long correctAnswerStartTime = 0;

// =========================================
// BUZZER PRESS ACK TRACKING
// =========================================
bool waitingForPressAck = false;
unsigned long pressAckTimeout = 0;
uint8_t pressRetryCount = 0;

// =========================================
// BATTERY MONITORING
// =========================================
float batteryVoltage = 0.0;
uint8_t batteryPercentage = 0;
unsigned long lastBatteryCheck = 0;
unsigned long batteryCheckInterval = 60000;

#define BATTERY_VOLTAGE_DIVIDER 2.0
#define BATTERY_MIN_VOLTAGE 3.0
#define BATTERY_MAX_VOLTAGE 4.2
#define ADC_RESOLUTION 4095
#define ADC_REFERENCE_VOLTAGE 3.3
#define BATTERY_CALIBRATION_FACTOR 1.098
#define ADC_ATTENUATION ADC_11db

// Battery display mode state
unsigned long buttonPressStartTime = 0;
bool buttonPressActive = false;
bool batteryModeActivationPending = false;
unsigned long batteryDisplayStartTime = 0;
unsigned long idDisplayStartTime = 0;
bool idDisplayShown = false;
bool idDisplayPhaseActive = false;

// =========================================
// ID PROGRAMMING MODE STATE
// =========================================
bool idProgrammingMode = false;
uint8_t pendingDeviceID = 1;
unsigned long lastIDButtonPress = 0;
unsigned long idHoldStartTime = 0;
bool idHoldActive = false;

// =========================================
// CHANNEL PROGRAMMING MODE STATE
// =========================================
bool channelProgrammingMode = false;
uint8_t pendingWifiChannel = 13;
unsigned long lastChannelButtonPress = 0;
unsigned long channelHoldStartTime = 0;
bool channelHoldActive = false;

// Double-press detection state
unsigned long firstPressTime = 0;
bool waitingForSecondPress = false;
bool secondPressDetected = false;

// =========================================
// CHANNEL SCANNING STATE
// =========================================
bool channelScanEnabled = false;
unsigned long lastSuccessfulHeartbeat = 0;
uint8_t consecutiveHeartbeatFailures = 0;
#define MAX_HEARTBEAT_FAILURES 3
#define HEARTBEAT_SUCCESS_TIMEOUT_MS 15000
bool isScanning = false;
uint8_t scanChannelIndex = 0;
unsigned long lastChannelScanTime = 0;
#define CHANNEL_SCAN_INTERVAL_MS 2000
uint8_t scanChannels[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
#define SCAN_CHANNELS_COUNT 13

// Two-phase channel change
uint8_t targetChannelForDirectJump = 0;
bool isDirectJumpPhase = false;
uint8_t directJumpAttempts = 0;
#define MAX_DIRECT_JUMP_ATTEMPTS 5
#define DIRECT_JUMP_INTERVAL_MS 300
unsigned long lastDirectJumpAttempt = 0;

unsigned long lastScanBeep = 0;
bool scanBeepState = false;
#define SCAN_BEEP_INTERVAL_MS 500
#define SCAN_BEEP_DURATION_MS 50

// =========================================
// POWER CONFIGURATION
// =========================================
#define WIFI_TX_POWER_RAW 84

// =========================================
// NVS FUNCTIONS
// =========================================
void loadDeviceID() {
  preferences.begin(NVS_NAMESPACE, false);
  
  if (preferences.isKey(NVS_ID_KEY)) {
    DEVICE_ID = preferences.getUChar(NVS_ID_KEY, 15);
    Serial.printf("[NVS] Loaded Device ID: %d\n", DEVICE_ID);
    
    if (DEVICE_ID < ID_MIN || DEVICE_ID > ID_MAX) {
      Serial.printf("[NVS] Invalid ID %d, using default 15\n", DEVICE_ID);
      DEVICE_ID = 15;
      preferences.putUChar(NVS_ID_KEY, DEVICE_ID);
    }
  } else {
    Serial.printf("[NVS] No ID found, using default: %d\n", DEVICE_ID);
    preferences.putUChar(NVS_ID_KEY, DEVICE_ID);
  }
  
  preferences.end();
}

void saveDeviceID(uint8_t newID) {
  preferences.begin(NVS_NAMESPACE, false);
  preferences.putUChar(NVS_ID_KEY, newID);
  preferences.end();
  
  DEVICE_ID = newID;
  Serial.printf("[NVS] Saved Device ID: %d\n", DEVICE_ID);
}

void loadWifiChannel() {
  preferences.begin(NVS_NAMESPACE, false);
  
  if (preferences.isKey(NVS_CHANNEL_KEY)) {
    DEFAULT_WIFI_CHANNEL = preferences.getUChar(NVS_CHANNEL_KEY, 13);
    Serial.printf("[NVS] Loaded WiFi Channel: %d\n", DEFAULT_WIFI_CHANNEL);
    
    if (DEFAULT_WIFI_CHANNEL < CHANNEL_MIN || DEFAULT_WIFI_CHANNEL > CHANNEL_MAX) {
      Serial.printf("[NVS] Invalid channel %d, using default 13\n", DEFAULT_WIFI_CHANNEL);
      DEFAULT_WIFI_CHANNEL = 13;
      preferences.putUChar(NVS_CHANNEL_KEY, DEFAULT_WIFI_CHANNEL);
    }
  } else {
    Serial.printf("[NVS] No channel found, using default: %d\n", DEFAULT_WIFI_CHANNEL);
    preferences.putUChar(NVS_CHANNEL_KEY, DEFAULT_WIFI_CHANNEL);
  }
  
  currentWifiChannel = DEFAULT_WIFI_CHANNEL;
  preferences.end();
}

void saveWifiChannel(uint8_t newChannel) {
  preferences.begin(NVS_NAMESPACE, false);
  preferences.putUChar(NVS_CHANNEL_KEY, newChannel);
  preferences.end();
  
  DEFAULT_WIFI_CHANNEL = newChannel;
  currentWifiChannel = newChannel;
  Serial.printf("[NVS] Saved WiFi Channel: %d\n", newChannel);
}

// =========================================
// STATE MANAGEMENT FUNCTIONS
// =========================================
void setBuzzerState(BuzzerState newState) {
  if (currentState != newState) {
    previousState = currentState;
    currentState = newState;
    Serial.printf("[STATE] Device %d: %d -> %d\n", DEVICE_ID, previousState, currentState);

    if (newState == STATE_ANSWERING_NOW || newState == STATE_CORRECT_ANSWER ||
        newState == STATE_WRONG_ANSWER) {
      updateLedState();
      lastRgbUpdate = millis();
      lastLedState = newState;
    }
  }
}

bool validateStateConsistency() {
  bool isConsistent = true;

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
    Serial.printf("[STATE WARNING] Device %d: DISARMED state but isArmed=true\n", DEVICE_ID);
    if (previousState != STATE_WRONG_ANSWER) {
      Serial.printf("[STATE ERROR] Device %d: DISARMED but isArmed=true - fixing\n", DEVICE_ID);
      isArmed = false;
      isConsistent = false;
    }
  }

  return isConsistent;
}

void forceStateRecovery() {
  Serial.printf("[STATE RECOVERY] Device %d starting state recovery\n", DEVICE_ID);

  waitingForPressAck = false;
  waitingForAnswerFeedback = false;
  pressRetryCount = 0;
  batteryModeActivationPending = false;
  buttonPressActive = false;

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

// =========================================
// WIFI CHANNEL MANAGEMENT
// =========================================
bool setWifiChannel(uint8_t channel) {
  if (channel < 1 || channel > 13) {
    Serial.printf("[CHANNEL] ERROR: Invalid channel %d\n", channel);
    return false;
  }

  Serial.printf("[CHANNEL] Setting channel to %d (was %d)\n", channel, currentWifiChannel);

  esp_err_t result = esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  if (result != ESP_OK) {
    Serial.printf("[CHANNEL] ERROR: Failed to set channel %d (error %d)\n", channel, result);
    return false;
  }

  currentWifiChannel = channel;
  Serial.printf("[CHANNEL] SUCCESS: Channel set to %d\n", channel);

  // Update ESP-NOW peer channel
  Serial.printf("[CHANNEL] Updating ESP-NOW peer to channel %d\n", channel);

  esp_err_t delResult = esp_now_del_peer(coordinatorMAC);
  if (delResult != ESP_OK) {
    Serial.printf("[CHANNEL] WARNING: Failed to delete peer (error %d)\n", delResult);
  }

  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, coordinatorMAC, 6);
  peerInfo.channel = channel;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA;

  esp_err_t addResult = esp_now_add_peer(&peerInfo);
  if (addResult != ESP_OK) {
    Serial.printf("[CHANNEL] ERROR: Failed to re-add peer on channel %d (error %d)\n", channel, addResult);
    return false;
  }

  Serial.printf("[CHANNEL] ✓ ESP-NOW peer updated to channel %d\n", channel);
  return true;
}

// =========================================
// COMMAND VALIDATION
// =========================================
bool validateCommandForState(Command cmd) {
  bool isValid = false;
  
  switch (cmd.command) {
    case CMD_ARM:
      isValid = (currentState == STATE_DISARMED);
      break;
    case CMD_DISARM:
      isValid = true;
      break;
    case CMD_TEST:
      isValid = true;
      break;
    case CMD_RESET:
      isValid = true;
      break;
    case CMD_CORRECT_ANSWER:
      isValid = (currentState == STATE_ANSWERING_NOW || currentState == STATE_DISARMED || 
                 currentState == STATE_CORRECT_ANSWER);
      break;
    case CMD_WRONG_ANSWER:
      isValid = (currentState == STATE_ANSWERING_NOW || currentState == STATE_DISARMED || 
                 currentState == STATE_WRONG_ANSWER);
      break;
    case CMD_END_ROUND:
      isValid = true;
      break;
    case CMD_CHANGE_CHANNEL:
      isValid = true;
      break;
    default:
      isValid = false;
      break;
  }

  if (!isValid) {
    Serial.printf("[CMD VALIDATION] Command %d rejected in state %d\n", cmd.command, currentState);
  }

  return isValid;
}

// =========================================
// ESP-NOW CALLBACKS
// =========================================
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  if (isDirectJumpPhase && status == ESP_NOW_SEND_SUCCESS) {
    Serial.printf("[PHASE 1] ✓ Coordinator ACKed on channel %d!\n", currentWifiChannel);
    playDirectJumpSuccessConfirmation();
    isDirectJumpPhase = false;
    directJumpAttempts = 0;
    consecutiveHeartbeatFailures = 0;
    lastSuccessfulHeartbeat = millis();
  }

  if (isScanning && status == ESP_NOW_SEND_SUCCESS) {
    Serial.printf("[PHASE 2] ✓ Coordinator found on channel %d!\n", currentWifiChannel);
    stopChannelScan();
    consecutiveHeartbeatFailures = 0;
    lastSuccessfulHeartbeat = millis();
  }
}

void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
  Serial.printf("[ESP-NOW] Received %d bytes\n", len);

  if (len == 16) {
    uint8_t messageType = incomingData[0];

    if (messageType == 5) {
      if (!waitingForPressAck && currentState == STATE_ANSWERING_NOW) {
        Serial.println("[PRESS] Ignoring duplicate ACK");
        return;
      }

      Serial.println("[PRESS] ACK received - press confirmed!");
      waitingForPressAck = false;
      pressRetryCount = 0;
      buzzerPressed = true;
      setBuzzerState(STATE_ANSWERING_NOW);
      waitingForAnswerFeedback = true;
      answerFeedbackTimeout = millis() + 30000;
      return;
    }

    if (messageType == 8) {
      Serial.println("[END_ROUND] ACK request received");
      endRoundReset();
      
      Message ackMsg;
      ackMsg.messageType = 8;
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
    Command cmd;
    memcpy(&cmd, incomingData, sizeof(cmd));

    Serial.printf("[CMD] Received: cmd=%d, target=%d, seq=%d\n", 
                  cmd.command, cmd.targetDevice, cmd.sequenceId);

    if (cmd.command == CMD_CHANGE_CHANNEL || cmd.targetDevice == 0 || cmd.targetDevice == DEVICE_ID) {
      handleCommand(cmd);
    } else {
      Serial.printf("[CMD] Rejected - target %d != my_id %d\n", cmd.targetDevice, DEVICE_ID);
    }
    return;
  }

  Serial.printf("[ERROR] Unknown message length: %d bytes\n", len);
}

// =========================================
// LED HELPER FUNCTIONS
// =========================================
void setAllLeds(CRGB color) {
  fill_solid(leds, NUM_LEDS, color);
  FastLED.show();
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

void blueChaser() {
  fill_solid(leds, NUM_LEDS, COLOR_OFF);

  for (int i = 0; i < 5; i++) {
    int pos = (chaserPosition - i + NUM_LEDS) % NUM_LEDS;
    int brightness = 255 - (i * 47);
    if (brightness < 51) brightness = 51;

    leds[pos] = COLOR_ARMED;
    leds[pos].fadeToBlackBy(255 - brightness);
  }

  FastLED.show();
  chaserPosition = (chaserPosition + 1) % NUM_LEDS;
}

void flashingWhite() {
  static bool flashState = false;
  flashState = !flashState;

  if (flashState) {
    setAllLeds(COLOR_ANSWERING_NOW);
  } else {
    setAllLeds(COLOR_OFF);
  }
}

void greenDecay() {
  unsigned long elapsed = millis() - correctAnswerStartTime;

  if (elapsed < CORRECT_ANSWER_DURATION) {
    float progress = (float)elapsed / CORRECT_ANSWER_DURATION;
    int brightness = 255 * (1.0 - progress);

    CRGB greenColor = COLOR_CORRECT_ANSWER;
    greenColor.fadeToBlackBy(255 - brightness);
    setAllLeds(greenColor);
  } else {
    setAllLeds(COLOR_OFF);

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
  setAllLeds(COLOR_WRONG_ANSWER);
}

void updateLedState() {
  if (isScanning) {
    static bool yellowBlinkState = false;
    static unsigned long lastYellowBlink = 0;

    if (millis() - lastYellowBlink > 250) {
      yellowBlinkState = !yellowBlinkState;
      setAllLeds(yellowBlinkState ? COLOR_SCANNING : COLOR_OFF);
      lastYellowBlink = millis();
    }
    return;
  }

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
      case STATE_ID_PROGRAMMING:
        displayProgrammingID(pendingDeviceID);
        break;
      case STATE_CHANNEL_PROGRAMMING:
        displayProgrammingChannel(pendingWifiChannel);
        break;
    }

    FastLED.show();
    lastLedState = currentState;
  } else {
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
      case STATE_ID_PROGRAMMING:
        displayProgrammingID(pendingDeviceID);
        break;
      case STATE_CHANNEL_PROGRAMMING:
        displayProgrammingChannel(pendingWifiChannel);
        break;
    }
  }
}

// =========================================
// AUDIO FUNCTIONS
// =========================================
void playBuzzerPattern() {
  int melody[] = {440, 550, 660};
  int noteDurations[] = {100, 100, 200};

  for (int i = 0; i < 3; i++) {
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(50);
  }
}

void playCorrectAnswerTone() {
  int melody[] = {523, 659, 784, 1047};
  int noteDurations[] = {150, 150, 150, 400};

  for (int i = 0; i < 4; i++) {
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(30);
  }
}

void playWrongAnswerTone() {
  int melody[] = {392, 330, 294};
  int noteDurations[] = {200, 200, 400};

  for (int i = 0; i < 3; i++) {
    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    delay(50);
  }
}

void playChannelChangeConfirmation() {
  int melody[] = {400, 800};
  int noteDurations[] = {100, 150};

  for (int i = 0; i < 2; i++) {
    setAllLeds(CRGB(0, 255, 255));

    unsigned long startTime = millis();
    unsigned long toneDuration = noteDurations[i];
    unsigned long halfPeriod = 500000 / melody[i];

    while (millis() - startTime < toneDuration) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }

    setAllLeds(COLOR_OFF);
    delay(50);
  }

  setAllLeds(CRGB(0, 255, 255));
  delay(100);
  setAllLeds(COLOR_OFF);
}

void playDirectJumpSuccessConfirmation() {
  Serial.println("[VISUAL] Direct jump success - magenta swipe");

  CRGB magenta = CRGB(255, 0, 255);

  fill_solid(leds, NUM_LEDS, COLOR_OFF);
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = magenta;
    FastLED.show();
    delay(250 / NUM_LEDS);
  }

  fill_solid(leds, NUM_LEDS, magenta);
  FastLED.show();
  delay(100);

  for (int brightness = 255; brightness >= 0; brightness -= 17) {
    CRGB fadedMagenta = magenta;
    fadedMagenta.fadeToBlackBy(255 - brightness);
    fill_solid(leds, NUM_LEDS, fadedMagenta);
    FastLED.show();
    delay(10);
  }

  fill_solid(leds, NUM_LEDS, COLOR_OFF);
  FastLED.show();
}

void startupSequence() {
  Serial.println("[STARTUP] Running sequence");

  for (int cycle = 0; cycle < 3; cycle++) {
    for (int i = 0; i < NUM_LEDS; i++) {
      fill_solid(leds, NUM_LEDS, COLOR_OFF);
      leds[i] = COLOR_STARTUP;
      FastLED.show();
      delay(30);
    }
  }

  for (int cycle = 0; cycle < 50; cycle++) {
    rainbowEffect();
    delay(20);
  }

  flashLeds(COLOR_STARTUP, 3, 200);

  unsigned long startTime = millis();
  unsigned long beepDuration = 500;
  unsigned long halfPeriod = 1000;

  while (millis() - startTime < beepDuration) {
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(halfPeriod);
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(halfPeriod);
  }

  setAllLeds(COLOR_OFF);
  Serial.println("[STARTUP] Complete");
}

// =========================================
// BATTERY MONITORING FUNCTIONS
// =========================================
float readBatteryVoltage() {
  uint32_t adcSum = 0;
  const int numReadings = 10;

  for (int i = 0; i < numReadings; i++) {
    uint32_t reading = analogRead(BATTERY_ADC_PIN);
    adcSum += reading;
    delay(10);
  }

  uint32_t adcAverage = adcSum / numReadings;
  float adcVoltage = (float)adcAverage / ADC_RESOLUTION * ADC_REFERENCE_VOLTAGE;
  float batteryVoltage = adcVoltage * BATTERY_VOLTAGE_DIVIDER;
  batteryVoltage *= BATTERY_CALIBRATION_FACTOR;

  static unsigned long lastDebugPrint = 0;
  if (millis() - lastDebugPrint > 10000) {
    Serial.printf("[BATTERY] ADC: %lu, Voltage: %.2fV\n", adcAverage, batteryVoltage);
    lastDebugPrint = millis();
  }

  return batteryVoltage;
}

uint8_t voltageToPercentage(float voltage) {
  const float dischargeCurve[][2] = {
    {4.20, 100}, {4.15, 95}, {4.10, 90}, {4.05, 85}, {4.00, 80},
    {3.95, 75}, {3.90, 70}, {3.85, 60}, {3.80, 50}, {3.75, 40},
    {3.70, 30}, {3.65, 25}, {3.60, 20}, {3.50, 10}, {3.00, 0}
  };

  const int curveSize = sizeof(dischargeCurve) / sizeof(dischargeCurve[0]);

  if (voltage >= dischargeCurve[0][0]) return 100;
  if (voltage <= dischargeCurve[curveSize - 1][0]) return 0;

  for (int i = 0; i < curveSize - 1; i++) {
    if (voltage >= dischargeCurve[i + 1][0]) {
      float v1 = dischargeCurve[i][0];
      float v2 = dischargeCurve[i + 1][0];
      float p1 = dischargeCurve[i][1];
      float p2 = dischargeCurve[i + 1][1];

      float percentage = p1 + (voltage - v1) * (p2 - p1) / (v2 - v1);
      return constrain((uint8_t)percentage, 0, 100);
    }
  }

  return 0;
}

void updateBatteryCheckInterval() {
  if (batteryPercentage > 50) {
    batteryCheckInterval = 60000;
  } else if (batteryPercentage > 20) {
    batteryCheckInterval = 30000;
  } else if (batteryPercentage > 10) {
    batteryCheckInterval = 15000;
  } else {
    batteryCheckInterval = 10000;
  }
}

void checkBatteryLevel() {
  unsigned long currentTime = millis();

  if (currentTime - lastBatteryCheck >= batteryCheckInterval) {
    batteryVoltage = readBatteryVoltage();
    batteryPercentage = voltageToPercentage(batteryVoltage);
    updateBatteryCheckInterval();
    lastBatteryCheck = currentTime;

    Serial.printf("[BATTERY] %.2fV (%d%%) - Next check: %lus\n",
                  batteryVoltage, batteryPercentage, batteryCheckInterval / 1000);
  }
}

// =========================================
// BATTERY DISPLAY MODE FUNCTIONS
// =========================================
void playBatteryModeEntryAnimation() {
  Serial.println("[BATTERY] Entry animation");

  int startFreq = 800;
  int endFreq = 1500;
  int stepDuration = 8;

  for (int i = 0; i < NUM_LEDS; i++) {
    fill_solid(leds, i + 1, CRGB::Blue);
    FastLED.show();

    int freq = startFreq + (i * (endFreq - startFreq) / NUM_LEDS);
    tone(BUZZER_PIN, freq, stepDuration);
    delay(stepDuration);
  }

  noTone(BUZZER_PIN);
  delay(200);

  displayBuzzerID();
  
  Serial.printf("[BATTERY] ID displays for %ds, then battery for %ds\n", 
                ID_DISPLAY_DURATION / 1000, BATTERY_DISPLAY_DURATION / 1000);
}

void displayBatteryLevel() {
  if (idDisplayPhaseActive) {
    return;
  }
  
  if (!idDisplayShown) {
    return;
  }

  readBatteryVoltage();

  uint8_t ledCount = (batteryPercentage * NUM_LEDS) / 100;
  if (ledCount > NUM_LEDS) ledCount = NUM_LEDS;

  fill_solid(leds, NUM_LEDS, CRGB::Black);

  CRGB batteryColor;
  if (batteryPercentage < 26) {
    batteryColor = CRGB::Red;
  } else if (batteryPercentage < 52) {
    batteryColor = CRGB::Orange;
  } else if (batteryPercentage < 78) {
    batteryColor = CRGB::Yellow;
  } else {
    batteryColor = CRGB::Green;
  }

  for (int i = 0; i < ledCount; i++) {
    leds[i] = batteryColor;
  }

  if (batteryPercentage < 26) {
    static unsigned long lastPulse = 0;
    static bool pulseBright = true;

    if (millis() - lastPulse > 500) {
      pulseBright = !pulseBright;
      lastPulse = millis();
    }

    if (!pulseBright) {
      for (int i = 0; i < ledCount; i++) {
        leds[i].nscale8(100);
      }
    }
  }

  FastLED.show();
}

void exitBatteryMode() {
  Serial.println("[BATTERY] Exiting display mode");

  buttonPressActive = false;
  batteryModeActivationPending = false;
  idDisplayShown = false;
  idDisplayPhaseActive = false;

  BuzzerState targetState = stateBeforeBatteryMode;

  if (targetState == STATE_ARMED && !isArmed) {
    targetState = STATE_DISARMED;
  } else if ((targetState == STATE_ANSWERING_NOW || targetState == STATE_CORRECT_ANSWER ||
              targetState == STATE_WRONG_ANSWER) && !buzzerPressed) {
    targetState = isArmed ? STATE_ARMED : STATE_DISARMED;
  }

  setBuzzerState(targetState);
  setAllLeds(COLOR_OFF);
}

// =========================================
// ID DISPLAY FUNCTIONS
// =========================================
void displayBuzzerID() {
  Serial.printf("[ID] Displaying ID: %d\n", DEVICE_ID);

  uint8_t id = DEVICE_ID;
  uint8_t fullGroups = id / 5;
  uint8_t remainder = id % 5;

  fill_solid(leds, NUM_LEDS, CRGB::Black);

  for (int group = 0; group < fullGroups; group++) {
    int startLED = group * 7;
    for (int i = 0; i < 5; i++) {
      if (startLED + i < NUM_LEDS) {
        leds[startLED + i] = CRGB::White;
      }
    }
  }

  if (remainder > 0) {
    int startLED = fullGroups * 7;
    for (int i = 0; i < remainder; i++) {
      if (startLED + i < NUM_LEDS) {
        leds[startLED + i] = CRGB::White;
      }
    }
  }

  FastLED.show();
  playIDAudio(fullGroups, remainder);
}

void playIDAudio(uint8_t dashes, uint8_t dots) {
  Serial.printf("[ID] Audio: %d dashes, %d dots\n", dashes, dots);

  for (int i = 0; i < dashes; i++) {
    tone(BUZZER_PIN, 800, 400);
    delay(400);
    noTone(BUZZER_PIN);
    delay(200);
  }

  if (dashes > 0 && dots > 0) {
    delay(200);
  }

  for (int i = 0; i < dots; i++) {
    tone(BUZZER_PIN, 1200, 100);
    delay(100);
    noTone(BUZZER_PIN);
    delay(200);
  }

  noTone(BUZZER_PIN);
}

// =========================================
// ID PROGRAMMING MODE FUNCTIONS
// =========================================
void enterIDProgrammingMode() {
  if (currentState == STATE_ARMED) {
    Serial.println("[ID PROG] Cannot enter while ARMED");
    tone(BUZZER_PIN, 200, 500);
    delay(500);
    noTone(BUZZER_PIN);
    return;
  }
  
  Serial.println("[ID PROG] *** ENTERING ID PROGRAMMING MODE ***");
  idProgrammingMode = true;
  pendingDeviceID = DEVICE_ID;
  lastIDButtonPress = millis();
  setBuzzerState(STATE_ID_PROGRAMMING);
  
  playIDProgrammingEntry();
  displayProgrammingID(pendingDeviceID);
}

void exitIDProgrammingMode(bool save) {
  if (save) {
    Serial.printf("[ID PROG] Saving ID: %d\n", pendingDeviceID);
    saveDeviceID(pendingDeviceID);
    
    playIDSaveConfirmation();
    
    for (int i = 0; i < 3; i++) {
      setAllLeds(CRGB::Green);
      delay(200);
      setAllLeds(CRGB::Black);
      delay(200);
    }
    
    Serial.println("[ID PROG] *** RESTARTING ***");
    delay(1000);
    ESP.restart();
  } else {
    Serial.println("[ID PROG] Cancelled");
    tone(BUZZER_PIN, 800, 200);
    delay(200);
    tone(BUZZER_PIN, 400, 400);
    delay(400);
    noTone(BUZZER_PIN);
  }
  
  idProgrammingMode = false;
  setAllLeds(CRGB::Black);
  setBuzzerState(STATE_DISARMED);
}

void processIDProgramming() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastIDButtonPress >= ID_CONFIRM_TIMEOUT_MS) {
    exitIDProgrammingMode(true);
    return;
  }
  
  displayProgrammingID(pendingDeviceID);
}

void incrementPendingID() {
  pendingDeviceID++;
  if (pendingDeviceID > ID_MAX) {
    pendingDeviceID = ID_MIN;
  }
  
  lastIDButtonPress = millis();
  
  Serial.printf("[ID PROG] ID: %d\n", pendingDeviceID);
  
  tone(BUZZER_PIN, 1000 + (pendingDeviceID * 50), 100);
  delay(100);
  noTone(BUZZER_PIN);
  
  displayProgrammingID(pendingDeviceID);
}

void displayProgrammingID(uint8_t id) {
  uint8_t fullGroups = id / 5;
  uint8_t remainder = id % 5;
  
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  
  CRGB progColor = CRGB(0, 255, 255);  // Cyan
  
  for (int group = 0; group < fullGroups; group++) {
    int startLED = group * 7;
    for (int i = 0; i < 5; i++) {
      if (startLED + i < NUM_LEDS) {
        leds[startLED + i] = progColor;
      }
    }
  }
  
  if (remainder > 0) {
    int startLED = fullGroups * 7;
    for (int i = 0; i < remainder; i++) {
      if (startLED + i < NUM_LEDS) {
        leds[startLED + i] = progColor;
      }
    }
  }
  
  FastLED.show();
}

void playIDProgrammingEntry() {
  for (int freq = 400; freq <= 2000; freq += 100) {
    tone(BUZZER_PIN, freq, 30);
    delay(30);
  }
  noTone(BUZZER_PIN);
  delay(200);
  
  for (int i = 0; i < 3; i++) {
    tone(BUZZER_PIN, 1500, 100);
    delay(150);
  }
  noTone(BUZZER_PIN);
}

void playIDSaveConfirmation() {
  int melody[] = {523, 659, 784, 1047};
  for (int i = 0; i < 4; i++) {
    tone(BUZZER_PIN, melody[i], 200);
    delay(250);
  }
  noTone(BUZZER_PIN);
}

// =========================================
// CHANNEL PROGRAMMING MODE FUNCTIONS
// =========================================
void enterChannelProgrammingMode() {
  if (currentState == STATE_ARMED) {
    Serial.println("[CH PROG] Cannot enter while ARMED");
    tone(BUZZER_PIN, 200, 500);
    delay(500);
    noTone(BUZZER_PIN);
    return;
  }
  
  Serial.println("[CH PROG] *** ENTERING CHANNEL PROGRAMMING MODE ***");
  channelProgrammingMode = true;
  pendingWifiChannel = currentWifiChannel;
  lastChannelButtonPress = millis();
  setBuzzerState(STATE_CHANNEL_PROGRAMMING);
  
  playChannelProgrammingEntry();
  displayProgrammingChannel(pendingWifiChannel);
}

void exitChannelProgrammingMode(bool save) {
  if (save) {
    Serial.printf("[CH PROG] Saving channel: %d\n", pendingWifiChannel);
    saveWifiChannel(pendingWifiChannel);
    
    playChannelSaveConfirmation();
    
    for (int i = 0; i < 3; i++) {
      setAllLeds(CRGB::Green);
      delay(200);
      setAllLeds(CRGB::Black);
      delay(200);
    }
    
    Serial.println("[CH PROG] *** RESTARTING ***");
    delay(1000);
    ESP.restart();
  } else {
    Serial.println("[CH PROG] Cancelled");
    tone(BUZZER_PIN, 800, 200);
    delay(200);
    tone(BUZZER_PIN, 400, 400);
    delay(400);
    noTone(BUZZER_PIN);
  }
  
  channelProgrammingMode = false;
  setAllLeds(CRGB::Black);
  setBuzzerState(STATE_DISARMED);
}

void processChannelProgramming() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastChannelButtonPress >= CHANNEL_CONFIRM_TIMEOUT_MS) {
    exitChannelProgrammingMode(true);
    return;
  }
  
  displayProgrammingChannel(pendingWifiChannel);
}

void incrementPendingChannel() {
  pendingWifiChannel++;
  if (pendingWifiChannel > CHANNEL_MAX) {
    pendingWifiChannel = CHANNEL_MIN;
  }
  
  lastChannelButtonPress = millis();
  
  Serial.printf("[CH PROG] Channel: %d\n", pendingWifiChannel);
  
  tone(BUZZER_PIN, 800 + (pendingWifiChannel * 80), 100);
  delay(100);
  noTone(BUZZER_PIN);
  
  displayProgrammingChannel(pendingWifiChannel);
}

void displayProgrammingChannel(uint8_t channel) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  
  CRGB channelColor = CRGB(255, 165, 0);  // Orange (different from cyan ID)
  
  // Light up single LED at position (channel - 1)
  // Channel 1 = LED 0, Channel 13 = LED 12
  if (channel >= 1 && channel <= 13) {
    leds[channel - 1] = channelColor;
  }
  
  FastLED.show();
}

void playChannelProgrammingEntry() {
  // Different pattern from ID mode - descending then ascending
  for (int freq = 2000; freq >= 400; freq -= 100) {
    tone(BUZZER_PIN, freq, 30);
    delay(30);
  }
  delay(100);
  for (int freq = 400; freq <= 1500; freq += 100) {
    tone(BUZZER_PIN, freq, 30);
    delay(30);
  }
  noTone(BUZZER_PIN);
  delay(200);
  
  for (int i = 0; i < 3; i++) {
    tone(BUZZER_PIN, 1200, 100);
    delay(150);
  }
  noTone(BUZZER_PIN);
}

void playChannelSaveConfirmation() {
  int melody[] = {392, 494, 587, 784};  // G-B-D-G (different from ID)
  for (int i = 0; i < 4; i++) {
    tone(BUZZER_PIN, melody[i], 200);
    delay(250);
  }
  noTone(BUZZER_PIN);
}

// =========================================
// BUTTON HANDLING
// =========================================
void checkBuzzerButton() {
  bool currentButtonState = digitalRead(BUZZER_BUTTON_PIN);
  
  // === ID PROGRAMMING MODE ACTIVE ===
  if (idProgrammingMode) {
    if (currentButtonState == LOW && lastButtonState == HIGH) {
      incrementPendingID();
    }
    lastButtonState = currentButtonState;
    return;
  }
  
  // === CHANNEL PROGRAMMING MODE ACTIVE ===
  if (channelProgrammingMode) {
    if (currentButtonState == LOW && lastButtonState == HIGH) {
      incrementPendingChannel();
    }
    lastButtonState = currentButtonState;
    return;
  }
  
  // === BATTERY DISPLAY MODE ACTIVE ===
  if (currentState == STATE_BATTERY_DISPLAY && currentButtonState == LOW && lastButtonState == HIGH) {
    exitBatteryMode();
    lastButtonState = currentButtonState;
    return;
  }
  
  // === NORMAL BUZZER PRESS (when armed) ===
  if (currentButtonState == LOW && lastButtonState == HIGH && isArmed && !buzzerPressed) {
    handleBuzzerPress();
    lastButtonState = currentButtonState;
    return;
  }
  
  // === PROGRAMMING MODE DETECTION (when not armed) ===
  if (!isArmed && currentState != STATE_BATTERY_DISPLAY) {
    // Button pressed
    if (currentButtonState == LOW && lastButtonState == HIGH) {
      unsigned long currentTime = millis();
      
      // Check for double-press (second press within window)
      if (waitingForSecondPress && (currentTime - firstPressTime <= DOUBLE_PRESS_WINDOW_MS)) {
        Serial.println("[BUTTON] Second press detected - starting channel mode hold timer");
        secondPressDetected = true;
        channelHoldStartTime = currentTime;
        channelHoldActive = true;
        waitingForSecondPress = false;
        // CRITICAL: Cancel single-press timers when double-press detected
        idHoldActive = false;
        buttonPressActive = false;
        batteryModeActivationPending = false;
      } else {
        // First press
        Serial.println("[BUTTON] First press detected");
        firstPressTime = currentTime;
        waitingForSecondPress = true;
        secondPressDetected = false;
        
        // Also start single-press hold timer for battery/ID modes
        idHoldStartTime = currentTime;
        idHoldActive = true;
      }
    }
    
    // Button released
    if (currentButtonState == HIGH && lastButtonState == LOW) {
      unsigned long holdDuration = 0;
      
      if (secondPressDetected && channelHoldActive) {
        holdDuration = millis() - channelHoldStartTime;
        
        if (holdDuration < CHANNEL_HOLD_THRESHOLD_MS) {
          Serial.println("[BUTTON] Second press released before 8s - channel mode cancelled");
        }
        
        channelHoldActive = false;
        secondPressDetected = false;
      }
      
      if (idHoldActive && !secondPressDetected) {
        holdDuration = millis() - idHoldStartTime;
        
        if (holdDuration < BUTTON_HOLD_THRESHOLD) {
          Serial.println("[BUTTON] Released before 3s");
        }
      }
      
      idHoldActive = false;
      buttonPressActive = false;
      batteryModeActivationPending = false;
    }
    
    // Check for double-press timeout
    if (waitingForSecondPress && !secondPressDetected && 
        (millis() - firstPressTime > DOUBLE_PRESS_WINDOW_MS)) {
      Serial.println("[BUTTON] Double-press window expired");
      waitingForSecondPress = false;
    }
    
    // Check for 3-second battery mode threshold (single press)
    if (idHoldActive && currentButtonState == LOW && !secondPressDetected &&
        (millis() - idHoldStartTime >= BUTTON_HOLD_THRESHOLD) &&
        (millis() - idHoldStartTime < ID_HOLD_THRESHOLD_MS) &&
        !batteryModeActivationPending) {
      batteryModeActivationPending = true;
      buttonPressActive = false;
      Serial.println("[BATTERY] 3s threshold - battery mode pending");
    }
    
    // Check for 8-second ID programming threshold (single press)
    if (idHoldActive && currentButtonState == LOW && !secondPressDetected &&
        (millis() - idHoldStartTime >= ID_HOLD_THRESHOLD_MS)) {
      batteryModeActivationPending = false;
      buttonPressActive = false;
      idHoldActive = false;
      enterIDProgrammingMode();
    }
    
    // Check for 8-second channel programming threshold (double press)
    if (channelHoldActive && currentButtonState == LOW && secondPressDetected &&
        (millis() - channelHoldStartTime >= CHANNEL_HOLD_THRESHOLD_MS)) {
      batteryModeActivationPending = false;
      buttonPressActive = false;
      idHoldActive = false;
      channelHoldActive = false;
      secondPressDetected = false;
      waitingForSecondPress = false;
      enterChannelProgrammingMode();
    }
  }
  
  lastButtonState = currentButtonState;
}

void handleBuzzerPress() {
  buzzerPressTime = millis();

  Serial.printf("[PRESS] Device %d pressed at %lu\n", DEVICE_ID, buzzerPressTime);

  sendBuzzerPressWithRetry();
  playBuzzerPattern();
}

void sendBuzzerPressWithRetry() {
  Message msg;
  msg.messageType = 1;
  msg.deviceId = DEVICE_ID;
  msg.timestamp = buzzerPressTime;
  memset(msg.data, 0, sizeof(msg.data));

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));

  if (result == ESP_OK) {
    Serial.printf("[PRESS] Sent (attempt %d/%d)\n", pressRetryCount + 1, MAX_PRESS_RETRIES);
    waitingForPressAck = true;
    uint32_t timeoutMs = PRESS_ACK_TIMEOUT_MS + (pressRetryCount * 50);
    pressAckTimeout = millis() + timeoutMs;
  } else {
    Serial.printf("[PRESS] FAILED (attempt %d/%d), error: %d\n", pressRetryCount + 1, MAX_PRESS_RETRIES, result);
    pressRetryCount++;
    if (pressRetryCount < MAX_PRESS_RETRIES) {
      uint32_t delayMs = 50 + (pressRetryCount * 100);
      delay(delayMs);
      sendBuzzerPressWithRetry();
    } else {
      waitingForPressAck = false;
      pressRetryCount = 0;
    }
  }
}

// =========================================
// COMMAND HANDLING
// =========================================
void sendCommandAck(uint16_t sequenceId) {
  if (sequenceId == 0) {
    return;
  }

  Message ackMsg;
  ackMsg.messageType = 4;
  ackMsg.deviceId = DEVICE_ID;
  ackMsg.timestamp = millis();
  memset(ackMsg.data, 0, sizeof(ackMsg.data));
  ackMsg.data[0] = sequenceId;

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&ackMsg, sizeof(ackMsg));
  Serial.printf("[ACK] Sent for seq=%d, result: %s\n", sequenceId,
                result == ESP_OK ? "OK" : "FAILED");
}

void sendChannelChangeAck() {
  Message ackMsg;
  ackMsg.messageType = 9;
  ackMsg.deviceId = DEVICE_ID;
  ackMsg.timestamp = millis();
  memset(ackMsg.data, 0, sizeof(ackMsg.data));
  ackMsg.data[0] = currentWifiChannel;

  Serial.printf("[CHANNEL_ACK] Sending to coordinator, channel %d\n", currentWifiChannel);

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&ackMsg, sizeof(ackMsg));
  Serial.printf("[CHANNEL_ACK] Result: %s\n", result == ESP_OK ? "OK" : "FAILED");
}

void handleCommand(Command cmd) {
  Serial.printf("[CMD] Device %d: cmd=%d, target=%d, seq=%d, state=%d\n",
                DEVICE_ID, cmd.command, cmd.targetDevice, cmd.sequenceId, currentState);

  if (!validateCommandForState(cmd)) {
    Serial.printf("[CMD] Rejected - invalid for state %d\n", currentState);
    sendCommandAck(cmd.sequenceId);
    return;
  }

  batteryModeActivationPending = false;
  buttonPressActive = false;

  if (currentState == STATE_BATTERY_DISPLAY) {
    exitBatteryMode();
  }

  sendCommandAck(cmd.sequenceId);

  switch (cmd.command) {
    case CMD_ARM:
      armBuzzer();
      break;
    case CMD_DISARM:
      disarmBuzzer();
      break;
    case CMD_TEST:
      testBuzzer();
      break;
    case CMD_RESET:
      resetBuzzer();
      break;
    case CMD_CORRECT_ANSWER:
      correctAnswerFeedback();
      updateLedState();
      break;
    case CMD_WRONG_ANSWER:
      wrongAnswerFeedback();
      updateLedState();
      break;
    case CMD_END_ROUND:
      endRoundReset();
      break;
    case CMD_CHANGE_CHANNEL:
      targetChannelForDirectJump = cmd.targetDevice;
      playChannelChangeConfirmation();
      sendChannelChangeAck();
      delay(1500);
      
      isDirectJumpPhase = true;
      directJumpAttempts = 0;
      lastDirectJumpAttempt = 0;
      
      if (setWifiChannel(targetChannelForDirectJump)) {
        Serial.printf("[PHASE 1] Jumped to channel %d\n", targetChannelForDirectJump);
      } else {
        isDirectJumpPhase = false;
        startChannelScan();
      }
      break;
    default:
      Serial.printf("[CMD] Unknown command: %d\n", cmd.command);
      break;
  }

  sendStatusUpdate();
}

void armBuzzer() {
  if (currentState == STATE_WRONG_ANSWER || currentState == STATE_CORRECT_ANSWER) {
    Serial.printf("[ARM] In answer state - ignoring\n");
    return;
  }

  if (!isArmed) {
    isArmed = true;
    buzzerPressed = false;
    setBuzzerState(STATE_ARMED);
    digitalWrite(BUZZER_PIN, LOW);

    Serial.println("[ARM] Buzzer armed");

    unsigned long startTime = millis();
    unsigned long beepDuration = 200;
    unsigned long halfPeriod = 750;

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

  if (currentState == STATE_WRONG_ANSWER) {
    Serial.printf("[DISARM] Preserving WRONG_ANSWER state\n");
  } else if (currentState == STATE_CORRECT_ANSWER) {
    Serial.printf("[DISARM] Preserving CORRECT_ANSWER state\n");
  } else if (currentState != STATE_DISARMED) {
    buzzerPressed = false;
    setBuzzerState(STATE_DISARMED);
  }

  digitalWrite(BUZZER_PIN, LOW);
  Serial.printf("[DISARM] Complete - state %d\n", currentState);
}

void testBuzzer() {
  Serial.println("[TEST] Running test");

  BuzzerState previousState = currentState;
  setBuzzerState(STATE_TEST);

  int testFreqs[] = {800, 1000, 1200};

  for (int i = 0; i < 3; i++) {
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

  for (int i = 0; i < 50; i++) {
    rainbowEffect();
    delay(20);
  }

  currentState = previousState;
}

void resetBuzzer() {
  Serial.println("[RESET] Resetting");

  isArmed = false;
  buzzerPressed = false;
  ledState = false;
  blinkCounter = 0;
  chaserPosition = 0;
  setBuzzerState(STATE_DISARMED);

  digitalWrite(BUZZER_PIN, LOW);
  startupSequence();
}

void correctAnswerFeedback() {
  Serial.println("[CORRECT] Feedback");
  setBuzzerState(STATE_CORRECT_ANSWER);
  waitingForAnswerFeedback = false;
  correctAnswerStartTime = millis();
  playCorrectAnswerTone();
}

void wrongAnswerFeedback() {
  Serial.printf("[WRONG] Device %d feedback\n", DEVICE_ID);

  if (currentState == STATE_WRONG_ANSWER) {
    Serial.println("[WRONG] Already in wrong state");
    return;
  }

  setBuzzerState(STATE_WRONG_ANSWER);
  isArmed = false;
  waitingForAnswerFeedback = false;
  playWrongAnswerTone();
}

void endRoundReset() {
  Serial.println("[END_ROUND] Reset");

  buzzerPressed = false;
  waitingForAnswerFeedback = false;
  waitingForPressAck = false;
  pressRetryCount = 0;

  isArmed = false;
  setBuzzerState(STATE_DISARMED);

  Serial.printf("[END_ROUND] Device %d reset to DISARMED\n", DEVICE_ID);
}

// =========================================
// CHANNEL SCANNING
// =========================================
void startChannelScan() {
  Serial.println("[SCAN] Starting coordinator search");
  isScanning = true;
  scanChannelIndex = 0;
  lastChannelScanTime = millis();

  Serial.printf("[SCAN] Trying channel %d\n", scanChannels[scanChannelIndex]);
  setWifiChannel(scanChannels[scanChannelIndex]);
}

void stopChannelScan() {
  Serial.println("[SCAN] Stopping - coordinator found");
  isScanning = false;
  scanChannelIndex = 0;
}

void processDirectJumpPhase() {
  if (!isDirectJumpPhase) return;

  unsigned long currentTime = millis();

  if (currentTime - lastDirectJumpAttempt >= DIRECT_JUMP_INTERVAL_MS) {
    directJumpAttempts++;
    lastDirectJumpAttempt = currentTime;

    Serial.printf("[PHASE 1] Attempt %d/%d on channel %d\n",
                  directJumpAttempts, MAX_DIRECT_JUMP_ATTEMPTS, targetChannelForDirectJump);

    sendHeartbeat();

    if (directJumpAttempts >= MAX_DIRECT_JUMP_ATTEMPTS) {
      Serial.printf("[PHASE 1] Failed after %d attempts\n", MAX_DIRECT_JUMP_ATTEMPTS);
      Serial.println("[PHASE 2] Starting full scan");

      isDirectJumpPhase = false;
      directJumpAttempts = 0;
      startChannelScan();
    }
  }
}

void processChannelScan() {
  if (!isScanning) return;

  unsigned long currentTime = millis();

  if (currentTime - lastChannelScanTime >= CHANNEL_SCAN_INTERVAL_MS) {
    scanChannelIndex++;

    if (scanChannelIndex >= SCAN_CHANNELS_COUNT) {
      Serial.println("[SCAN] Complete - coordinator not found");
      Serial.printf("[SCAN] Returning to default channel %d\n", DEFAULT_WIFI_CHANNEL);

      scanChannelIndex = 0;
      setWifiChannel(DEFAULT_WIFI_CHANNEL);
      lastChannelScanTime = currentTime;
      consecutiveHeartbeatFailures = 0;
      isScanning = false;
    } else {
      Serial.printf("[SCAN] Trying channel %d\n", scanChannels[scanChannelIndex]);
      setWifiChannel(scanChannels[scanChannelIndex]);
      lastChannelScanTime = currentTime;
    }
  }
}

// =========================================
// HEARTBEAT & STATUS
// =========================================
void sendHeartbeat() {
  batteryVoltage = readBatteryVoltage();
  batteryPercentage = voltageToPercentage(batteryVoltage);

  Message msg;
  msg.messageType = 2;
  msg.deviceId = DEVICE_ID;
  msg.timestamp = millis();
  msg.data[0] = isArmed ? 1 : 0;
  msg.data[1] = buzzerPressed ? 1 : 0;
  msg.data[2] = batteryPercentage;

  uint16_t voltageInt = (uint16_t)(batteryVoltage * 100);
  msg.data[3] = voltageInt & 0xFF;
  msg.data[4] = (voltageInt >> 8) & 0xFF;

  esp_err_t result = esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
  
  if (result != ESP_OK) {
    consecutiveHeartbeatFailures++;
    Serial.printf("[HB] Failed %d/%d\n", consecutiveHeartbeatFailures, MAX_HEARTBEAT_FAILURES);

    if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES && !isScanning) {
      Serial.println("[HB] Max failures - starting scan");
      startChannelScan();
    }
  } else {
    if (!isDirectJumpPhase && !isScanning) {
      if (consecutiveHeartbeatFailures > 0) {
        Serial.printf("[HB] Queued - resetting counter (was %d)\n", consecutiveHeartbeatFailures);
      }
      consecutiveHeartbeatFailures = 0;
      lastSuccessfulHeartbeat = millis();
    }
  }
}

void sendStatusUpdate() {
  Message msg;
  msg.messageType = 3;
  msg.deviceId = DEVICE_ID;
  msg.timestamp = millis();
  msg.data[0] = isArmed ? 1 : 0;
  msg.data[1] = buzzerPressed ? 1 : 0;
  msg.data[2] = (leds[0].r > 0 || leds[0].g > 0 || leds[0].b > 0) ? 1 : 0;
  msg.data[3] = batteryPercentage;

  uint16_t voltageInt = (uint16_t)(batteryVoltage * 100);
  msg.data[4] = voltageInt & 0xFF;
  msg.data[5] = (voltageInt >> 8) & 0xFF;

  esp_now_send(coordinatorMAC, (uint8_t*)&msg, sizeof(msg));
}

// =========================================
// SETUP
// =========================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=== ESP32 Group Buzzer Starting ===");

  // Load configuration from NVS
  loadDeviceID();
  loadWifiChannel();

  Serial.printf("[CONFIG] Device ID: %d\n", DEVICE_ID);
  Serial.printf("[CONFIG] WiFi Channel: %d\n", currentWifiChannel);

  // Initialize hardware
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BATTERY_ADC_PIN, INPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_ATTENUATION);

  // Test ADC
  delay(100);
  uint32_t testADC = analogRead(BATTERY_ADC_PIN);
  Serial.printf("[ADC] Test: %lu (%.2fV)\n", testADC, 
                (float)testADC / ADC_RESOLUTION * ADC_REFERENCE_VOLTAGE);

  // Initialize FastLED
  FastLED.addLeds<LED_TYPE, LED_DATA_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS)
         .setCorrection(FASTLED_CORRECTION);
  FastLED.setBrightness(LED_BRIGHTNESS);

  setAllLeds(COLOR_OFF);
  digitalWrite(BUZZER_PIN, LOW);

  // Initialize WiFi
  WiFi.mode(WIFI_STA);
  esp_wifi_set_max_tx_power(WIFI_TX_POWER_RAW);
  delay(500);

  // Print MAC
  Serial.printf("[MAC] Device #%d: %s\n", DEVICE_ID, WiFi.macAddress().c_str());

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init FAILED");
    return;
  }

  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // Set channel before adding peer
  if (!setWifiChannel(currentWifiChannel)) {
    Serial.printf("[CHANNEL] Failed to set initial channel %d\n", currentWifiChannel);
  }

  // Add coordinator peer
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, coordinatorMAC, 6);
  peerInfo.channel = currentWifiChannel;
  peerInfo.encrypt = false;
  peerInfo.ifidx = WIFI_IF_STA;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("[ESP-NOW] Failed to add peer");
  } else {
    Serial.println("[ESP-NOW] Peer added");
  }

  // Verify channel
  uint8_t primaryChan;
  wifi_second_chan_t secondChan;
  esp_wifi_get_channel(&primaryChan, &secondChan);
  Serial.printf("[CHANNEL] Verified: %d\n", primaryChan);

  if (primaryChan != currentWifiChannel) {
    Serial.printf("[CHANNEL] ERROR: Expected %d, got %d\n", currentWifiChannel, primaryChan);
  }

  // Initial battery reading
  batteryVoltage = readBatteryVoltage();
  batteryPercentage = voltageToPercentage(batteryVoltage);
  updateBatteryCheckInterval();
  Serial.printf("[BATTERY] Initial: %.2fV (%d%%)\n", batteryVoltage, batteryPercentage);

  // Startup sequence
  startupSequence();

  Serial.println("=== Buzzer Ready ===");
  sendHeartbeat();
}

// =========================================
// MAIN LOOP
// =========================================
void loop() {
  unsigned long currentTime = millis();

  // Check button
  if (currentTime - lastButtonCheck > BUTTON_DEBOUNCE_MS) {
    checkBuzzerButton();
    lastButtonCheck = currentTime;
  }

  // Process programming modes
  if (idProgrammingMode) {
    processIDProgramming();
    return;
  }

  if (channelProgrammingMode) {
    processChannelProgramming();
    return;
  }

  // Handle battery mode activation
  if (batteryModeActivationPending && currentState != STATE_ARMED) {
    stateBeforeBatteryMode = currentState;
    setBuzzerState(STATE_BATTERY_DISPLAY);
    idDisplayShown = false;
    idDisplayPhaseActive = true;
    playBatteryModeEntryAnimation();
    batteryModeActivationPending = false;
    batteryDisplayStartTime = currentTime;
    idDisplayStartTime = currentTime;
    Serial.println("[BATTERY] Mode activated");
  }

  // Handle battery mode phases
  if (currentState == STATE_BATTERY_DISPLAY) {
    unsigned long timeInMode = currentTime - batteryDisplayStartTime;
    
    if (idDisplayPhaseActive && timeInMode >= ID_DISPLAY_DURATION) {
      Serial.println("[BATTERY] Switching to battery phase");
      idDisplayPhaseActive = false;
      idDisplayShown = true;
    }
    
    if (timeInMode >= BATTERY_MODE_TIMEOUT) {
      exitBatteryMode();
    }
  }

  // Handle press ACK timeout
  if (waitingForPressAck && currentTime > pressAckTimeout) {
    pressRetryCount++;
    if (pressRetryCount < MAX_PRESS_RETRIES) {
      Serial.printf("[PRESS] Timeout, retry %d/%d\n", pressRetryCount + 1, MAX_PRESS_RETRIES);
      sendBuzzerPressWithRetry();
    } else {
      Serial.println("[PRESS] Max retries reached");
      waitingForPressAck = false;
      pressRetryCount = 0;
    }
  }

  // Handle answer feedback timeout
  if (waitingForAnswerFeedback && currentTime > answerFeedbackTimeout) {
    waitingForAnswerFeedback = false;
    Serial.println("[TIMEOUT] Answer feedback timeout");

    if (currentState != STATE_WRONG_ANSWER) {
      if (isArmed) {
        setBuzzerState(STATE_ARMED);
      } else {
        setBuzzerState(STATE_DISARMED);
      }
    }
  }

  // State consistency check
  static unsigned long lastStateCheck = 0;
  if (currentTime - lastStateCheck > STATE_CHECK_INTERVAL_MS) {
    validateStateConsistency();
    lastStateCheck = currentTime;
  }

  // Update LEDs
  if (currentTime - lastRgbUpdate > LED_UPDATE_INTERVAL_MS) {
    updateLedState();
    lastRgbUpdate = currentTime;
  }

  // Scan beep indicator
  if (isScanning && currentTime - lastScanBeep >= SCAN_BEEP_INTERVAL_MS) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(SCAN_BEEP_DURATION_MS);
    digitalWrite(BUZZER_PIN, LOW);
    lastScanBeep = currentTime;
  }

  // Process channel operations
  processDirectJumpPhase();
  processChannelScan();

  // Battery monitoring
  checkBatteryLevel();

  // Heartbeat
  if (currentTime - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
    lastHeartbeat = currentTime;
  }

  yield();
}