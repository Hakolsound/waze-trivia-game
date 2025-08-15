class AdminConfig {
    constructor() {
        this.socket = io();
        this.currentGame = null;
        this.gameSelector = null;
        
        this.initializeGameSelector();
        this.setupSocketListeners();
        this.initializeElements();
        this.setupEventListeners();
        
        // Initialize buzzer sidebar
        this.buzzerDevices = new Map();
        this.loadThresholdSetting();
        setTimeout(() => {
            this.refreshBuzzerStatus();
        }, 1000);
        
        // Set up periodic status updates to handle stale devices
        setInterval(() => {
            this.updateBuzzerSidebar(); // Check for stale devices based on timestamps
        }, 5000); // Check every 5 seconds
    }

    initializeGameSelector() {
        this.gameSelector = new GlobalGameSelector({
            socket: this.socket,
            containerSelector: '#game-selector-container',
            showIfNoGame: true,
            allowGameChange: true
        });

        // Listen for game changes
        this.gameSelector.on('gameChanged', (game) => {
            this.currentGame = game;
            this.onGameChanged(game);
        });

        this.gameSelector.on('gamesLoaded', (games) => {
            this.onGamesLoaded(games);
        });
    }

    onGameChanged(game) {
        console.log('Game changed:', game);
        const indicator = document.getElementById('current-game-indicator');
        
        if (game) {
            indicator.textContent = `Current Game: ${game.name}`;
            indicator.style.display = 'block';
            
            // Show admin configuration interface
            console.log('Showing admin interface');
            this.showAdminInterface();
            
            // Load game-specific data
            this.loadGameData(game);
        } else {
            indicator.textContent = 'No Game Selected';
            indicator.style.display = 'block';
            
            // Hide admin configuration interface
            console.log('Hiding admin interface');
            this.hideAdminInterface();
        }
    }

    onGamesLoaded(games) {
        // Update any game-specific UI elements
        console.log('Games loaded:', games.length);
    }

    showAdminInterface() {
        const gameConfiguration = document.getElementById('game-configuration');
        
        console.log('gameConfiguration element:', gameConfiguration);
        
        if (gameConfiguration) {
            gameConfiguration.classList.remove('hidden');
            gameConfiguration.classList.add('active');
            console.log('Showed game-configuration');
        }
    }

    hideAdminInterface() {
        // No longer need to show games-selection since we use global game selector
        const gameConfiguration = document.getElementById('game-configuration');
        
        if (gameConfiguration) {
            gameConfiguration.classList.add('hidden');
            gameConfiguration.classList.remove('active');
        }
    }

    async loadGameData(game) {
        if (!game) return;
        
        try {
            // Load teams
            await this.loadTeams(game.id);
            
            // Load questions
            await this.loadQuestions(game.id);
            
            // Load branding
            await this.loadBranding(game.id);
            
            // Update UI title
            const titleElement = document.getElementById('current-game-title');
            if (titleElement) {
                titleElement.textContent = `Configuring: ${game.name}`;
            }
        } catch (error) {
            console.error('Failed to load game data:', error);
            this.showToast('Failed to load game data', 'error');
        }
    }

    initializeElements() {
        this.elements = {
            // Config tabs
            configTabs: document.querySelectorAll('.config-tab'),
            configPanels: document.querySelectorAll('.config-panel'),
            
            // Back button
            backToGamesBtn: document.getElementById('back-to-games-btn'),
            
            // New action buttons
            changeGameBtn: document.getElementById('change-game-btn'),
            openDisplayBtn: document.getElementById('open-display-btn'),
            openHostBtn: document.getElementById('open-host-btn'),
            
            // Team elements
            addTeamBtn: document.getElementById('add-team-btn'),
            teamsContainer: document.getElementById('teams-container'),
            teamModal: document.getElementById('team-modal'),
            teamForm: document.getElementById('team-form'),
            teamName: document.getElementById('team-name'),
            teamColor: document.getElementById('team-color'),
            buzzerId: document.getElementById('buzzer-id'),
            cancelTeamBtn: document.getElementById('cancel-team-btn'),
            
            // Question elements
            addQuestionBtn: document.getElementById('add-question-btn'),
            questionTabs: document.getElementById('question-tabs'),
            questionEditor: document.getElementById('question-editor'),
            addQuestionTabBtn: document.getElementById('add-question-tab-btn'),
            questionEditorModal: document.getElementById('question-editor-modal'),
            questionForm: document.getElementById('question-form'),
            questionText: document.getElementById('question-text'),
            correctAnswer: document.getElementById('correct-answer'),
            timeLimit: document.getElementById('time-limit'),
            questionPoints: document.getElementById('question-points'),
            mediaUrl: document.getElementById('media-url'),
            cancelQuestionBtn: document.getElementById('cancel-question-btn'),
            deleteQuestionBtn: document.getElementById('delete-question-btn'),
            closeQuestionEditorBtn: document.getElementById('close-question-editor-btn'),
            
            // Branding elements
            primaryColor: document.getElementById('primary-color'),
            secondaryColor: document.getElementById('secondary-color'),
            gameLogo: document.getElementById('game-logo'),
            gameDescription: document.getElementById('game-description'),
            
            // System elements
            dbStatus: document.getElementById('db-status'),
            hardwareStatus: document.getElementById('hardware-status'),
            firebaseStatus: document.getElementById('firebase-status'),
            testAllBuzzersBtn: document.getElementById('test-all-buzzers-btn'),
            refreshSystemStatusBtn: document.getElementById('refresh-system-status-btn'),
            backupDbBtn: document.getElementById('backup-db-btn'),
            
            // Buzzer sidebar elements
            buzzerSidebar: document.getElementById('buzzer-sidebar'),
            toggleBuzzerSidebarBtn: document.getElementById('toggle-buzzer-sidebar'),
            buzzerCounter: document.getElementById('buzzer-counter'),
            onlineThreshold: document.getElementById('online-threshold'),
            onlineBuzzers: document.getElementById('online-buzzers'),
            offlineBuzzers: document.getElementById('offline-buzzers'),
            
            // Navigation buttons
            navOpenDisplayBtn: document.getElementById('nav-open-display-btn'),
            navOpenHostBtn: document.getElementById('nav-open-host-btn')
        };
    }

    setupEventListeners() {
        // Config tabs
        if (this.elements.configTabs) {
            this.elements.configTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    this.switchConfigTab(e.target.dataset.tab);
                });
            });
        }

        // Back button
        if (this.elements.backToGamesBtn) {
            this.elements.backToGamesBtn.addEventListener('click', () => {
                this.gameSelector.clearCurrentGame();
            });
        }

        // New action buttons
        if (this.elements.changeGameBtn) {
            this.elements.changeGameBtn.addEventListener('click', () => {
                this.gameSelector.showGameSelector();
            });
        }

        if (this.elements.openDisplayBtn) {
            this.elements.openDisplayBtn.addEventListener('click', () => {
                window.open('/display', '_blank', 'width=1920,height=1080');
            });
        }

        if (this.elements.openHostBtn) {
            this.elements.openHostBtn.addEventListener('click', () => {
                window.open('/control', '_blank', 'width=1400,height=900');
            });
        }

        // Team management
        if (this.elements.addTeamBtn) {
            this.elements.addTeamBtn.addEventListener('click', () => {
                this.showTeamModal();
            });
        }

        if (this.elements.teamForm) {
            this.elements.teamForm.addEventListener('submit', (e) => {
                this.handleTeamSubmit(e);
            });
        }

        if (this.elements.cancelTeamBtn) {
            this.elements.cancelTeamBtn.addEventListener('click', () => {
                this.hideTeamModal();
            });
        }

        // Question management
        if (this.elements.addQuestionBtn) {
            this.elements.addQuestionBtn.addEventListener('click', () => {
                this.addNewQuestion();
            });
        }

        if (this.elements.addQuestionTabBtn) {
            this.elements.addQuestionTabBtn.addEventListener('click', () => {
                this.addNewQuestion();
            });
        }

        if (this.elements.questionForm) {
            this.elements.questionForm.addEventListener('submit', (e) => {
                this.handleQuestionSubmit(e);
            });
        }

        if (this.elements.cancelQuestionBtn) {
            this.elements.cancelQuestionBtn.addEventListener('click', () => {
                this.hideQuestionEditor();
            });
        }

        if (this.elements.closeQuestionEditorBtn) {
            this.elements.closeQuestionEditorBtn.addEventListener('click', () => {
                this.hideQuestionEditor();
            });
        }

        if (this.elements.deleteQuestionBtn) {
            this.elements.deleteQuestionBtn.addEventListener('click', () => {
                this.deleteCurrentQuestion();
            });
        }

        // System management
        if (this.elements.refreshSystemStatusBtn) {
            this.elements.refreshSystemStatusBtn.addEventListener('click', () => {
                this.refreshSystemStatus();
            });
        }

        if (this.elements.testAllBuzzersBtn) {
            this.elements.testAllBuzzersBtn.addEventListener('click', () => {
                this.testAllBuzzers();
            });
        }

        if (this.elements.backupDbBtn) {
            this.elements.backupDbBtn.addEventListener('click', () => {
                this.backupDatabase();
            });
        }
        
        // Buzzer sidebar controls
        if (this.elements.toggleBuzzerSidebarBtn) {
            this.elements.toggleBuzzerSidebarBtn.addEventListener('click', () => {
                this.toggleBuzzerSidebar();
            });
        }
        
        // Online threshold setting
        if (this.elements.onlineThreshold) {
            this.elements.onlineThreshold.addEventListener('input', () => {
                this.updateBuzzerSidebar();
            });
            this.elements.onlineThreshold.addEventListener('change', () => {
                this.saveThresholdSetting();
            });
        }
        
        // Navigation buttons
        if (this.elements.navOpenDisplayBtn) {
            this.elements.navOpenDisplayBtn.addEventListener('click', () => {
                window.open('/display', '_blank', 'width=1920,height=1080');
            });
        }

        if (this.elements.navOpenHostBtn) {
            this.elements.navOpenHostBtn.addEventListener('click', () => {
                window.open('/control', '_blank', 'width=1400,height=900');
            });
        }
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('join-admin');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        // Buzzer monitoring listeners
        this.socket.on('esp32-device', (data) => {
            this.updateBuzzerDevice(data);
        });

        this.socket.on('buzzer-heartbeat', (data) => {
            this.updateBuzzerHeartbeat(data);
        });

        // Test if socket is working at all
        this.socket.on('connect', () => {
            console.log('Socket connected successfully!');
        });
        
        this.socket.on('disconnect', () => {
            console.log('Socket disconnected!');
        });
        
        // Listen for any ESP32 related events
        this.socket.on('esp32-device-data', (data) => {
            console.log('=== ESP32 DEVICE DATA RECEIVED ===', data);
            if (data.esp32_data) {
                this.parseESP32DeviceData(data.esp32_data, data.timestamp);
            }
        });
        
        this.socket.on('esp32-status', (data) => {
            console.log('=== ESP32 STATUS RECEIVED ===', data);
            this.updateESP32Status(data);
        });
    }

    switchConfigTab(tabName) {
        // Update active tab
        this.elements.configTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update active panel
        this.elements.configPanels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-config`);
        });
    }

    // Team Management
    async loadTeams(gameId) {
        if (!gameId) return;

        try {
            const response = await fetch(`/api/groups/game/${gameId}`);
            const teams = await response.json();
            this.renderTeams(teams);
        } catch (error) {
            console.error('Failed to load teams:', error);
            this.showToast('Failed to load teams', 'error');
        }
    }

    renderTeams(teams) {
        if (!this.elements.teamsContainer) return;

        if (teams.length === 0) {
            this.elements.teamsContainer.innerHTML = `
                <div class="empty-state">
                    <p>No teams added yet. Add your first team to get started.</p>
                </div>
            `;
            return;
        }

        this.elements.teamsContainer.innerHTML = teams.map(team => `
            <div class="team-card">
                <div class="team-header">
                    <div class="team-name">${team.name}</div>
                    <div class="team-color-indicator" style="background-color: ${team.color}"></div>
                </div>
                <div class="team-info">
                    <div>Buzzer ID: ${team.buzzer_id}</div>
                    <div>Score: ${team.score || 0}</div>
                </div>
                <div class="team-actions">
                    <button class="btn btn-small btn-info" onclick="admin.editTeam('${team.id}')">Edit</button>
                    <button class="btn btn-small btn-danger" onclick="admin.deleteTeam('${team.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    showTeamModal(team = null) {
        this.editingTeam = team;
        
        if (this.elements.teamName) this.elements.teamName.value = team ? team.name : '';
        if (this.elements.teamColor) this.elements.teamColor.value = team ? team.color : '#00D4FF';
        
        // Auto-assign buzzer ID for new teams
        if (!team && this.currentGame) {
            this.autoAssignBuzzerId();
        } else if (this.elements.buzzerId) {
            this.elements.buzzerId.value = team ? team.buzzer_id : '';
        }
        
        if (this.elements.teamModal) {
            this.elements.teamModal.classList.remove('hidden');
        }
    }

    async autoAssignBuzzerId() {
        if (!this.currentGame || !this.elements.buzzerId) return;
        
        try {
            const response = await fetch(`/api/groups/game/${this.currentGame.id}`);
            const existingTeams = await response.json();
            const nextBuzzerNumber = existingTeams.length + 1;
            this.elements.buzzerId.value = nextBuzzerNumber.toString();
        } catch (error) {
            this.elements.buzzerId.value = '1';
        }
    }

    hideTeamModal() {
        this.editingTeam = null;
        if (this.elements.teamModal) {
            this.elements.teamModal.classList.add('hidden');
        }
        if (this.elements.teamForm) {
            this.elements.teamForm.reset();
        }
    }

    async handleTeamSubmit(e) {
        e.preventDefault();
        
        const teamData = {
            name: this.elements.teamName.value,
            color: this.elements.teamColor.value,
            buzzer_id: this.elements.buzzerId.value
        };

        try {
            if (this.editingTeam) {
                await fetch(`/api/groups/${this.editingTeam.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(teamData)
                });
                this.showToast('Team updated successfully', 'success');
            } else {
                await fetch(`/api/groups/game/${this.currentGame.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(teamData)
                });
                this.showToast('Team added successfully', 'success');
            }
            
            this.hideTeamModal();
            this.loadTeams(this.currentGame.id);
        } catch (error) {
            console.error('Failed to save team:', error);
            this.showToast('Failed to save team', 'error');
        }
    }

    async editTeam(teamId) {
        try {
            const response = await fetch(`/api/groups/${teamId}`);
            const team = await response.json();
            this.showTeamModal(team);
        } catch (error) {
            console.error('Failed to load team:', error);
            this.showToast('Failed to load team for editing', 'error');
        }
    }

    async deleteTeam(teamId) {
        if (!confirm('Are you sure you want to delete this team?')) return;

        try {
            await fetch(`/api/groups/${teamId}`, { method: 'DELETE' });
            this.showToast('Team deleted successfully', 'success');
            this.loadTeams(this.currentGame.id);
        } catch (error) {
            console.error('Failed to delete team:', error);
            this.showToast('Failed to delete team', 'error');
        }
    }

    // Question Management
    async loadQuestions(gameId) {
        if (!gameId) return;

        try {
            const response = await fetch(`/api/questions/game/${gameId}`);
            const questions = await response.json();
            this.renderQuestionTabs(questions);
        } catch (error) {
            console.error('Failed to load questions:', error);
            this.showToast('Failed to load questions', 'error');
        }
    }

    renderQuestionTabs(questions) {
        if (!this.elements.questionTabs) return;

        if (questions.length === 0) {
            this.elements.questionTabs.innerHTML = '';
            if (this.elements.questionEditor) {
                this.elements.questionEditor.innerHTML = `
                    <div class="no-question-selected">
                        <p>No questions added yet. Click + to add your first question.</p>
                    </div>
                `;
            }
            return;
        }

        this.elements.questionTabs.innerHTML = questions.map((question, index) => `
            <div class="question-tab ${index === 0 ? 'active' : ''}" 
                 data-question-id="${question.id}" 
                 draggable="true"
                 ondragstart="admin.handleQuestionDragStart(event)"
                 ondragover="admin.handleQuestionDragOver(event)"
                 ondrop="admin.handleQuestionDrop(event)"
                 ondragend="admin.handleQuestionDragEnd(event)">
                <span>Q${question.question_order || index + 1}</span>
                <button class="question-tab-close" onclick="admin.deleteQuestion('${question.id}')">&times;</button>
            </div>
        `).join('');

        // Add click handlers
        this.elements.questionTabs.querySelectorAll('.question-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (!e.target.classList.contains('question-tab-close')) {
                    this.selectQuestion(tab.dataset.questionId);
                }
            });
        });

        // Select first question by default
        if (questions.length > 0) {
            this.selectQuestion(questions[0].id);
        }
    }

    selectQuestion(questionId) {
        // Update active tab
        this.elements.questionTabs.querySelectorAll('.question-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.questionId === questionId);
        });

        // Load question data into editor
        this.loadQuestionIntoEditor(questionId);
    }

    async loadQuestionIntoEditor(questionId) {
        try {
            const response = await fetch(`/api/questions/${questionId}`);
            const question = await response.json();
            
            this.currentQuestion = question;
            
            if (this.elements.questionEditor) {
                this.elements.questionEditor.innerHTML = `
                    <div class="question-form">
                        <div class="form-group">
                            <label for="edit-question-text">Question:</label>
                            <textarea id="edit-question-text" rows="3">${question.text}</textarea>
                        </div>
                        <div class="form-group">
                            <label for="edit-correct-answer">Correct Answer:</label>
                            <input type="text" id="edit-correct-answer" value="${question.correct_answer}">
                        </div>
                        <div class="question-settings">
                            <div class="form-group">
                                <label for="edit-time-limit">Time Limit (seconds):</label>
                                <input type="number" id="edit-time-limit" value="${question.time_limit}" min="5" max="300">
                            </div>
                            <div class="form-group">
                                <label for="edit-question-points">Points:</label>
                                <input type="number" id="edit-question-points" value="${question.points}" min="10" max="1000">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="edit-media-url">Media URL (optional):</label>
                            <input type="url" id="edit-media-url" value="${question.media_url || ''}">
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn btn-primary" onclick="admin.saveCurrentQuestion()">Save Changes</button>
                            <button type="button" class="btn btn-danger" onclick="admin.deleteQuestion('${question.id}')">Delete Question</button>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Failed to load question:', error);
            this.showToast('Failed to load question', 'error');
        }
    }

    async saveCurrentQuestion() {
        if (!this.currentQuestion) return;

        const questionData = {
            text: document.getElementById('edit-question-text').value,
            correct_answer: document.getElementById('edit-correct-answer').value,
            time_limit: parseInt(document.getElementById('edit-time-limit').value),
            points: parseInt(document.getElementById('edit-question-points').value),
            media_url: document.getElementById('edit-media-url').value
        };

        try {
            await fetch(`/api/questions/${this.currentQuestion.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(questionData)
            });
            
            this.showToast('Question saved successfully', 'success');
            this.loadQuestions(this.currentGame.id);
        } catch (error) {
            console.error('Failed to save question:', error);
            this.showToast('Failed to save question', 'error');
        }
    }

    addNewQuestion() {
        this.showQuestionEditor();
    }

    showQuestionEditor(question = null) {
        this.editingQuestion = question;
        
        // Get default time from current game branding/settings
        const defaultTime = (this.currentGame?.default_question_time) || 30;
        
        if (this.elements.questionText) this.elements.questionText.value = question ? question.text : '';
        if (this.elements.correctAnswer) this.elements.correctAnswer.value = question ? question.correct_answer : '';
        if (this.elements.timeLimit) this.elements.timeLimit.value = question ? question.time_limit : defaultTime;
        if (this.elements.questionPoints) this.elements.questionPoints.value = question ? question.points : 100;
        if (this.elements.mediaUrl) this.elements.mediaUrl.value = question ? question.media_url || '' : '';
        
        if (this.elements.questionEditorModal) {
            this.elements.questionEditorModal.classList.remove('hidden');
        }
    }

    hideQuestionEditor() {
        this.editingQuestion = null;
        if (this.elements.questionEditorModal) {
            this.elements.questionEditorModal.classList.add('hidden');
        }
        if (this.elements.questionForm) {
            this.elements.questionForm.reset();
        }
    }

    async handleQuestionSubmit(e) {
        e.preventDefault();
        
        const questionData = {
            text: this.elements.questionText.value,
            correct_answer: this.elements.correctAnswer.value,
            time_limit: parseInt(this.elements.timeLimit.value),
            points: parseInt(this.elements.questionPoints.value),
            media_url: this.elements.mediaUrl.value
        };

        try {
            if (this.editingQuestion) {
                await fetch(`/api/questions/${this.editingQuestion.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionData)
                });
                this.showToast('Question updated successfully', 'success');
            } else {
                await fetch(`/api/questions/game/${this.currentGame.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionData)
                });
                this.showToast('Question added successfully', 'success');
            }
            
            this.hideQuestionEditor();
            this.loadQuestions(this.currentGame.id);
        } catch (error) {
            console.error('Failed to save question:', error);
            this.showToast('Failed to save question', 'error');
        }
    }

    async deleteQuestion(questionId) {
        if (!confirm('Are you sure you want to delete this question?')) return;

        try {
            await fetch(`/api/questions/${questionId}`, { method: 'DELETE' });
            this.showToast('Question deleted successfully', 'success');
            this.loadQuestions(this.currentGame.id);
        } catch (error) {
            console.error('Failed to delete question:', error);
            this.showToast('Failed to delete question', 'error');
        }
    }

    // Drag and Drop handlers for question tabs
    handleQuestionDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.dataset.questionId);
        e.target.classList.add('dragging');
    }

    handleQuestionDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleQuestionDrop(e) {
        e.preventDefault();
        const draggedQuestionId = e.dataTransfer.getData('text/plain');
        const dropTargetId = e.target.closest('.question-tab').dataset.questionId;
        
        if (draggedQuestionId !== dropTargetId) {
            this.reorderQuestions(draggedQuestionId, dropTargetId);
        }
    }

    handleQuestionDragEnd(e) {
        e.target.classList.remove('dragging');
    }

    async reorderQuestions(draggedId, dropTargetId) {
        if (!this.currentGame) return;
        
        try {
            // Get current questions
            const response = await fetch(`/api/questions/game/${this.currentGame.id}`);
            const questions = await response.json();
            
            // Find positions
            const draggedIndex = questions.findIndex(q => q.id === draggedId);
            const targetIndex = questions.findIndex(q => q.id === dropTargetId);
            
            if (draggedIndex === -1 || targetIndex === -1) return;
            
            // Reorder array
            const [draggedQuestion] = questions.splice(draggedIndex, 1);
            questions.splice(targetIndex, 0, draggedQuestion);
            
            // Create new order array
            const questionIds = questions.map(q => q.id);
            
            // Send reorder request
            await fetch(`/api/questions/game/${this.currentGame.id}/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questionIds })
            });
            
            this.showToast('Questions reordered successfully', 'success');
            this.loadQuestions(this.currentGame.id);
        } catch (error) {
            console.error('Failed to reorder questions:', error);
            this.showToast('Failed to reorder questions', 'error');
        }
    }

    // Branding Management
    async loadBranding(gameId) {
        if (!gameId) return;

        try {
            const response = await fetch(`/api/games/${gameId}/branding`);
            const branding = await response.json();
            this.populateBrandingForm(branding);
        } catch (error) {
            console.error('Failed to load branding:', error);
        }
    }

    populateBrandingForm(branding) {
        if (this.elements.primaryColor) this.elements.primaryColor.value = branding.primary_color || '#00D4FF';
        if (this.elements.secondaryColor) this.elements.secondaryColor.value = branding.secondary_color || '#FF6B35';
        if (this.elements.gameDescription) this.elements.gameDescription.value = branding.game_description || '';
    }

    // System Management
    async refreshSystemStatus() {
        try {
            const response = await fetch('/health');
            const health = await response.json();
            
            this.updateStatusIndicator('db-status', health.services.database ? 'healthy' : 'error');
            this.updateStatusIndicator('hardware-status', health.services.esp32 ? 'healthy' : 'error');
            this.updateStatusIndicator('firebase-status', health.services.firebase ? 'healthy' : 'error');
        } catch (error) {
            console.error('Failed to refresh system status:', error);
            this.showToast('Failed to refresh system status', 'error');
        }
    }

    updateStatusIndicator(elementId, status) {
        const element = document.getElementById(elementId);
        if (element) {
            element.className = `status-indicator ${status}`;
            element.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    async testAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/test-all', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Buzzer test completed', 'success');
            } else {
                this.showToast('Buzzer test failed', 'error');
            }
        } catch (error) {
            console.error('Failed to test buzzers:', error);
            this.showToast('Failed to test buzzers', 'error');
        }
    }

    async backupDatabase() {
        try {
            const response = await fetch('/api/system/backup', { method: 'POST' });
            
            if (response.ok) {
                this.showToast('Database backup initiated', 'success');
            } else {
                this.showToast('Database backup failed', 'error');
            }
        } catch (error) {
            console.error('Failed to backup database:', error);
            this.showToast('Failed to backup database', 'error');
        }
    }

    // Buzzer Overlay Methods
    toggleBuzzerSidebar() {
        if (!this.elements.buzzerSidebar) return;
        
        const isHidden = this.elements.buzzerSidebar.classList.contains('hidden');
        
        if (isHidden) {
            this.elements.buzzerSidebar.classList.remove('hidden');
            this.elements.toggleBuzzerSidebarBtn.textContent = 'Hide';
            this.refreshBuzzerStatus();
        } else {
            this.elements.buzzerSidebar.classList.add('hidden');
            this.elements.toggleBuzzerSidebarBtn.textContent = 'Show';
        }
    }

    updateBuzzerDevice(data) {
        if (!this.buzzerDevices) {
            this.buzzerDevices = new Map();
        }
        
        const deviceId = data.device_id || data.id;
        
        // Only accept numeric device IDs (filter out false devices)
        if (!deviceId || !/^\d+$/.test(deviceId.toString())) {
            return;
        }
        
        const now = Date.now();
        
        this.buzzerDevices.set(deviceId, {
            ...data,
            last_seen: now,
            status: 'offline', // Default offline until proven online
            online: false,
            teamName: this.getTeamNameByBuzzerId(deviceId)
        });
        
        this.updateBuzzerSidebar();
    }

    updateBuzzerHeartbeat(data) {
        if (!this.buzzerDevices) {
            this.buzzerDevices = new Map();
        }
        
        const deviceId = data.device_id || data.id;
        
        // Only accept numeric device IDs (filter out false devices)
        if (!deviceId || !/^\d+$/.test(deviceId.toString())) {
            return;
        }
        
        const now = Date.now();
        
        if (this.buzzerDevices.has(deviceId)) {
            const device = this.buzzerDevices.get(deviceId);
            device.last_seen = now;
            device.status = 'online'; // Heartbeat means online
            device.online = true;
            this.buzzerDevices.set(deviceId, device);
        } else {
            // Create new device entry from heartbeat - heartbeat means online
            this.buzzerDevices.set(deviceId, {
                device_id: deviceId,
                name: `Buzzer ${deviceId}`,
                last_seen: now,
                status: 'online', // Heartbeat means device is online
                online: true,
                teamName: this.getTeamNameByBuzzerId(deviceId),
                ...data
            });
        }
        
        this.updateBuzzerSidebar();
    }

    updateESP32Status(data) {
        // Update ESP32 connection status in system panel
        if (this.elements.hardwareStatus) {
            this.elements.hardwareStatus.textContent = data.connected ? 'Connected' : 'Disconnected';
            this.elements.hardwareStatus.className = `status-indicator ${data.connected ? 'healthy' : 'error'}`;
        }
        
        // Parse ESP32 device data if available
        if (data.esp32_data) {
            this.parseESP32DeviceData(data.esp32_data);
        }
    }
    
    parseESP32DeviceData(esp32Data, timestamp) {
        // Parse format: "DEVICE:1,online=1,armed=0,pressed=0,mac=EC:62:60:1D:E8:D4"
        try {
            if (typeof esp32Data !== 'string') {
                return;
            }
            
            const parts = esp32Data.split(',');
            if (parts.length < 2) {
                return;
            }
            
            // Extract device ID
            const devicePart = parts[0];
            if (!devicePart.startsWith('DEVICE:')) {
                return;
            }
            const deviceId = devicePart.split(':')[1];
            
            if (!deviceId || deviceId.trim() === '' || !/^\d+$/.test(deviceId.toString())) {
                return; // Only accept numeric device IDs
            }
            
            // Parse parameters
            const params = {};
            for (let i = 1; i < parts.length; i++) {
                const [key, value] = parts[i].split('=');
                if (key && value !== undefined) {
                    params[key] = value === '1' ? true : value === '0' ? false : value;
                }
            }
            
            // Convert timestamp to milliseconds if provided
            let lastSeen;
            if (timestamp) {
                // Handle both ISO string and timestamp formats
                if (typeof timestamp === 'string') {
                    lastSeen = new Date(timestamp).getTime();
                } else {
                    lastSeen = timestamp;
                }
            } else {
                lastSeen = Date.now();
            }
            
            // Determine if device is actually online based on timestamp
            const now = Date.now();
            const timeSinceLastSeen = now - lastSeen;
            const threshold = this.getOnlineThreshold();
            const isRecentlyActive = timeSinceLastSeen < threshold;
            const reportedOnline = params.online === true;
            
            // Device is considered online if it reported online AND was seen recently
            const actuallyOnline = reportedOnline && isRecentlyActive;
            
            if (!this.buzzerDevices) {
                this.buzzerDevices = new Map();
            }
            
            const existingDevice = this.buzzerDevices.get(deviceId);
            const deviceData = {
                device_id: deviceId,
                name: `Buzzer ${deviceId}`,
                last_seen: lastSeen,
                status: actuallyOnline ? 'online' : 'offline',
                online: actuallyOnline, // Explicit online flag
                armed: params.armed === true,
                pressed: params.pressed === true,
                mac: params.mac || '',
                teamName: this.getTeamNameByBuzzerId(deviceId),
                reported_online: reportedOnline,
                time_since_last_seen: timeSinceLastSeen,
                ...existingDevice // Keep any additional data (but override status)
            };
            
            console.log(`Setting device ${deviceId} data:`, deviceData);
            this.buzzerDevices.set(deviceId, deviceData);
            
            this.updateBuzzerSidebar();
        } catch (error) {
            console.error('Error parsing ESP32 device data:', error);
        }
    }

    getTeamNameByBuzzerId(buzzerId) {
        if (!this.currentGame || !this.currentGame.groups) return null;
        const team = this.currentGame.groups.find(team => team.buzzer_id === buzzerId);
        return team ? team.name : null;
    }

    updateBuzzerSidebar() {
        if (!this.buzzerDevices || !this.elements.onlineBuzzers || !this.elements.offlineBuzzers) return;
        
        const now = Date.now();
        const staleThreshold = this.getOnlineThreshold();
        
        const onlineBuzzers = [];
        const offlineBuzzers = [];
        
        console.log('UpdateBuzzerSidebar - Current devices:', Array.from(this.buzzerDevices.values()));
        console.log('Threshold:', staleThreshold / 1000, 'seconds');
        
        this.buzzerDevices.forEach(device => {
            const timeSinceLastSeen = now - device.last_seen;
            const isRecent = timeSinceLastSeen < staleThreshold;
            const isOnlineReported = device.online === true;
            
            console.log(`Device ${device.device_id}: online=${isOnlineReported}, recent=${isRecent} (${Math.floor(timeSinceLastSeen/1000)}s ago)`);
            
            // Device is online ONLY if ESP32 reported online=true AND data is recent
            if (isOnlineReported && isRecent) {
                console.log(`Adding device ${device.device_id} to ONLINE list`);
                onlineBuzzers.push(device);
            } else {
                console.log(`Adding device ${device.device_id} to OFFLINE list`);
                offlineBuzzers.push(device);
            }
        });
        
        // Update online buzzers
        this.renderBuzzerList(this.elements.onlineBuzzers, onlineBuzzers, true);
        
        // Update offline buzzers
        this.renderBuzzerList(this.elements.offlineBuzzers, offlineBuzzers, false);
        
        // Update counter
        this.updateBuzzerCounter(onlineBuzzers.length);
    }

    renderBuzzerList(container, buzzers, isOnline) {
        if (buzzers.length === 0) {
            container.innerHTML = `<div class="no-buzzers">No ${isOnline ? 'online' : 'offline'} buzzers</div>`;
            return;
        }
        
        container.innerHTML = '';
        
        buzzers.forEach(device => {
            const buzzerElement = document.createElement('div');
            buzzerElement.className = `buzzer-item ${isOnline ? 'online' : 'offline'}`;
            
            const teamName = this.getTeamNameByBuzzerId(device.device_id);
            const timeSinceLastSeen = Date.now() - device.last_seen;
            const lastSeenText = this.formatLastSeen(timeSinceLastSeen);
            
            buzzerElement.innerHTML = `
                <div class="buzzer-info">
                    <div class="buzzer-header">
                        <span class="buzzer-id">#${device.device_id}</span>
                        <span class="buzzer-status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    </div>
                    <div class="buzzer-details">
                        ${teamName ? `<div class="team-name">${teamName}</div>` : '<div class="no-team">No team assigned</div>'}
                        <div class="last-seen">${lastSeenText}</div>
                    </div>
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
                
                // Don't clear the map - instead update existing entries or add new ones
                // Mark all existing devices as potentially offline first
                this.buzzerDevices.forEach(device => {
                    device.server_reported = false;
                });
                
                // Update with server data
                if (Array.isArray(devices)) {
                    devices.forEach(device => {
                        const deviceId = device.device_id;
                        // Only accept numeric device IDs (1, 2, 3, 4) not text ones (buzzer_1, etc)
                        if (deviceId && /^\d+$/.test(deviceId.toString())) {
                            const existingDevice = this.buzzerDevices.get(deviceId);
                            this.buzzerDevices.set(deviceId, {
                                // Default to offline
                                status: 'offline',
                                online: false,
                                ...existingDevice, // Keep existing data (like last_seen from ESP32)
                                ...device, // Overlay server data
                                server_reported: true,
                                teamName: this.getTeamNameByBuzzerId(deviceId)
                            });
                        }
                    });
                }
                
                this.updateBuzzerSidebar();
            }
        } catch (error) {
            console.error('Failed to refresh buzzer status:', error);
        }
    }

    updateBuzzerCounter(onlineCount) {
        if (this.elements.buzzerCounter) {
            const totalGroups = this.getTotalGroups();
            this.elements.buzzerCounter.textContent = `${onlineCount}/${totalGroups}`;
        }
    }
    
    getTotalGroups() {
        if (this.currentGame && this.currentGame.groups) {
            return this.currentGame.groups.length;
        }
        return 4; // Default to 4 groups
    }

    // Threshold management methods
    getOnlineThreshold() {
        if (this.elements.onlineThreshold) {
            const value = parseInt(this.elements.onlineThreshold.value);
            return value * 1000; // Convert seconds to milliseconds
        }
        return 60000; // Default 60 seconds
    }
    
    loadThresholdSetting() {
        const saved = localStorage.getItem('buzzer-online-threshold');
        if (saved && this.elements.onlineThreshold) {
            this.elements.onlineThreshold.value = saved;
        }
    }
    
    saveThresholdSetting() {
        if (this.elements.onlineThreshold) {
            localStorage.setItem('buzzer-online-threshold', this.elements.onlineThreshold.value);
        }
    }

    // Utility methods
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container') || document.body;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize admin when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.admin = new AdminConfig();
});