class VirtualBuzzer {
    constructor() {
        this.socket = null;
        this.currentGame = null;
        this.selectedTeam = null;
        this.currentState = 'disconnected'; // disconnected, idle, armed, pressed
        this.teams = [];
        this.buzzerId = null;
        
        this.initializeElements();
        this.connectToServer();
        this.setupEventListeners();
    }

    initializeElements() {
        this.elements = {
            // Status elements
            statusDot: document.getElementById('status-dot'),
            statusText: document.getElementById('status-text'),
            
            // Screen elements
            teamSelection: document.getElementById('team-selection'),
            buzzerScreen: document.getElementById('buzzer-screen'),
            errorScreen: document.getElementById('error-screen'),
            
            // Team selection elements
            teamsGrid: document.getElementById('teams-grid'),
            
            // Buzzer screen elements
            teamAvatar: document.getElementById('team-avatar'),
            selectedTeamName: document.getElementById('selected-team-name'),
            changeTeamBtn: document.getElementById('change-team-btn'),
            
            // Game state elements
            stateIcon: document.getElementById('state-icon'),
            stateTitle: document.getElementById('state-title'),
            stateDescription: document.getElementById('state-description'),
            
            // Buzzer elements
            buzzerButton: document.getElementById('buzzer-button'),
            feedbackMessage: document.getElementById('feedback-message'),
            
            // Error elements
            errorMessage: document.getElementById('error-message'),
            retryBtn: document.getElementById('retry-btn')
        };
    }

    connectToServer() {
        try {
            this.socket = io();
            this.setupSocketListeners();
        } catch (error) {
            console.error('Failed to connect to server:', error);
            this.showError('Failed to connect to game server');
        }
    }

    setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
            this.buzzerId = `virtual_${this.socket.id}`;
            this.requestGameData();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
            this.currentState = 'disconnected';
            this.updateBuzzerState();
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.showError('Connection lost. Please check your internet connection.');
        });

        // Global game events
        this.socket.on('global-game-changed', (data) => {
            this.currentGame = data.game;
            this.updateGameData();
        });

        // Game state events
        this.socket.on('game-state', (state) => {
            this.handleGameStateChange(state);
        });

        this.socket.on('question-start', (data) => {
            this.handleQuestionStart(data);
        });

        this.socket.on('question-end', (data) => {
            this.handleQuestionEnd(data);
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

        this.socket.on('buzzer-acknowledged', (data) => {
            if (data.buzzerId === this.buzzerId) {
                this.handleBuzzerAcknowledged(data);
            }
        });
    }

    setupEventListeners() {
        // Change team button
        if (this.elements.changeTeamBtn) {
            this.elements.changeTeamBtn.addEventListener('click', () => {
                this.showTeamSelection();
            });
        }

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

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
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

    updateConnectionStatus(status) {
        const dot = this.elements.statusDot;
        const text = this.elements.statusText;

        dot.className = `status-dot ${status}`;
        
        switch (status) {
            case 'connected':
                text.textContent = 'Connected';
                break;
            case 'disconnected':
                text.textContent = 'Disconnected';
                break;
            default:
                text.textContent = 'Connecting...';
        }
    }

    updateGameData() {
        if (this.currentGame && this.currentGame.groups) {
            this.teams = this.currentGame.groups;
            this.updateTeamSelection();
        }
    }

    async updateTeamSelection() {
        if (!this.teams.length) {
            this.elements.teamsGrid.innerHTML = `
                <div class="team-loading">
                    <div class="loading-spinner"></div>
                    <p>No teams available</p>
                </div>
            `;
            return;
        }

        // Get virtual buzzer settings to determine offline threshold
        const settings = await this.getVirtualBuzzerSettings();
        const offlineThreshold = settings?.buzzerOfflineThreshold || 120;

        // Get online buzzers to determine availability
        const availableTeams = await this.getAvailableTeams(offlineThreshold);

        if (availableTeams.length === 0) {
            this.elements.teamsGrid.innerHTML = `
                <div class="team-loading">
                    <p>All teams have active buzzers</p>
                    <p class="info-text">Virtual buzzers are only available for teams without physical buzzers online</p>
                </div>
            `;
            return;
        }

        this.elements.teamsGrid.innerHTML = availableTeams.map(team => `
            <div class="team-card available" data-team-id="${team.id}">
                <div class="team-avatar" style="background: ${team.color || '#4A9EBF'}">${team.name.charAt(0)}</div>
                <div class="team-name">${team.name}</div>
                <div class="team-status">Available for virtual buzzer</div>
            </div>
        `).join('');

        // Add click listeners to team cards
        document.querySelectorAll('.team-card[data-team-id]').forEach(card => {
            card.addEventListener('click', () => {
                const teamId = card.dataset.teamId;
                const team = this.teams.find(t => t.id === teamId);
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
        // In a real implementation, we'd check which physical buzzers are online
        // For now, we'll return all teams as available
        return this.teams.filter(team => {
            // TODO: Check if team's physical buzzer has been offline for more than offlineThreshold seconds
            return true;
        });
    }

    selectTeam(team) {
        this.selectedTeam = team;
        this.updateTeamInfo();
        this.showBuzzerScreen();
        
        // Register with server as virtual buzzer for this team
        this.socket.emit('virtual-buzzer-register', {
            buzzerId: this.buzzerId,
            groupId: team.id,
            teamName: team.name
        });

        this.showFeedback('Team selected! You can now buzz in.', 'success');
    }

    updateTeamInfo() {
        if (!this.selectedTeam) return;

        this.elements.teamAvatar.style.background = this.selectedTeam.color || '#4A9EBF';
        this.elements.teamAvatar.textContent = this.selectedTeam.name.charAt(0);
        this.elements.selectedTeamName.textContent = this.selectedTeam.name;
    }

    handleGameStateChange(state) {
        if (state.currentQuestion) {
            this.updateGameState('question', '📝 Question Active', 'Get ready to buzz in!');
        } else {
            this.updateGameState('idle', '⏳ Waiting', 'Waiting for next question...');
        }
    }

    handleQuestionStart(data) {
        this.updateGameState('question', '📝 Question Started', 'Question is now active!');
        this.currentState = 'idle';
        this.updateBuzzerState();
    }

    handleQuestionEnd(data) {
        this.updateGameState('idle', '⏰ Time Up', 'Question time has ended');
        this.currentState = 'idle';
        this.updateBuzzerState();
    }

    handleBuzzersArmed(data) {
        if (this.selectedTeam && this.currentState !== 'pressed') {
            this.currentState = 'armed';
            this.updateBuzzerState();
            this.updateGameState('armed', '🔴 Ready to Buzz!', 'Tap the buzzer to answer');
            
            // Haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }
    }

    handleBuzzersDisarmed(data) {
        if (this.currentState !== 'pressed') {
            this.currentState = 'idle';
            this.updateBuzzerState();
            this.updateGameState('idle', '⏳ Waiting', 'Buzzers are not active');
        }
    }

    handleBuzzerAcknowledged(data) {
        this.showFeedback('Buzz received! Wait for your turn.', 'success');
    }

    updateGameState(state, title, description) {
        const icons = {
            idle: '⏳',
            question: '📝',
            armed: '🔴',
            pressed: '✅'
        };

        this.elements.stateIcon.textContent = icons[state] || '⏳';
        this.elements.stateTitle.textContent = title;
        this.elements.stateDescription.textContent = description;
    }

    updateBuzzerState() {
        const button = this.elements.buzzerButton;
        
        // Remove all state classes
        button.classList.remove('disabled', 'armed', 'pressed');
        
        switch (this.currentState) {
            case 'armed':
                button.classList.add('armed');
                button.disabled = false;
                break;
            case 'pressed':
                button.classList.add('pressed');
                button.disabled = true;
                break;
            case 'idle':
            case 'disconnected':
            default:
                button.classList.add('disabled');
                button.disabled = true;
        }
    }

    pressBuzzer() {
        if (this.currentState !== 'armed' || !this.selectedTeam) return;

        this.currentState = 'pressed';
        this.updateBuzzerState();
        this.updateGameState('pressed', '✅ Buzzed!', 'You have buzzed in!');

        // Send buzzer press to server
        this.socket.emit('buzzer-press', {
            buzzerId: this.buzzerId,
            groupId: this.selectedTeam.id,
            timestamp: Date.now()
        });

        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }

        this.showFeedback('Buzzed! Wait for host response.', 'success');
    }

    showFeedback(message, type = '') {
        const feedback = this.elements.feedbackMessage;
        feedback.textContent = message;
        feedback.className = `feedback-message show ${type}`;
        
        setTimeout(() => {
            feedback.classList.remove('show');
        }, 3000);
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    showTeamSelection() {
        this.showScreen('team-selection');
        this.updateTeamSelection();
    }

    showBuzzerScreen() {
        this.showScreen('buzzer-screen');
        this.updateBuzzerState();
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.showScreen('error-screen');
    }
}

// Initialize virtual buzzer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.virtualBuzzer = new VirtualBuzzer();
});