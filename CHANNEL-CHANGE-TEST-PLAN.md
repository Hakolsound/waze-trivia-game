# WiFi Channel Change Test Plan

## Current System Analysis

### Available Commands

#### Backend API (esp32Service.js)
- `scanWifiChannels()` → Binary command 9 (SCAN_CHANNELS)
- `setWifiChannel(channel)` → Binary command 10 (SET_CHANNEL)

#### Coordinator Firmware Binary Commands
- **Command 9**: `BIN_CMD_SCAN_CHANNELS` - Scan WiFi channels
- **Command 10**: `BIN_CMD_SET_CHANNEL` - Change channel + broadcast to buzzers

#### Buzzer Firmware ESP-NOW Commands
- **Command 8**: `CMD_CHANGE_CHANNEL` - Received via ESP-NOW from coordinator

---

## Test 1: Normal Channel Change (Current Behavior)

### Setup
- Coordinator on CH 13 (default)
- All buzzers on CH 13 (default)

### Execute
```bash
# Frontend button: "Change to Channel 1"
POST /api/wifi/channel
Body: { "channel": 1 }
```

### Expected Behavior

**Coordinator:**
1. Receives binary command: `[0xBB][10][1][checksum]`
2. Calls `changeWifiChannel(1)`
3. Broadcasts `CMD_CHANGE_CHANNEL(1)` to all registered buzzers via ESP-NOW
4. Changes own channel: `esp_wifi_set_channel(1)`
5. Sends to backend: `WIFI_CHANNEL_CHANGED:1`

**Buzzers:**
1. Receive `CMD_CHANGE_CHANNEL(1)` on CH 13
2. Send ACK back to coordinator
3. Wait 1500ms for coordinator to switch
4. Phase 1: Jump directly to CH 1
5. Try heartbeats on CH 1 (3 attempts)
6. Phase 2: If fails, scan [13, 1, 6, 11] to find coordinator

### Test Verification
- [ ] Coordinator reports `WIFI_CHANNEL_CHANGED:1`
- [ ] All buzzers successfully moved to CH 1
- [ ] Buzzers can send buzzer press events on CH 1
- [ ] Log all buzzer ACKs received

### Possible Outcomes
✅ **Success**: All buzzers on CH 1, coordinator on CH 1
⚠️ **Partial**: Some buzzers on CH 1, some stuck on CH 13
❌ **Failure**: Coordinator on CH 1, but no buzzers followed

---

## Test 2: Analyze Partial Success Scenario

### Reproduce Partial Failure
1. Start with all buzzers on CH 13
2. Change to CH 1
3. Intentionally interfere with some buzzers (cover antenna, power cycle mid-change)

### Expected State After Partial Failure
```
Coordinator: CH 1 ✓
Buzzer A:    CH 1 ✅ (success)
Buzzer B:    CH 1 ✅ (success)
Buzzer C:    CH 13 ❌ (missed command)
Buzzer D:    CH 13 ❌ (failed to connect)
```

### Verification
- [ ] Buzzers A & B can send events (heard by coordinator on CH 1)
- [ ] Buzzers C & D cannot send events (coordinator not on CH 13)
- [ ] Log which buzzers sent ACKs during channel change

---

## Test 3: Manual Recovery (Current Options)

### Option 1: Move Back to Default
```bash
POST /api/wifi/channel
Body: { "channel": 13 }
```

**Expected:**
- Coordinator moves to CH 13
- Broadcasts `CMD_CHANGE_CHANNEL(13)`
- Buzzers on CH 1 may or may not hear it
- Buzzers on CH 13 already there

**Problem:** May break successfully migrated buzzers

### Option 2: Hard Reset All Buzzers
- Physically power cycle all buzzers
- All reset to default CH 13
- Coordinator can change again

**Problem:** Disruptive, requires physical access

---

## Test 4: Proposed "Recall Neglected Buzzers" Flow

### Goal
Retry channel change for buzzers stuck on default without affecting successful buzzers.

### Step-by-Step Test Plan

#### Step 1: Silent Move to Default (CH 13)
**Command:** *(NEW)* `BIN_CMD_SET_CHANNEL_SILENT = 11`
```
Binary: [0xBB][11][13][checksum]
```

