class HostControl {
    constructor() {
        this.socket = io();
        this.currentGame = null;
        this.currentQuestionIndex = 0;
        this.questions = [];
        this.teams = [];
        this.buzzerOrder = [];
        this.isQuestionActive = false;
        this.activeQuestionIndex = -1; // Track which question is actually on-air/running
        this.isBuzzersArmed = false;
        this.playedQuestions = new Set(); // Track which questions have been played
        this.buzzerDevices = new Map();
        this.virtualBuzzers = new Map(); // Track active virtual buzzers
        this.virtualBuzzersEnabled = false; // Track if virtual buzzers are enabled
        this.isLeaderboardVisible = false; // Track leaderboard state
        this.isAnswerVisible = false; // Track answer display state
        this.currentLeaderboardView = 'all'; // Track current leaderboard view
        this.gameSelector = null;
        
        // Show Correct Answer state
        this.answerShown = false;
        this.keyPressCount = { 'A': 0, lastTime: 0 };
        
        this.initializeGameSelector();
        this.initializeElements();
        this.setupSocketListeners();
        this.setupEventListeners();
        this.refreshSystemStatus();
        this.currentBuzzerPosition = 0;
        this.evaluationHistory = [];
        this.questionTimer = null;
        this.questionStartTime = null;
        this.questionTimeLimit = 30;
        
        // Initialize buzzer sidebar
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
        console.log('Game changed in host control:', game);
        
        if (game) {
            // Load game data
            this.questions = game.questions || [];
            this.teams = game.groups || [];
            this.currentQuestionIndex = game.current_question_index || 0;
            
            // Synchronize with server game state
            this.synchronizeGameState(game);
            
            // Update displays
            this.updateGameDisplay();
            this.updateTeamDisplay();
            this.updateQuestionSelector();
            this.initializeQuestionTabs();
            this.updateQuestionControls();
            this.updateQuestionDisplay();
            
            // Check virtual buzzer settings and update section visibility
            this.checkVirtualBuzzerSettings();
            
            // Join game room
            this.socket.emit('join-game', game.id);
            this.showToast('Game loaded successfully', 'success');
        } else {
            // Clear game data
            this.questions = [];
            this.teams = [];
            this.currentQuestionIndex = 0;
            
            // Update displays
            this.updateGameDisplay();
            this.updateTeamDisplay();
            this.updateQuestionSelector();
            this.initializeQuestionTabs();
            this.updateQuestionControls();
            this.updateQuestionDisplay();
            
            // Hide virtual buzzer section when no game is loaded
            this.checkVirtualBuzzerSettings();
        }
    }

    synchronizeGameState(game) {
        console.log(`Synchronizing game state. Status: ${game.status}, Current question: ${game.current_question_index}, Played: ${JSON.stringify(game.played_questions || [])}`);
        
        // Set the authoritative server state
        this.currentQuestionIndex = game.current_question_index;
        
        // Ensure played_questions array is available
        if (!game.played_questions) {
            game.played_questions = [];
        }
        
        // Reset local state first
        this.isQuestionActive = false;
        this.activeQuestionIndex = -1;
        
        // Handle current question state based on game status
        if (game.status === 'question_active') {
            this.isQuestionActive = true;
            this.activeQuestionIndex = game.current_question_index;
            console.log(`Synchronized: Question ${game.current_question_index} is active`);
        } else if (game.status === 'question_ended') {
            // Question ended but not resolved - keep it on-air until resolved
            this.isQuestionActive = false; // Timer not running but still on-air
            this.activeQuestionIndex = game.current_question_index;
            console.log(`Synchronized: Question ${game.current_question_index} ended but not resolved`);
        }
        
        console.log(`After sync - Current index: ${this.currentQuestionIndex}, Active question: ${this.activeQuestionIndex}, Is active: ${this.isQuestionActive}`);
    }

    onGamesLoaded(games) {
        console.log('Games loaded in host control:', games.length);
    }

    initializeElements() {
        this.elements = {
            // Header elements
            connectionStatus: document.getElementById('connection-status'),
            statusIndicator: document.getElementById('status-indicator'),
            currentGameName: document.getElementById('current-game-name'),
            questionProgress: document.getElementById('question-progress'),
            teamsCount: document.getElementById('teams-count'),
            
            // Main question elements
            questionText: document.getElementById('question-text'),
            questionMeta: document.getElementById('question-meta'),
            questionMedia: document.getElementById('question-media'),
            
            // Timer elements (circular timer removed - only progress bar remains)
            
            // Progress bar timer elements
            questionProgressBar: document.getElementById('question-progress-bar'),
            progressBarFill: document.getElementById('progress-bar-fill'),
            progressTimeText: document.getElementById('progress-time-text'),
            
            // Scoreboard sidebar elements
            teamCounter: document.getElementById('team-counter'),
            
            // Question progress elements
            currentQuestionNum: document.getElementById('current-question-num'),
            totalQuestions: document.getElementById('total-questions'),
            progressPercentage: document.getElementById('progress-percentage'),
            questionProgressFill: document.getElementById('question-progress-fill'),
            
            // Correct answer elements
            correctAnswerDisplay: document.getElementById('correct-answer-display'),
            correctAnswerText: document.getElementById('correct-answer-text'),
            
            // Question tabs elements
            questionTabs: document.getElementById('question-tabs'),
            scrollTabsLeft: document.getElementById('scroll-tabs-left'),
            scrollTabsRight: document.getElementById('scroll-tabs-right'),
            
            // Current answerer elements
            currentAnswererHighlight: document.getElementById('current-answerer-highlight'),
            currentAnswererPosition: document.getElementById('current-answerer-position'),
            currentAnswererName: document.getElementById('current-answerer-name'),
            currentAnswererTime: document.getElementById('current-answerer-time'),
            currentAnswererStatus: document.getElementById('current-answerer-status'),
            
            // Main control buttons
            startQuestionBtn: document.getElementById('start-question-btn'),
            nextQuestionBtn: document.getElementById('next-question-btn'),
            endQuestionBtn: document.getElementById('end-question-btn'),
            showAnswerBtn: document.getElementById('show-answer-btn'),
            decreaseFontBtn: document.getElementById('decrease-font-btn'),
            increaseFontBtn: document.getElementById('increase-font-btn'),
            prevQuestionBtn: document.getElementById('prev-question-btn'),
            questionSelect: document.getElementById('question-select'),
            showQuestionSelectBtn: document.getElementById('show-question-select-btn'),
            
            // Secondary panels
            teamsScoring: document.getElementById('teams-scoring'),
            refreshScoresBtn: document.getElementById('refresh-scores-btn'),
            buzzersArmedStatus: document.getElementById('buzzers-armed-status'),
            armBuzzersBtn: document.getElementById('arm-buzzers-btn'),
            disarmBuzzersBtn: document.getElementById('disarm-buzzers-btn'),
            buzzerResults: document.getElementById('buzzer-results'),
            resetScoresBtn: document.getElementById('reset-scores-btn'),
            resetQuestionsBtn: document.getElementById('reset-questions-btn'),
            resetGameBtn: document.getElementById('reset-game-btn'),
            showLeaderboardBtn: document.getElementById('show-leaderboard-btn'),
            leaderboardViewSelect: document.getElementById('leaderboard-view-select'),
            endGameBtn: document.getElementById('end-game-btn'),
            
            // Floating action buttons
            showBuzzerStatusBtn: document.getElementById('show-buzzer-status-btn'),
            awardPointsBtn: document.getElementById('award-points-btn'),
            
            // Answer evaluation modal
            answerEvaluationModal: document.getElementById('answer-evaluation-modal'),
            closeEvaluationBtn: document.getElementById('close-evaluation-btn'),
            noBuzzerContent: document.getElementById('no-buzzer-content'),
            currentAnswererContent: document.getElementById('current-answerer-content'),
            currentPosition: document.getElementById('current-position'),
            currentTeamName: document.getElementById('current-team-name'),
            currentBuzzerTime: document.getElementById('current-buzzer-time'),
            questionPoints: document.getElementById('question-points'),
            markCorrectBtn: document.getElementById('mark-correct-btn'),
            markIncorrectBtn: document.getElementById('mark-incorrect-btn'),
            giveUpBtn: document.getElementById('give-up-btn'),
            nextInLineCard: document.getElementById('next-in-line-card'),
            nextTeamName: document.getElementById('next-team-name'),
            nextBuzzerTime: document.getElementById('next-buzzer-time'),
            evaluationHistorySection: document.getElementById('evaluation-history-section'),
            evaluationList: document.getElementById('evaluation-list'),
            
            // Buzzer status modal
            buzzerStatusModal: document.getElementById('buzzer-status-modal'),
            closeBuzzerModalBtn: document.getElementById('close-buzzer-modal-btn'),
            modalBuzzerStatusList: document.getElementById('modal-buzzer-status-list'),
            modalRefreshBuzzersBtn: document.getElementById('modal-refresh-buzzers-btn'),
            modalArmAllBuzzersBtn: document.getElementById('modal-arm-all-buzzers-btn'),
            modalDisarmAllBuzzersBtn: document.getElementById('modal-disarm-all-buzzers-btn'),
            
            // Manual points modal
            manualPointsModal: document.getElementById('manual-points-modal'),
            closePointsModalBtn: document.getElementById('close-points-modal-btn'),
            pointsInput: document.getElementById('points-input'),
            teamSelect: document.getElementById('team-select'),
            awardPointsSubmitBtn: document.getElementById('award-points-submit-btn'),

            // Virtual buzzer toggle
            virtualBuzzerEnabled: document.getElementById('virtual-buzzer-enabled'),
            
            // Game actions modal
            showGameActionsBtn: document.getElementById('show-game-actions-btn'),
            gameActionsModal: document.getElementById('game-actions-modal'),
            closeGameActionsModalBtn: document.getElementById('close-game-actions-modal-btn'),
            
            // Header navigation buttons
            navOpenDisplayBtn: document.getElementById('nav-open-display-btn'),
            navOpenAdminBtn: document.getElementById('nav-open-admin-btn'),
            
            // Toast container
            toastContainer: document.getElementById('toast-container'),
            
            // Buzzer sidebar elements
            buzzerSidebar: document.getElementById('buzzer-sidebar'),
            toggleBuzzerSidebarBtn: document.getElementById('toggle-buzzer-sidebar'),
            buzzerCounter: document.getElementById('buzzer-counter'),
            onlineThreshold: document.getElementById('online-threshold'),
            onlineBuzzers: document.getElementById('online-buzzers'),
            virtualBuzzersSection: document.getElementById('virtual-buzzers-section'),
            virtualBuzzers: document.getElementById('virtual-buzzers'),
            offlineBuzzers: document.getElementById('offline-buzzers')
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

        // ESP32 device monitoring listeners
        this.socket.on('esp32-device-data', (data) => {
            if (data.esp32_data) {
                this.parseESP32DeviceData(data.esp32_data, data.timestamp);
            }
        });
        
        this.socket.on('esp32-status', (data) => {
            this.updateESP32Status(data);
        });

        // Timer pause/resume events
        this.socket.on('timer-paused', (data) => {
            console.log('Timer paused by backend:', data);
            // Stop the local timer interval
            this.stopTimer();
            
            // Calculate and display remaining time
            const elapsedSeconds = Math.floor(data.timeElapsed / 1000);
            const remaining = Math.max(0, this.questionTimeLimit - elapsedSeconds);
            
            if (this.elements.progressTimeText) {
                this.elements.progressTimeText.textContent = `⏸️ ${remaining}s (paused)`;
            }
            
            // Update progress bar to show current state
            if (this.elements.progressBarFill) {
                const remainingPercentage = Math.max(0, (remaining / this.questionTimeLimit) * 100);
                this.elements.progressBarFill.style.transform = `scaleX(${remainingPercentage / 100})`;
            }
        });

        this.socket.on('timer-resumed', (data) => {
            console.log('Timer resumed by backend:', data);
            // Update remaining time from backend
            const remainingSeconds = Math.max(0, Math.floor(data.timeRemaining / 1000));
            
            // Adjust question start time to match backend remaining time
            this.questionStartTime = Date.now() - (this.questionTimeLimit - remainingSeconds) * 1000;
            
            // Restart the local timer
            this.startTimer();
        });

        // Virtual buzzer listeners
        this.socket.on('virtual-buzzer-register', (data) => {
            this.handleVirtualBuzzerRegister(data);
        });

        this.socket.on('virtual-buzzer-disconnect', (data) => {
            this.handleVirtualBuzzerDisconnect(data.buzzerId);
        });

        this.socket.on('question-start', async (data) => {
            this.isQuestionActive = true;
            this.activeQuestionIndex = data.questionIndex;
            this.questionStartTime = data.startTime;
            this.questionTimeLimit = data.question.time_limit || 30;
            this.startTimer();
            this.updateQuestionControls();
            this.resetAnswerEvaluation(); // Clear previous evaluation state
            this.hideCurrentAnswererHighlight();
            
            // Refresh game state to get updated played_questions and update tabs
            if (this.currentGame) {
                try {
                    const response = await fetch(`/api/games/${this.currentGame.id}`);
                    if (response.ok) {
                        const updatedGame = await response.json();
                        this.currentGame = updatedGame;
                        this.updateQuestionTabsState();
                    }
                } catch (error) {
                    console.error('Failed to refresh game state:', error);
                }
            }
        });

        this.socket.on('question-end', async (data) => {
            this.isQuestionActive = false;
            this.activeQuestionIndex = -1; // Clear on-air status
            this.buzzerOrder = data.buzzerOrder || [];
            this.stopTimer();
            this.hideTimers();
            
            // Disarm buzzers when question ends naturally (timeout)
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'question-end');
            }
            
            this.updateQuestionControls();
            this.updateBuzzerResults();
            this.hideCurrentAnswererHighlight();
            this.updateQuestionTabsState();
            
            // Time up - host controls when to advance manually for entertainment purposes
        });

