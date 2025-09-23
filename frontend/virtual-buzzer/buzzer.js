class VirtualBuzzer {
    constructor() {
        this.socket = null;
        this.currentGame = null;
        this.selectedTeam = null;
        this.currentState = 'idle'; // idle, armed, pressed
        this.teams = [];
        this.buzzerId = null;
        this.password = 'michal'; // Simple password storage
        
        this.initializeElements();
        this.requestFullscreen();
        this.connectToServer();
        this.setupEventListeners();
    }

    initializeElements() {
        this.elements = {
            // Screen elements
            teamSelection: document.getElementById('team-selection'),
            buzzerScreen: document.getElementById('buzzer-screen'),
            errorScreen: document.getElementById('error-screen'),
            
            // Team selection elements
            teamsGrid: document.getElementById('teams-grid'),
            
            // Buzzer screen elements
            buzzerButton: document.getElementById('buzzer-button'),
            changeTeamBtn: document.getElementById('change-team-btn'),
            
            // Password modal elements
            passwordModal: document.getElementById('password-modal'),
            passwordInput: document.getElementById('password-input'),
            passwordSubmit: document.getElementById('password-submit'),
            passwordCancel: document.getElementById('password-cancel'),
            
            // Connection indicator
            connectionIndicator: document.getElementById('connection-indicator'),
            connectionDot: document.getElementById('connection-dot'),
            
            // Error elements
            errorMessage: document.getElementById('error-message'),
            retryBtn: document.getElementById('retry-btn')
        };
    }

    requestFullscreen() {
        // Attempt to enter fullscreen on mobile devices
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Try to enter fullscreen after first user interaction
            document.addEventListener('click', () => {
                this.enterFullscreen();
            }, { once: true });

            document.addEventListener('touchstart', () => {
                this.enterFullscreen();
            }, { once: true });
        }
    }

    enterFullscreen() {
        try {
            const element = document.documentElement;
            
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen();
            } else if (element.mozRequestFullScreen) {
                element.mozRequestFullScreen();
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
            }
        } catch (error) {
            console.log('Fullscreen not supported or blocked:', error);
        }
    }

    connectToServer() {
        try {
            this.updateConnectionStatus('connecting');
            this.socket = io();
            
            this.socket.on('connect', () => {
                console.log('Connected to server');
                this.updateConnectionStatus('connected');
                this.requestGameData();
            });

            // Add listener to confirm game room joining
            this.socket.on('game-joined', (data) => {
                console.log('Virtual buzzer successfully joined game room:', data);
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from server');
                this.updateConnectionStatus('disconnected');
                this.showError('Connection lost. Please refresh the page.');
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                this.updateConnectionStatus('error');
                this.showError('Unable to connect to server');
            });

            this.setupSocketListeners();
        } catch (error) {
            console.error('Socket initialization error:', error);
            this.updateConnectionStatus('error');
            this.showError('Failed to initialize connection');
        }
    }

    setupSocketListeners() {
        // Global game events
        this.socket.on('global-game-changed', (data) => {
            this.currentGame = data.game;
            // Join the new game room if we have a current game and selected team
            if (this.currentGame && this.selectedTeam) {
                this.socket.emit('join-game', this.currentGame.id);
            }
            this.updateTeamSelection();
        });

        // Teams update
        this.socket.on('teams-updated', (teams) => {
            this.teams = teams;
            this.updateTeamSelection();
        });

        // Buzzer events
        this.socket.on('buzzers-armed', (data) => {
            this.handleBuzzersArmed(data);
        });

        this.socket.on('buzzers-disarmed', (data) => {
            this.handleBuzzersDisarmed(data);
        });

        this.socket.on('question-end', (data) => {
            this.handleQuestionEnd(data);
        });

        this.socket.on('buzzer-acknowledged', (data) => {
            if (data.buzzerId === this.buzzerId) {
                this.handleBuzzerAcknowledged(data);
            }
        });

        // Listen for buzzer state response
        this.socket.on('buzzer-state-response', (data) => {
            this.handleBuzzerStateResponse(data);
        });
    }

    setupEventListeners() {
        // Buzzer button
        if (this.elements.buzzerButton) {
            this.elements.buzzerButton.addEventListener('click', () => {
                this.pressBuzzer();
            });

            // Touch events for mobile
            this.elements.buzzerButton.addEventListener('touchstart', (e) => {
                e.preventDefault(); // Prevent double-tap zoom
                this.pressBuzzer();
            });
        }

        // Change team button
        if (this.elements.changeTeamBtn) {
            this.elements.changeTeamBtn.addEventListener('click', () => {
                this.showPasswordModal();
            });
        }

        // Password modal events
        if (this.elements.passwordSubmit) {
            this.elements.passwordSubmit.addEventListener('click', () => {
                this.verifyPassword();
            });
        }

        if (this.elements.passwordCancel) {
            this.elements.passwordCancel.addEventListener('click', () => {
                this.hidePasswordModal();
            });
        }

        if (this.elements.passwordInput) {
            this.elements.passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.verifyPassword();
                }
            });
        }

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
                this.updateConnectionStatus('connecting');
                this.connectToServer();
                this.showTeamSelection();
            });
        }

        // Prevent context menu on long press
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    requestGameData() {
        // Request current global game and teams
        this.socket.emit('request-global-game');
        this.socket.emit('request-teams');
    }

    async updateTeamSelection() {
        if (!this.currentGame || !this.currentGame.groups) {
            this.elements.teamsGrid.innerHTML = `
                <div class="team-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading game data...</p>
                </div>
            `;
            return;
        }

        const settings = await this.getVirtualBuzzerSettings();
        const offlineThreshold = settings?.buzzerOfflineThreshold || 120;

        // Get available teams
        const availableTeams = await this.getAvailableTeams(offlineThreshold);

        if (availableTeams.length === 0) {
            this.elements.teamsGrid.innerHTML = `
                <div class="team-loading">
                    <p>All teams have active buzzers</p>
                </div>
            `;
            return;
        }

        this.elements.teamsGrid.innerHTML = availableTeams.map(team => `
            <div class="team-card available" data-team-id="${team.id}">
                <div class="team-avatar" style="background: ${team.color || '#4A9EBF'}">${team.name.charAt(0)}</div>
                <div class="team-name">${team.name}</div>
                <div class="team-status">Available</div>
            </div>
        `).join('');

        // Add click listeners to team cards
        document.querySelectorAll('.team-card[data-team-id]').forEach(card => {
            card.addEventListener('click', () => {
                const teamId = card.dataset.teamId;
                const team = availableTeams.find(t => t.id === teamId);
                if (team) {
                    this.selectTeam(team);
                }
            });
        });
    }

    async getVirtualBuzzerSettings() {
        if (!this.currentGame) return null;

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/virtual-buzzer-settings`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Failed to get virtual buzzer settings:', error);
        }
        return null;
    }

    async getAvailableTeams(offlineThreshold) {
        if (!this.currentGame) return [];

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/available-teams-virtual`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Failed to fetch available teams:', error);
        }
        return [];
    }

    selectTeam(team) {
        this.selectedTeam = team;
        this.buzzerId = `virtual_${team.id}_${Date.now()}`;
        
        // Show buzzer screen
        this.showBuzzerScreen();
        
        // Join the current game room to receive buzzer events
        if (this.currentGame) {
            console.log('Virtual buzzer joining game room:', this.currentGame.id);
            this.socket.emit('join-game', this.currentGame.id);
        }
        
        // Register with server as virtual buzzer for this team
        this.socket.emit('virtual-buzzer-register', {
            buzzerId: this.buzzerId,
            groupId: team.id,
            teamName: team.name
        });

        // Request current buzzer state to sync with system
        this.socket.emit('request-buzzer-state');

        console.log(`Selected team: ${team.name}`);
    }

    showTeamSelection() {
        this.hideAllScreens();
        this.elements.teamSelection.classList.add('active');
        // Enable scrolling for team selection on mobile
        document.body.classList.add('allow-scroll');
        this.updateTeamSelection();
    }

    showBuzzerScreen() {
        this.hideAllScreens();
        this.elements.buzzerScreen.classList.add('active');
        // Disable scrolling for buzzer screen
        document.body.classList.remove('allow-scroll');
        this.updateBuzzerState();
    }

    showError(message) {
        this.hideAllScreens();
        this.elements.errorScreen.classList.add('active');
        // Disable scrolling for error screen
        document.body.classList.remove('allow-scroll');
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
        }
    }

    hideAllScreens() {
        this.elements.teamSelection.classList.remove('active');
        this.elements.buzzerScreen.classList.remove('active');
        this.elements.errorScreen.classList.remove('active');
        // Reset scroll state
        document.body.classList.remove('allow-scroll');
    }

    updateBuzzerState() {
        const button = this.elements.buzzerButton;
        
        // Remove all state classes
        button.classList.remove('idle', 'armed', 'pressed');
        
        // Add current state class
        button.classList.add(this.currentState);
        
        // Update button state
        switch (this.currentState) {
            case 'armed':
                button.disabled = false;
                break;
            case 'pressed':
                button.disabled = true;
                break;
            case 'idle':
            default:
                button.disabled = true;
        }
    }

    pressBuzzer() {
        if (this.currentState !== 'armed' || !this.selectedTeam || !this.currentGame) return;

        this.currentState = 'pressed';
        this.updateBuzzerState();

        // Send buzzer press to server
        this.socket.emit('buzzer-press', {
            gameId: this.currentGame.id,
            buzzerId: this.buzzerId,
            groupId: this.selectedTeam.id,
            timestamp: Date.now()
        });

        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }
    }

    handleBuzzersArmed(data) {
        console.log('Virtual buzzer received buzzers-armed event:', data);
        if (this.selectedTeam && this.currentState !== 'pressed') {
            this.currentState = 'armed';
            this.updateBuzzerState();
            
            // Haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }
    }

    handleBuzzersDisarmed(data) {
        console.log('Virtual buzzer received buzzers-disarmed event:', data);
        // Always reset to idle when buzzers are disarmed, regardless of current state
        this.currentState = 'idle';
        this.updateBuzzerState();
    }

    handleQuestionEnd(data) {
        console.log('Virtual buzzer received question-end event:', data);
        // Ensure buzzer resets to idle when question ends
        this.currentState = 'idle';
        this.updateBuzzerState();
    }

    handleBuzzerAcknowledged(data) {
        console.log('Buzz acknowledged!');
    }

    handleBuzzerStateResponse(data) {
        console.log('Virtual buzzer received state sync:', data);

        // Sync virtual buzzer state with system state
        if (data.armed && this.currentState !== 'pressed') {
            this.currentState = 'armed';
            console.log('Virtual buzzer synced to ARMED state');
        } else if (!data.armed) {
            this.currentState = 'idle';
            console.log('Virtual buzzer synced to IDLE state');
        }

        this.updateBuzzerState();

        // Haptic feedback if transitioning to armed
        if (data.armed && navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    // Password Modal Methods
    showPasswordModal() {
        this.elements.passwordModal.classList.remove('hidden');
        this.elements.passwordInput.value = '';
        this.elements.passwordInput.focus();
    }

    hidePasswordModal() {
        this.elements.passwordModal.classList.add('hidden');
        this.elements.passwordInput.value = '';
    }

    verifyPassword() {
        const enteredPassword = this.elements.passwordInput.value;
        
        if (enteredPassword === this.password) {
            this.hidePasswordModal();
            this.changeTeam();
        } else {
            // Simple error indication
            this.elements.passwordInput.style.borderColor = '#dc3545';
            this.elements.passwordInput.value = '';
            this.elements.passwordInput.placeholder = 'Wrong password';
            
            // Reset after 2 seconds
            setTimeout(() => {
                this.elements.passwordInput.style.borderColor = '';
                this.elements.passwordInput.placeholder = 'Password';
            }, 2000);
        }
    }

    changeTeam() {
        // Reset current team selection
        this.selectedTeam = null;
        this.buzzerId = null;
        this.currentState = 'idle';
        
        // Go back to team selection
        this.showTeamSelection();
    }

    // Connection Status Methods
    updateConnectionStatus(status) {
        if (!this.elements.connectionDot) return;

        // Remove all status classes
        this.elements.connectionDot.classList.remove('connected', 'connecting', 'disconnected', 'error');
        
        // Add appropriate status class
        switch (status) {
            case 'connected':
                this.elements.connectionDot.classList.add('connected');
                break;
            case 'connecting':
                this.elements.connectionDot.classList.add('connecting');
                break;
            case 'disconnected':
            case 'error':
            default:
                // Default red state (no additional class needed)
                break;
        }
    }
}

// Initialize the virtual buzzer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new VirtualBuzzer();
});