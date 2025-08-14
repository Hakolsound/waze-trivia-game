class AdminConfig {
    constructor() {
        this.socket = io();
        this.currentTab = 'games';
        this.currentGame = null;
        this.editingItem = null;
        this.currentBrandingGame = null;
        this.brandingData = {};
        this.buzzerDevices = new Map();
        
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
            
            // Branding tab
            brandingGameSelect: document.getElementById('branding-game-select'),
            brandingContent: document.getElementById('branding-content'),
            noBrandingSelected: document.getElementById('no-game-branding'),
            gameLogo: document.getElementById('game-logo'),
            logoPosition: document.getElementById('logo-position'),
            logoSize: document.getElementById('logo-size'),
            primaryColor: document.getElementById('primary-color'),
            secondaryColor: document.getElementById('secondary-color'),
            accentColor: document.getElementById('accent-color'),
            backgroundStyle: document.getElementById('background-style'),
            fontFamily: document.getElementById('font-family'),
            showTimer: document.getElementById('show-timer'),
            showScores: document.getElementById('show-scores'),
            autoAdvance: document.getElementById('auto-advance'),
            defaultQuestionTime: document.getElementById('default-question-time'),
            maxGroups: document.getElementById('max-groups'),
            gameDescription: document.getElementById('game-description'),
            previewTitle: document.getElementById('preview-title'),
            previewLogo: document.getElementById('preview-logo'),
            gamePreview: document.getElementById('game-preview'),
            saveBrandingBtn: document.getElementById('save-branding-btn'),
            resetBrandingBtn: document.getElementById('reset-branding-btn'),
            exportThemeBtn: document.getElementById('export-theme-btn'),
            importThemeBtn: document.getElementById('import-theme-btn'),
            importThemeInput: document.getElementById('import-theme-input'),
            logoPreviewImg: document.getElementById('logo-preview-img'),
            currentLogoPreview: document.getElementById('current-logo-preview'),
            removeLogo: document.getElementById('remove-logo-btn'),

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
            
            // Buzzer status elements
            buzzerStatusList: document.getElementById('buzzer-status-list'),
            refreshBuzzersBtn: document.getElementById('refresh-buzzers-btn'),
            armAllBuzzersBtn: document.getElementById('arm-all-buzzers-btn'),
            disarmAllBuzzersBtn: document.getElementById('disarm-all-buzzers-btn'),
            
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

        // Branding tab
        this.elements.brandingGameSelect.addEventListener('change', (e) => this.loadGameBranding(e.target.value));
        this.elements.gameLogo.addEventListener('change', (e) => this.handleLogoUpload(e));
        this.elements.removeLogo.addEventListener('click', () => this.removeLogo());
        this.elements.saveBrandingBtn.addEventListener('click', () => this.saveBranding());
        this.elements.resetBrandingBtn.addEventListener('click', () => this.resetBranding());
        this.elements.exportThemeBtn.addEventListener('click', () => this.exportTheme());
        this.elements.importThemeBtn.addEventListener('click', () => this.elements.importThemeInput.click());
        this.elements.importThemeInput.addEventListener('change', (e) => this.importTheme(e));

        // Real-time preview updates
        const brandingInputs = [
            'logoPosition', 'logoSize', 'primaryColor', 'secondaryColor', 
            'accentColor', 'backgroundStyle', 'fontFamily', 'defaultQuestionTime'
        ];
        brandingInputs.forEach(inputName => {
            this.elements[inputName].addEventListener('change', () => this.updatePreview());
            this.elements[inputName].addEventListener('input', () => this.updatePreview());
        });

        // Color preview updates
        ['primaryColor', 'secondaryColor', 'accentColor'].forEach(colorInput => {
            this.elements[colorInput].addEventListener('input', (e) => {
                const previewId = colorInput.replace('Color', 'Preview');
                if (this.elements[previewId]) {
                    this.elements[previewId].textContent = e.target.value;
                }
            });
        });

        // Preset buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('preset-btn')) {
                this.applyColorPreset(e.target.dataset.preset);
            }
        });

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
        
        // Buzzer status management
        this.elements.refreshBuzzersBtn.addEventListener('click', () => this.refreshBuzzerStatus());
        this.elements.armAllBuzzersBtn.addEventListener('click', () => this.armAllBuzzers());
        this.elements.disarmAllBuzzersBtn.addEventListener('click', () => this.disarmAllBuzzers());

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
        
        // Listen for ESP32 device updates
        this.socket.on('esp32-device', (data) => {
            this.updateBuzzerDevice(data);
        });
        
        // Listen for buzzer heartbeats
        this.socket.on('buzzer-heartbeat', (data) => {
            this.updateBuzzerHeartbeat(data);
        });
        
        // Listen for ESP32 status changes
        this.socket.on('esp32-status', (data) => {
            this.updateESP32Status(data);
        });
    }

    async loadInitialData() {
        await this.loadGames();
        await this.refreshSystemStatus();
        this.startBuzzerStatusMonitoring();
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
        const selectors = [
            this.elements.teamsGameSelect, 
            this.elements.questionsGameSelect,
            this.elements.brandingGameSelect
        ];
        
        selectors.forEach(select => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select a game...</option>';
            games.forEach(game => {
                const option = document.createElement('option');
                option.value = game.id;
                option.textContent = game.name;
                select.appendChild(option);
            });
            // Restore selection if it still exists
            if (currentValue && games.find(g => g.id === currentValue)) {
                select.value = currentValue;
            }
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

    // Branding Management
    async loadGameBranding(gameId) {
        if (!gameId) {
            this.elements.brandingContent.classList.remove('active');
            this.elements.noBrandingSelected.style.display = 'block';
            this.currentBrandingGame = null;
            this.disableBrandingButtons();
            return;
        }

        try {
            const response = await fetch(`/api/games/${gameId}/branding`);
            const branding = await response.json();
            
            this.currentBrandingGame = gameId;
            this.brandingData = branding;
            
            this.populateBrandingForm(branding);
            this.elements.brandingContent.classList.add('active');
            this.elements.noBrandingSelected.style.display = 'none';
            this.enableBrandingButtons();
            this.updatePreview();
            
        } catch (error) {
            console.error('Failed to load game branding:', error);
            this.showToast('Failed to load game branding', 'error');
        }
    }

    populateBrandingForm(branding) {
        // Logo and visual identity
        if (branding.logo_url) {
            this.elements.logoPreviewImg.src = branding.logo_url;
            this.elements.currentLogoPreview.classList.remove('hidden');
        } else {
            this.elements.currentLogoPreview.classList.add('hidden');
        }
        
        this.elements.logoPosition.value = branding.logo_position || 'top-right';
        this.elements.logoSize.value = branding.logo_size || 'medium';
        
        // Color scheme
        this.elements.primaryColor.value = branding.primary_color || '#667eea';
        this.elements.secondaryColor.value = branding.secondary_color || '#764ba2';
        this.elements.accentColor.value = branding.accent_color || '#FFD700';
        this.elements.backgroundStyle.value = branding.background_style || 'gradient';
        
        // Typography and layout
        this.elements.fontFamily.value = branding.font_family || 'Segoe UI';
        this.elements.showTimer.checked = branding.show_timer !== 0;
        this.elements.showScores.checked = branding.show_scores !== 0;
        this.elements.autoAdvance.checked = branding.auto_advance === 1;
        
        // Game settings
        this.elements.defaultQuestionTime.value = branding.default_question_time || 30;
        this.elements.maxGroups.value = branding.max_groups || 8;
        this.elements.gameDescription.value = branding.game_description || '';
        
        // Update color previews
        document.getElementById('primary-preview').textContent = this.elements.primaryColor.value;
        document.getElementById('secondary-preview').textContent = this.elements.secondaryColor.value;
        document.getElementById('accent-preview').textContent = this.elements.accentColor.value;
        
        // Update preview title
        this.elements.previewTitle.textContent = branding.name || 'Game Preview';
    }

    async handleLogoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.showToast('Please select a valid image file', 'error');
            return;
        }
        
        // Validate file size (2MB limit)
        if (file.size > 2 * 1024 * 1024) {
            this.showToast('File size must be less than 2MB', 'error');
            return;
        }
        
        try {
            const formData = new FormData();
            formData.append('logo', file);
            formData.append('gameId', this.currentBrandingGame);
            
            const response = await fetch('/api/games/upload-logo', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Upload failed');
            }
            
            const result = await response.json();
            
            // Update UI with new logo
            this.elements.logoPreviewImg.src = result.logoUrl;
            this.elements.currentLogoPreview.classList.remove('hidden');
            this.brandingData.logo_url = result.logoUrl;
            
            this.updatePreview();
            this.showToast('Logo uploaded successfully', 'success');
            
        } catch (error) {
            console.error('Logo upload failed:', error);
            this.showToast('Failed to upload logo', 'error');
        }
    }

    async removeLogo() {
        if (!confirm('Are you sure you want to remove the logo?')) return;
        
        try {
            await fetch(`/api/games/${this.currentBrandingGame}/logo`, {
                method: 'DELETE'
            });
            
            this.elements.currentLogoPreview.classList.add('hidden');
            this.elements.logoPreviewImg.src = '';
            this.elements.gameLogo.value = '';
            this.brandingData.logo_url = null;
            
            this.updatePreview();
            this.showToast('Logo removed successfully', 'success');
            
        } catch (error) {
            console.error('Failed to remove logo:', error);
            this.showToast('Failed to remove logo', 'error');
        }
    }

    async saveBranding() {
        if (!this.currentBrandingGame) return;
        
        const brandingData = {
            logo_url: this.brandingData.logo_url,
            logo_position: this.elements.logoPosition.value,
            logo_size: this.elements.logoSize.value,
            primary_color: this.elements.primaryColor.value,
            secondary_color: this.elements.secondaryColor.value,
            accent_color: this.elements.accentColor.value,
            background_style: this.elements.backgroundStyle.value,
            font_family: this.elements.fontFamily.value,
            show_timer: this.elements.showTimer.checked ? 1 : 0,
            show_scores: this.elements.showScores.checked ? 1 : 0,
            auto_advance: this.elements.autoAdvance.checked ? 1 : 0,
            default_question_time: parseInt(this.elements.defaultQuestionTime.value),
            max_groups: parseInt(this.elements.maxGroups.value),
            game_description: this.elements.gameDescription.value
        };
        
        try {
            const response = await fetch(`/api/games/${this.currentBrandingGame}/branding`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(brandingData)
            });
            
            if (!response.ok) {
                throw new Error('Save failed');
            }
            
            this.brandingData = { ...this.brandingData, ...brandingData };
            this.showToast('Branding saved successfully', 'success');
            
        } catch (error) {
            console.error('Failed to save branding:', error);
            this.showToast('Failed to save branding', 'error');
        }
    }

    async resetBranding() {
        if (!confirm('Are you sure you want to reset branding to defaults? This will remove all customizations.')) return;
        
        try {
            const response = await fetch(`/api/games/${this.currentBrandingGame}/branding/reset`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Reset failed');
            }
            
            const defaultBranding = await response.json();
            this.populateBrandingForm(defaultBranding);
            this.updatePreview();
            this.showToast('Branding reset to defaults', 'success');
            
        } catch (error) {
            console.error('Failed to reset branding:', error);
            this.showToast('Failed to reset branding', 'error');
        }
    }

    updatePreview() {
        if (!this.currentBrandingGame) return;
        
        const preview = this.elements.gamePreview;
        const logo = this.elements.previewLogo;
        
        // Update colors and gradient
        const primaryColor = this.elements.primaryColor.value;
        const secondaryColor = this.elements.secondaryColor.value;
        const accentColor = this.elements.accentColor.value;
        
        preview.style.background = `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`;
        preview.style.fontFamily = this.elements.fontFamily.value;
        
        // Update logo
        if (this.brandingData.logo_url) {
            logo.style.backgroundImage = `url('${this.brandingData.logo_url}')`;
            logo.className = `preview-logo ${this.elements.logoPosition.value}`;
            
            const sizeMap = {
                'small': '80px',
                'medium': '120px', 
                'large': '160px',
                'x-large': '200px'
            };
            const size = sizeMap[this.elements.logoSize.value] || '120px';
            logo.style.width = size;
            logo.style.height = size;
            logo.classList.remove('hidden');
        } else {
            logo.classList.add('hidden');
        }
        
        // Update timer display
        const timer = preview.querySelector('.preview-timer');
        if (this.elements.showTimer.checked) {
            timer.style.display = 'flex';
            timer.textContent = this.elements.defaultQuestionTime.value;
        } else {
            timer.style.display = 'none';
        }
        
        // Update scores display
        const scores = preview.querySelector('.preview-scores');
        if (this.elements.showScores.checked) {
            scores.style.display = 'flex';
        } else {
            scores.style.display = 'none';
        }
    }

    applyColorPreset(preset) {
        const presets = {
            default: { primary: '#667eea', secondary: '#764ba2', accent: '#FFD700' },
            corporate: { primary: '#4a5568', secondary: '#718096', accent: '#e2e8f0' },
            energetic: { primary: '#ff7e00', secondary: '#ff4500', accent: '#ffd700' },
            nature: { primary: '#48bb78', secondary: '#38a169', accent: '#68d391' },
            royal: { primary: '#805ad5', secondary: '#553c9a', accent: '#b794f6' },
            modern: { primary: '#2d3748', secondary: '#1a202c', accent: '#4a5568' }
        };
        
        const colors = presets[preset];
        if (!colors) return;
        
        this.elements.primaryColor.value = colors.primary;
        this.elements.secondaryColor.value = colors.secondary;
        this.elements.accentColor.value = colors.accent;
        
        // Update previews
        document.getElementById('primary-preview').textContent = colors.primary;
        document.getElementById('secondary-preview').textContent = colors.secondary;  
        document.getElementById('accent-preview').textContent = colors.accent;
        
        this.updatePreview();
    }

    exportTheme() {
        if (!this.currentBrandingGame) return;
        
        const themeData = {
            name: `${this.brandingData.name || 'Game'} Theme`,
            version: '1.0',
            exported: new Date().toISOString(),
            branding: {
                logo_position: this.elements.logoPosition.value,
                logo_size: this.elements.logoSize.value,
                primary_color: this.elements.primaryColor.value,
                secondary_color: this.elements.secondaryColor.value,
                accent_color: this.elements.accentColor.value,
                background_style: this.elements.backgroundStyle.value,
                font_family: this.elements.fontFamily.value,
                show_timer: this.elements.showTimer.checked,
                show_scores: this.elements.showScores.checked,
                auto_advance: this.elements.autoAdvance.checked,
                default_question_time: parseInt(this.elements.defaultQuestionTime.value),
                max_groups: parseInt(this.elements.maxGroups.value)
            }
        };
        
        const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.brandingData.name || 'game'}-theme.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showToast('Theme exported successfully', 'success');
    }

    async importTheme(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const themeData = JSON.parse(text);
            
            if (!themeData.branding) {
                throw new Error('Invalid theme file format');
            }
            
            const branding = themeData.branding;
            
            // Apply theme data to form
            this.elements.logoPosition.value = branding.logo_position || 'top-right';
            this.elements.logoSize.value = branding.logo_size || 'medium';
            this.elements.primaryColor.value = branding.primary_color || '#667eea';
            this.elements.secondaryColor.value = branding.secondary_color || '#764ba2';
            this.elements.accentColor.value = branding.accent_color || '#FFD700';
            this.elements.backgroundStyle.value = branding.background_style || 'gradient';
            this.elements.fontFamily.value = branding.font_family || 'Segoe UI';
            this.elements.showTimer.checked = branding.show_timer !== false;
            this.elements.showScores.checked = branding.show_scores !== false;
            this.elements.autoAdvance.checked = branding.auto_advance === true;
            this.elements.defaultQuestionTime.value = branding.default_question_time || 30;
            this.elements.maxGroups.value = branding.max_groups || 8;
            
            // Update color previews
            document.getElementById('primary-preview').textContent = this.elements.primaryColor.value;
            document.getElementById('secondary-preview').textContent = this.elements.secondaryColor.value;
            document.getElementById('accent-preview').textContent = this.elements.accentColor.value;
            
            this.updatePreview();
            this.showToast(`Theme "${themeData.name}" imported successfully`, 'success');
            
        } catch (error) {
            console.error('Failed to import theme:', error);
            this.showToast('Failed to import theme file', 'error');
        }
        
        // Clear file input
        event.target.value = '';
    }

    enableBrandingButtons() {
        this.elements.saveBrandingBtn.disabled = false;
        this.elements.resetBrandingBtn.disabled = false;
        this.elements.exportThemeBtn.disabled = false;
        this.elements.importThemeBtn.disabled = false;
    }

    disableBrandingButtons() {
        this.elements.saveBrandingBtn.disabled = true;
        this.elements.resetBrandingBtn.disabled = true;
        this.elements.exportThemeBtn.disabled = true;
        this.elements.importThemeBtn.disabled = true;
    }

    // Buzzer Status Monitoring
    startBuzzerStatusMonitoring() {
        // Initial load
        this.refreshBuzzerStatus();
        
        // Update status every 30 seconds
        this.buzzerStatusInterval = setInterval(() => {
            this.updateBuzzerStatusDisplay();
        }, 30000);
    }

    updateBuzzerDevice(data) {
        const deviceId = data.device_id || data.id;
        const now = Date.now();
        
        this.buzzerDevices.set(deviceId, {
            ...data,
            last_seen: now,
            status: 'online'
        });
        
        this.updateBuzzerStatusDisplay();
    }

    updateBuzzerHeartbeat(data) {
        const deviceId = data.device_id || data.id;
        const now = Date.now();
        
        if (this.buzzerDevices.has(deviceId)) {
            const device = this.buzzerDevices.get(deviceId);
            device.last_seen = now;
            device.status = 'online';
            this.buzzerDevices.set(deviceId, device);
        } else {
            // Create new device entry from heartbeat
            this.buzzerDevices.set(deviceId, {
                device_id: deviceId,
                name: `Buzzer ${deviceId}`,
                last_seen: now,
                status: 'online',
                ...data
            });
        }
        
        this.updateBuzzerStatusDisplay();
    }

    updateESP32Status(data) {
        // Update ESP32 connection status
        if (this.elements.systemEsp32Status) {
            this.elements.systemEsp32Status.textContent = data.connected ? 'Connected' : 'Disconnected';
            this.elements.systemEsp32Status.className = `status-indicator ${data.connected ? 'connected' : 'disconnected'}`;
        }
        
        if (this.elements.buzzerConnectionStatus) {
            this.elements.buzzerConnectionStatus.textContent = data.connected ? 'Connected' : 'Disconnected';
        }
    }

    updateBuzzerStatusDisplay() {
        const container = this.elements.buzzerStatusList;
        const now = Date.now();
        const staleMasLength = 60000; // 60 seconds
        
        if (this.buzzerDevices.size === 0) {
            container.innerHTML = '<div class="no-buzzers">No buzzers detected</div>';
            return;
        }
        
        container.innerHTML = '';
        
        // Sort devices by last seen (most recent first)
        const sortedDevices = Array.from(this.buzzerDevices.values()).sort((a, b) => b.last_seen - a.last_seen);
        
        sortedDevices.forEach(device => {
            const timeSinceLastSeen = now - device.last_seen;
            let status = 'offline';
            let statusText = 'Offline';
            
            if (timeSinceLastSeen < staleMasLength) {
                status = 'online';
                statusText = 'Online';
            } else if (timeSinceLastSeen < staleMasLength * 2) {
                status = 'stale';
                statusText = 'Stale';
            }
            
            const buzzerElement = document.createElement('div');
            buzzerElement.className = `buzzer-item ${status}`;
            
            const lastSeenText = this.formatLastSeen(timeSinceLastSeen);
            
            buzzerElement.innerHTML = `
                <div class="buzzer-info">
                    <div class="buzzer-name">${device.name || `Buzzer ${device.device_id}`}</div>
                    <div class="buzzer-meta">
                        <span>ID: ${device.device_id}</span>
                        <span class="last-seen">Last seen: ${lastSeenText}</span>
                        ${device.team ? `<span>Team: ${device.team}</span>` : ''}
                    </div>
                </div>
                <div class="buzzer-status">
                    <div class="buzzer-status-dot"></div>
                    <span>${statusText}</span>
                </div>
            `;
            
            container.appendChild(buzzerElement);
        });
    }

    formatLastSeen(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        
        if (seconds < 60) {
            return `${seconds}s ago`;
        } else if (seconds < 3600) {
            return `${Math.floor(seconds / 60)}m ago`;
        } else {
            return `${Math.floor(seconds / 3600)}h ago`;
        }
    }

    async refreshBuzzerStatus() {
        try {
            const response = await fetch('/api/buzzers/devices');
            if (response.ok) {
                const devices = await response.json();
                const now = Date.now();
                
                // Update our device map with fresh data
                this.buzzerDevices.clear();
                devices.forEach(device => {
                    this.buzzerDevices.set(device.device_id, {
                        ...device,
                        last_seen: device.last_seen || now
                    });
                });
                
                this.updateBuzzerStatusDisplay();
            }
        } catch (error) {
            console.error('Failed to refresh buzzer status:', error);
            this.showToast('Failed to refresh buzzer status', 'error');
        }
    }

    async armAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/arm', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showToast('All buzzers armed successfully', 'success');
            } else {
                throw new Error('Failed to arm buzzers');
            }
        } catch (error) {
            console.error('Failed to arm buzzers:', error);
            this.showToast('Failed to arm all buzzers', 'error');
        }
    }

    async disarmAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/disarm', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showToast('All buzzers disarmed successfully', 'success');
            } else {
                throw new Error('Failed to disarm buzzers');
            }
        } catch (error) {
            console.error('Failed to disarm buzzers:', error);
            this.showToast('Failed to disarm all buzzers', 'error');
        }
    }

    // Expose methods to global scope for onclick handlers
    editGame(gameId) { 
        fetch(`/api/games/${gameId}`)
            .then(response => response.json())
            .then(game => {
                this.showGameModal(game);
            })
            .catch(error => {
                this.showToast('Failed to load game for editing', 'error');
            });
    }

    editTeam(teamId) { 
        fetch(`/api/groups/${teamId}`)
            .then(response => response.json())
            .then(team => {
                this.showTeamModal(team);
            })
            .catch(error => {
                this.showToast('Failed to load team for editing', 'error');
            });
    }

    editQuestion(questionId) { 
        fetch(`/api/questions/${questionId}`)
            .then(response => response.json())
            .then(question => {
                this.showQuestionModal(question);
            })
            .catch(error => {
                this.showToast('Failed to load question for editing', 'error');
            });
    }
}

// Initialize admin when DOM is loaded
let admin;
document.addEventListener('DOMContentLoaded', () => {
    admin = new AdminConfig();
});