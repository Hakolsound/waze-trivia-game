class HostControl {
    constructor() {
        this.socket = io();
        this.currentGame = null;
        this.currentQuestionIndex = 0;
        this.questions = [];
        this.teams = [];
        this.buzzerOrder = [];
        this.isQuestionActive = false;
        this.isBuzzersArmed = false;
        
        this.initializeElements();
        this.setupSocketListeners();
        this.setupEventListeners();
        this.loadGames();
        this.refreshSystemStatus();
    }

    initializeElements() {
        this.elements = {
            connectionStatus: document.getElementById('connection-status'),
            statusIndicator: document.getElementById('status-indicator'),
            gameSelect: document.getElementById('game-select'),
            loadGameBtn: document.getElementById('load-game-btn'),
            currentGameInfo: document.getElementById('current-game-info'),
            questionText: document.getElementById('question-text'),
            questionMeta: document.getElementById('question-meta'),
            startQuestionBtn: document.getElementById('start-question-btn'),
            endQuestionBtn: document.getElementById('end-question-btn'),
            nextQuestionBtn: document.getElementById('next-question-btn'),
            prevQuestionBtn: document.getElementById('prev-question-btn'),
            questionSelect: document.getElementById('question-select'),
            esp32Status: document.getElementById('esp32-status'),
            buzzersArmed: document.getElementById('buzzers-armed'),
            armBuzzersBtn: document.getElementById('arm-buzzers-btn'),
            disarmBuzzersBtn: document.getElementById('disarm-buzzers-btn'),
            testBuzzersBtn: document.getElementById('test-buzzers-btn'),
            buzzerList: document.getElementById('buzzer-list'),
            teamsScoring: document.getElementById('teams-scoring'),
            pointsInput: document.getElementById('points-input'),
            teamSelect: document.getElementById('team-select'),
            awardPointsBtn: document.getElementById('award-points-btn'),
            resetGameBtn: document.getElementById('reset-game-btn'),
            endGameBtn: document.getElementById('end-game-btn'),
            dbStatus: document.getElementById('db-status'),
            hardwareStatus: document.getElementById('hardware-status'),
            firebaseStatus: document.getElementById('firebase-status'),
            clientCount: document.getElementById('client-count'),
            refreshStatusBtn: document.getElementById('refresh-status-btn'),
            toastContainer: document.getElementById('toast-container')
        };
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            this.updateConnectionStatus('Connected', true);
            this.socket.emit('join-control');
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus('Disconnected', false);
        });

        this.socket.on('game-state', (state) => {
            this.handleGameState(state);
        });

        this.socket.on('buzzers-armed', () => {
            this.isBuzzersArmed = true;
            this.updateBuzzerStatus();
        });

        this.socket.on('buzzers-disarmed', () => {
            this.isBuzzersArmed = false;
            this.updateBuzzerStatus();
        });

        this.socket.on('buzzer-pressed', (data) => {
            this.handleBuzzerPress(data);
        });

        this.socket.on('question-start', (data) => {
            this.isQuestionActive = true;
            this.updateQuestionControls();
        });

        this.socket.on('question-end', (data) => {
            this.isQuestionActive = false;
            this.buzzerOrder = data.buzzerOrder || [];
            this.updateQuestionControls();
            this.updateBuzzerResults();
        });

        this.socket.on('score-update', (data) => {
            this.updateTeamDisplay();
            this.showToast('Points awarded successfully', 'success');
        });

        this.socket.on('game-reset', () => {
            this.resetControlPanel();
            this.showToast('Game has been reset', 'info');
        });
    }

    setupEventListeners() {
        this.elements.loadGameBtn.addEventListener('click', () => this.loadSelectedGame());
        this.elements.startQuestionBtn.addEventListener('click', () => this.startQuestion());
        this.elements.endQuestionBtn.addEventListener('click', () => this.endQuestion());
        this.elements.nextQuestionBtn.addEventListener('click', () => this.nextQuestion());
        this.elements.prevQuestionBtn.addEventListener('click', () => this.prevQuestion());
        this.elements.questionSelect.addEventListener('change', (e) => this.jumpToQuestion(e.target.value));
        this.elements.armBuzzersBtn.addEventListener('click', () => this.armBuzzers());
        this.elements.disarmBuzzersBtn.addEventListener('click', () => this.disarmBuzzers());
        this.elements.testBuzzersBtn.addEventListener('click', () => this.testBuzzers());
        this.elements.awardPointsBtn.addEventListener('click', () => this.awardPoints());
        this.elements.resetGameBtn.addEventListener('click', () => this.resetGame());
        this.elements.endGameBtn.addEventListener('click', () => this.endGame());
        this.elements.refreshStatusBtn.addEventListener('click', () => this.refreshSystemStatus());
    }

    async loadGames() {
        try {
            const response = await fetch('/api/games');
            const games = await response.json();
            
            this.elements.gameSelect.innerHTML = '<option value="">Select a game...</option>';
            games.forEach(game => {
                const option = document.createElement('option');
                option.value = game.id;
                option.textContent = `${game.name} (${game.status})`;
                this.elements.gameSelect.appendChild(option);
            });
        } catch (error) {
            this.showToast('Failed to load games', 'error');
        }
    }

    async loadSelectedGame() {
        const gameId = this.elements.gameSelect.value;
        if (!gameId) return;

        try {
            const response = await fetch(`/api/games/${gameId}`);
            const game = await response.json();
            
            this.currentGame = game;
            this.questions = game.questions || [];
            this.teams = game.groups || [];
            this.currentQuestionIndex = game.current_question_index || 0;
            
            this.updateGameDisplay();
            this.updateTeamDisplay();
            this.updateQuestionSelector();
            this.updateQuestionControls();
            
            this.socket.emit('join-game', gameId);
            this.showToast('Game loaded successfully', 'success');
        } catch (error) {
            this.showToast('Failed to load game', 'error');
        }
    }

    handleGameState(state) {
        if (!state) return;
        
        this.currentGame = state;
        this.questions = state.questions || [];
        this.teams = state.groups || [];
        this.currentQuestionIndex = state.current_question_index || 0;
        
        this.updateGameDisplay();
        this.updateTeamDisplay();
        this.updateQuestionDisplay();
    }

    updateGameDisplay() {
        if (this.currentGame) {
            this.elements.currentGameInfo.innerHTML = `
                <strong>${this.currentGame.name}</strong><br>
                Status: ${this.currentGame.status}<br>
                Teams: ${this.teams.length}<br>
                Questions: ${this.questions.length}
            `;
        }
    }

    updateTeamDisplay() {
        this.elements.teamsScoring.innerHTML = '';
        this.elements.teamSelect.innerHTML = '<option value="">Select team...</option>';
        
        this.teams.sort((a, b) => b.score - a.score).forEach(team => {
            const teamItem = document.createElement('div');
            teamItem.className = 'team-score-item';
            teamItem.style.setProperty('--team-color', team.color || '#667eea');
            teamItem.innerHTML = `
                <span class="team-name">${team.name}</span>
                <span class="team-score">${team.score}</span>
            `;
            this.elements.teamsScoring.appendChild(teamItem);
            
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            this.elements.teamSelect.appendChild(option);
        });
    }

    updateQuestionSelector() {
        this.elements.questionSelect.innerHTML = '<option value="">Select question...</option>';
        this.questions.forEach((question, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${index + 1}. ${question.text.substring(0, 50)}...`;
            this.elements.questionSelect.appendChild(option);
        });
        this.elements.questionSelect.disabled = false;
    }

    updateQuestionDisplay() {
        if (this.questions.length > 0 && this.currentQuestionIndex < this.questions.length) {
            const question = this.questions[this.currentQuestionIndex];
            this.elements.questionText.textContent = question.text;
            this.elements.questionMeta.innerHTML = `
                <span>Points: ${question.points}</span>
                <span>Time: ${question.time_limit}s</span>
                <span>Question ${this.currentQuestionIndex + 1} of ${this.questions.length}</span>
            `;
        } else {
            this.elements.questionText.textContent = 'No question selected';
            this.elements.questionMeta.innerHTML = '';
        }
    }

    updateQuestionControls() {
        const hasGame = this.currentGame !== null;
        const hasQuestions = this.questions.length > 0;
        const canStart = hasGame && hasQuestions && !this.isQuestionActive;
        const canEnd = this.isQuestionActive;
        
        this.elements.startQuestionBtn.disabled = !canStart;
        this.elements.endQuestionBtn.disabled = !canEnd;
        this.elements.nextQuestionBtn.disabled = !hasGame || this.currentQuestionIndex >= this.questions.length - 1;
        this.elements.prevQuestionBtn.disabled = !hasGame || this.currentQuestionIndex <= 0;
        this.elements.armBuzzersBtn.disabled = !canStart;
        this.elements.disarmBuzzersBtn.disabled = !this.isBuzzersArmed;
        this.elements.awardPointsBtn.disabled = !hasGame;
        this.elements.teamSelect.disabled = !hasGame;
        this.elements.questionSelect.disabled = !hasGame;
    }

    updateBuzzerStatus() {
        this.elements.buzzersArmed.textContent = this.isBuzzersArmed ? 'Yes' : 'No';
        this.updateQuestionControls();
    }

    updateBuzzerResults() {
        if (this.buzzerOrder.length === 0) {
            this.elements.buzzerList.innerHTML = 'No buzzer presses yet';
            return;
        }

        this.elements.buzzerList.innerHTML = '';
        this.buzzerOrder.forEach((buzzer, index) => {
            const buzzerItem = document.createElement('div');
            buzzerItem.className = 'buzzer-item';
            
            const teamName = this.getTeamName(buzzer.groupId);
            const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
            
            buzzerItem.innerHTML = `
                <div class="buzzer-position">${index + 1}</div>
                <span>${teamName}</span>
                <span>${deltaTime}s</span>
            `;
            
            this.elements.buzzerList.appendChild(buzzerItem);
        });
    }

    getTeamName(groupId) {
        const team = this.teams.find(t => t.id === groupId);
        return team ? team.name : 'Unknown Team';
    }

    async startQuestion() {
        if (!this.currentGame) return;

        try {
            await fetch(`/api/games/${this.currentGame.id}/start-question/${this.currentQuestionIndex}`, {
                method: 'POST'
            });
            this.buzzerOrder = [];
            this.updateBuzzerResults();
            this.showToast('Question started', 'success');
        } catch (error) {
            this.showToast('Failed to start question', 'error');
        }
    }

    async endQuestion() {
        if (!this.currentGame) return;

        try {
            await fetch(`/api/games/${this.currentGame.id}/end-question`, {
                method: 'POST'
            });
            this.showToast('Question ended', 'info');
        } catch (error) {
            this.showToast('Failed to end question', 'error');
        }
    }

    nextQuestion() {
        if (this.currentQuestionIndex < this.questions.length - 1) {
            this.currentQuestionIndex++;
            this.updateQuestionDisplay();
            this.updateQuestionControls();
        }
    }

    prevQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            this.updateQuestionDisplay();
            this.updateQuestionControls();
        }
    }

    jumpToQuestion(index) {
        if (index !== '' && index >= 0 && index < this.questions.length) {
            this.currentQuestionIndex = parseInt(index);
            this.updateQuestionDisplay();
            this.updateQuestionControls();
        }
    }

    async armBuzzers() {
        if (!this.currentGame) return;

        try {
            await fetch(`/api/buzzers/arm/${this.currentGame.id}`, {
                method: 'POST'
            });
            this.showToast('Buzzers armed', 'success');
        } catch (error) {
            this.showToast('Failed to arm buzzers', 'error');
        }
    }

    async disarmBuzzers() {
        try {
            await fetch('/api/buzzers/disarm', {
                method: 'POST'
            });
            this.showToast('Buzzers disarmed', 'info');
        } catch (error) {
            this.showToast('Failed to disarm buzzers', 'error');
        }
    }

    async testBuzzers() {
        try {
            const response = await fetch('/api/buzzers/status');
            const status = await response.json();
            this.showToast(`Buzzer test initiated. Connected: ${status.connected}`, 'info');
        } catch (error) {
            this.showToast('Failed to test buzzers', 'error');
        }
    }

    async awardPoints() {
        const teamId = this.elements.teamSelect.value;
        const points = parseInt(this.elements.pointsInput.value) || 0;
        
        if (!teamId || !this.currentGame) return;

        try {
            await fetch(`/api/games/${this.currentGame.id}/award-points`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: teamId, points })
            });
            
            this.elements.pointsInput.value = '100';
            this.elements.teamSelect.value = '';
        } catch (error) {
            this.showToast('Failed to award points', 'error');
        }
    }

    async resetGame() {
        if (!this.currentGame || !confirm('Are you sure you want to reset the game? This will clear all scores and buzzer history.')) {
            return;
        }

        try {
            await fetch(`/api/games/${this.currentGame.id}/reset`, {
                method: 'POST'
            });
        } catch (error) {
            this.showToast('Failed to reset game', 'error');
        }
    }

    async endGame() {
        if (!this.currentGame || !confirm('Are you sure you want to end the game?')) {
            return;
        }

        try {
            await fetch(`/api/games/${this.currentGame.id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'game_over' })
            });
            this.showToast('Game ended', 'info');
        } catch (error) {
            this.showToast('Failed to end game', 'error');
        }
    }

    async refreshSystemStatus() {
        try {
            const [healthResponse, buzzerResponse] = await Promise.all([
                fetch('/health'),
                fetch('/api/buzzers/status')
            ]);

            const health = await healthResponse.json();
            const buzzerStatus = await buzzerResponse.json();

            this.elements.dbStatus.textContent = health.services.database ? 'Connected' : 'Disconnected';
            this.elements.hardwareStatus.textContent = buzzerStatus.connected ? 'Connected' : 'Disconnected';
            this.elements.firebaseStatus.textContent = health.services.firebase ? 'Connected' : 'Disconnected';
            this.elements.esp32Status.textContent = buzzerStatus.connected ? 'Connected' : 'Disconnected';

        } catch (error) {
            this.showToast('Failed to refresh system status', 'error');
        }
    }

    handleBuzzerPress(data) {
        this.buzzerOrder.push(data);
        this.updateBuzzerResults();
    }

    resetControlPanel() {
        this.buzzerOrder = [];
        this.isQuestionActive = false;
        this.isBuzzersArmed = false;
        this.updateBuzzerResults();
        this.updateQuestionControls();
        this.updateBuzzerStatus();
    }

    updateConnectionStatus(status, connected) {
        this.elements.connectionStatus.textContent = status;
        this.elements.statusIndicator.classList.toggle('connected', connected);
    }

    showToast(message, type = 'info', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            toast.remove();
        });

        this.elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, duration);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HostControl();
});