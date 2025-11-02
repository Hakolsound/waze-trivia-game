# Diagnose Re-Arm Issue

## Problem Summary

After a wrong answer, only 2 out of 14 buzzers are getting re-armed.

### Evidence from Logs

**Expected**: Backend sends ARM_SPECIFIC with bitmask `0xf7fe` = 14 buzzers (all except 11)
```
[ARM_SPECIFIC] Bitmask: 0xf7fe
Expected armed: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15
```

**Actual**: Only 2 buzzers armed (3 and 14)
```
STATUS: deviceMask=0x3ff7, armed=0x4008
Online: 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
Armed: 3, 14
```

**Critical Finding**: Buzzers 3 and 14 are marked as "armed" but are **NOT online**!

## Root Cause Analysis

The coordinator is likely:
1. Sending ARM commands too fast (14 commands in ~140ms)
2. ESP-NOW send buffer overflowing
3. `esp_now_send()` returning ESP_OK (queued) but actual delivery failing
4. Coordinator updating internal state based on "queued" not "delivered"

## Diagnostic Steps

### Step 1: Check Coordinator Serial Output

Connect to coordinator serial monitor to see actual ESP-NOW send results:

```bash
# On Raspberry Pi
sudo systemctl stop waze-trivia-game.service

# Check which port coordinator is on
ls /dev/ttyUSB*

# Monitor coordinator (likely /dev/ttyUSB0)
arduino-cli monitor --port /dev/ttyUSB0 --config baudrate=115200
```

Look for these debug messages during re-arm:
```
[ARM_SPECIFIC] Binary command received: bitmask=0xf7fe
[ARM_SPECIFIC] Bitmask bit 1 set, arming device 1
[ACK] Command sent with ACK: dev=1, cmd=1, seq=XXXX
...
[ACK] ARM_SPECIFIC sent to 14 devices (14 successful, 0 failed)
```

If you see failures or ESP-NOW errors, that confirms the send buffer issue.

### Step 2: Check Which Buzzers Are Actually Online

From the logs:
- **Online** (deviceMask=0x3ff7): 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
- **Missing**: 3, 14, 15

Buzzers 3, 14, and 15 are offline, but buzzers 3 and 14 show as "armed". This suggests:
- Coordinator is tracking "armed" state even for offline devices
- The armed bitmask might be stale/incorrect

### Step 3: Check ESP-NOW OnDataSent Callback

The coordinator should have an `OnDataSent` callback that reports actual delivery status. Check if it's logging delivery failures:

```cpp
void OnDataSent(const uint8_t *mac, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS) {
    Serial.printf("[ESP-NOW] Send FAILED to device\n");
  }
}
```

## Potential Fixes

### Fix 1: Add Delay Between ARM Commands

In `armSpecificBuzzersByBitmask()`:

```cpp
if (sendCommandWithAck(deviceId, CMD_ARM)) {
  // ... update state ...
  armedCount++;
  sent++;
  delay(10);  // Add 10ms delay between sends
}
```

This prevents ESP-NOW buffer overflow.

### Fix 2: Only ARM Online Devices

Check if device is online before arming:

```cpp
for (uint8_t deviceId = 1; deviceId <= 15; deviceId++) {
  if (bitmask & (1 << deviceId)) {
    // Find device and check if online
    bool isOnline = false;
    for (int i = 0; i < registeredDeviceCount; i++) {
      if (devices[i].deviceId == deviceId && devices[i].isOnline) {
        isOnline = true;
        break;
      }
    }

    if (!isOnline) {
      Serial.printf("[ARM_SPECIFIC] Skipping offline device %d\n", deviceId);
      continue;
    }

    // Send ARM command...
  }
}
```

### Fix 3: Use OnDataSent for State Updates

Don't update `isArmed` immediately when queuing command. Wait for `OnDataSent` callback to confirm delivery:

```cpp
// In OnDataSent callback:
void OnDataSent(const uint8_t *mac, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    // Now update device.isArmed = true
  } else {
    // Retry or log failure
  }
}
```

### Fix 4: Check Armed Bitmask Calculation

The STATUS message shows `armed=0x4008` which includes offline devices. The coordinator should calculate armed bitmask by:
```cpp
uint16_t armedMask = 0;
for (int i = 0; i < registeredDeviceCount; i++) {
  if (devices[i].isArmed && devices[i].isOnline) {
    armedMask |= (1 << devices[i].deviceId);
  }
}
```

## Next Steps

1. **Check coordinator serial output** during re-arm to see actual ESP-NOW results
2. **Verify which buzzers are truly online** vs what STATUS reports
3. **Test with fewer buzzers** to see if it's a buffer overflow issue
4. **Implement Fix 1** (add delay) as quick workaround
5. **Implement Fix 2** (check online status) for proper solution

## Questions to Answer

1. Why are buzzers 3, 14, 15 offline?
2. Why does armed bitmask include offline buzzers?
3. Is ESP-NOW send buffer overflowing with 14 rapid sends?
4. Is the OnDataSent callback being called for failed sends?
