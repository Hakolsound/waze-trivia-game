#!/usr/bin/env node
/**
 * Pi Server Launcher
 * Provides selection interface for running either Trivia Game Server or OSC Buzzer Server
 */

const inquirer = require('inquirer');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const figlet = require('figlet');

class PiServerLauncher {
    constructor() {
        this.servers = {
            trivia: {
                name: 'Trivia Game Server',
                description: 'Full trivia game with web interface, scoring, and team management',
                path: '../backend',
                command: 'node',
                args: ['server.js'],
                ports: [3000, 3001],
                color: chalk.green,
                icon: '🎮'
            },
            osc: {
                name: 'OSC Buzzer Server', 
                description: 'ESP32 buzzers to OSC message translator for lighting/audio systems',
                path: '../osc-buzzer-server',
                command: 'node',
                args: ['server.js'],
                ports: [3001],
                color: chalk.blue,
                icon: '🎛️'
            }
        };
        
        this.currentProcess = null;
        this.currentMode = null;
    }

    async start() {
        console.clear();
        await this.showWelcome();
        
        // Check for command line arguments
        const args = process.argv.slice(2);
        const modeArg = args.find(arg => arg.startsWith('--mode='));
        
        if (modeArg) {
            const mode = modeArg.split('=')[1];
            if (this.servers[mode]) {
                await this.launchServer(mode);
                return;
            }
        }
        
        await this.showMainMenu();
    }

    async showWelcome() {
        return new Promise((resolve) => {
            figlet('Pi Server', { font: 'Small' }, (err, data) => {
                if (err) {
                    console.log(chalk.cyan('🚀 Pi Server Launcher'));
                } else {
                    console.log(chalk.cyan(data));
                }
                console.log(chalk.gray('Choose which server to run on this Pi\n'));
                resolve();
            });
        });
    }