        this.socket.on('score-update', (data) => {
            // Update team data with new scores if provided
            if (data.teams) {
                this.teams = data.teams;
            } else if (data.groupId && data.newScore !== undefined) {
                // Update specific team score
                const team = this.teams.find(t => t.id === data.groupId);
                if (team) {
                    team.score = data.newScore;
                }
            }
            this.updateTeamDisplay();
            this.showToast('Points awarded successfully', 'success');
        });

        this.socket.on('game-reset', () => {
            this.resetControlPanel();
            this.showToast('Game has been reset', 'info');
        });

        // Buzzer device monitoring listeners
        this.socket.on('esp32-device', (data) => {
            this.updateBuzzerDevice(data);
        });

        this.socket.on('buzzer-heartbeat', (data) => {
            this.updateBuzzerHeartbeat(data);
        });

        this.socket.on('esp32-status', (data) => {
            this.updateESP32Status(data);
        });

        // Answer evaluation listeners
        this.socket.on('answer-evaluated', (data) => {
            this.handleAnswerEvaluated(data);
        });

        this.socket.on('question-prepared', (data) => {
            this.handleQuestionPrepared(data);
        });

        this.socket.on('game-completed', (data) => {
            this.handleGameCompleted(data);
        });
    }

    setupEventListeners() {
        // Main game controls (with null checks to prevent errors)
        if (this.elements.startQuestionBtn) this.elements.startQuestionBtn.addEventListener('click', () => this.startQuestion());
        if (this.elements.endQuestionBtn) this.elements.endQuestionBtn.addEventListener('click', () => this.endQuestion());
        if (this.elements.showAnswerBtn) this.elements.showAnswerBtn.addEventListener('click', (e) => this.handleShowAnswerClick(e));
        if (this.elements.decreaseFontBtn) this.elements.decreaseFontBtn.addEventListener('click', () => this.decreaseDisplayFontSize());
        if (this.elements.increaseFontBtn) this.elements.increaseFontBtn.addEventListener('click', () => this.increaseDisplayFontSize());
        if (this.elements.nextQuestionBtn) this.elements.nextQuestionBtn.addEventListener('click', () => this.nextQuestion());
        if (this.elements.prevQuestionBtn) this.elements.prevQuestionBtn.addEventListener('click', () => this.prevQuestion());
        if (this.elements.questionSelect) this.elements.questionSelect.addEventListener('change', (e) => this.jumpToQuestion(e.target.value));
        if (this.elements.showQuestionSelectBtn) this.elements.showQuestionSelectBtn.addEventListener('click', () => this.showQuestionSelectModal());
        if (this.elements.resetScoresBtn) this.elements.resetScoresBtn.addEventListener('click', () => this.resetAllScores());
        if (this.elements.resetQuestionsBtn) this.elements.resetQuestionsBtn.addEventListener('click', () => this.resetQuestions());
        if (this.elements.resetGameBtn) this.elements.resetGameBtn.addEventListener('click', () => this.resetGame());
        if (this.elements.showLeaderboardBtn) this.elements.showLeaderboardBtn.addEventListener('click', () => this.toggleLeaderboard());
        if (this.elements.leaderboardViewSelect) this.elements.leaderboardViewSelect.addEventListener('change', (e) => this.changeLeaderboardView(e.target.value));
        if (this.elements.endGameBtn) this.elements.endGameBtn.addEventListener('click', () => this.endGame());
        
        // Buzzer controls
        if (this.elements.armBuzzersBtn) this.elements.armBuzzersBtn.addEventListener('click', () => this.armBuzzers());
        if (this.elements.disarmBuzzersBtn) this.elements.disarmBuzzersBtn.addEventListener('click', () => this.disarmBuzzers());
        
        
        // Floating action buttons
        if (this.elements.showBuzzerStatusBtn) this.elements.showBuzzerStatusBtn.addEventListener('click', () => this.showBuzzerStatusModal());
        
        // Answer evaluation modal
        if (this.elements.closeEvaluationBtn) this.elements.closeEvaluationBtn.addEventListener('click', () => this.hideAnswerEvaluationModal());
        if (this.elements.markCorrectBtn) this.elements.markCorrectBtn.addEventListener('click', () => this.markAnswer(true));
        if (this.elements.markIncorrectBtn) this.elements.markIncorrectBtn.addEventListener('click', () => this.markAnswer(false));
        if (this.elements.giveUpBtn) this.elements.giveUpBtn.addEventListener('click', () => this.giveUpQuestion());
        
        // Buzzer status modal
        if (this.elements.closeBuzzerModalBtn) this.elements.closeBuzzerModalBtn.addEventListener('click', () => this.hideBuzzerStatusModal());
        if (this.elements.modalRefreshBuzzersBtn) this.elements.modalRefreshBuzzersBtn.addEventListener('click', () => this.refreshModalBuzzerStatus());
        if (this.elements.modalArmAllBuzzersBtn) this.elements.modalArmAllBuzzersBtn.addEventListener('click', () => this.modalArmAllBuzzers());
        if (this.elements.modalDisarmAllBuzzersBtn) this.elements.modalDisarmAllBuzzersBtn.addEventListener('click', () => this.modalDisarmAllBuzzers());
        
        // Manual points modal
        if (this.elements.closePointsModalBtn) this.elements.closePointsModalBtn.addEventListener('click', () => this.hideManualPointsModal());
        if (this.elements.awardPointsSubmitBtn) this.elements.awardPointsSubmitBtn.addEventListener('click', () => this.awardManualPoints());
        
        // Game actions modal
        if (this.elements.showGameActionsBtn) this.elements.showGameActionsBtn.addEventListener('click', () => this.showGameActionsModal());
        if (this.elements.closeGameActionsModalBtn) this.elements.closeGameActionsModalBtn.addEventListener('click', () => this.hideGameActionsModal());
        
        // Question tabs event listeners
        if (this.elements.scrollTabsLeft) this.elements.scrollTabsLeft.addEventListener('click', () => this.scrollQuestionTabs(-1));
        if (this.elements.scrollTabsRight) this.elements.scrollTabsRight.addEventListener('click', () => this.scrollQuestionTabs(1));
        
        // Header navigation buttons
        if (this.elements.navOpenDisplayBtn) this.elements.navOpenDisplayBtn.addEventListener('click', () => window.open('/display', '_blank'));
        if (this.elements.navOpenAdminBtn) this.elements.navOpenAdminBtn.addEventListener('click', () => window.open('/admin', '_blank'));
        
        // Close modals when clicking outside
        this.elements.answerEvaluationModal.addEventListener('click', (e) => {
            if (e.target === this.elements.answerEvaluationModal) {
                this.hideAnswerEvaluationModal();
            }
        });
        
        this.elements.buzzerStatusModal.addEventListener('click', (e) => {
            if (e.target === this.elements.buzzerStatusModal) {
                this.hideBuzzerStatusModal();
            }
        });
        
        this.elements.manualPointsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.manualPointsModal) {
                this.hideManualPointsModal();
            }
        });
        
        this.elements.gameActionsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.gameActionsModal) {
                this.hideGameActionsModal();
            }
        });
        
        // Refresh scores button
        if (this.elements.refreshScoresBtn) {
            this.elements.refreshScoresBtn.addEventListener('click', () => this.updateTeamDisplay());
        }
        
        // Buzzer overlay controls
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
        
        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            // Don't trigger shortcuts if a modal is open (except for Escape)
            const modalOpen = !document.getElementById('answer-evaluation-modal').classList.contains('hidden') ||
                            !document.getElementById('buzzer-status-modal').classList.contains('hidden') ||
                            !document.getElementById('manual-points-modal').classList.contains('hidden') ||
                            !document.getElementById('game-actions-modal').classList.contains('hidden');
                            
            if (modalOpen && e.key !== 'Escape') {
                return;
            }
            
            switch (e.key) {
                case ' ': // Space - Start Question or Evaluate Answers
                    e.preventDefault();
                    if (this.isQuestionActive && this.buzzerOrder.length > 0) {
                        this.showAnswerEvaluationModal();
                    } else if (!this.isQuestionActive) {
                        this.startQuestion();
                    }
                    break;
                    
                case 'ArrowLeft': // Left Arrow - Previous Question
                    e.preventDefault();
                    this.prevQuestion();
                    break;
                    
                case 'ArrowRight': // Right Arrow - Next Question  
                    e.preventDefault();
                    this.nextQuestion();
                    break;
                    
                case 'Escape': // Escape - Hide Leaderboard or Close Modals
                    e.preventDefault();
                    if (modalOpen) {
                        this.hideAnswerEvaluationModal();
                        this.hideBuzzerStatusModal();
                        this.hideManualPointsModal();
                        this.hideGameActionsModal();
                    } else if (this.isLeaderboardVisible) {
                        this.hideLeaderboard();
                    }
                    break;
                    
                case 's':
                case 'S': // S - End Question
                    e.preventDefault();
                    if (this.isQuestionActive) {
                        this.endQuestion();
                    }
                    break;
                    
                case 'j':
                case 'J': // J - Jump to Question
                    e.preventDefault();
                    this.showQuestionSelectModal();
                    break;
                    
                case 'g':
                case 'G': // G - Change Game
                    e.preventDefault();
                    if (this.gameSelector) {
                        this.gameSelector.showGameSelector();
                    }
                    break;
                    
                case 'h':
                case 'H': // H - Open Host Control (Ctrl+H/Cmd+H)
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        window.open('/control', '_blank');
                    }
                    break;
                    
                case 'd':
                case 'D': // D - Open Display (use Ctrl+D/Cmd+D)
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        window.open('/display', '_blank');
                    }
                    break;
                    
                case 'a':
                case 'A': // A - Show Answer (triple press) or Open Admin (Ctrl+A/Cmd+A)
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        window.open('/admin', '_blank');
                    } else {
                        e.preventDefault();
                        this.handleAKeyPress(e);
                    }
                    break;
                    
                case 'l':
                case 'L': // L - Toggle Leaderboard
                    e.preventDefault();
                    this.toggleLeaderboard();
                    break;
                    
                case '-':
                case '_': // - - Decrease Font Size
                    e.preventDefault();
                    this.decreaseDisplayFontSize();
                    break;
                    
                case '+':
                case '=': // + - Increase Font Size (= key for easier access)
                    e.preventDefault();
                    this.increaseDisplayFontSize();
                    break;
            }
        });

        // Virtual buzzer toggle event listener
        if (this.elements.virtualBuzzerEnabled) {
            this.elements.virtualBuzzerEnabled.addEventListener('change', (e) => {
                this.handleVirtualBuzzerToggle(e.target.checked);
            });
        }
    }

    // Game loading is now handled by the global game selector

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
            this.elements.currentGameName.textContent = this.currentGame.name;
            this.elements.questionProgress.textContent = `Q ${this.currentQuestionIndex + 1}/${this.questions.length}`;
            this.elements.teamsCount.textContent = `${this.teams.length} Teams`;
            
            // Update question meta in the main card
            if (this.questions.length > 0) {
                const currentQuestion = this.questions[this.currentQuestionIndex];
                if (currentQuestion) {
                    const pointsSpan = this.elements.questionMeta.querySelector('.points');
                    const timeSpan = this.elements.questionMeta.querySelector('.time');
                    if (pointsSpan) pointsSpan.textContent = `${currentQuestion.points || 100} pts`;
                    if (timeSpan) timeSpan.textContent = `${currentQuestion.time_limit || 30}s`;
                }
            }
        } else {
            this.elements.currentGameName.textContent = 'No Game Loaded';
            this.elements.questionProgress.textContent = 'Q 0/0';
            this.elements.teamsCount.textContent = '0 Teams';
        }
    }

    updateTeamDisplay(preserveUserInput = false) {
        console.log('[VIRTUAL BUZZER DEBUG] updateTeamDisplay called with', this.teams.length, 'teams');
        if (this.teams.length === 0) {
            this.elements.teamsScoring.innerHTML = '<div class="no-teams">No teams loaded</div>';
            this.elements.teamSelect.innerHTML = '<option value="">No teams available</option>';
            return;
        }
        
        // Store current user input values if preserving
        const currentInputValues = {};
        if (preserveUserInput) {
            const existingInputs = this.elements.teamsScoring.querySelectorAll('.team-score');
            existingInputs.forEach(input => {
                const teamId = input.getAttribute('data-team-id');
                if (teamId) {
                    currentInputValues[teamId] = input.value;
                }
            });
        }
        
        this.elements.teamsScoring.innerHTML = '';
        this.elements.teamSelect.innerHTML = '<option value="">Select team...</option>';
        
        this.teams.sort((a, b) => b.score - a.score).forEach((team, index) => {
            const teamItem = document.createElement('div');
            teamItem.className = 'team-score-item';
            teamItem.style.setProperty('--team-color', team.color || '#00D4FF');
            
            const scoreInput = document.createElement('input');
            scoreInput.type = 'number';
            scoreInput.className = 'team-score';
            // Use preserved user input or current team score
            scoreInput.value = preserveUserInput && currentInputValues[team.id] ? currentInputValues[team.id] : (team.score || 0);
            scoreInput.setAttribute('data-team-id', team.id);
            
            // Add event listener for score changes
            scoreInput.addEventListener('change', (e) => this.updateTeamScore(team.id, parseInt(e.target.value) || 0));
            scoreInput.addEventListener('blur', (e) => e.target.style.outline = 'none');

            // Prevent clicks on input from triggering virtual buzzer
            scoreInput.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[CLICK TEST] Click on score input stopped from propagating');
            });
            
            // Add ranking number and team name
            const rankBadge = document.createElement('span');
            rankBadge.className = 'rank-badge';
            rankBadge.textContent = index + 1;
            
            const teamNameSpan = document.createElement('span');
            teamNameSpan.className = 'team-name';
            teamNameSpan.textContent = team.name;
            
            // Add crown for leader
            if (index === 0 && team.score > 0) {
                teamNameSpan.textContent += ' 👑';
            }
            
            teamItem.appendChild(rankBadge);
            teamItem.appendChild(teamNameSpan);
            teamItem.appendChild(scoreInput);
            
            this.elements.teamsScoring.appendChild(teamItem);

            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            this.elements.teamSelect.appendChild(option);
        });

        // Re-setup virtual buzzer click handlers if enabled
        console.log('[VIRTUAL BUZZER DEBUG] Teams updated - checking toggle state:', this.elements.virtualBuzzerEnabled ? this.elements.virtualBuzzerEnabled.checked : 'toggle not found');
        if (this.elements.virtualBuzzerEnabled && this.elements.virtualBuzzerEnabled.checked) {
            console.log('[VIRTUAL BUZZER DEBUG] Toggle is enabled, setting up handlers after team update');
            this.setupTeamClickHandlers();
        }
    }

    // Virtual Buzzer Methods
    handleVirtualBuzzerToggle(enabled) {
        console.log('[VIRTUAL BUZZER DEBUG] Toggle changed to:', enabled);
        const teamsListElement = this.elements.teamsScoring;
        if (enabled) {
            teamsListElement.classList.add('virtual-buzzer-enabled');
            this.setupTeamClickHandlers();
        } else {
            teamsListElement.classList.remove('virtual-buzzer-enabled');
            this.removeTeamClickHandlers();
        }
    }

    setupTeamClickHandlers() {
        const teamItems = this.elements.teamsScoring.querySelectorAll('.team-score-item');
        console.log('[VIRTUAL BUZZER DEBUG] Setting up click handlers for', teamItems.length, 'team items');
        teamItems.forEach((teamItem, index) => {
            // Remove existing handlers first
            teamItem.removeEventListener('click', this.boundHandleTeamClick);

            // Add new handler
            this.boundHandleTeamClick = this.handleTeamClick.bind(this);
            teamItem.addEventListener('click', this.boundHandleTeamClick);

            // Add a simple test to see if ANY clicks are detected
            teamItem.addEventListener('click', function(e) {
                console.log('[CLICK TEST] Any click detected on team item', index, 'with keys:', {
                    ctrl: e.ctrlKey,
                    meta: e.metaKey,
                    alt: e.altKey,
                    shift: e.shiftKey
                });
            });

            console.log('[VIRTUAL BUZZER DEBUG] Added click handler to team item', index);
        });
    }

    removeTeamClickHandlers() {
        const teamItems = this.elements.teamsScoring.querySelectorAll('.team-score-item');
        console.log('[VIRTUAL BUZZER DEBUG] Removing click handlers from', teamItems.length, 'team items');
        teamItems.forEach(teamItem => {
            if (this.boundHandleTeamClick) {
                teamItem.removeEventListener('click', this.boundHandleTeamClick);
            }
        });
        this.boundHandleTeamClick = null;
    }

    handleTeamClick(event) {
        console.log('[VIRTUAL BUZZER DEBUG] Team clicked:', {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            toggleEnabled: this.elements.virtualBuzzerEnabled ? this.elements.virtualBuzzerEnabled.checked : 'toggle not found',
            isQuestionActive: this.isQuestionActive,
            isBuzzersArmed: this.isBuzzersArmed
        });

        // Only proceed if Ctrl/Cmd is pressed and virtual buzzer is enabled
        if (!(event.ctrlKey || event.metaKey) || !this.elements.virtualBuzzerEnabled.checked) {
            console.log('[VIRTUAL BUZZER DEBUG] Conditions not met - exiting');
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        // Check if buzzers are armed (same rules as physical buzzers)
        if (!this.isQuestionActive) {
            this.showToast('No active question - buzzers are not armed', 'warning');
            return;
        }

        if (!this.isBuzzersArmed) {
            this.showToast('Buzzers are not armed for this question', 'warning');
            return;
        }

        // Get team information
        const teamScoreInput = event.currentTarget.querySelector('.team-score');
        if (!teamScoreInput) return;

        const teamId = teamScoreInput.getAttribute('data-team-id');
        const teamName = event.currentTarget.querySelector('.team-name').textContent.replace(' 👑', '');

        // Check if this team already buzzed in
        if (this.buzzerOrder.some(buzzer => buzzer.groupId === teamId)) {
            this.showToast(`${teamName} has already buzzed in`, 'warning');
            return;
        }

        // Create virtual buzzer press data
        const virtualBuzzerData = {
            gameId: this.currentGame.id,
            buzzerId: `virtual_${teamId}`,
            groupId: teamId,
            teamName: teamName,
            timestamp: Date.now(),
            deltaMs: Date.now() - this.questionStartTime, // Calculate from question start
            position: this.buzzerOrder.length + 1,
            isVirtual: true
        };

        console.log(`[VIRTUAL BUZZER] ${teamName} buzzed in via Ctrl+Click at ${virtualBuzzerData.deltaMs}ms`);
        console.log('[VIRTUAL BUZZER] Emitting buzzer-press with data:', virtualBuzzerData);
        console.log('[VIRTUAL BUZZER] Socket connected:', this.socket.connected);

        // Send virtual buzzer press through socket to backend (same as physical buzzers)
        this.socket.emit('buzzer-press', virtualBuzzerData);

        // Visual feedback
        const clickedElement = event.currentTarget;
        clickedElement.style.backgroundColor = 'rgba(74, 158, 191, 0.2)';
        setTimeout(() => {
            clickedElement.style.backgroundColor = '';
        }, 1000);

        this.showToast(`Virtual buzzer: ${teamName}`, 'info');
    }

    updateQuestionSelector() {
        this.elements.questionSelect.innerHTML = '<option value="">Select question...</option>';
        this.questions.forEach((question, index) => {
            const option = document.createElement('option');
            option.value = index;
            
            // Mark played questions in the dropdown
            if (this.isQuestionPlayed(index)) {
                option.textContent = `${index + 1}. ${question.text.substring(0, 50)}... [PLAYED]`;
                option.disabled = true; // Disable played questions in dropdown
                option.style.color = '#999'; // Gray out played questions
            } else {
                option.textContent = `${index + 1}. ${question.text.substring(0, 50)}...`;
            }
            
            this.elements.questionSelect.appendChild(option);
        });
        this.elements.questionSelect.disabled = false;
    }

    updateQuestionDisplay() {
        if (this.questions.length > 0 && this.currentQuestionIndex < this.questions.length) {
            const question = this.questions[this.currentQuestionIndex];
            this.elements.questionText.textContent = question.text;
            
            // Show correct answer
            if (this.elements.correctAnswerText && question.correct_answer) {
                this.elements.correctAnswerText.textContent = question.correct_answer;
                this.elements.correctAnswerDisplay.classList.remove('hidden');
            }
            
            // Update meta info
            this.elements.questionMeta.innerHTML = `
                <span class="points">${question.points || 100} pts</span>
                <span class="time">${question.time_limit || 30}s</span>
            `;
        } else {
            this.elements.questionText.textContent = 'Select a game and start your first question...';
            this.elements.questionMeta.innerHTML = '';
            if (this.elements.correctAnswerDisplay) {
                this.elements.correctAnswerDisplay.classList.add('hidden');
            }
        }
        
        // Update question progress indicators
        this.updateQuestionProgress();
    }
    
    updateQuestionProgress() {
        const totalQuestions = this.questions.length;
        const currentNum = this.currentQuestionIndex + 1; // 1-based for display
        const percentage = totalQuestions > 0 ? Math.round((currentNum / totalQuestions) * 100) : 0;
        
        // Update header progress
        if (this.elements.questionProgress) {
            this.elements.questionProgress.textContent = `Q ${currentNum}/${totalQuestions}`;
        }
        
        // Update team count
        if (this.elements.teamsCount) {
            this.elements.teamsCount.textContent = `${this.teams.length}`;
        }
        
        // Update team counter in scoreboard sidebar
        if (this.elements.teamCounter) {
            const totalPossibleTeams = this.teams.length > 0 ? this.teams.length : 0;
            this.elements.teamCounter.textContent = `${this.teams.length}/${totalPossibleTeams}`;
        }
        
        // Update question progress info
        if (this.elements.currentQuestionNum) {
            this.elements.currentQuestionNum.textContent = currentNum;
        }
        if (this.elements.totalQuestions) {
            this.elements.totalQuestions.textContent = totalQuestions;
        }
        if (this.elements.progressPercentage) {
            this.elements.progressPercentage.textContent = `${percentage}%`;
        }
        if (this.elements.questionProgressFill) {
            this.elements.questionProgressFill.style.width = `${percentage}%`;
        }
    }

    updateQuestionControls() {
        const hasGame = this.currentGame !== null;
        const hasQuestions = this.questions.length > 0;
        const isCurrentQuestionPlayed = this.isQuestionPlayed(this.currentQuestionIndex);
        const canStart = hasGame && hasQuestions && !this.isQuestionActive && !isCurrentQuestionPlayed;
        const canEnd = this.isQuestionActive;
        
        // Debug logging for the GO button issue
        if (hasGame && hasQuestions && !canStart) {
            console.log('GO button disabled - Debug info:', {
                hasGame,
                hasQuestions,
                currentQuestionIndex: this.currentQuestionIndex,
                isQuestionActive: this.isQuestionActive,
                isCurrentQuestionPlayed,
                playedQuestions: this.currentGame?.played_questions,
                canStart
            });
        }
        
        // Check if next/previous navigation is possible (not to played questions)
        const canGoNext = hasGame && this.currentQuestionIndex < this.questions.length - 1;
        const canGoPrev = hasGame && this.currentQuestionIndex > 0 && !this.isQuestionPlayed(this.currentQuestionIndex - 1);
        
        // Add null checks to prevent errors
        if (this.elements.startQuestionBtn) this.elements.startQuestionBtn.disabled = !canStart;
        if (this.elements.endQuestionBtn) this.elements.endQuestionBtn.disabled = !canEnd;
        if (this.elements.nextQuestionBtn) this.elements.nextQuestionBtn.disabled = !canGoNext;
        if (this.elements.prevQuestionBtn) this.elements.prevQuestionBtn.disabled = !canGoPrev;
        if (this.elements.armBuzzersBtn) this.elements.armBuzzersBtn.disabled = !canStart;
        if (this.elements.disarmBuzzersBtn) this.elements.disarmBuzzersBtn.disabled = !this.isBuzzersArmed;
        if (this.elements.awardPointsBtn) this.elements.awardPointsBtn.disabled = !hasGame;
        if (this.elements.teamSelect) this.elements.teamSelect.disabled = !hasGame;
        if (this.elements.questionSelect) this.elements.questionSelect.disabled = !hasGame;
        if (this.elements.showQuestionSelectBtn) this.elements.showQuestionSelectBtn.disabled = !hasGame;
        
        // Update toggle button states
        this.updateShowAnswerButton();
        this.updateLeaderboardButton();
    }

    updateBuzzerStatus() {
        if (this.elements.buzzersArmedStatus) {
            this.elements.buzzersArmedStatus.textContent = this.isBuzzersArmed ? 'Armed' : 'Disarmed';
        }
        
        // Update buzzer sidebar header armed state
        const buzzerSidebarHeader = document.querySelector('.buzzer-sidebar-header');
        if (buzzerSidebarHeader) {
            buzzerSidebarHeader.classList.toggle('armed', this.isBuzzersArmed);
        }
        
        // Refresh buzzer sidebar to show/hide armed states on individual items
        this.updateBuzzerSidebar();
        
        this.updateQuestionControls();
    }

    clearArmedIndicators() {
        // Remove armed class from sidebar header
        const buzzerSidebarHeader = document.querySelector('.buzzer-sidebar-header');
        if (buzzerSidebarHeader) {
            buzzerSidebarHeader.classList.remove('armed');
        }
        
        // Remove armed classes from all buzzer items and status dots
        const buzzerItems = document.querySelectorAll('.buzzer-item.armed');
        buzzerItems.forEach(item => {
            item.classList.remove('armed');
        });
        
        const armedStatusDots = document.querySelectorAll('.buzzer-status-dot.armed');
        armedStatusDots.forEach(dot => {
            dot.classList.remove('armed');
        });
        
        // Note: We don't change this.isBuzzersArmed here as that's managed by socket events
        // This method only removes visual indicators while keeping the logical state intact
    }

    updateBuzzerResults() {
        if (this.buzzerOrder.length === 0) {
            this.elements.buzzerResults.innerHTML = '<div class="no-buzzes">No buzzer presses yet</div>';
            return;
        }

        this.elements.buzzerResults.innerHTML = '';
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
            
            this.elements.buzzerResults.appendChild(buzzerItem);
        });
    }

    getTeamName(groupId) {
        const team = this.teams.find(t => t.id === groupId);
        return team ? team.name : 'Unknown Team';
    }

    async startQuestion() {
        if (!this.currentGame) return;
        
        // Prevent replaying already played questions
        if (this.isQuestionPlayed(this.currentQuestionIndex)) {
            this.showToast(`Question ${this.currentQuestionIndex + 1} has already been played`, 'warning');
            return;
        }
        
        // Prevent restarting on-air question
        if (this.activeQuestionIndex >= 0) {
            console.log('Start question blocked - Debug info:', {
                activeQuestionIndex: this.activeQuestionIndex,
                currentQuestionIndex: this.currentQuestionIndex,
                isQuestionActive: this.isQuestionActive
            });
            this.showToast('Another question is already on-air', 'warning');
            return;
        }

        try {
            await fetch(`/api/games/${this.currentGame.id}/start-question/${this.currentQuestionIndex}`, {
                method: 'POST'
            });
            this.buzzerOrder = [];
            this.updateBuzzerResults();
            
            // Update tab state for active question
            this.isQuestionActive = true;
            this.activeQuestionIndex = this.currentQuestionIndex; // Set which question is on-air
            this.questionStartTime = Date.now();
            this.questionTimeLimit = this.questions[this.currentQuestionIndex]?.time_limit || 30;
            this.updateQuestionTabsState();
            this.startTabProgressUpdates();
            
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
            
            // Disarm buzzers when question ends
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'question-end');
            }
            
            // Update tab state for ended question
            this.isQuestionActive = false;
            this.stopTabProgressUpdates();
            this.updateQuestionTabsState();
            
            this.showToast('Question ended', 'info');
        } catch (error) {
            this.showToast('Failed to end question', 'error');
        }
    }

    async nextQuestion() {
        if (!this.currentGame || this.currentQuestionIndex >= this.questions.length - 1) {
            return;
        }

        try {
            // Disarm buzzers when navigating to next question
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'navigation');
            }
            
            // Clear on-air state when moving to different question
            this.activeQuestionIndex = -1;
            this.isQuestionActive = false;
            
            // Reset toggles for idle state when advancing to next question
            this.resetTogglesForIdleState();
            
            const newQuestionIndex = this.currentQuestionIndex + 1;
            
            // Call backend to update server state
            const response = await fetch(`/api/games/${this.currentGame.id}/navigate-to-question/${newQuestionIndex}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                this.currentQuestionIndex = newQuestionIndex;
                // Update current game's server state for consistency
                if (this.currentGame) {
                    this.currentGame.current_question_index = newQuestionIndex;
                }
                this.updateQuestionDisplay();
                this.updateQuestionControls();
                this.updateQuestionTabsState();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to navigate to next question');
            }
            
        } catch (error) {
            console.error('Failed to navigate to next question:', error);
            this.showToast('Failed to navigate to next question', 'error');
        }
    }

    async prevQuestion() {
        if (!this.currentGame || this.currentQuestionIndex <= 0) {
            return;
        }

        const newQuestionIndex = this.currentQuestionIndex - 1;
        
        // Prevent navigating back to already played questions
        if (this.isQuestionPlayed(newQuestionIndex)) {
            this.showToast(`Cannot go back to Question ${newQuestionIndex + 1} - it has already been played`, 'warning');
            return;
        }

        try {
            // Disarm buzzers when navigating to previous question
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'navigation');
            }
            
            // Clear on-air state when moving to different question  
            this.activeQuestionIndex = -1;
            this.isQuestionActive = false;
            
            // Reset toggles for idle state when navigating to previous question
            this.resetTogglesForIdleState();
            
            // Call backend to update server state
            const response = await fetch(`/api/games/${this.currentGame.id}/navigate-to-question/${newQuestionIndex}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                this.currentQuestionIndex = newQuestionIndex;
                // Update current game's server state for consistency
                if (this.currentGame) {
                    this.currentGame.current_question_index = newQuestionIndex;
                }
                this.updateQuestionDisplay();
                this.updateQuestionControls();
                this.updateQuestionTabsState();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to navigate to previous question');
            }
            
        } catch (error) {
            console.error('Failed to navigate to previous question:', error);
            this.showToast('Failed to navigate to previous question', 'error');
        }
    }

    async jumpToQuestion(index) {
        if (!this.currentGame || index === '' || index < 0 || index >= this.questions.length) {
            return;
        }

        const newQuestionIndex = parseInt(index);
        
        // Prevent jumping to already played questions
        if (this.isQuestionPlayed(newQuestionIndex)) {
            this.showToast(`Cannot jump to Question ${newQuestionIndex + 1} - it has already been played`, 'warning');
            return;
        }

        try {
            // Disarm buzzers when jumping to a different question
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'navigation');
            }
            
            // Clear on-air state when jumping to different question
            this.activeQuestionIndex = -1;
            this.isQuestionActive = false;
            
            // Reset toggles for idle state when jumping to question
            this.resetTogglesForIdleState();
            
            // Call backend to update server state
            const response = await fetch(`/api/games/${this.currentGame.id}/navigate-to-question/${newQuestionIndex}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                this.currentQuestionIndex = newQuestionIndex;
                // Update current game's server state for consistency
                if (this.currentGame) {
                    this.currentGame.current_question_index = newQuestionIndex;
                }
                this.updateQuestionDisplay();
                this.updateQuestionControls();
                this.updateQuestionTabsState();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to jump to question');
            }
            
        } catch (error) {
            console.error('Failed to jump to question:', error);
            this.showToast('Failed to jump to question', 'error');
        }
    }

    showQuestionSelectModal() {
        // Create a temporary select that stays visible longer
        if (this.elements.questionSelect && !this.elements.questionSelect.disabled) {
            const select = this.elements.questionSelect;
            
            // Position the select near the button and make it visible
            select.classList.remove('hidden');
            select.style.position = 'absolute';
            select.style.zIndex = '1000';
            select.style.top = '50%';
            select.style.left = '50%';
            select.style.transform = 'translate(-50%, -50%)';
            select.style.fontSize = '1rem';
            select.style.padding = '8px';
            
            // Focus and open the dropdown
            select.focus();
            
            // Add a change listener to hide after selection
            const hideSelect = () => {
                select.classList.add('hidden');
                select.style.position = '';
                select.style.zIndex = '';
                select.style.top = '';
                select.style.left = '';
                select.style.transform = '';
                select.style.fontSize = '';
                select.style.padding = '';
                select.removeEventListener('change', hideSelect);
                select.removeEventListener('blur', hideSelect);
            };
            
            select.addEventListener('change', hideSelect);
            select.addEventListener('blur', hideSelect);
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

    async disarmBuzzers(showToast = true, source = 'manual') {
        try {
            await fetch('/api/buzzers/disarm', {
                method: 'POST'
            });
            
            if (showToast) {
                // Debounce toast notifications to prevent spam
                this.debouncedDisarmToast(source);
            }
        } catch (error) {
            this.showToast('Failed to disarm buzzers', 'error');
        }
    }

    debouncedDisarmToast(source) {
        // Clear existing timeout
        if (this.disarmToastTimeout) {
            clearTimeout(this.disarmToastTimeout);
        }
        
        // Track sources for grouping
        if (!this.pendingDisarmSources) {
            this.pendingDisarmSources = new Set();
        }
        this.pendingDisarmSources.add(source);
        
        // Set a short delay to collect multiple disarm calls
        this.disarmToastTimeout = setTimeout(() => {
            let message = 'Buzzers disarmed';
            
            if (this.pendingDisarmSources.has('navigation') && this.pendingDisarmSources.size > 1) {
                message = 'Buzzers disarmed (navigation)';
            } else if (this.pendingDisarmSources.has('question-end')) {
                message = 'Buzzers disarmed (question ended)';
            } else if (this.pendingDisarmSources.has('game-action') && this.pendingDisarmSources.size > 1) {
                message = 'Buzzers disarmed (game action)';
            }
            
            this.showToast(message, 'info');
            this.pendingDisarmSources.clear();
        }, 100); // 100ms delay to group rapid calls
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
        if (!this.currentGame || !confirm('Are you sure you want to reset the game? This will clear all scores, question progress, answers, and buzzer history.')) {
            return;
        }

        try {
            // Disarm buzzers before resetting
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'game-action');
            }
            
            // Stop any active timers
            this.stopTimer();
            this.stopTabProgressUpdates();
            
            // Reset all local state
            this.currentQuestionIndex = 0;
            this.isQuestionActive = false;
            this.activeQuestionIndex = -1;
            this.questionStartTime = null;
            this.evaluationHistory = [];
            this.buzzerOrder = [];
            this.currentBuzzerPosition = 0;
            this.playedQuestions.clear(); // Clear played questions on reset
            
            // Clear UI elements
            this.updateBuzzerResults();
            this.hideAnswerEvaluationModal();
            this.hideCurrentAnswererHighlight();
            
            // Hide correct answer display
            if (this.elements.correctAnswerDisplay) {
                this.elements.correctAnswerDisplay.classList.add('hidden');
            }
            
            // Reset question tabs to initial state
            this.initializeQuestionTabs();
            
            // Call backend reset
            const response = await fetch(`/api/games/${this.currentGame.id}/reset`, {
                method: 'POST'
            });
            
            if (response.ok) {
                // Update current game's server state for consistency
                if (this.currentGame) {
                    this.currentGame.current_question_index = 0;
                    this.currentGame.played_questions = [];
                }
                
                // Reset local team scores to match backend reset
                this.teams.forEach(team => {
                    team.score = 0;
                });
                
                // Update displays after successful reset
                this.updateQuestionDisplay();
                this.updateQuestionControls();
                this.updateQuestionTabsState();
                this.updateTeamDisplay(false);
                
                this.showToast('Game has been completely reset', 'success');
            } else {
                throw new Error('Failed to reset game on server');
            }
            
        } catch (error) {
            console.error('Failed to reset game:', error);
            this.showToast('Failed to reset game', 'error');
        }
    }

    async resetAllScores() {
        if (!this.currentGame || !confirm('Are you sure you want to reset all team scores to 0? This cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/reset-scores`, {
                method: 'POST'
            });
            
            if (response.ok) {
                // Update local teams data
                this.teams.forEach(team => {
                    team.score = 0;
                });
                
                // Refresh the scoreboard
                this.updateTeamDisplay(false);
                
                this.showToast('All team scores have been reset to 0', 'success');
            } else {
                throw new Error('Failed to reset scores');
            }
        } catch (error) {
            console.error('Failed to reset scores:', error);
            this.showToast('Failed to reset scores', 'error');
        }
    }

    async resetQuestions() {
        if (!this.currentGame || !confirm('Are you sure you want to reset all question progress? This will clear all answers, feedback, and question history but keep team scores intact.')) {
            return;
        }

        try {
            // Stop any active question timers
            this.stopTimer();
            this.stopTabProgressUpdates();
            
            // Reset question state
            this.currentQuestionIndex = 0;
            this.isQuestionActive = false;
            this.activeQuestionIndex = -1;
            this.questionStartTime = null;
            
            // Clear evaluation history
            this.evaluationHistory = [];
            this.playedQuestions.clear(); // Clear played questions on reset
            
            // Clear buzzer results
            this.updateBuzzerResults();
            this.hideAnswerEvaluationModal();
            this.hideCurrentAnswererHighlight();
            
            // Reset question tabs to initial state
            this.initializeQuestionTabs();
            
            // Call backend reset questions
            const response = await fetch(`/api/games/${this.currentGame.id}/reset-questions`, {
                method: 'POST'
            });
            
            if (response.ok) {
                // Update current game's server state for consistency
                if (this.currentGame) {
                    this.currentGame.current_question_index = 0;
                    this.currentGame.played_questions = [];
                }
                
                // Update all displays after successful reset
                this.updateQuestionDisplay();
                this.updateQuestionControls();
                this.updateQuestionTabsState();
                
                // Hide correct answer display
                if (this.elements.correctAnswerDisplay) {
                    this.elements.correctAnswerDisplay.classList.add('hidden');
                }
                
                this.showToast('Question progress has been reset', 'success');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to reset questions on server');
            }
            
        } catch (error) {
            console.error('Failed to reset questions:', error);
            this.showToast('Failed to reset question progress', 'error');
        }
    }

    async endGame() {
        if (!this.currentGame || !confirm('Are you sure you want to end the game?')) {
            return;
        }

        try {
            // Disarm buzzers before ending game
            if (this.isBuzzersArmed) {
                await this.disarmBuzzers(true, 'game-action');
            }
            
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

    toggleLeaderboard() {
        if (this.isLeaderboardVisible) {
            this.hideLeaderboard();
        } else {
            this.showLeaderboard();
        }
        this.updateLeaderboardButton();
    }

    updateLeaderboardButton() {
        if (!this.elements.showLeaderboardBtn) return;
        
        // Update toggle switch appearance based on state
        if (this.isLeaderboardVisible) {
            // Leaderboard is currently shown - button should show "on" state (up position)
            this.elements.showLeaderboardBtn.classList.remove('toggle-off');
            this.elements.showLeaderboardBtn.classList.add('toggle-on');
            this.elements.showLeaderboardBtn.title = 'Hide Leaderboard [L] • Currently visible';
        } else {
            // Leaderboard is hidden - button should show "off" state (down position)
            this.elements.showLeaderboardBtn.classList.remove('toggle-on');
            this.elements.showLeaderboardBtn.classList.add('toggle-off');
            this.elements.showLeaderboardBtn.title = 'Show Leaderboard [L]';
        }
    }

    resetTogglesForIdleState() {
        // Reset show answer toggle to off state
        this.isAnswerVisible = false;
        this.answerShown = false;
        
        // Reset leaderboard toggle to off state
        this.isLeaderboardVisible = false;
        
        // Update button appearances
        this.updateShowAnswerButton();
        this.updateLeaderboardButton();
        
        // Send hide commands to display to ensure it's in sync
        if (this.currentGame) {
            this.socket.emit('hide-leaderboard');
        }
    }

    showLeaderboard() {
        this.socket.emit('show-leaderboard', { view: this.currentLeaderboardView });
        this.isLeaderboardVisible = true;
        this.showToast(`🏆 Leaderboard shown (${this.getViewDisplayName()})`, 'success');
    }

    hideLeaderboard() {
        this.socket.emit('hide-leaderboard');
        this.isLeaderboardVisible = false;
        this.showToast('Leaderboard hidden', 'info');
    }

    changeLeaderboardView(newView) {
        this.currentLeaderboardView = newView;
        // If leaderboard is currently visible, update it with new view
        if (this.isLeaderboardVisible) {
            this.socket.emit('show-leaderboard', { view: newView });
            this.showToast(`🏆 Switched to ${this.getViewDisplayName()}`, 'success');
        }
    }

    getViewDisplayName() {
        switch (this.currentLeaderboardView) {
            case 'top3': return 'Top 3';
            case 'top5': return 'Top 5';
            case 'all': return 'All Teams';
            default: return 'All Teams';
        }
    }

    async refreshSystemStatus() {
        try {
            const [healthResponse, buzzerResponse] = await Promise.all([
                fetch('/health'),
                fetch('/api/buzzers/devices')
            ]);

            const health = await healthResponse.json();
            const devices = await buzzerResponse.json();

            // Only update elements that exist (for backwards compatibility)
            if (this.elements.dbStatus) {
                this.elements.dbStatus.textContent = health.services.database ? 'Connected' : 'Disconnected';
            }
            // Check if ESP32 is connected based on having any devices
            const esp32Connected = Array.isArray(devices) && devices.length > 0;
            
            if (this.elements.hardwareStatus) {
                this.elements.hardwareStatus.textContent = esp32Connected ? 'Connected' : 'Disconnected';
            }
            if (this.elements.firebaseStatus) {
                this.elements.firebaseStatus.textContent = health.services.firebase ? 'Connected' : 'Disconnected';
            }
            if (this.elements.esp32Status) {
                this.elements.esp32Status.textContent = esp32Connected ? 'Connected' : 'Disconnected';
            }

            // Log status for debugging (can be removed later)
            console.log('System Status:', {
                database: health.services.database ? 'Connected' : 'Disconnected',
                esp32: esp32Connected ? 'Connected' : 'Disconnected',
                firebase: health.services.firebase ? 'Connected' : 'Disconnected'
            });

        } catch (error) {
            console.error('System status check failed:', error);
            this.showToast('Failed to refresh system status', 'error');
        }
    }

    handleBuzzerPress(data) {
        // Clear armed indicators when first buzzer activity begins
        if (this.buzzerOrder.length === 0 && this.isBuzzersArmed) {
            this.clearArmedIndicators();
        }

        this.buzzerOrder.push(data);
        this.updateBuzzerResults();
        this.updateAnswerEvaluation();

        // Show current answerer highlight and evaluation modal for first buzzer OR
        // when modal is hidden but there are unevaluated buzzers
        const modalIsHidden = this.elements.answerEvaluationModal.classList.contains('hidden');
        const hasUnevaluatedBuzzers = this.buzzerOrder.find(b => !b.evaluated);

        if (this.buzzerOrder.length === 1 || (modalIsHidden && hasUnevaluatedBuzzers)) {
            this.showCurrentAnswererHighlight(data);
            // Auto-show answer evaluation modal when team buzzes and modal is not visible
            this.showAnswerEvaluationModal();

            // Timer pause logic is now handled by backend
        }

        // If additional teams buzz while timer is already paused, keep it paused
        // This handles the case where multiple teams buzz in quick succession
    }

    resetControlPanel() {
        this.buzzerOrder = [];
        this.isQuestionActive = false;
        this.isBuzzersArmed = false;
        this.updateBuzzerResults();
        this.updateQuestionControls();
        this.updateBuzzerStatus();
        this.resetAnswerEvaluation();
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

    // Buzzer Status Modal Methods
    showBuzzerStatusModal() {
        this.elements.buzzerStatusModal.classList.remove('hidden');
        this.refreshModalBuzzerStatus();
    }

    hideBuzzerStatusModal() {
        this.elements.buzzerStatusModal.classList.add('hidden');
    }

    updateBuzzerDevice(data) {
        const deviceId = data.device_id || data.id;
        const now = Date.now();
        
        this.buzzerDevices.set(deviceId, {
            ...data,
            last_seen: now,
            status: 'online'
        });
        
        this.updateModalBuzzerStatusDisplay();
    }

    updateBuzzerHeartbeat(data) {
        const deviceId = data.device_id || data.id;
        const now = Date.now();
        
        if (this.buzzerDevices.has(deviceId)) {
            const device = this.buzzerDevices.get(deviceId);
            device.last_seen = now;
            device.status = 'online';
            // Preserve last_online timestamp from backend API
            // Only update last_online if device is actually online
            if (data.online === true || device.online === true) {
                device.last_online = device.last_online || now; // Keep existing or set to now
            }
            this.buzzerDevices.set(deviceId, device);
        } else {
            // Create new device entry from heartbeat
            this.buzzerDevices.set(deviceId, {
                device_id: deviceId,
                name: `Buzzer ${deviceId}`,
                last_seen: now,
                status: 'online',
                last_online: data.online === true ? now : null, // Set last_online only if actually online
                ...data
            });
        }
        
        this.updateModalBuzzerStatusDisplay();
    }

    updateESP32Status(data) {
        // Update ESP32 connection status in main UI
        if (this.elements.esp32Status) {
            this.elements.esp32Status.textContent = data.connected ? 'Connected' : 'Disconnected';
        }
    }

    getTeamNameByBuzzerId(buzzerId) {
        const team = this.teams.find(team => team.buzzer_id === buzzerId);
        return team ? team.name : null;
    }

    updateModalBuzzerStatusDisplay() {
        const container = this.elements.modalBuzzerStatusList;
        if (!container) return;
        
        const now = Date.now();
        const staleMaxLength = 60000; // 60 seconds
        
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
            
            if (timeSinceLastSeen < staleMaxLength) {
                status = 'online';
                statusText = 'Online';
            } else if (timeSinceLastSeen < staleMaxLength * 2) {
                status = 'stale';
                statusText = 'Stale';
            }
            
            const buzzerElement = document.createElement('div');
            buzzerElement.className = `buzzer-item ${status}`;
            
            const lastSeenText = this.formatLastSeen(timeSinceLastSeen);
            const teamName = this.getTeamNameByBuzzerId(device.device_id);
            
            buzzerElement.innerHTML = `
                <div class="buzzer-info">
                    <div class="buzzer-name">${device.name || `Buzzer ${device.device_id}`}</div>
                    <div class="buzzer-meta">
                        <span>ID: ${device.device_id}</span>
                        <span class="last-seen">Last seen: ${lastSeenText}</span>
                        ${teamName ? `<span class="team-name-display">Team: ${teamName}</span>` : '<span>No team assigned</span>'}
                        ${device.armed !== undefined ? `<span>Armed: ${device.armed ? 'Yes' : 'No'}</span>` : ''}
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

    async refreshModalBuzzerStatus() {
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
                        last_seen: device.last_seen || now,
                        last_online: device.last_online // Preserve last_online from backend
                    });
                });
                
                this.updateModalBuzzerStatusDisplay();
            }
        } catch (error) {
            console.error('Failed to refresh buzzer status:', error);
            this.showToast('Failed to refresh buzzer status', 'error');
        }
    }

    async modalArmAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/arm', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showToast('All buzzers armed successfully', 'success');
                this.refreshModalBuzzerStatus();
            } else {
                throw new Error('Failed to arm buzzers');
            }
        } catch (error) {
            console.error('Failed to arm buzzers:', error);
            this.showToast('Failed to arm all buzzers', 'error');
        }
    }

    async modalDisarmAllBuzzers() {
        try {
            const response = await fetch('/api/buzzers/disarm', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showToast('All buzzers disarmed successfully', 'success');
                this.refreshModalBuzzerStatus();
            } else {
                throw new Error('Failed to disarm buzzers');
            }
        } catch (error) {
            console.error('Failed to disarm buzzers:', error);
            this.showToast('Failed to disarm all buzzers', 'error');
        }
    }

    // Answer Evaluation Methods
    updateAnswerEvaluation() {
        if (!this.currentGame || !this.isQuestionActive || this.buzzerOrder.length === 0) {
            this.showNoActiveQuestion();
            return;
        }

        // Find the first unevaluated buzzer
        const currentBuzzer = this.buzzerOrder.find(b => !b.evaluated);
        if (!currentBuzzer) {
            this.showNoActiveQuestion();
            return;
        }

        this.showCurrentAnswerer(currentBuzzer);
        this.showNextInLine();
    }

    showNoActiveQuestion() {
        this.elements.noActiveQuestion.classList.remove('hidden');
        this.elements.currentAnswerer.classList.add('hidden');
        this.elements.evaluationHistory.classList.add('hidden');
    }

    showCurrentAnswerer(buzzer) {
        this.elements.noActiveQuestion.classList.add('hidden');
        this.elements.currentAnswerer.classList.remove('hidden');

        const position = this.buzzerOrder.findIndex(b => b === buzzer) + 1;
        const teamName = this.getTeamName(buzzer.groupId);
        const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
        const currentQuestion = this.questions[this.currentQuestionIndex];

        // Update position indicator
        const positionText = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`;
        this.elements.currentPosition.textContent = positionText;

        // Update team info
        this.elements.currentTeamName.textContent = teamName;
        this.elements.currentBuzzerTime.textContent = `Buzzed in at ${deltaTime}s`;

        // Update points - show actual time-based points if applicable
        const actualPoints = this.getActualPointsForBuzzer(buzzer);
        this.elements.questionPoints.textContent = `+${actualPoints}`;

        // Store current buzzer position for evaluation
        this.currentBuzzerPosition = this.buzzerOrder.indexOf(buzzer);
    }

    showNextInLine() {
        const nextBuzzer = this.buzzerOrder.find((b, index) => 
            index > this.currentBuzzerPosition && !b.evaluated
        );

        if (nextBuzzer) {
            const nextTeamName = this.getTeamName(nextBuzzer.groupId);
            const nextDeltaTime = (nextBuzzer.deltaMs / 1000).toFixed(2);
            
            this.elements.nextTeamName.textContent = nextTeamName;
            this.elements.nextBuzzerTime.textContent = `${nextDeltaTime}s`;
            this.elements.nextInLineInfo.classList.remove('hidden');
        } else {
            this.elements.nextInLineInfo.classList.add('hidden');
        }
    }


    handleAnswerEvaluated(data) {
        // Add to evaluation history
        const teamName = this.getTeamName(data.groupId);
        this.addToEvaluationHistory(teamName, data.isCorrect, data.pointsAwarded);
        
        // Update team display to reflect new scores
        this.updateTeamDisplay();

        // If question is complete, reset evaluation interface
        if (data.questionComplete) {
            this.resetAnswerEvaluation();
        }
    }

    addToEvaluationHistory(teamName, isCorrect, points) {
        this.evaluationHistory.push({ teamName, isCorrect, points });
        
        const historyItem = document.createElement('div');
        historyItem.className = `evaluation-item ${isCorrect ? 'correct' : 'incorrect'}`;
        historyItem.innerHTML = `
            <span class="team-name">${teamName}</span>
            <span class="result">${isCorrect ? '✅ Correct' : '❌ Incorrect'}</span>
            <span class="points">${points > 0 ? '+' : ''}${points} pts</span>
        `;
        
        this.elements.evaluationList.prepend(historyItem);
        this.elements.evaluationHistory.classList.remove('hidden');

        // Add entrance animation
        historyItem.style.transform = 'translateX(-20px)';
        historyItem.style.opacity = '0';
        setTimeout(() => {
            historyItem.style.transform = 'translateX(0)';
            historyItem.style.opacity = '1';
        }, 50);
    }

    async handleQuestionPrepared(data) {
        this.showToast(`Next question prepared: ${data.question.text.substring(0, 50)}...`, 'info');
        this.resetAnswerEvaluation();
        
        // Clear any lingering on-air state from previous question
        this.isQuestionActive = false;
        this.activeQuestionIndex = -1;
        
        // Reset toggles for idle state when question is prepared (transitioning to idle)
        this.resetTogglesForIdleState();
        
        // Update current question index and sync with server state
        this.currentQuestionIndex = data.nextQuestionIndex;
        
        // Refresh game state from server to ensure played_questions is accurate
        if (this.currentGame) {
            try {
                const response = await fetch(`/api/games/${this.currentGame.id}`);
                if (response.ok) {
                    const updatedGame = await response.json();
                    this.currentGame = updatedGame;
                    console.log('Game state refreshed after question prepared:', {
                        currentIndex: this.currentGame.current_question_index,
                        playedQuestions: this.currentGame.played_questions
                    });
                }
            } catch (error) {
                console.error('Failed to refresh game state after question prepared:', error);
            }
        }
        
        this.updateQuestionDisplay();
        this.updateQuestionControls(); // Add this to ensure button states are updated
        this.updateQuestionTabsState();
    }

    handleGameCompleted(data) {
        this.showToast('🎉 Game completed! Final scores calculated.', 'success', 5000);
        this.resetAnswerEvaluation();
        this.resetControlPanel();
    }

    resetAnswerEvaluation() {
        this.currentBuzzerPosition = -1;
        this.evaluationHistory = [];
        this.answerShown = false; // Reset answer shown state
        this.isAnswerVisible = false; // Reset answer visibility state
        if (this.elements.evaluationList) {
            this.elements.evaluationList.innerHTML = '';
        }
        
        this.hideAnswerEvaluationModal();
    }

    // Modal Management Methods
    showAnswerEvaluationModal() {
        this.elements.answerEvaluationModal.classList.remove('hidden');
        this.updateAnswerEvaluationModal();
    }

    hideAnswerEvaluationModal() {
        this.elements.answerEvaluationModal.classList.add('hidden');
    }

    updateAnswerEvaluationModal() {
        if (!this.currentGame || !this.isQuestionActive || this.buzzerOrder.length === 0) {
            this.elements.noBuzzerContent.classList.remove('hidden');
            this.elements.currentAnswererContent.classList.add('hidden');
            this.elements.evaluationHistorySection.classList.add('hidden');
            return;
        }

        // Find the first unevaluated buzzer
        const currentBuzzer = this.buzzerOrder.find(b => !b.evaluated);
        if (!currentBuzzer) {
            this.elements.noBuzzerContent.classList.remove('hidden');
            this.elements.currentAnswererContent.classList.add('hidden');
            return;
        }

        this.showCurrentAnswererInModal(currentBuzzer);
        this.showNextInLineInModal();
        
        // Show evaluation history if there is any
        if (this.evaluationHistory.length > 0) {
            this.elements.evaluationHistorySection.classList.remove('hidden');
        }
    }

    showCurrentAnswererInModal(buzzer) {
        console.log(`[MODAL DEBUG] showCurrentAnswererInModal called with buzzer:`, buzzer);
        this.elements.noBuzzerContent.classList.add('hidden');
        this.elements.currentAnswererContent.classList.remove('hidden');

        const position = this.buzzerOrder.findIndex(b => b === buzzer) + 1;
        const teamName = this.getTeamName(buzzer.groupId);
        const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
        const currentQuestion = this.questions[this.currentQuestionIndex];

        // Update position indicator
        const positionText = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`;
        this.elements.currentPosition.textContent = positionText;

        // Update team info
        this.elements.currentTeamName.textContent = teamName;
        this.elements.currentBuzzerTime.textContent = `Buzzed in at ${deltaTime}s`;

        // Update points - show actual time-based points if applicable
        const actualPoints = this.getActualPointsForBuzzer(buzzer);
        console.log(`[MODAL DEBUG] Updating modal points for ${teamName}: ${actualPoints} (questionStartTime: ${this.questionStartTime}, buzzer.timestamp: ${buzzer.timestamp})`);
        console.log(`[MODAL DEBUG] Question points element:`, this.elements.questionPoints);
        console.log(`[MODAL DEBUG] Setting textContent to: +${actualPoints}`);
        this.elements.questionPoints.textContent = `+${actualPoints}`;
        console.log(`[MODAL DEBUG] After update, element textContent:`, this.elements.questionPoints.textContent);

        // Store current buzzer position for evaluation
        this.currentBuzzerPosition = this.buzzerOrder.indexOf(buzzer);
    }

    showNextInLineInModal() {
        const nextBuzzer = this.buzzerOrder.find((b, index) => 
            index > this.currentBuzzerPosition && !b.evaluated
        );

        if (nextBuzzer) {
            const nextTeamName = this.getTeamName(nextBuzzer.groupId);
            const nextDeltaTime = (nextBuzzer.deltaMs / 1000).toFixed(2);
            
            this.elements.nextTeamName.textContent = nextTeamName;
            this.elements.nextBuzzerTime.textContent = `${nextDeltaTime}s`;
            this.elements.nextInLineCard.classList.remove('hidden');
        } else {
            this.elements.nextInLineCard.classList.add('hidden');
        }
    }

    showManualPointsModal() {
        this.elements.manualPointsModal.classList.remove('hidden');
    }

    hideManualPointsModal() {
        this.elements.manualPointsModal.classList.add('hidden');
    }

    showGameActionsModal() {
        this.elements.gameActionsModal.classList.remove('hidden');
    }

    hideGameActionsModal() {
        this.elements.gameActionsModal.classList.add('hidden');
    }

    async awardManualPoints() {
        const teamId = this.elements.teamSelect.value;
        const points = parseInt(this.elements.pointsInput.value) || 0;
        
        if (!teamId || !this.currentGame) {
            this.showToast('Please select a team and enter points', 'error');
            return;
        }

        try {
            await fetch(`/api/games/${this.currentGame.id}/award-points`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: teamId, points })
            });
            
            this.elements.pointsInput.value = '100';
            this.elements.teamSelect.value = '';
            this.hideManualPointsModal();
            this.showToast(`Awarded ${points} points!`, 'success');
        } catch (error) {
            this.showToast('Failed to award points', 'error');
        }
    }

    // Override the original answer evaluation methods to work with modal
    showNoActiveQuestion() {
        // This method is now handled by updateAnswerEvaluationModal
    }

    showCurrentAnswerer(buzzer) {
        // This method is now handled by showCurrentAnswererInModal
    }

    showNextInLine() {
        // This method is now handled by showNextInLineInModal
    }

    updateAnswerEvaluation() {
        // Update the modal content when buzzer order changes
        if (!this.elements.answerEvaluationModal.classList.contains('hidden')) {
            console.log('[MODAL DEBUG] Updating answer evaluation modal due to buzzer order change');
            this.updateAnswerEvaluationModal();
        }
    }

    // Override addToEvaluationHistory to work with new modal structure
    addToEvaluationHistory(teamName, isCorrect, points) {
        this.evaluationHistory.push({ teamName, isCorrect, points });
        
        if (this.elements.evaluationList) {
            const historyItem = document.createElement('div');
            historyItem.className = `evaluation-item ${isCorrect ? 'correct' : 'incorrect'}`;
            historyItem.innerHTML = `
                <span class="team-name">${teamName}</span>
                <span class="result">${isCorrect ? '✅ Correct' : '❌ Incorrect'}</span>
                <span class="points">${points > 0 ? '+' : ''}${points} pts</span>
            `;
            
            this.elements.evaluationList.prepend(historyItem);
            this.elements.evaluationHistorySection.classList.remove('hidden');

            // Add entrance animation
            historyItem.style.transform = 'translateX(-20px)';
            historyItem.style.opacity = '0';
            setTimeout(() => {
                historyItem.style.transform = 'translateX(0)';
                historyItem.style.opacity = '1';
            }, 50);
        }
    }

    // Timer Methods
    startTimer() {
        if (!this.questionStartTime) return;

        this.stopTimer(); // Clear any existing timer first
        
        // Initialize performance tracking variables
        this.lastDisplayedTime = -1;
        this.lastProgressPercentage = -1;
        this.lastTimerState = '';
        
        // Show progress bar timer
        if (this.elements.questionProgressBar) {
            this.elements.questionProgressBar.classList.remove('hidden');
        }
        
        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - this.questionStartTime) / 1000);
            const remaining = Math.max(0, this.questionTimeLimit - elapsed);
            
            // Update timeRemaining property
            this.timeRemaining = remaining;
            
            // Update progress bar timer text only if it changed
            if (this.elements.progressTimeText && this.lastDisplayedTime !== remaining) {
                this.elements.progressTimeText.textContent = `${remaining}s remaining`;
                this.lastDisplayedTime = remaining;
            }
            
            // Calculate progress percentage (0-100, where 0 is full time, 100 is no time)
            const progress = Math.min(100, (elapsed / this.questionTimeLimit) * 100);
            const remainingPercentage = Math.max(0, 100 - progress);
            
            // Update progress bar fill using transform for better performance
            if (this.elements.progressBarFill && this.lastProgressPercentage !== remainingPercentage) {
                this.elements.progressBarFill.style.transform = `scaleX(${remainingPercentage / 100})`;
                this.lastProgressPercentage = remainingPercentage;
            }
            
            // Change colors and styles based on remaining time - only when state changes
            const warningThreshold = this.questionTimeLimit * 0.3; // 30% of time remaining
            const criticalThreshold = this.questionTimeLimit * 0.1; // 10% of time remaining
            
            let currentState = '';
            if (remaining <= criticalThreshold) {
                currentState = 'critical';
            } else if (remaining <= warningThreshold) {
                currentState = 'warning';
            }
            
            // Only update classes if state changed
            if (this.lastTimerState !== currentState) {
                // Reset classes
                if (this.elements.questionProgressBar) {
                    this.elements.questionProgressBar.classList.remove('warning', 'critical');
                    if (currentState) {
                        this.elements.questionProgressBar.classList.add(currentState);
                    }
                }
                if (this.elements.progressBarFill) {
                    this.elements.progressBarFill.classList.remove('warning', 'critical');
                    if (currentState) {
                        this.elements.progressBarFill.classList.add(currentState);
                    }
                }
                this.lastTimerState = currentState;
            }
            
            // Update show answer button when time changes
            this.updateShowAnswerButton();
            
            // Auto-stop when time is up
            if (remaining <= 0) {
                this.stopTimer();
            }
        };
        
        updateTimer();
        this.questionTimer = setInterval(updateTimer, 1000);
    }


    stopTimer() {
        // Clear the interval first
        if (this.questionTimer) {
            clearInterval(this.questionTimer);
            this.questionTimer = null;
        }
    }
    
    hideTimers() {
        // Hide and reset progress bar timer
        if (this.elements.questionProgressBar) {
            this.elements.questionProgressBar.classList.add('hidden');
            this.elements.questionProgressBar.classList.remove('warning', 'critical');
        }
        if (this.elements.progressBarFill) {
            this.elements.progressBarFill.classList.remove('warning', 'critical');
            this.elements.progressBarFill.style.width = '100%'; // Reset to full width
        }
    }

    // Calculate time-based points (same logic as backend)
    calculateTimeBasedPoints(originalPoints, timeRemaining, totalTime) {
        if (timeRemaining <= 0) return 0;
        if (timeRemaining >= totalTime) return originalPoints;

        // Linear decrease from original points to 0
        const ratio = timeRemaining / totalTime;
        return Math.ceil(originalPoints * ratio);
    }

    // Get actual points for current buzzer (considering time-based scoring)
    getActualPointsForBuzzer(buzzer) {
        if (!this.currentGame || !buzzer) {
            console.log(`[FRONTEND DEBUG] Missing game or buzzer data`);
            return 0;
        }

        // Use this.questions array which is populated from game state
        const currentQuestion = this.questions[this.currentQuestionIndex];
        if (!currentQuestion) {
            console.log(`[FRONTEND DEBUG] No current question found at index ${this.currentQuestionIndex}`);
            return 0;
        }

        // If time-based scoring is enabled, calculate based on timing
        if (this.currentGame.time_based_scoring) {
            // Use JavaScript timing calculation (same as backend now uses)
            // Calculate elapsed time from when question started
            const questionStartTime = this.questionStartTime || Date.now(); // Fallback if not set
            const timeElapsed = buzzer.timestamp - questionStartTime;
            const totalTime = (currentQuestion.time_limit || 30) * 1000; // Convert to ms
            const timeRemaining = Math.max(0, totalTime - timeElapsed);

            console.log(`[FRONTEND DEBUG] Time calculation - Question: "${currentQuestion.question}", Points: ${currentQuestion.points}, Elapsed: ${timeElapsed}ms, Total: ${totalTime}ms, Remaining: ${timeRemaining}ms, Time-based scoring: ${this.currentGame.time_based_scoring}`);

            return this.calculateTimeBasedPoints(currentQuestion.points, timeRemaining, totalTime);
        }

        // Otherwise return full points
        console.log(`[FRONTEND DEBUG] Time-based scoring disabled, returning full points: ${currentQuestion.points}`);
        return currentQuestion.points;
    }

    // Current Answerer Highlight Methods
    showCurrentAnswererHighlight(buzzerData) {
        if (!this.elements.currentAnswererHighlight || !buzzerData) return;

        const teamName = this.getTeamName(buzzerData.groupId);
        const deltaTime = (buzzerData.deltaMs / 1000).toFixed(2);
        const position = this.buzzerOrder.findIndex(b => b.groupId === buzzerData.groupId) + 1;
        const positionText = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`;

        // Update highlight elements
        if (this.elements.currentAnswererPosition) {
            this.elements.currentAnswererPosition.textContent = positionText;
        }
        if (this.elements.currentAnswererName) {
            this.elements.currentAnswererName.textContent = teamName;
        }
        if (this.elements.currentAnswererTime) {
            this.elements.currentAnswererTime.textContent = `${deltaTime}s`;
        }
        if (this.elements.currentAnswererStatus) {
            const statusText = this.elements.currentAnswererStatus.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = 'Answering...';
            }
        }

        // Show the highlight
        this.elements.currentAnswererHighlight.classList.remove('hidden', 'correct', 'incorrect');
        this.elements.currentAnswererHighlight.classList.remove('correct', 'incorrect');
    }

    hideCurrentAnswererHighlight() {
        if (this.elements.currentAnswererHighlight) {
            this.elements.currentAnswererHighlight.classList.add('hidden');
            this.elements.currentAnswererHighlight.classList.remove('correct', 'incorrect');
        }
    }

    showAnswerFeedback(isCorrect) {
        if (!this.elements.currentAnswererHighlight) return;

        const statusText = this.elements.currentAnswererStatus?.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = isCorrect ? 'CORRECT! ✅' : 'INCORRECT ❌';
            statusText.style.fontSize = '1.1rem';
            statusText.style.fontWeight = '700';
        }

        // Add result class
        this.elements.currentAnswererHighlight.classList.remove('correct', 'incorrect');
        this.elements.currentAnswererHighlight.classList.add(isCorrect ? 'correct' : 'incorrect');

        // Hide after 3 seconds
        setTimeout(() => {
            this.hideCurrentAnswererHighlight();
        }, 3000);
    }

    // Enhanced Buzzer Results Display
    updateBuzzerResults() {
        const buzzerResultsSection = document.getElementById('buzzer-results-section');
        
        if (this.buzzerOrder.length === 0) {
            this.elements.buzzerResults.innerHTML = '<div class="no-buzzes">No buzzer presses yet</div>';
            if (buzzerResultsSection) {
                buzzerResultsSection.classList.add('hidden');
            }
            return;
        }

        // Show the buzzer results section in sidebar
        if (buzzerResultsSection) {
            buzzerResultsSection.classList.remove('hidden');
        }

        this.elements.buzzerResults.innerHTML = '';
        const firstBuzzTime = this.buzzerOrder.length > 0 ? this.buzzerOrder[0].deltaMs : 0;
        
        this.buzzerOrder.forEach((buzzer, index) => {
            const buzzerItem = document.createElement('div');
            buzzerItem.className = 'buzzer-result-item';
            
            const teamName = this.getTeamName(buzzer.groupId);
            const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
            const deltaFromFirst = index === 0 ? 0 : ((buzzer.deltaMs - firstBuzzTime) / 1000).toFixed(2);
            
            // Add evaluation status if available
            if (buzzer.evaluated) {
                buzzerItem.classList.add(buzzer.isCorrect ? 'evaluated-correct' : 'evaluated-incorrect');
            }
            
            buzzerItem.innerHTML = `
                <div class="buzzer-rank-badge ${index === 0 ? 'first' : ''}">${index + 1}</div>
                <div class="buzzer-team-info">
                    <div class="buzzer-team-name">
                        ${teamName}
                        ${buzzer.evaluated ? (buzzer.isCorrect ? ' ✅' : ' ❌') : ''}
                    </div>
                    <div class="buzzer-timing">
                        ${index === 0 ? 
                            `${deltaTime}s` : 
                            `+${deltaFromFirst}s`
                        }
                    </div>
                </div>
            `;
            
            this.elements.buzzerResults.appendChild(buzzerItem);
        });
    }

    // Override the answer evaluation to include visual feedback
    async markAnswer(isCorrect) {
        if (!this.currentGame || this.currentBuzzerPosition === -1) {
            this.showToast('No active buzzer to evaluate', 'error');
            return;
        }

        try {
            // Show immediate feedback
            this.showAnswerFeedback(isCorrect);

            const response = await fetch(`/api/games/${this.currentGame.id}/evaluate-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    isCorrect,
                    buzzerPosition: this.currentBuzzerPosition
                })
            });

            if (!response.ok) {
                throw new Error('Failed to evaluate answer');
            }

            const result = await response.json();
            
            // Mark this buzzer as evaluated locally
            if (this.buzzerOrder[this.currentBuzzerPosition]) {
                this.buzzerOrder[this.currentBuzzerPosition].evaluated = true;
                this.buzzerOrder[this.currentBuzzerPosition].isCorrect = isCorrect;
                this.buzzerOrder[this.currentBuzzerPosition].pointsAwarded = result.pointsAwarded || 0;
            }

            const statusMessage = isCorrect ? 'Correct answer!' : 'Incorrect answer';
            this.showToast(statusMessage, isCorrect ? 'success' : 'warning');

            // Update question tabs with feedback
            const currentBuzzer = this.buzzerOrder[this.currentBuzzerPosition];
            if (currentBuzzer) {
                const teamName = this.getTeamName(currentBuzzer.groupId);
                this.updateQuestionTabFeedback(this.currentQuestionIndex, teamName, isCorrect);
                
                // Store in evaluation history
                this.evaluationHistory.push({
                    questionIndex: this.currentQuestionIndex,
                    teamName: teamName,
                    correct: isCorrect,
                    pointsAwarded: result.pointsAwarded || 0
                });
            }

            // Update buzzer results display
            this.updateBuzzerResults();

            // Handle game flow based on answer correctness
            if (isCorrect) {
                // Hide modal - server will handle advancing to next question via prepareNextQuestion
                setTimeout(() => {
                    this.hideAnswerEvaluationModal();
                }, 1000);
            } else {
                // Update the evaluation interface for next buzzer if answer is wrong
                setTimeout(() => {
                    this.updateAnswerEvaluation();
                    // Show next answerer if available
                    const nextBuzzer = this.buzzerOrder.find(b => !b.evaluated);
                    if (nextBuzzer) {
                        // Update currentBuzzerPosition to point to the next unevaluated buzzer
                        this.currentBuzzerPosition = this.buzzerOrder.indexOf(nextBuzzer);
                        this.showCurrentAnswererHighlight(nextBuzzer);
                    } else {
                        // No more teams to answer - hide modal
                        this.hideAnswerEvaluationModal();
                    }
                }, 500);
            }

        } catch (error) {
            console.error('Failed to evaluate answer:', error);
            this.showToast('Failed to evaluate answer', 'error');
        }
    }

    async giveUpQuestion() {
        if (!this.currentGame) {
            this.showToast('No active game', 'error');
            return;
        }

        try {
            // End the current question without evaluating any answers
            const response = await fetch(`/api/games/${this.currentGame.id}/end-question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error('Failed to end question');
            }

            // Question will be marked as completed by server when advancing
            
            // Show feedback and hide modal
            this.showToast('Question skipped - moving to next question', 'info');
            this.hideAnswerEvaluationModal();
            
            // Auto-advance to next question after brief delay
            setTimeout(() => {
                this.nextQuestion();
            }, 1000);

        } catch (error) {
            console.error('Failed to give up question:', error);
            this.showToast('Failed to skip question', 'error');
        }
    }

    // Update team score directly
    async updateTeamScore(teamId, newScore) {
        const currentTeam = this.teams.find(t => t.id === teamId);
        if (!currentTeam) return;

        const pointsDifference = newScore - currentTeam.score;
        
        try {
            await fetch(`/api/games/${this.currentGame.id}/award-points`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: teamId, points: pointsDifference })
            });
            
            // Update the team score locally immediately
            currentTeam.score = newScore;
            this.updateTeamDisplay();
            this.showToast(`Score updated: ${pointsDifference > 0 ? '+' : ''}${pointsDifference} points`, 'success');
        } catch (error) {
            this.showToast('Failed to update score', 'error');
            // Revert the display but preserve user input
            this.updateTeamDisplay(true);
        }
    }

    // Buzzer Sidebar Methods
    toggleBuzzerSidebar() {
        if (!this.elements.buzzerSidebar) return;
        
        const isCollapsed = this.elements.buzzerSidebar.classList.contains('collapsed');
        
        if (isCollapsed) {
            this.elements.buzzerSidebar.classList.remove('collapsed');
            this.elements.toggleBuzzerSidebarBtn.textContent = '◀';
            this.refreshBuzzerStatus();
        } else {
            this.elements.buzzerSidebar.classList.add('collapsed');
            this.elements.toggleBuzzerSidebarBtn.textContent = '▶';
        }
    }

    updateBuzzerSidebar() {
        if (!this.buzzerDevices || !this.elements.onlineBuzzers || !this.elements.offlineBuzzers) return;
        
        const now = Date.now();
        const staleThreshold = this.getOnlineThreshold();
        
        const onlineBuzzers = [];
        const offlineBuzzers = [];
        
        this.buzzerDevices.forEach(device => {
            const timeSinceLastSeen = now - device.last_seen;
            const isRecent = timeSinceLastSeen < staleThreshold;
            const isOnlineReported = device.online === true;
            
            // Device is online ONLY if ESP32 reported online=true AND data is recent
            if (isOnlineReported && isRecent) {
                onlineBuzzers.push(device);
            } else {
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
            // Add armed class to online buzzers when buzzers are armed
            const armedClass = (isOnline && this.isBuzzersArmed) ? ' armed' : '';
            buzzerElement.className = `buzzer-item ${isOnline ? 'online' : 'offline'}${armedClass}`;
            
            const teamName = this.getTeamNameByBuzzerId(device.device_id);
            // For online devices: show last_seen (live stream), for offline: show last_online (when last online)
            let timeSinceDisplay, lastSeenText;
            if (isOnline) {
                // Online: show last server update (live stream effect)
                timeSinceDisplay = device.last_seen ? Date.now() - device.last_seen : null;
                lastSeenText = timeSinceDisplay ? this.formatLastSeen(timeSinceDisplay) : 'now';
            } else {
                // Offline: show when device was last online
                timeSinceDisplay = device.last_online ? Date.now() - device.last_online : null;
                lastSeenText = timeSinceDisplay ? this.formatLastSeen(timeSinceDisplay) : 'never';
            }
            
            // Add armed class to status dot when buzzers are armed
            const dotArmedClass = (isOnline && this.isBuzzersArmed) ? ' armed' : '';
            
            buzzerElement.innerHTML = `
                <div class="buzzer-info">
                    <div class="buzzer-header">
                        <span class="buzzer-id">#${device.device_id}</span>
                        <span class="buzzer-status-dot ${isOnline ? 'online' : 'offline'}${dotArmedClass}"></span>
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

    getTeamNameByBuzzerId(buzzerId) {
        const team = this.teams.find(team => team.buzzer_id === buzzerId);
        return team ? team.name : null;
    }

    async refreshBuzzerStatus() {
        try {
            const response = await fetch('/api/buzzers/devices');
            if (response.ok) {
                const devices = await response.json();
                const now = Date.now();
                
                // Update our device map with fresh data
                this.buzzerDevices = new Map();
                devices.forEach(device => {
                    this.buzzerDevices.set(device.device_id, {
                        ...device,
                        last_seen: device.last_seen || now,
                        last_online: device.last_online // Preserve last_online from backend
                    });
                });
                
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
        return this.teams ? this.teams.length : 4; // Default to 4 groups
    }

    // Threshold management methods
    getOnlineThreshold() {
        if (this.elements.onlineThreshold) {
            const value = parseInt(this.elements.onlineThreshold.value);
            // Ensure minimum threshold of 10 seconds to prevent constant offline/online switching
            const minValue = Math.max(value, 10);
            return minValue * 1000; // Convert seconds to milliseconds
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

    formatLastSeen(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        
        if (seconds <= 0) {
            return 'now';
        } else if (seconds < 60) {
            return `${seconds}s ago`;
        } else if (seconds < 3600) {
            return `${Math.floor(seconds / 60)}m ago`;
        } else {
            return `${Math.floor(seconds / 3600)}h ago`;
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
            
            // Get existing device data to preserve last_online timestamp
            const existingDevice = this.buzzerDevices.get(deviceId) || {};
            
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
                // Preserve or update last_online timestamp
                last_online: actuallyOnline ? (existingDevice.last_online || now) : existingDevice.last_online
            };
            
            this.buzzerDevices.set(deviceId, deviceData);
            this.updateBuzzerSidebar();
        } catch (error) {
            console.error('Error parsing ESP32 device data:', error);
        }
    }

    updateESP32Status(data) {
        // Parse ESP32 device data if available
        if (data.esp32_data) {
            this.parseESP32DeviceData(data.esp32_data);
        }
    }

    // Virtual Buzzer Management Methods
    async checkVirtualBuzzerSettings() {
        if (!this.currentGame) {
            this.virtualBuzzersEnabled = false;
            this.updateVirtualBuzzersSection();
            return;
        }

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/virtual-buzzer-settings`);
            if (response.ok) {
                const settings = await response.json();
                this.virtualBuzzersEnabled = settings.virtualBuzzersEnabled || false;
            } else {
                this.virtualBuzzersEnabled = false;
            }
        } catch (error) {
            console.error('Failed to check virtual buzzer settings:', error);
            this.virtualBuzzersEnabled = false;
        }

        this.updateVirtualBuzzersSection();
    }

    handleVirtualBuzzerRegister(data) {
        if (!this.virtualBuzzersEnabled) return;

        const { buzzerId, groupId, teamName } = data;
        const now = Date.now();

        this.virtualBuzzers.set(buzzerId, {
            buzzerId,
            groupId,
            teamName,
            connectedAt: now,
            lastActivity: now,
            status: 'connected'
        });

        this.updateVirtualBuzzersSection();
    }

    handleVirtualBuzzerDisconnect(buzzerId) {
        if (this.virtualBuzzers.has(buzzerId)) {
            this.virtualBuzzers.delete(buzzerId);
            this.updateVirtualBuzzersSection();
        }
    }

    updateVirtualBuzzersSection() {
        if (!this.elements.virtualBuzzersSection || !this.elements.virtualBuzzers) return;

        // Show/hide section based on whether virtual buzzers are enabled
        if (!this.virtualBuzzersEnabled) {
            this.elements.virtualBuzzersSection.classList.add('hidden');
            return;
        }

        this.elements.virtualBuzzersSection.classList.remove('hidden');

        // Update virtual buzzers list
        if (this.virtualBuzzers.size === 0) {
            this.elements.virtualBuzzers.innerHTML = '<div class="no-buzzers">No virtual buzzers active</div>';
            return;
        }

        const virtualBuzzerList = Array.from(this.virtualBuzzers.values());
        this.elements.virtualBuzzers.innerHTML = '';

        virtualBuzzerList.forEach(vBuzzer => {
            const buzzerElement = document.createElement('div');
            const armedClass = this.isBuzzersArmed ? ' armed' : '';
            buzzerElement.className = `buzzer-item virtual${armedClass}`;
            
            const connectedTime = Date.now() - vBuzzer.connectedAt;
            const connectedText = this.formatLastSeen(connectedTime);
            
            const dotArmedClass = this.isBuzzersArmed ? ' armed' : '';

            buzzerElement.innerHTML = `
                <div class="buzzer-status">
                    <div class="status-dot virtual${dotArmedClass}"></div>
                    <div class="buzzer-details">
                        <div class="buzzer-name">${vBuzzer.teamName}</div>
                        <div class="buzzer-meta">Virtual • Connected ${connectedText}</div>
                    </div>
                </div>
            `;

            this.elements.virtualBuzzers.appendChild(buzzerElement);
        });
    }

    // Question Tabs Functionality
    initializeQuestionTabs() {
        if (!this.questions || this.questions.length === 0) {
            this.elements.questionTabs.innerHTML = '<div class="no-tabs">No questions loaded</div>';
            return;
        }

        // Remove sample tabs
        const sampleTabs = this.elements.questionTabs.querySelectorAll('.sample-tab');
        sampleTabs.forEach(tab => tab.remove());

        // Create question tabs
        this.elements.questionTabs.innerHTML = '';
        this.questions.forEach((question, index) => {
            const tab = this.createQuestionTab(question, index);
            this.elements.questionTabs.appendChild(tab);
        });

        // Update current question
        this.updateQuestionTabsState();
    }

    createQuestionTab(question, index) {
        const tab = document.createElement('div');
        tab.className = 'question-tab';
        tab.dataset.questionIndex = index;
        
        // Determine tab state
        let tabState = 'pending';
        let statusIcon = '⏳';
        let feedbackContent = '';
        
        if (index < this.currentQuestionIndex) {
            tabState = 'completed';
            statusIcon = '✓';
            // Add feedback from evaluation history if available
            const evaluation = this.evaluationHistory.find(e => e.questionIndex === index);
            if (evaluation) {
                const iconClass = evaluation.correct ? 'correct' : 'incorrect';
                const iconSymbol = evaluation.correct ? '✓' : '✗';
                feedbackContent = `
                    <div class="tab-feedback">
                        <span class="feedback-icon ${iconClass}">${iconSymbol}</span>
                        <span class="feedback-team">${evaluation.teamName}</span>
                    </div>
                `;
            }
        } else if (index === this.currentQuestionIndex) {
            if (this.isQuestionActive) {
                tabState = 'active';
                statusIcon = '▶';
            } else {
                tabState = 'current';
                statusIcon = '▶';
            }
        }

        tab.classList.add(tabState);
        if (index === this.currentQuestionIndex) {
            tab.classList.add('current');
        }

        // Add progress content for active questions
        let progressContent = '';
        if (tabState === 'active' && this.isQuestionActive) {
            const timeRemaining = Math.max(0, (this.questionStartTime + this.questionTimeLimit * 1000 - Date.now()) / 1000);
            // Use ceiling for progress calculation to match the text display
            const displayTime = timeRemaining > 0 ? Math.ceil(timeRemaining) : 0;
            const progressPercentage = Math.max(0, (displayTime / this.questionTimeLimit) * 100);
            progressContent = `
                <div class="tab-progress">
                    <div class="progress-indicator">
                        <div class="progress-fill" style="width: ${progressPercentage}%"></div>
                    </div>
                    <span class="progress-text">${displayTime}s left</span>
                </div>
            `;
        }

        tab.innerHTML = `
            <div class="tab-status">${statusIcon}</div>
            <div class="tab-info">
                <span class="tab-number">Q${index + 1}</span>
            </div>
            ${feedbackContent}
            ${progressContent}
        `;

        // Add click event for navigation
        tab.addEventListener('click', () => this.navigateToQuestion(index));

        return tab;
    }

    isQuestionPlayed(questionIndex) {
        // A question is played if it was actually started/fired, not just navigated to
        // Check if this question index exists in the game's played questions list
        if (this.currentGame && this.currentGame.played_questions) {
            return this.currentGame.played_questions.includes(questionIndex);
        }
        
        // Fallback to old logic if no played_questions data available
        return false;
    }

    updateQuestionTabsState() {
        if (!this.elements.questionTabs) return;

        const tabs = this.elements.questionTabs.querySelectorAll('.question-tab');
        
        tabs.forEach((tab, index) => {
            const tabIndex = parseInt(tab.dataset.questionIndex);
            
            // Reset classes
            tab.className = 'question-tab';
            
            // Clear state logic: Check if actually played vs just navigated to
            const isActuallyPlayed = this.isQuestionPlayed(tabIndex);
            
            if (isActuallyPlayed) {
                // Questions that were actually started/fired are PLAYED
                console.log(`Tab ${tabIndex} is PLAYED (actually started)`);
                tab.classList.add('played');
                tab.classList.add('disabled'); // Disable clicking on played questions
                tab.querySelector('.tab-status').textContent = '✗';
                
            } else if (tabIndex === this.activeQuestionIndex && this.activeQuestionIndex >= 0) {
                // Question is ON-AIR (actively running OR ended but awaiting host decision)
                console.log(`Tab ${tabIndex} is ON-AIR (activeIndex: ${this.activeQuestionIndex}, isActive: ${this.isQuestionActive})`);
                tab.classList.add('active');
                tab.querySelector('.tab-status').textContent = '▶';
                
            } else if (tabIndex === this.currentQuestionIndex) {
                // Host is currently viewing this question (SELECTED - mid-height)
                console.log(`Tab ${tabIndex} is SELECTED (current index: ${this.currentQuestionIndex})`);
                tab.classList.add('selected');
                tab.querySelector('.tab-status').textContent = '►';
                
            } else {
                // Future questions are PENDING
                console.log(`Tab ${tabIndex} is PENDING`);
                tab.classList.add('pending');
                tab.querySelector('.tab-status').textContent = '⏳';
            }

            // Update progress for active question or remove progress for inactive ones
            if (tabIndex === this.activeQuestionIndex && this.isQuestionActive) {
                this.updateTabProgress(tab);
            } else {
                // Remove progress display for non-active questions
                const existingProgress = tab.querySelector('.tab-progress');
                if (existingProgress) {
                    existingProgress.remove();
                }
            }
        });

        // Scroll current question into view
        this.scrollTabIntoView(this.currentQuestionIndex);
    }

    updateTabProgress(tab) {
        if (!this.isQuestionActive || !this.questionStartTime) return;
        
        const timeRemaining = Math.max(0, (this.questionStartTime + this.questionTimeLimit * 1000 - Date.now()) / 1000);
        // Use ceiling for progress calculation to match the text display
        const displayTime = timeRemaining > 0 ? Math.ceil(timeRemaining) : 0;
        const progressPercentage = Math.max(0, (displayTime / this.questionTimeLimit) * 100);
        
        let progressElement = tab.querySelector('.tab-progress');
        if (!progressElement) {
            progressElement = document.createElement('div');
            progressElement.className = 'tab-progress';
            progressElement.innerHTML = `
                <div class="progress-indicator">
                    <div class="progress-fill"></div>
                </div>
                <span class="progress-text"></span>
            `;
            tab.appendChild(progressElement);
        }
        
        const progressFill = progressElement.querySelector('.progress-fill');
        const progressText = progressElement.querySelector('.progress-text');
        
        if (progressFill) progressFill.style.width = `${progressPercentage}%`;
        if (progressText) progressText.textContent = `${displayTime}s left`;
    }

    updateQuestionTabFeedback(questionIndex, teamName, correct) {
        const tab = this.elements.questionTabs.querySelector(`[data-question-index="${questionIndex}"]`);
        if (!tab) return;

        // Remove existing feedback
        const existingFeedback = tab.querySelector('.tab-feedback');
        if (existingFeedback) {
            existingFeedback.remove();
        }

        // Add new feedback
        const iconClass = correct ? 'correct' : 'incorrect';
        const iconSymbol = correct ? '✓' : '✗';
        
        const feedbackElement = document.createElement('div');
        feedbackElement.className = 'tab-feedback';
        feedbackElement.innerHTML = `
            <span class="feedback-icon ${iconClass}">${iconSymbol}</span>
            <span class="feedback-team">${teamName}</span>
        `;
        
        tab.appendChild(feedbackElement);
    }

    navigateToQuestion(questionIndex) {
        if (questionIndex < 0 || questionIndex >= this.questions.length) return;
        if (questionIndex === this.currentQuestionIndex) return;

        // Prevent navigating to already played questions
        if (this.isQuestionPlayed(questionIndex)) {
            this.showToast(`Cannot navigate to Question ${questionIndex + 1} - it has already been played`, 'warning');
            return;
        }

        // Show confirmation dialog
        const currentQ = this.currentQuestionIndex + 1;
        const targetQ = questionIndex + 1;
        const confirmMessage = `Are you sure you want to navigate from Question ${currentQ} to Question ${targetQ}?`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        // Use the API to navigate to the question (to sync server state)
        this.jumpToQuestion(questionIndex);
        
        // Show toast
        this.showToast(`Navigated to Question ${questionIndex + 1}`, 'info');
    }

    scrollQuestionTabs(direction) {
        const tabsContainer = this.elements.questionTabs;
        const scrollAmount = 82; // Width of compact tab plus gap (80px + 2px)
        const currentScroll = tabsContainer.scrollLeft;
        const newScroll = currentScroll + (direction * scrollAmount);
        
        tabsContainer.scrollTo({
            left: newScroll,
            behavior: 'smooth'
        });
    }

    scrollTabIntoView(questionIndex) {
        const tab = this.elements.questionTabs.querySelector(`[data-question-index="${questionIndex}"]`);
        if (!tab) return;

        tab.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
    }


    startTabProgressUpdates() {
        this.stopTabProgressUpdates();
        this.tabProgressInterval = setInterval(() => {
            const currentTab = this.elements.questionTabs.querySelector(`[data-question-index="${this.currentQuestionIndex}"]`);
            if (currentTab && this.isQuestionActive) {
                this.updateTabProgress(currentTab);
            }
        }, 100); // Update every 100ms for smooth progress
    }

    stopTabProgressUpdates() {
        if (this.tabProgressInterval) {
            clearInterval(this.tabProgressInterval);
            this.tabProgressInterval = null;
        }
    }

    // Show Correct Answer Methods
    handleAKeyPress(e) {
        const now = Date.now();
        const timeSinceLastA = now - this.keyPressCount.lastTime;
        
        // Reset counter if more than 2 seconds since last A press
        if (timeSinceLastA > 2000) {
            this.keyPressCount.A = 0;
        }
        
        this.keyPressCount.A++;
        this.keyPressCount.lastTime = now;
        
        console.log('A pressed', this.keyPressCount.A, 'times');
        
        // Check if button is enabled and clicked once, or if triple-A pressed
        if ((this.keyPressCount.A === 1 && this.canShowAnswer()) || this.keyPressCount.A >= 3) {
            if (this.keyPressCount.A >= 3) {
                console.log('Triple A pressed - force enabling show answer');
                this.showToast('Show Answer enabled (Triple A)', 'info');
            }
            this.toggleCorrectAnswer();
            this.keyPressCount.A = 0; // Reset counter
        }
    }

    canShowAnswer() {
        if (!this.currentGame) return false;
        if (this.currentQuestionIndex < 0 || this.currentQuestionIndex >= this.questions.length) return false;
        if (this.answerShown) return false; // Already shown
        
        // Enable if: question skipped, time expired, or triple-A pressed
        const timeExpired = this.timeRemaining <= 0;
        const questionSkipped = false; // Will be set in giveUpQuestion method
        
        return timeExpired || questionSkipped;
    }

    updateShowAnswerButton() {
        if (!this.elements.showAnswerBtn) return;
        
        // Enable button by default (safety is handled by CMD/Ctrl check)
        this.elements.showAnswerBtn.disabled = false;
        
        // Update toggle switch appearance based on state
        if (this.isAnswerVisible) {
            // Answer is currently shown - button should show "on" state (up position)
            this.elements.showAnswerBtn.classList.remove('toggle-off');
            this.elements.showAnswerBtn.classList.add('toggle-on');
            this.elements.showAnswerBtn.title = 'Hide Correct Answer [CMD/Ctrl + Click] • Currently visible';
            
            // Update icon to show "on" state (answer is shown)
            const icon = this.elements.showAnswerBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'lightbulb';
            
            const shortcut = this.elements.showAnswerBtn.querySelector('.control-shortcut');
            if (shortcut) shortcut.textContent = '⌘';
        } else {
            // Answer is hidden - button should show "off" state (down position)
            this.elements.showAnswerBtn.classList.remove('toggle-on');
            this.elements.showAnswerBtn.classList.add('toggle-off');
            this.elements.showAnswerBtn.title = 'Show Correct Answer [CMD/Ctrl + Click] • Hold CMD/Ctrl and click';
            
            // Update icon to show "off" state (answer is hidden)
            const icon = this.elements.showAnswerBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'lightbulb_outline';
            
            const shortcut = this.elements.showAnswerBtn.querySelector('.control-shortcut');
            if (shortcut) shortcut.textContent = '⌘';
        }
    }

    handleShowAnswerClick(event) {
        // Check if CMD (Mac) or Ctrl (Windows/Linux) key is pressed
        const isModifierPressed = event.metaKey || event.ctrlKey;
        
        if (!isModifierPressed) {
            this.showToast('Hold CMD (Mac) or Ctrl (Windows) while clicking to toggle answer', 'warning');
            return;
        }
        
        // CMD/Ctrl click acts as force override (like triple-A)
        if (this.isAnswerVisible) {
            this.hideCorrectAnswer();
        } else {
            // Force show answer with CMD/Ctrl click (bypass normal conditions)
            this.showCorrectAnswerForced();
        }
    }

    toggleCorrectAnswer() {
        if (this.isAnswerVisible) {
            this.hideCorrectAnswer();
        } else {
            this.showCorrectAnswer();
        }
    }

    async showCorrectAnswerForced() {
        // Force show answer without validation (used by CMD/Ctrl click)
        return this.showCorrectAnswer(true);
    }

    async showCorrectAnswer(forceShow = false) {
        if (!this.currentGame) {
            this.showToast('No game selected', 'error');
            return;
        }
        
        if (this.currentQuestionIndex < 0 || this.currentQuestionIndex >= this.questions.length) {
            this.showToast('No valid question selected', 'error');
            return;
        }
        
        // Check if forced (triple-A, CMD/Ctrl click) or conditions met
        if (!forceShow && !this.canShowAnswer() && this.keyPressCount.A < 3) {
            this.showToast('Cannot show answer yet', 'error');
            return;
        }

        try {
            // Send show answer request to backend
            const response = await fetch(`/api/games/${this.currentGame.id}/show-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionIndex: this.currentQuestionIndex,
                    forced: this.keyPressCount.A >= 3
                })
            });

            if (response.ok) {
                this.answerShown = true;
                this.isAnswerVisible = true;
                this.updateShowAnswerButton();
                this.showToast('💡 Correct answer revealed on display', 'success');
            } else {
                throw new Error('Failed to show answer');
            }
        } catch (error) {
            console.error('Failed to show correct answer:', error);
            this.showToast('Failed to show answer', 'error');
        }
    }

    async hideCorrectAnswer() {
        try {
            // Send hide answer request to backend 
            const response = await fetch(`/api/games/${this.currentGame.id}/hide-answer`, {
                method: 'POST'
            });

            if (response.ok) {
                this.isAnswerVisible = false;
                this.updateShowAnswerButton();
                this.showToast('Answer hidden', 'info');
            } else {
                throw new Error('Failed to hide answer');
            }
        } catch (error) {
            console.error('Failed to hide correct answer:', error);
            this.showToast('Failed to hide answer', 'error');
        }
    }

    // Display Font Size Controls
    async decreaseDisplayFontSize() {
        if (!this.currentGame) {
            this.showToast('No active game', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/font-size/decrease`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                this.showToast(`Font size decreased to ${result.fontSize}%`, 'info');
            } else {
                throw new Error('Failed to decrease font size');
            }
        } catch (error) {
            console.error('Failed to decrease font size:', error);
            this.showToast('Failed to decrease font size', 'error');
        }
    }

    async increaseDisplayFontSize() {
        if (!this.currentGame) {
            this.showToast('No active game', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/font-size/increase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                this.showToast(`Font size increased to ${result.fontSize}%`, 'info');
            } else {
                throw new Error('Failed to increase font size');
            }
        } catch (error) {
            console.error('Failed to increase font size:', error);
            this.showToast('Failed to increase font size', 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HostControl();
});