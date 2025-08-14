# 🔗 I2C Connection Guide (Advanced Option)

For the most integrated setup, you can connect the ESP32 coordinator to the Pi via I2C.

## 🔌 **I2C Wiring**
```
Pi GPIO    →  ESP32
GPIO 2 (SDA) → GPIO 21 (SDA)
GPIO 3 (SCL) → GPIO 22 (SCL)  
5V or 3.3V   → VIN or 3.3V
GND          → GND
```

## ⚙️ **Configuration**

### Pi Side (`/boot/config.txt`)
```bash
# Enable I2C
dtparam=i2c_arm=on
dtparam=i2c1_baudrate=400000
```

### ESP32 Side (Arduino code)
```cpp
#include <Wire.h>
#define I2C_SLAVE_ADDR 0x42

void setup() {
  Wire.begin(I2C_SLAVE_ADDR);
  Wire.onRequest(requestEvent);
  Wire.onReceive(receiveEvent);
}
```

### Node.js Side
```javascript
const i2c = require('i2c-bus');
const bus = i2c.openSync(1);

// Read from ESP32
const buffer = Buffer.alloc(16);
bus.readI2cBlock(0x42, 0, 16, buffer);
```

## 📊 **Pros & Cons**

### I2C Pros:
- ✅ Only 4 wires total (including power)
- ✅ Multiple device support on same bus
- ✅ Hardware-level addressing
- ✅ Very clean integration

### I2C Cons:
- ❌ More complex implementation
- ❌ Limited data rate for high-frequency updates
- ❌ Requires additional I2C libraries

### GPIO Serial Pros:
- ✅ Simple implementation (current code works)
- ✅ High data rate
- ✅ Bidirectional communication
- ✅ Standard serial protocols

### GPIO Serial Cons:
- ❌ Uses 2 GPIO pins
- ❌ Point-to-point only

## 🎯 **Recommendation**
Stick with **GPIO Serial** for simplicity and reliability. It's much easier to implement and debug.