    async showMainMenu() {
        const choices = Object.keys(this.servers).map(key => {
            const server = this.servers[key];
            return {
                name: `${server.icon} ${server.color(server.name)} - ${server.description}`,
                value: key,
                short: server.name
            };
        });

        choices.push(
            { name: '─'.repeat(80), disabled: true },
            { name: '⚙️  System Management', value: 'system' },
            { name: '❌ Exit', value: 'exit' }
        );

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select server to launch:',
                choices: choices,
                pageSize: 10
            }
        ]);

        switch (action) {
            case 'exit':
                console.log(chalk.yellow('👋 Goodbye!'));
                process.exit(0);
                break;
            case 'system':
                await this.showSystemMenu();
                break;
            default:
                await this.showServerDetails(action);
                break;
        }
    }

    async showServerDetails(serverKey) {
        const server = this.servers[serverKey];
        
        console.clear();
        console.log(server.color(`\n${server.icon} ${server.name}`));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`Description: ${server.description}`);
        console.log(`Ports: ${server.ports.join(', ')}`);
        console.log(`Path: ${server.path}`);
        
        // Check if server files exist
        const serverPath = path.resolve(__dirname, server.path);
        const exists = fs.existsSync(serverPath);
        const packageExists = fs.existsSync(path.join(serverPath, 'package.json'));
        
        console.log(`Status: ${exists ? '✅ Available' : '❌ Not found'}`);
        console.log(`Dependencies: ${packageExists ? '✅ Ready' : '❌ Need installation'}`);

        const choices = [];
        
        if (exists) {
            choices.push({ name: '🚀 Launch Server', value: 'launch' });
            if (packageExists) {
                choices.push({ name: '🔧 Install/Update Dependencies', value: 'install' });
            }
        }
        
        choices.push(
            { name: '📊 Check Port Status', value: 'ports' },
            { name: '⬅️  Back to Main Menu', value: 'back' }
        );

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Choose action:',
                choices
            }
        ]);

        switch (action) {
            case 'launch':
                await this.launchServer(serverKey);
                break;
            case 'install':
                await this.installDependencies(serverKey);
                break;
            case 'ports':
                await this.checkPorts(server.ports);
                break;
            case 'back':
                await this.showMainMenu();
                break;
        }
    }

    async launchServer(serverKey) {
        const server = this.servers[serverKey];
        const serverPath = path.resolve(__dirname, server.path);
        
        if (!fs.existsSync(serverPath)) {
            console.error(chalk.red(`❌ Server path not found: ${serverPath}`));
            await this.pressEnterToContinue();
            await this.showMainMenu();
            return;
        }

        console.clear();
        console.log(server.color(`\n🚀 Launching ${server.name}...`));
        console.log(chalk.gray(`Path: ${serverPath}`));
        console.log(chalk.gray(`Command: ${server.command} ${server.args.join(' ')}`));
        console.log(chalk.yellow('\nPress Ctrl+C to stop the server\n'));

        // Kill any existing process on the same ports
        await this.killProcessesOnPorts(server.ports);

        this.currentMode = serverKey;
        this.currentProcess = spawn(server.command, server.args, {
            cwd: serverPath,
            stdio: 'inherit'
        });

        this.currentProcess.on('exit', (code) => {
            console.log(chalk.yellow(`\n📊 ${server.name} exited with code ${code}`));
            this.currentProcess = null;
            this.currentMode = null;
            setTimeout(() => this.showMainMenu(), 2000);
        });

        this.currentProcess.on('error', (error) => {
            console.error(chalk.red(`❌ Failed to start ${server.name}:`), error.message);
            setTimeout(() => this.showMainMenu(), 3000);
        });
    }

    async installDependencies(serverKey) {
        const server = this.servers[serverKey];
        const serverPath = path.resolve(__dirname, server.path);
        
        console.clear();
        console.log(server.color(`\n🔧 Installing dependencies for ${server.name}...`));
        
        return new Promise((resolve) => {
            const npmProcess = spawn('npm', ['install'], {
                cwd: serverPath,
                stdio: 'inherit'
            });

            npmProcess.on('exit', async (code) => {
                if (code === 0) {
                    console.log(chalk.green(`✅ Dependencies installed successfully!`));
                } else {
                    console.log(chalk.red(`❌ Installation failed with code ${code}`));
                }
                await this.pressEnterToContinue();
                await this.showServerDetails(serverKey);
                resolve();
            });
        });
    }

    async checkPorts(ports) {
        console.log(chalk.blue('\n🔍 Checking port status...'));
        
        for (const port of ports) {
            try {
                const result = await this.checkPortInUse(port);
                console.log(`Port ${port}: ${result ? chalk.red('❌ In use') : chalk.green('✅ Available')}`);
            } catch (error) {
                console.log(`Port ${port}: ${chalk.yellow('⚠️  Unknown')}`);
            }
        }
        
        await this.pressEnterToContinue();
        await this.showMainMenu();
    }

    checkPortInUse(port) {
        return new Promise((resolve) => {
            exec(`netstat -tuln | grep :${port}`, (error, stdout) => {
                resolve(!!stdout.trim());
            });
        });
    }

    async killProcessesOnPorts(ports) {
        for (const port of ports) {
            try {
                await this.killProcessOnPort(port);
            } catch (error) {
                // Ignore errors - port might not be in use
            }
        }
    }

    killProcessOnPort(port) {
        return new Promise((resolve) => {
            exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, () => {
                resolve(); // Always resolve, ignore errors
            });
        });
    }

    async showSystemMenu() {
        const choices = [
            { name: '🔄 Restart Pi', value: 'restart' },
            { name: '🔌 Shutdown Pi', value: 'shutdown' },
            { name: '📊 System Status', value: 'status' },
            { name: '🧹 Clean Logs', value: 'clean' },
            { name: '⬅️  Back to Main Menu', value: 'back' }
        ];

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action', 
                message: 'System Management:',
                choices
            }
        ]);

        switch (action) {
            case 'restart':
                await this.confirmSystemAction('restart');
                break;
            case 'shutdown':
                await this.confirmSystemAction('shutdown');
                break;
            case 'status':
                await this.showSystemStatus();
                break;
            case 'clean':
                await this.cleanLogs();
                break;
            case 'back':
                await this.showMainMenu();
                break;
        }
    }

    async confirmSystemAction(action) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to ${action} the Pi?`,
                default: false
            }
        ]);

        if (confirm) {
            console.log(chalk.yellow(`🔄 ${action.charAt(0).toUpperCase() + action.slice(1)}ing Pi...`));
            exec(`sudo ${action} now`);
        } else {
            await this.showSystemMenu();
        }
    }

    async showSystemStatus() {
        console.log(chalk.blue('\n📊 System Status:'));
        
        // Show basic system info
        const commands = [
            ['Uptime', 'uptime'],
            ['Memory', 'free -h'],
            ['Disk Space', 'df -h /'],
            ['CPU Temperature', 'vcgencmd measure_temp 2>/dev/null || echo "N/A"'],
            ['Network', 'hostname -I']
        ];

        for (const [label, cmd] of commands) {
            try {
                const result = await this.execCommand(cmd);
                console.log(`${label}: ${result.trim()}`);
            } catch (error) {
                console.log(`${label}: ${chalk.red('Error')}`);
            }
        }

        await this.pressEnterToContinue();
        await this.showSystemMenu();
    }

    execCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }

    async cleanLogs() {
        console.log(chalk.blue('🧹 Cleaning logs...'));
        
        try {
            await this.execCommand('sudo journalctl --vacuum-time=7d');
            await this.execCommand('sudo find /tmp -type f -atime +7 -delete 2>/dev/null');
            console.log(chalk.green('✅ Logs cleaned successfully'));
        } catch (error) {
            console.log(chalk.red('❌ Failed to clean logs'));
        }
        
        await this.pressEnterToContinue();
        await this.showSystemMenu();
    }

    async pressEnterToContinue() {
        await inquirer.prompt([
            {
                type: 'input',
                name: 'continue',
                message: 'Press Enter to continue...'
            }
        ]);
    }

    handleExit() {
        if (this.currentProcess) {
            console.log(chalk.yellow('\n🛑 Stopping server...'));
            this.currentProcess.kill('SIGTERM');
            
            setTimeout(() => {
                if (this.currentProcess) {
                    this.currentProcess.kill('SIGKILL');
                }
                process.exit(0);
            }, 5000);
        } else {
            console.log(chalk.yellow('\n👋 Goodbye!'));
            process.exit(0);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    if (global.launcher) {
        global.launcher.handleExit();
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    if (global.launcher) {
        global.launcher.handleExit();
    } else {
        process.exit(0);
    }
});

// Start the launcher
global.launcher = new PiServerLauncher();
global.launcher.start().catch(console.error);