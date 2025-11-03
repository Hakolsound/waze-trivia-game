const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

class SystemMonitor {
    constructor() {
        this.isRaspberryPi = false;
        this.checkPlatform();
    }

    checkPlatform() {
        // Check if running on Raspberry Pi
        try {
            const fs = require('fs');
            if (fs.existsSync('/proc/device-tree/model')) {
                const model = fs.readFileSync('/proc/device-tree/model', 'utf8');
                this.isRaspberryPi = model.toLowerCase().includes('raspberry');
            }
        } catch (error) {
            console.log('Not running on Raspberry Pi');
        }
    }

    /**
     * Get CPU temperature in Celsius
     * @returns {Promise<number|null>} Temperature in Celsius or null if unavailable
     */
    async getCpuTemperature() {
        if (!this.isRaspberryPi) {
            // Return mock temperature for development on non-Pi systems
            return this.getMockTemperature();
        }

        try {
            // Try vcgencmd first (Raspberry Pi specific)
            const { stdout } = await execPromise('vcgencmd measure_temp');
            const match = stdout.match(/temp=([\d.]+)/);
            if (match) {
                return parseFloat(match[1]);
            }
        } catch (error) {
            // Fallback to thermal_zone reading
            try {
                const fs = require('fs');
                const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
                return parseInt(tempRaw) / 1000; // Convert millidegrees to degrees
            } catch (fallbackError) {
                console.error('Failed to read CPU temperature:', fallbackError.message);
                return null;
            }
        }

        return null;
    }

    /**
     * Get mock temperature for development (simulates 40-65°C range)
     */
    getMockTemperature() {
        // Simulate varying temperature between 40-65°C
        const baseTemp = 45;
        const variation = Math.sin(Date.now() / 10000) * 10;
        return Math.round((baseTemp + variation) * 10) / 10;
    }

    /**
     * Get temperature status based on temperature value
     * @param {number} temp - Temperature in Celsius
     * @returns {object} Status object with level and color
     */
    getTemperatureStatus(temp) {
        if (temp === null) {
            return { level: 'unknown', color: 'gray', text: 'N/A' };
        }

        // Raspberry Pi temperature thresholds:
        // < 60°C: Safe (green)
        // 60-70°C: Warm (yellow/orange)
        // 70-80°C: Hot (orange/red)
        // > 80°C: Critical (red) - throttling occurs at 82°C

        if (temp < 60) {
            return { level: 'safe', color: 'green', text: 'Safe' };
        } else if (temp < 70) {
            return { level: 'warm', color: 'yellow', text: 'Warm' };
        } else if (temp < 80) {
            return { level: 'hot', color: 'orange', text: 'Hot' };
        } else {
            return { level: 'critical', color: 'red', text: 'Critical' };
        }
    }

    /**
     * Get complete system info including temperature and status
     */
    async getSystemInfo() {
        const temp = await this.getCpuTemperature();
        const status = this.getTemperatureStatus(temp);

        return {
            temperature: temp,
            temperatureF: temp ? Math.round(temp * 9/5 + 32) : null,
            status: status.level,
            statusColor: status.color,
            statusText: status.text,
            isRaspberryPi: this.isRaspberryPi,
            timestamp: Date.now()
        };
    }
}

module.exports = new SystemMonitor();