**Expected Coordinator Behavior:**
- Receives command 11
- Changes own channel silently: `esp_wifi_set_channel(13)`
- **NO** ESP-NOW broadcast to buzzers
- Sends to backend: `COORD_CHANNEL_SILENT_CHANGE:13`

**Expected Buzzer Behavior:**
- Buzzer A (on CH 1): Hears nothing, stays on CH 1 ✓
- Buzzer B (on CH 1): Hears nothing, stays on CH 1 ✓
- Buzzer C (on CH 13): Hears nothing, stays on CH 13 ✓
- Buzzer D (on CH 13): Hears nothing, stays on CH 13 ✓

**Verification:**
- [ ] Coordinator channel = 13
- [ ] Buzzers A & B still on CH 1 (test by sending ARM command, they shouldn't respond)
- [ ] Buzzers C & D on CH 13 (test by sending ARM command, they should respond)

#### Step 2: Wait for Stabilization
```javascript
await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds
```

#### Step 3: Broadcast Channel Change to CH 1
**Command:** *(EXISTING)* `BIN_CMD_SET_CHANNEL = 10`
```
Binary: [0xBB][10][1][checksum]
```

**Expected Coordinator Behavior:**
- Receives command 10
- Broadcasts `CMD_CHANGE_CHANNEL(1)` via ESP-NOW
- Changes own channel: `esp_wifi_set_channel(1)`
- Sends to backend: `WIFI_CHANNEL_CHANGED:1`

**Expected Buzzer Behavior:**
- Buzzer A (on CH 1): Cannot hear (different channel) ✓
- Buzzer B (on CH 1): Cannot hear (different channel) ✓
- Buzzer C (on CH 13): Hears command → Moves to CH 1 ✓
- Buzzer D (on CH 13): Hears command → Moves to CH 1 ✓

**Verification:**
- [ ] Buzzers C & D send ACKs
- [ ] Buzzers C & D successfully move to CH 1
- [ ] All 4 buzzers now on CH 1
- [ ] All buzzers can send events

#### Final State
```
Coordinator: CH 1 ✅
Buzzer A:    CH 1 ✅ (never moved)
Buzzer B:    CH 1 ✅ (never moved)
Buzzer C:    CH 1 ✅ (just moved)
Buzzer D:    CH 1 ✅ (just moved)
```

---

## Implementation Checklist

### Phase 1: Testing Current Behavior ✓
- [x] Document current commands
- [ ] Test normal channel change (all success)
- [ ] Test partial failure scenario
- [ ] Verify buzzer behavior on different channels
- [ ] Log ACKs and failures

### Phase 2: Firmware Changes
- [ ] Add `BIN_CMD_SET_CHANNEL_SILENT` (11) to coordinator firmware
- [ ] Test silent channel change command
- [ ] Verify no ESP-NOW broadcast during silent change
- [ ] Update to buzzers needed? **NO**

### Phase 3: Backend Changes
- [ ] Add `setWifiChannelSilent(channel)` method to esp32Service
- [ ] Add `POST /api/wifi/channel/recall-neglected` endpoint
- [ ] Implement 3-step recall flow
- [ ] Add event handlers for silent channel change

### Phase 4: Frontend Changes
- [ ] Add "Recall Neglected Buzzers" button to WiFi section
- [ ] Show progress indicator (Step 1/3, 2/3, 3/3)
- [ ] Display toast notifications for each step
- [ ] Disable channel controls during operation

### Phase 5: Integration Testing
- [ ] Test complete recall flow with 4 buzzers
- [ ] Verify no disruption to successful buzzers
- [ ] Test error scenarios (coordinator disconnect, timeout)
- [ ] Load test with 15+ buzzers

---

## Success Criteria

✅ **Must Have:**
1. Silent channel change works (coordinator only, no broadcast)
2. Recall flow completes all 3 steps
3. Successfully migrated buzzers stay on target channel
4. Failed buzzers successfully move to target channel
5. All buzzers can communicate after recall

✅ **Should Have:**
1. Clear progress indication in UI
2. Detailed logging of each step
3. Error recovery if recall fails
4. Ability to cancel recall mid-operation

✅ **Nice to Have:**
1. Estimate of how many buzzers on each channel
2. Real-time ACK counter during recall
3. Automatic retry if recall partially fails
