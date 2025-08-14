class AdminConfig {
    constructor() {
        this.socket = io();
        this.currentTab = 'games';
        this.currentGame = null;
        this.editingItem = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
        this.loadInitialData();
    }

    initializeElements() {
        this.elements = {
            // Tab buttons
            tabButtons: document.querySelectorAll('.tab-button'),
            tabContents: document.querySelectorAll('.tab-content'),
            
            // Games tab
            createGameBtn: document.getElementById('create-game-btn'),
            gamesTableBody: document.getElementById('games-table-body'),
            gameModal: document.getElementById('game-modal'),
            gameForm: document.getElementById('game-form'),
            gameName: document.getElementById('game-name'),
            cancelGameBtn: document.getElementById('cancel-game-btn'),
            
            // Teams tab
            teamsGameSelect: document.getElementById('teams-game-select'),
            addTeamBtn: document.getElementById('add-team-btn'),
            teamsContainer: document.getElementById('teams-container'),
            teamModal: document.getElementById('team-modal'),
            teamForm: document.getElementById('team-form'),
            teamName: document.getElementById('team-name'),
            teamColor: document.getElementById('team-color'),
            buzzerId: document.getElementById('buzzer-id'),
            cancelTeamBtn: document.getElementById('cancel-team-btn'),
            
            // Questions tab
            questionsGameSelect: document.getElementById('questions-game-select'),
            addQuestionBtn: document.getElementById('add-question-btn'),
            questionsContainer: document.getElementById('questions-container'),
            questionModal: document.getElementById('question-modal'),
            questionForm: document.getElementById('question-form'),
            questionText: document.getElementById('question-text'),
            correctAnswer: document.getElementById('correct-answer'),
            timeLimit: document.getElementById('time-limit'),
            questionPoints: document.getElementById('question-points'),
            mediaUrl: document.getElementById('media-url'),
            cancelQuestionBtn: document.getElementById('cancel-question-btn'),
            
            // System tab
            refreshSystemStatusBtn: document.getElementById('refresh-system-status-btn'),
            serverStatus: document.getElementById('server-status'),
            systemDbStatus: document.getElementById('system-db-status'),
            systemEsp32Status: document.getElementById('system-esp32-status'),
            systemFirebaseStatus: document.getElementById('system-firebase-status'),
            serialPortInfo: document.getElementById('serial-port-info'),
            buzzerConnectionStatus: document.getElementById('buzzer-connection-status'),
            testAllBuzzersBtn: document.getElementById('test-all-buzzers-btn'),
            resetBuzzersBtn: document.getElementById('reset-buzzers-btn'),
            backupDbBtn: document.getElementById('backup-db-btn'),
            clearHistoryBtn: document.getElementById('clear-history-btn'),
            resetDbBtn: document.getElementById('reset-db-btn'),
            dbInfoText: document.getElementById('db-info-text'),
            logsDisplay: document.getElementById('logs-display'),
            refreshLogsBtn: document.getElementById('refresh-logs-btn'),
            clearLogsBtn: document.getElementById('clear-logs-btn'),
            
            // Toast container
            toastContainer: document.getElementById('toast-container')
        };
    }

    setupEventListeners() {
        // Tab navigation
        this.elements.tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.switchTab(button.dataset.tab);
            });
        });

        // Games tab
        this.elements.createGameBtn.addEventListener('click', () => this.showGameModal());
        this.elements.gameForm.addEventListener('submit', (e) => this.handleGameSubmit(e));
        this.elements.cancelGameBtn.addEventListener('click', () => this.hideGameModal());

        // Teams tab
        this.elements.teamsGameSelect.addEventListener('change', (e) => this.loadTeams(e.target.value));
        this.elements.addTeamBtn.addEventListener('click', () => this.showTeamModal());
        this.elements.teamForm.addEventListener('submit', (e) => this.handleTeamSubmit(e));
        this.elements.cancelTeamBtn.addEventListener('click', () => this.hideTeamModal());

        // Questions tab
        this.elements.questionsGameSelect.addEventListener('change', (e) => this.loadQuestions(e.target.value));
        this.elements.addQuestionBtn.addEventListener('click', () => this.showQuestionModal());
        this.elements.questionForm.addEventListener('submit', (e) => this.handleQuestionSubmit(e));
        this.elements.cancelQuestionBtn.addEventListener('click', () => this.hideQuestionModal());

        // System tab
        this.elements.refreshSystemStatusBtn.addEventListener('click', () => this.refreshSystemStatus());
        this.elements.testAllBuzzersBtn.addEventListener('click', () => this.testAllBuzzers());
        this.elements.resetBuzzersBtn.addEventListener('click', () => this.resetBuzzers());
        this.elements.backupDbBtn.addEventListener('click', () => this.backupDatabase());
        this.elements.clearHistoryBtn.addEventListener('click', () => this.clearGameHistory());
        this.elements.resetDbBtn.addEventListener('click', () => this.resetDatabase());
        this.elements.refreshLogsBtn.addEventListener('click', () => this.refreshLogs());
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());

        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Admin connected to server');
        });

        this.socket.on('disconnect', () => {
            console.log('Admin disconnected from server');
        });
    }

    async loadInitialData() {
        await this.loadGames();
        await this.refreshSystemStatus();
    }

    switchTab(tabName) {
        // Update tab buttons
        this.elements.tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });

        // Update tab content
        this.elements.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        this.currentTab = tabName;
    }

    async loadGames() {
        try {
            const response = await fetch('/api/games');
            const games = await response.json();
            
            this.updateGamesTable(games);
            this.updateGameSelectors(games);
        } catch (error) {
            this.showToast('Failed to load games', 'error');
        }
    }

    updateGamesTable(games) {
        const tbody = this.elements.gamesTableBody;
        tbody.innerHTML = '';

        games.forEach(game => {
            const row = document.createElement('tr');
            const createdDate = new Date(game.created_at).toLocaleDateString();
            
            row.innerHTML = `
                <td>${game.name}</td>
                <td><span class="status-indicator ${game.status}">${game.status}</span></td>
                <td>0</td>
                <td>0</td>
                <td>${createdDate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-info" onclick="admin.editGame('${game.id}')">Edit</button>
                        <button class="btn btn-danger" onclick="admin.deleteGame('${game.id}')">Delete</button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    updateGameSelectors(games) {
        const selectors = [this.elements.teamsGameSelect, this.elements.questionsGameSelect];
        
        selectors.forEach(select => {
            select.innerHTML = '<option value="">Select a game...</option>';
            games.forEach(game => {
                const option = document.createElement('option');
                option.value = game.id;
                option.textContent = game.name;
                select.appendChild(option);
            });
        });
    }

    // Game Management
    showGameModal(game = null) {
        this.editingItem = game;
        const title = game ? 'Edit Game' : 'Create New Game';
        document.getElementById('game-modal-title').textContent = title;
        
        this.elements.gameName.value = game ? game.name : '';
        this.elements.gameModal.classList.remove('hidden');
    }

    hideGameModal() {
        this.elements.gameModal.classList.add('hidden');
        this.elements.gameForm.reset();
        this.editingItem = null;
    }

    async handleGameSubmit(e) {
        e.preventDefault();
        
        const gameData = {
            name: this.elements.gameName.value
        };

        try {
            if (this.editingItem) {
                // Update existing game
                await fetch(`/api/games/${this.editingItem.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(gameData)
                });
                this.showToast('Game updated successfully', 'success');
            } else {
                // Create new game
                await fetch('/api/games', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(gameData)
                });
                this.showToast('Game created successfully', 'success');
            }
            
            this.hideGameModal();
            this.loadGames();
        } catch (error) {
            this.showToast('Failed to save game', 'error');
        }
    }

    async deleteGame(gameId) {
        if (!confirm('Are you sure you want to delete this game? This action cannot be undone.')) {
            return;
        }

        try {
            await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
            this.showToast('Game deleted successfully', 'success');
            this.loadGames();
        } catch (error) {
            this.showToast('Failed to delete game', 'error');
        }
    }

    // Team Management
    async loadTeams(gameId) {
        if (!gameId) {
            this.elements.teamsContainer.innerHTML = '<p>Select a game to manage teams</p>';
            this.elements.addTeamBtn.disabled = true;
            return;
        }

        this.elements.addTeamBtn.disabled = false;
        this.currentGame = gameId;

        try {
            const response = await fetch(`/api/groups/game/${gameId}`);
            const teams = await response.json();
            this.updateTeamsDisplay(teams);
        } catch (error) {
            this.showToast('Failed to load teams', 'error');
        }
    }

    updateTeamsDisplay(teams) {
        this.elements.teamsContainer.innerHTML = '';
        
        if (teams.length === 0) {
            this.elements.teamsContainer.innerHTML = '<p>No teams found. Add some teams to get started.</p>';
            return;
        }

        teams.forEach(team => {
            const teamElement = document.createElement('div');
            teamElement.className = 'team-item';
            teamElement.style.setProperty('--team-color', team.color);
            
            teamElement.innerHTML = `
                <div class="team-info">
                    <div class="team-name">${team.name}</div>
                    <div class="team-meta">Buzzer: ${team.buzzer_id} | Score: ${team.score}</div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-info" onclick="admin.editTeam('${team.id}')">Edit</button>
                    <button class="btn btn-danger" onclick="admin.deleteTeam('${team.id}')">Delete</button>
                </div>
            `;
            
            this.elements.teamsContainer.appendChild(teamElement);
        });
    }

    showTeamModal(team = null) {
        this.editingItem = team;
        const title = team ? 'Edit Team' : 'Add New Team';
        document.getElementById('team-modal-title').textContent = title;
        
        this.elements.teamName.value = team ? team.name : '';
        this.elements.teamColor.value = team ? team.color : '#667eea';
        this.elements.buzzerId.value = team ? team.buzzer_id : '';
        this.elements.teamModal.classList.remove('hidden');
    }

    hideTeamModal() {
        this.elements.teamModal.classList.add('hidden');
        this.elements.teamForm.reset();
        this.editingItem = null;
    }

    async handleTeamSubmit(e) {
        e.preventDefault();
        
        const teamData = {
            name: this.elements.teamName.value,
            color: this.elements.teamColor.value,
            buzzer_id: this.elements.buzzerId.value
        };

        try {
            if (this.editingItem) {
                await fetch(`/api/groups/${this.editingItem.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(teamData)
                });
                this.showToast('Team updated successfully', 'success');
            } else {
                await fetch(`/api/groups/game/${this.currentGame}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(teamData)
                });
                this.showToast('Team added successfully', 'success');
            }
            
            this.hideTeamModal();
            this.loadTeams(this.currentGame);
        } catch (error) {
            this.showToast('Failed to save team', 'error');
        }
    }

    async deleteTeam(teamId) {
        if (!confirm('Are you sure you want to delete this team?')) return;

        try {
            await fetch(`/api/groups/${teamId}`, { method: 'DELETE' });
            this.showToast('Team deleted successfully', 'success');
            this.loadTeams(this.currentGame);
        } catch (error) {
            this.showToast('Failed to delete team', 'error');
        }
    }

    // Question Management
    async loadQuestions(gameId) {
        if (!gameId) {
            this.elements.questionsContainer.innerHTML = '<p>Select a game to manage questions</p>';
            this.elements.addQuestionBtn.disabled = true;
            return;
        }

        this.elements.addQuestionBtn.disabled = false;
        this.currentGame = gameId;

        try {
            const response = await fetch(`/api/questions/game/${gameId}`);
            const questions = await response.json();
            this.updateQuestionsDisplay(questions);
        } catch (error) {
            this.showToast('Failed to load questions', 'error');
        }
    }

    updateQuestionsDisplay(questions) {
        this.elements.questionsContainer.innerHTML = '';
        
        if (questions.length === 0) {
            this.elements.questionsContainer.innerHTML = '<p>No questions found. Add some questions to get started.</p>';
            return;
        }

        questions.forEach((question, index) => {
            const questionElement = document.createElement('div');
            questionElement.className = 'question-item';
            
            questionElement.innerHTML = `
                <div class="question-info">
                    <div class="question-preview">${index + 1}. ${question.text}</div>
                    <div class="question-meta">Points: ${question.points} | Time: ${question.time_limit}s | Answer: ${question.correct_answer}</div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-info" onclick="admin.editQuestion('${question.id}')">Edit</button>
                    <button class="btn btn-danger" onclick="admin.deleteQuestion('${question.id}')">Delete</button>
                </div>
            `;
            
            this.elements.questionsContainer.appendChild(questionElement);
        });
    }

    showQuestionModal(question = null) {
        this.editingItem = question;
        const title = question ? 'Edit Question' : 'Add New Question';
        document.getElementById('question-modal-title').textContent = title;
        
        this.elements.questionText.value = question ? question.text : '';
        this.elements.correctAnswer.value = question ? question.correct_answer : '';
        this.elements.timeLimit.value = question ? question.time_limit : 30;
        this.elements.questionPoints.value = question ? question.points : 100;
        this.elements.mediaUrl.value = question ? question.media_url || '' : '';
        this.elements.questionModal.classList.remove('hidden');
    }

    hideQuestionModal() {
        this.elements.questionModal.classList.add('hidden');
        this.elements.questionForm.reset();
        this.editingItem = null;
    }

    async handleQuestionSubmit(e) {
        e.preventDefault();
        
        const questionData = {
            text: this.elements.questionText.value,
            correct_answer: this.elements.correctAnswer.value,
            time_limit: parseInt(this.elements.timeLimit.value),
            points: parseInt(this.elements.questionPoints.value),
            media_url: this.elements.mediaUrl.value || null
        };

        try {
            if (this.editingItem) {
                await fetch(`/api/questions/${this.editingItem.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionData)
                });
                this.showToast('Question updated successfully', 'success');
            } else {
                await fetch(`/api/questions/game/${this.currentGame}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionData)
                });
                this.showToast('Question added successfully', 'success');
            }
            
            this.hideQuestionModal();
            this.loadQuestions(this.currentGame);
        } catch (error) {
            this.showToast('Failed to save question', 'error');
        }
    }

    async deleteQuestion(questionId) {
        if (!confirm('Are you sure you want to delete this question?')) return;

        try {
            await fetch(`/api/questions/${questionId}`, { method: 'DELETE' });
            this.showToast('Question deleted successfully', 'success');
            this.loadQuestions(this.currentGame);
        } catch (error) {
            this.showToast('Failed to delete question', 'error');
        }
    }

    // System Management
    async refreshSystemStatus() {
        try {
            const [healthResponse, buzzerResponse] = await Promise.all([
                fetch('/health'),
                fetch('/api/buzzers/status')
            ]);

            const health = await healthResponse.json();
            const buzzerStatus = await buzzerResponse.json();

            this.updateSystemStatus(health, buzzerStatus);
        } catch (error) {
            this.showToast('Failed to refresh system status', 'error');
        }
    }

    updateSystemStatus(health, buzzerStatus) {
        this.elements.serverStatus.textContent = 'Online';
        this.elements.serverStatus.className = 'status-indicator online';

        this.elements.systemDbStatus.textContent = health.services.database ? 'Connected' : 'Disconnected';
        this.elements.systemDbStatus.className = `status-indicator ${health.services.database ? 'connected' : 'disconnected'}`;

        this.elements.systemEsp32Status.textContent = buzzerStatus.connected ? 'Connected' : 'Disconnected';
        this.elements.systemEsp32Status.className = `status-indicator ${buzzerStatus.connected ? 'connected' : 'disconnected'}`;

        this.elements.systemFirebaseStatus.textContent = health.services.firebase ? 'Connected' : 'Disconnected';
        this.elements.systemFirebaseStatus.className = `status-indicator ${health.services.firebase ? 'connected' : 'disconnected'}`;

        this.elements.serialPortInfo.textContent = buzzerStatus.port || 'Not configured';
        this.elements.buzzerConnectionStatus.textContent = buzzerStatus.connected ? 'Connected' : 'Disconnected';
    }

    async testAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/status');
            const status = await response.json();
            this.showToast(`Buzzer test completed. Status: ${status.connected ? 'Connected' : 'Disconnected'}`, 'info');
        } catch (error) {
            this.showToast('Failed to test buzzers', 'error');
        }
    }

    async resetBuzzers() {
        if (!confirm('Are you sure you want to reset all buzzers?')) return;

        try {
            await fetch('/api/buzzers/disarm', { method: 'POST' });
            this.showToast('Buzzers reset successfully', 'success');
        } catch (error) {
            this.showToast('Failed to reset buzzers', 'error');
        }
    }

    async backupDatabase() {
        this.showToast('Database backup feature not yet implemented', 'info');
    }

    async clearGameHistory() {
        if (!confirm('Are you sure you want to clear all game history? This action cannot be undone.')) return;
        this.showToast('Clear game history feature not yet implemented', 'info');
    }

    async resetDatabase() {
        if (!confirm('Are you sure you want to reset the entire database? This will delete ALL data and cannot be undone.')) return;
        this.showToast('Database reset feature not yet implemented', 'warning');
    }

    refreshLogs() {
        this.elements.logsDisplay.textContent = 'Log refresh feature not yet implemented';
    }

    clearLogs() {
        this.elements.logsDisplay.textContent = 'Logs cleared (feature not yet implemented)';
    }

    // Utility methods
    hideAllModals() {
        this.hideGameModal();
        this.hideTeamModal();
        this.hideQuestionModal();
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

    // Expose methods to global scope for onclick handlers
    editGame(gameId) { /* Implementation for editing games */ }
    editTeam(teamId) { /* Implementation for editing teams */ }
    editQuestion(questionId) { /* Implementation for editing questions */ }
}

// Initialize admin when DOM is loaded
let admin;
document.addEventListener('DOMContentLoaded', () => {
    admin = new AdminConfig();
});