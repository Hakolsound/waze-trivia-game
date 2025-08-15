class GameDisplay {
    constructor() {
        this.socket = io();
        this.currentGame = null;
        this.currentQuestion = null;
        this.questionTimer = null;
        this.timeRemaining = 0;
        this.totalTime = 30;
        this.buzzerQueue = [];
        this.gameSelector = null;
        this.currentState = 'idle'; // idle, question, buzzer, answer
        this.teamNames = new Map();
        
        this.initializeGameSelector();
        this.initializeElements();
        this.setupSocketListeners();
        this.setupUI();
    }

    initializeGameSelector() {
        this.gameSelector = new GlobalGameSelector({
            socket: this.socket,
            containerSelector: '#game-selector-container',
            showIfNoGame: true,
            allowGameChange: false, // Display should not allow game changes
            showCurrentGameIndicator: false
        });

        // Listen for game changes
        this.gameSelector.on('gameChanged', (game) => {
            this.currentGame = game;
            this.onGameChanged(game);
        });
    }

    onGameChanged(game) {
        console.log('Game changed in display:', game);
        
        if (game) {
            // Update team names mapping
            this.teamNames.clear();
            if (game.groups) {
                game.groups.forEach(team => {
                    // Map both groupId and buzzer_id for compatibility
                    this.teamNames.set(team.id, team.name);
                    this.teamNames.set(team.buzzer_id || team.id, team.name);
                });
            }

            // Update game title and logo
            this.updateGameBranding(game);
            
            // Join game room
            this.socket.emit('join-game', game.id);
            this.socket.emit('join-display');
            
            // Show idle state
            this.showIdleState();
        } else {
            // No game selected
            this.currentGame = null;
            this.teamNames.clear();
            this.showIdleState();
        }
    }

    initializeElements() {
        this.elements = {
            // Header elements
            gameTitle: document.getElementById('game-title'),
            gameStatus: document.getElementById('game-status'),
            questionCounter: document.getElementById('question-counter'),
            
            // State sections
            idleState: document.getElementById('idle-state'),
            questionSection: document.getElementById('question-section'),
            
            // Logo elements
            gameLogo: document.getElementById('game-logo'),
            logoPlaceholder: document.getElementById('logo-placeholder'),
            gameDescriptionDisplay: document.getElementById('game-description-display'),
            
            // Question elements
            questionText: document.getElementById('question-text'),
            questionMedia: document.getElementById('question-media'),
            questionPoints: document.getElementById('question-points'),
            
            // Timer elements
            timerProgress: document.getElementById('timer-progress'),
            timerText: document.getElementById('timer-text'),
            
            // Buzzer elements
            buzzerQueue: document.getElementById('buzzer-queue'),
            
            // Feedback elements
            answerFeedback: document.getElementById('answer-feedback'),
            
            // Overlay elements
            messageOverlay: document.getElementById('message-overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlayMessage: document.getElementById('overlay-message')
        };
    }

    setupUI() {
        // Initially show idle state
        this.showIdleState();
        this.clearBuzzerQueue();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateGameStatus('Connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateGameStatus('Disconnected');
        });

        // Game state events
        this.socket.on('game-state', (state) => {
            this.handleGameState(state);
        });

        // Question events
        this.socket.on('question-start', (data) => {
            this.handleQuestionStarted(data);
        });

        this.socket.on('question-end', (data) => {
            this.handleQuestionEnded(data);
        });

        // Timer events
        this.socket.on('timer-update', (data) => {
            this.updateTimer(data.timeRemaining, data.totalTime);
        });

        // Buzzer events
        this.socket.on('buzzer-pressed', (data) => {
            this.handleBuzzerPressed(data);
        });

        this.socket.on('answer-evaluated', (data) => {
            this.handleAnswerResult(data);
        });

        // Team/score updates
        this.socket.on('teams-updated', (teams) => {
            this.handleTeamsUpdated(teams);
        });

        // Game control events
        this.socket.on('game-reset', () => {
            this.handleGameReset();
        });
    }

    // State Management
    showIdleState() {
        this.currentState = 'idle';
        this.elements.idleState.classList.add('active');
        this.elements.idleState.classList.remove('hidden');
        this.elements.questionSection.classList.add('hidden');
        this.elements.questionSection.classList.remove('active');
        this.elements.answerFeedback.classList.add('hidden');
        
        this.updateGameStatus('Ready to play');
        this.clearBuzzerQueue();
    }

    showQuestionState(question) {
        this.currentState = 'question';
        this.elements.idleState.classList.remove('active');
        this.elements.idleState.classList.add('hidden');
        this.elements.questionSection.classList.remove('hidden');
        this.elements.questionSection.classList.add('active');
        this.elements.answerFeedback.classList.add('hidden');
        
        // Update question content
        this.elements.questionText.textContent = question.text;
        this.elements.questionPoints.textContent = `${question.points || 100} Points`;
        
        // Handle media
        if (question.media_url) {
            this.elements.questionMedia.src = question.media_url;
            this.elements.questionMedia.classList.remove('hidden');
        } else {
            this.elements.questionMedia.classList.add('hidden');
        }
        
        this.updateGameStatus('Question in progress');
        this.clearBuzzerQueue();
    }

    // Game Event Handlers
    handleGameState(state) {
        if (state.currentQuestion) {
            this.currentQuestion = state.currentQuestion;
            this.showQuestionState(state.currentQuestion);
            
            if (state.timeRemaining > 0) {
                this.updateTimer(state.timeRemaining, state.currentQuestion.time_limit);
            }
        } else {
            this.showIdleState();
        }
        
        this.updateQuestionCounter(state.questionIndex, state.totalQuestions);
    }

    handleQuestionStarted(data) {
        this.currentQuestion = data.question;
        this.showQuestionState(data.question);
        this.totalTime = data.question.time_limit || 30;
        this.timeRemaining = this.totalTime;
        this.updateTimer(this.timeRemaining, this.totalTime);
        this.startTimer();
    }

    handleQuestionEnded(data) {
        this.clearTimer();
        // Keep question visible instead of returning to idle state
        // The question will be hidden when a correct answer is given or host manually advances
        this.updateGameStatus('Time up - Waiting for answer');
        this.elements.timerText.textContent = 'Time up!';
    }

    handleBuzzerPressed(data) {
        console.log('Buzzer pressed:', data);
        
        // Add to buzzer queue if not already there
        const buzzerId = data.buzzer_id || data.buzzerId;
        const groupId = data.groupId;
        const existingIndex = this.buzzerQueue.findIndex(item => item.buzzerId === buzzerId || item.groupId === groupId);
        if (existingIndex === -1) {
            // Try to get team name using groupId first, then buzzer_id
            const teamName = this.teamNames.get(groupId) || this.teamNames.get(buzzerId) || `Team ${buzzerId}`;
            const buzzerItem = {
                buzzerId: buzzerId,
                groupId: groupId,
                teamName: teamName,
                timestamp: data.timestamp,
                deltaTime: (data.deltaMs || data.deltaTime || 0) / 1000, // Convert ms to seconds
                order: this.buzzerQueue.length + 1
            };
            
            this.buzzerQueue.push(buzzerItem);
            this.updateBuzzerQueue();
            
            // Highlight the fastest buzzer
            if (this.buzzerQueue.length === 1) {
                this.highlightFastestBuzzer(buzzerItem);
            }
        }
    }

    handleBuzzerResult(data) {
        // This handles when the host selects which team to answer
        this.highlightSelectedTeam(data.buzzerId);
    }

    handleAnswerResult(data) {
        // Convert backend data format to display format
        const displayData = {
            correct: data.isCorrect,
            buzzerId: data.groupId, // Backend uses groupId as identifier
            points: Math.abs(data.pointsAwarded),
            isCorrect: data.isCorrect
        };
        
        // Show answer feedback
        this.showAnswerFeedback(displayData);
        
        // Update buzzer queue to show result
        this.updateBuzzerQueueWithResult(displayData);
        
        // Clear after delay
        setTimeout(() => {
            if (data.isCorrect) {
                this.showIdleState();
                this.currentQuestion = null;
            } else {
                // Remove the incorrect team from queue and continue
                this.removeFromBuzzerQueue(data.groupId);
            }
        }, 3000);
    }

    handleTeamsUpdated(teams) {
        // Update team names mapping
        teams.forEach(team => {
            // Map both groupId and buzzer_id for compatibility
            this.teamNames.set(team.id, team.name);
            this.teamNames.set(team.buzzer_id || team.id, team.name);
        });
    }

    handleGameReset() {
        this.clearTimer();
        this.clearBuzzerQueue();
        this.showIdleState();
    }

    // UI Update Methods
    updateGameBranding(game) {
        if (game.name) {
            this.elements.gameTitle.textContent = game.name;
        }
        
        // Handle description
        if (game.game_description || game.description) {
            this.elements.gameDescriptionDisplay.textContent = game.game_description || game.description;
        } else if (game.name) {
            this.elements.gameDescriptionDisplay.textContent = game.name;
        } else {
            this.elements.gameDescriptionDisplay.textContent = 'Hakol Trivia Game';
        }
        
        // Handle logo
        if (game.logo_url) {
            this.elements.gameLogo.src = game.logo_url;
            this.elements.gameLogo.classList.remove('hidden');
            this.elements.logoPlaceholder.classList.add('hidden');
        } else {
            this.elements.gameLogo.classList.add('hidden');
            this.elements.logoPlaceholder.classList.remove('hidden');
        }
    }

    updateGameStatus(status) {
        this.elements.gameStatus.textContent = status;
    }

    updateQuestionCounter(current, total) {
        if (current !== undefined && total !== undefined) {
            this.elements.questionCounter.textContent = `Question ${current + 1} of ${total}`;
        } else {
            this.elements.questionCounter.textContent = 'Ready to start';
        }
    }

    // Timer Methods
    startTimer() {
        this.clearTimer();
        const updateInterval = 1000 / 50; // 50 FPS = 20ms intervals
        const decrementPerUpdate = 1 / 50; // Decrease by 1/50th of a second each update
        
        this.questionTimer = setInterval(() => {
            this.timeRemaining -= decrementPerUpdate;
            this.updateTimer(this.timeRemaining, this.totalTime);
            
            if (this.timeRemaining <= 0) {
                this.clearTimer();
                this.timeRemaining = 0;
                this.updateTimer(0, this.totalTime);
            }
        }, updateInterval);
    }

    clearTimer() {
        if (this.questionTimer) {
            clearInterval(this.questionTimer);
            this.questionTimer = null;
        }
    }

    updateTimer(timeRemaining, totalTime) {
        this.timeRemaining = timeRemaining;
        this.totalTime = totalTime;
        
        // Ensure timer bar is completely empty when time is up
        let percentage;
        if (timeRemaining <= 0 || totalTime <= 0) {
            percentage = 0;
        } else {
            percentage = Math.max(0, (timeRemaining / totalTime) * 100);
        }
        
        this.elements.timerProgress.style.width = `${percentage}%`;
        
        const seconds = Math.max(0, Math.ceil(timeRemaining)); // Round up to show whole seconds
        if (seconds > 0) {
            // Format: "13s" for >10s, "3s" for <=10s, no "remaining"
            this.elements.timerText.textContent = `${seconds}s`;
        } else {
            this.elements.timerText.textContent = 'Time up!';
            // Force timer to 0% when showing "Time up!"
            this.elements.timerProgress.style.width = '0%';
        }
    }

    // Buzzer Queue Methods
    updateBuzzerQueue() {
        const container = this.elements.buzzerQueue;
        
        if (this.buzzerQueue.length === 0) {
            container.innerHTML = `
                <div class="buzzer-item">
                    <div class="buzzer-team"></div>
                    <div class="buzzer-details">
                        <span class="buzzer-order">-</span>
                        <span class="buzzer-time">-</span>
                    </div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.buzzerQueue.map((item, index) => `
            <div class="buzzer-item ${index === 0 ? 'fastest' : 'active'}" data-buzzer-id="${item.buzzerId}">
                <div class="buzzer-team">${item.teamName}</div>
                <div class="buzzer-details">
                    <span class="buzzer-order">${item.order}</span>
                    <span class="buzzer-time">${item.deltaTime.toFixed(2)}s</span>
                </div>
            </div>
        `).join('');
    }

    highlightFastestBuzzer(buzzerItem) {
        // Additional highlighting for fastest buzzer
        const buzzerElement = document.querySelector(`[data-buzzer-id="${buzzerItem.buzzerId}"]`);
        if (buzzerElement) {
            buzzerElement.classList.add('fastest');
        }
    }

    highlightSelectedTeam(buzzerId) {
        // Highlight the selected team for answering
        document.querySelectorAll('.buzzer-item').forEach(item => {
            item.classList.remove('fastest', 'selected');
            if (item.dataset.buzzerId === buzzerId.toString()) {
                item.classList.add('selected');
            }
        });
    }

    clearBuzzerQueue() {
        this.buzzerQueue = [];
        this.updateBuzzerQueue();
    }

    removeFromBuzzerQueue(buzzerId) {
        this.buzzerQueue = this.buzzerQueue.filter(item => item.buzzerId !== buzzerId);
        // Reorder the remaining items
        this.buzzerQueue.forEach((item, index) => {
            item.order = index + 1;
        });
        this.updateBuzzerQueue();
    }

    updateBuzzerQueueWithResult(data) {
        const buzzerElement = document.querySelector(`[data-buzzer-id="${data.buzzerId}"]`);
        if (buzzerElement) {
            buzzerElement.classList.add(data.correct ? 'correct' : 'incorrect');
        }
    }

    // Answer Feedback Methods
    showAnswerFeedback(data) {
        const feedback = this.elements.answerFeedback;
        const teamName = this.teamNames.get(data.buzzerId) || `Team ${data.buzzerId}`;
        
        // Update content
        const icon = feedback.querySelector('.feedback-icon');
        const team = feedback.querySelector('.feedback-team');
        const points = feedback.querySelector('.feedback-points');
        const message = feedback.querySelector('.feedback-message');
        
        if (data.correct) {
            icon.textContent = '✓';
            icon.className = 'feedback-icon correct';
            points.className = 'feedback-points positive';
            points.textContent = `+${data.points || 100}`;
            message.textContent = 'Correct answer!';
            feedback.className = 'answer-feedback correct show';
        } else {
            icon.textContent = '✗';
            icon.className = 'feedback-icon incorrect';
            points.className = 'feedback-points negative';
            points.textContent = `-${data.points || 100}`;
            message.textContent = 'Incorrect answer!';
            feedback.className = 'answer-feedback incorrect show';
        }
        
        team.textContent = teamName;
        
        // Hide after delay
        setTimeout(() => {
            feedback.classList.remove('show');
        }, 2500);
    }

    // Utility Methods
    showMessage(title, message, duration = 3000) {
        this.elements.overlayTitle.textContent = title;
        this.elements.overlayMessage.textContent = message;
        this.elements.messageOverlay.classList.remove('hidden');
        
        if (duration > 0) {
            setTimeout(() => {
                this.elements.messageOverlay.classList.add('hidden');
            }, duration);
        }
    }

    hideMessage() {
        this.elements.messageOverlay.classList.add('hidden');
    }
}

// Initialize the display when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.gameDisplay = new GameDisplay();
});