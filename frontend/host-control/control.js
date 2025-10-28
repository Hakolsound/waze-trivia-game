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

        // Modal event listeners flag
        this.modalEventListenersAttached = false;

        // Show Correct Answer state
        this.answerShown = false;
        this.keyPressCount = { 'A': 0, lastTime: 0 };
        
        this.initializeGameSelector();
        this.initializeElements();
        this.setupSocketListeners();
        this.setupEventListeners();
        this.refreshSystemStatus();

        // Manually check for current game after a short delay
        setTimeout(() => {
            this.checkAndLoadCurrentGame();
        }, 500);
        this.currentBuzzerPosition = 0;
        this.evaluationHistory = [];
        this.questionTimer = null;
        this.questionStartTime = null;
        this.questionTimeLimit = 30;

        // Game actions state
        this.pendingAction = null;
        
        // Initialize buzzer sidebar
        this.loadThresholdSetting();
        setTimeout(() => {
            this.refreshBuzzerStatus();
        }, 1000);
        
        // Set up periodic status updates to handle stale devices
        setInterval(() => {
            this.updateBuzzerSidebar(); // Check for stale devices based on timestamps
        }, 5000); // Check every 5 seconds

        // Initialize WiFi section
        this.initializeWifiSection();
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
        console.log('🎮 onGameChanged called with game:', game?.name, 'played_questions:', game?.played_questions);
        console.log('Teams in game:', game?.groups?.length || 0);
        console.log('Questions in game:', game?.questions?.length || 0);

        if (game) {
            // Update current game object with new data
            this.currentGame = game;

            // Load game data
            this.questions = game.questions || [];
            this.teams = game.groups || [];
            this.currentQuestionIndex = game.current_question_index || 0;

            console.log('Loaded teams:', this.teams.length, 'questions:', this.questions.length);
            console.log('Updated currentGame.played_questions:', this.currentGame.played_questions);

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

        // Sync local played questions with server data
        this.playedQuestions.clear();
        game.played_questions.forEach(index => {
            this.playedQuestions.add(index);
        });
        
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

    getGameState() {
        return {
            id: this.currentGame?.id,
            status: this.isQuestionActive ? 'question_active' : 'question_ended',
            current_question_index: this.activeQuestionIndex >= 0 ? this.activeQuestionIndex : this.currentQuestionIndex,
            played_questions: Array.from(this.playedQuestions),
            groups: this.teams,
            questions: this.questions
        };
    }

    onGamesLoaded(games) {
        console.log('Games loaded in host control:', games.length);
    }

    async checkAndLoadCurrentGame() {
        try {
            // Check if we already have a game loaded
            if (this.currentGame && this.teams.length > 0 && this.questions.length > 0) {
                console.log('Game already loaded, skipping manual load');
                return;
            }

            console.log('Checking for current game...');

            // Fetch current game from API
            const response = await fetch('/api/games/global/current');
            const status = await response.json();

            if (status.gameId && status.game) {
                console.log('Found current game, loading:', status.game.name);
                this.onGameChanged(status.game);
            } else {
                console.log('No current game found');
                this.showToast('No active game. Please select a game to continue.', 'info');
            }
        } catch (error) {
            console.error('Failed to check current game:', error);
            this.showToast('Failed to load game data', 'error');
        }
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
            
            // Game actions modal
            gameActionsModal: document.getElementById('game-actions-modal'),
            closeGameActionsModalBtn: document.getElementById('close-game-actions-modal-btn'),
            pauseGameBtn: document.getElementById('pause-game-btn'),
            resumeGameBtn: document.getElementById('resume-game-btn'),
            exportGameDataBtn: document.getElementById('export-game-data-btn'),
            clearGameHistoryBtn: document.getElementById('clear-game-history-btn'),
            gameActionStatus: document.getElementById('game-action-status'),
            statusMessage: document.getElementById('status-message'),
            gameActionConfirmation: document.getElementById('game-action-confirmation'),
            confirmationIcon: document.getElementById('confirmation-icon'),
            confirmationTitle: document.getElementById('confirmation-title'),
            confirmationMessage: document.getElementById('confirmation-message'),
            confirmActionBtn: document.getElementById('confirm-action-btn'),
            cancelActionBtn: document.getElementById('cancel-action-btn'),
            
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
            offlineBuzzers: document.getElementById('offline-buzzers'),

            // WiFi Channel Optimization
            wifiSection: document.querySelector('.wifi-section'),
            toggleWifiSectionBtn: document.getElementById('toggle-wifi-section'),
            scanWifiChannelsBtn: document.getElementById('scan-wifi-channels-btn'),
            wifiScanStatus: document.getElementById('wifi-scan-status'),
            wifiResults: document.getElementById('wifi-results'),
            currentChannelDisplay: document.getElementById('current-channel-display'),
            applyBestChannelBtn: document.getElementById('apply-best-channel-btn'),
            channelQualityList: document.getElementById('channel-quality-list'),
            wifiScanError: document.getElementById('wifi-scan-error'),
            wifiErrorMessage: document.getElementById('wifi-error-message')
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
        if (this.elements.showLeaderboardBtn) this.elements.showLeaderboardBtn.addEventListener('click', () => this.toggleLeaderboard());
        if (this.elements.leaderboardViewSelect) this.elements.leaderboardViewSelect.addEventListener('change', (e) => this.changeLeaderboardView(e.target.value));
        if (this.elements.endGameBtn) this.elements.endGameBtn.addEventListener('click', () => this.endGame());

        
        // Buzzer controls
        if (this.elements.armBuzzersBtn) this.elements.armBuzzersBtn.addEventListener('click', () => this.armBuzzers());
        if (this.elements.disarmBuzzersBtn) this.elements.disarmBuzzersBtn.addEventListener('click', () => this.disarmBuzzers());
        
        
        // Answer evaluation modal
        if (this.elements.closeEvaluationBtn) this.elements.closeEvaluationBtn.addEventListener('click', () => this.hideAnswerEvaluationModal());
        if (this.elements.markCorrectBtn) this.elements.markCorrectBtn.addEventListener('click', () => this.markAnswer(true));
        if (this.elements.markIncorrectBtn) this.elements.markIncorrectBtn.addEventListener('click', () => this.markAnswer(false));
        if (this.elements.giveUpBtn) this.elements.giveUpBtn.addEventListener('click', () => this.giveUpQuestion());

        // Game actions modal
        if (this.elements.closeGameActionsModalBtn) this.elements.closeGameActionsModalBtn.addEventListener('click', () => this.hideGameActionsModal());
        if (this.elements.exportGameDataBtn) this.elements.exportGameDataBtn.addEventListener('click', () => this.exportGameData());
        // Game actions modal click outside to close
        if (this.elements.gameActionsModal) {
            this.elements.gameActionsModal.addEventListener('click', (e) => {
                if (e.target === this.elements.gameActionsModal) {
                    this.hideGameActionsModal();
                }
            });
        }
        
        // Manual points modal
        if (this.elements.closePointsModalBtn) this.elements.closePointsModalBtn.addEventListener('click', () => this.hideManualPointsModal());
        if (this.elements.awardPointsSubmitBtn) this.elements.awardPointsSubmitBtn.addEventListener('click', () => this.awardManualPoints());
        
        // Game actions modal
        if (this.elements.showGameActionsBtn) {
            console.log('📌 Attaching showGameActionsBtn listener');
            this.elements.showGameActionsBtn.addEventListener('click', () => {
                console.log('🎯 showGameActionsBtn clicked');
                this.showGameActionsModal();
            });
        }
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

        // WiFi Channel Optimization
        if (this.elements.toggleWifiSectionBtn) {
            this.elements.toggleWifiSectionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleWifiSection();
            });
        }

        // Make the entire header clickable
        const wifiSectionHeader = document.querySelector('.wifi-section-header');
        if (wifiSectionHeader) {
            wifiSectionHeader.addEventListener('click', () => this.toggleWifiSection());
        }
        if (this.elements.scanWifiChannelsBtn) {
            this.elements.scanWifiChannelsBtn.addEventListener('click', () => this.scanWifiChannels());
        }
        if (this.elements.applyBestChannelBtn) {
            this.elements.applyBestChannelBtn.addEventListener('click', () => this.confirmChannelChange());
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
            const answerModal = document.getElementById('answer-evaluation-modal');
            const pointsModal = document.getElementById('manual-points-modal');
            const actionsModal = document.getElementById('game-actions-modal');

            const modalOpen = (answerModal && !answerModal.classList.contains('hidden')) ||
                            (pointsModal && !pointsModal.classList.contains('hidden')) ||
                            (actionsModal && !actionsModal.classList.contains('hidden'));
                            
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

            // Mark question as played locally
            this.playedQuestions.add(this.currentQuestionIndex);
            if (this.currentGame && !this.currentGame.played_questions) {
                this.currentGame.played_questions = [];
            }
            if (this.currentGame && !this.currentGame.played_questions.includes(this.currentQuestionIndex)) {
                this.currentGame.played_questions.push(this.currentQuestionIndex);
            }

            // Update tab state for active question
            this.isQuestionActive = true;
            this.activeQuestionIndex = this.currentQuestionIndex; // Set which question is on-air
            this.questionStartTime = Date.now();
            this.questionTimeLimit = this.questions[this.currentQuestionIndex]?.time_limit || 30;
            this.updateQuestionTabsState();
            this.startTabProgressUpdates();
            this.updateQuestionSelector(); // Update dropdown to reflect played status

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
        // Close game actions modal if it's open (buzzer activity takes priority)
        this.hideGameActionsModal();

        // Clear armed indicators when first buzzer activity begins
        if (this.buzzerOrder.length === 0 && this.isBuzzersArmed) {
            this.clearArmedIndicators();
        }

        // Check for duplicate team buzzer presses - prevent same team from being added multiple times
        const groupId = data.groupId;
        const teamAlreadyBuzzed = this.buzzerOrder.some(buzzer => buzzer.groupId === groupId);

        if (teamAlreadyBuzzed) {
            console.log(`[FRONTEND] Duplicate buzzer press ignored for team ${groupId}:`, data);
            return; // Don't add duplicate
        }

        console.log(`[FRONTEND] Adding new buzzer press for team ${groupId}:`, data);
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

    updateBuzzerDevice(data) {
        const deviceId = data.device_id || data.id;
        const now = Date.now();
        
        this.buzzerDevices.set(deviceId, {
            ...data,
            last_seen: now,
            status: 'online'
        });
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
            // Update battery data from heartbeat
            if (data.battery_percentage !== undefined) {
                device.battery_percentage = data.battery_percentage;
            }
            if (data.battery_voltage !== undefined) {
                device.battery_voltage = data.battery_voltage;
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
        console.log(`[FRONTEND] showAnswerEvaluationModal called - currentBuzzerPosition: ${this.currentBuzzerPosition}, buzzerOrder length: ${this.buzzerOrder.length}`);
        this.elements.answerEvaluationModal.classList.remove('hidden');
        this.updateAnswerEvaluationModal();
    }

    hideAnswerEvaluationModal() {
        this.elements.answerEvaluationModal.classList.add('hidden');
    }

    updateAnswerEvaluationModal() {
        // Early return for invalid state to avoid unnecessary DOM operations
        if (!this.currentGame || !this.isQuestionActive) {
            requestAnimationFrame(() => {
                this.elements.noBuzzerContent.classList.remove('hidden');
                this.elements.currentAnswererContent.classList.add('hidden');
                this.elements.evaluationHistorySection.classList.add('hidden');
            });
            return;
        }

        // If no buzzers in queue, show waiting state but keep modal open
        if (this.buzzerOrder.length === 0) {
            requestAnimationFrame(() => {
                this.elements.noBuzzerContent.classList.remove('hidden');
                this.elements.currentAnswererContent.classList.add('hidden');
                this.elements.evaluationHistorySection.classList.add('hidden');
            });
            return;
        }

        // Use for loop instead of find for better performance
        let currentBuzzer = null;
        for (let i = 0; i < this.buzzerOrder.length; i++) {
            if (!this.buzzerOrder[i].evaluated) {
                currentBuzzer = this.buzzerOrder[i];
                this.currentBuzzerPosition = i;
                break;
            }
        }

        if (!currentBuzzer) {
            requestAnimationFrame(() => {
                this.elements.noBuzzerContent.classList.remove('hidden');
                this.elements.currentAnswererContent.classList.add('hidden');
            });
            return;
        }

        this.showCurrentAnswererInModal(currentBuzzer);
        this.showNextInLineInModal();

        // Show evaluation history if there is any
        if (this.evaluationHistory.length > 0) {
            requestAnimationFrame(() => {
                this.elements.evaluationHistorySection.classList.remove('hidden');
            });
        }
    }

    showCurrentAnswererInModal(buzzer) {
        // Batch DOM updates using requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            this.elements.noBuzzerContent.classList.add('hidden');
            this.elements.currentAnswererContent.classList.remove('hidden');

            const position = this.buzzerOrder.indexOf(buzzer) + 1;
            const teamName = this.getTeamName(buzzer.groupId);
            const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
            const actualPoints = this.getActualPointsForBuzzer(buzzer);

            // Pre-calculate position text to avoid conditionals
            const positionTexts = ['1st', '2nd', '3rd'];
            const positionText = positionTexts[position - 1] || `${position}th`;

            // Batch all text content updates
            this.elements.currentPosition.textContent = positionText;
            this.elements.currentTeamName.textContent = teamName;
            this.elements.currentBuzzerTime.textContent = `Buzzed in at ${deltaTime}s`;
            this.elements.questionPoints.textContent = `+${actualPoints}`;

            // Store current buzzer position for evaluation
            this.currentBuzzerPosition = position - 1; // 0-based index
        });
    }

    showNextInLineInModal() {
        // Use for loop instead of find for better performance with small arrays
        let nextBuzzer = null;
        for (let i = this.currentBuzzerPosition + 1; i < this.buzzerOrder.length; i++) {
            if (!this.buzzerOrder[i].evaluated) {
                nextBuzzer = this.buzzerOrder[i];
                break;
            }
        }

        requestAnimationFrame(() => {
            if (nextBuzzer) {
                const nextTeamName = this.getTeamName(nextBuzzer.groupId);
                const nextDeltaTime = (nextBuzzer.deltaMs / 1000).toFixed(2);

                this.elements.nextTeamName.textContent = nextTeamName;
                this.elements.nextBuzzerTime.textContent = `${nextDeltaTime}s`;
                this.elements.nextInLineCard.classList.remove('hidden');
            } else {
                this.elements.nextInLineCard.classList.add('hidden');
            }
        });
    }

    showManualPointsModal() {
        this.elements.manualPointsModal.classList.remove('hidden');
    }

    hideManualPointsModal() {
        this.elements.manualPointsModal.classList.add('hidden');
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

            console.log(`[FRONTEND] About to evaluate - currentBuzzerPosition: ${this.currentBuzzerPosition}, buzzerOrder length: ${this.buzzerOrder.length}`);
            console.log(`[FRONTEND] Current buzzer being evaluated:`, this.buzzerOrder[this.currentBuzzerPosition]);

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
                // Correct answer - hide modal, server will handle advancing to next question
                setTimeout(() => {
                    this.hideAnswerEvaluationModal();
                }, 1000);
            } else {
                // Wrong answer - clear buzzer order (backend handles selective re-arming)
                console.log(`[FRONTEND] Wrong answer - clearing buzzer order (backend handles re-arming)`);

                setTimeout(() => {
                    // Clear the buzzer order and reset state
                    this.buzzerOrder = [];
                    this.currentBuzzerPosition = -1;

                    // Update modal to show waiting state (don't hide it)
                    this.updateAnswerEvaluationModal();

                    // NOTE: Removed this.armBuzzers() call - backend already handles selective re-arming
                    // The backend only arms buzzers that haven't answered wrong yet
                }, 1000);
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
            // Expand the sidebar
            this.elements.buzzerSidebar.classList.remove('collapsed');
            this.elements.toggleBuzzerSidebarBtn.textContent = '◀'; // Left arrow means "collapse"
            this.refreshBuzzerStatus();
        } else {
            // Collapse the sidebar
            this.elements.buzzerSidebar.classList.add('collapsed');
            this.elements.toggleBuzzerSidebarBtn.textContent = '▶'; // Right arrow means "expand"
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

        // Sort both lists by device_id in ascending order (Team 1, Team 2, etc.)
        onlineBuzzers.sort((a, b) => parseInt(a.device_id) - parseInt(b.device_id));
        offlineBuzzers.sort((a, b) => parseInt(a.device_id) - parseInt(b.device_id));

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

            const batteryStatus = this.formatBatteryStatus(device.battery_percentage, device.battery_voltage);

            buzzerElement.innerHTML = `
                <div class="buzzer-info">
                    <div class="buzzer-header">
                        <span class="buzzer-id">#${device.device_id}</span>
                        <span class="buzzer-status-dot ${isOnline ? 'online' : 'offline'}${dotArmedClass}"></span>
                    </div>
                    <div class="buzzer-details">
                        ${teamName ? `<div class="team-name">${teamName}</div>` : '<div class="no-team">No team assigned</div>'}
                        <div class="last-seen">${lastSeenText}</div>
                        ${batteryStatus}
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
                
                // Don't clear the map - instead update existing entries or add new ones
                // Mark all existing devices as potentially offline first
                this.buzzerDevices.forEach(device => {
                    device.server_reported = false;
                });

                devices.forEach(device => {
                    const deviceId = device.device_id;
                    // Only accept numeric device IDs (1, 2, 3, 4) not text ones (buzzer_1, etc)
                    if (deviceId && /^\d+$/.test(deviceId.toString())) {
                        const existingDevice = this.buzzerDevices.get(deviceId);
                        this.buzzerDevices.set(deviceId, {
                            // Default to offline
                            status: 'offline',
                            online: false,
                            ...existingDevice, // Keep existing data (like last_seen from socket events)
                            ...device, // Overlay server data
                            server_reported: true,
                            last_online: device.last_online // Preserve last_online from backend
                        });
                    }
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

    formatBatteryStatus(batteryPercentage, batteryVoltage) {
        // Handle undefined or null values
        if (batteryPercentage === undefined || batteryPercentage === null || batteryVoltage === undefined || batteryVoltage === null) {
            return '<div class="battery-status unknown"><span class="battery-icon">🔋</span><span>---</span></div>';
        }

        let statusClass, icon;

        if (batteryPercentage <= 10) {
            statusClass = 'critical';
            icon = '🔋';
        } else if (batteryPercentage <= 25) {
            statusClass = 'low';
            icon = '🔋';
        } else if (batteryPercentage <= 50) {
            statusClass = 'medium';
            icon = '🔋';
        } else {
            statusClass = 'good';
            icon = '🔋';
        }

        return `<div class="battery-status ${statusClass}"><span class="battery-icon">${icon}</span><span>${batteryPercentage}% (${batteryVoltage.toFixed(2)}V)</span></div>`;
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

    // =========================================
    // WiFi Channel Optimization Methods
    // =========================================

    initializeWifiSection() {
        // Restore collapsed state from localStorage
        const isCollapsed = localStorage.getItem('wifiSectionCollapsed') === 'true';
        if (isCollapsed && this.elements.wifiSection) {
            this.elements.wifiSection.classList.add('collapsed');
        }
    }

    toggleWifiSection() {
        if (!this.elements.wifiSection) return;

        const isCollapsed = this.elements.wifiSection.classList.contains('collapsed');
        if (isCollapsed) {
            this.elements.wifiSection.classList.remove('collapsed');
            localStorage.setItem('wifiSectionCollapsed', 'false');
        } else {
            this.elements.wifiSection.classList.add('collapsed');
            localStorage.setItem('wifiSectionCollapsed', 'true');
        }
    }

    async scanWifiChannels() {
        if (!this.elements.scanWifiChannelsBtn || !this.elements.wifiScanStatus) return;

        try {
            // Show scanning state
            this.elements.scanWifiChannelsBtn.disabled = true;
            this.elements.scanWifiChannelsBtn.textContent = '🔄 Scanning...';
            this.elements.wifiScanStatus.classList.remove('hidden');
            this.elements.wifiResults.classList.add('hidden');
            this.elements.wifiScanError.classList.add('hidden');

            // Make API call
            const response = await fetch('/api/wifi/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                this.displayChannelResults(result);
                this.showToast('WiFi scan completed successfully', 'success');
            } else {
                const error = await response.json();
                this.showWifiScanError(error.message || 'Scan failed');
            }
        } catch (error) {
            console.error('WiFi scan failed:', error);
            this.showWifiScanError('Network error during scan');
        } finally {
            // Reset UI state
            this.elements.scanWifiChannelsBtn.disabled = false;
            this.elements.scanWifiChannelsBtn.innerHTML = '🔍 Scan Channels';
            this.elements.wifiScanStatus.classList.add('hidden');
        }
    }

    displayChannelResults(results) {
        if (!this.elements.channelQualityList || !this.elements.wifiResults) return;

        // Show results section
        this.elements.wifiResults.classList.remove('hidden');
        this.elements.channelQualityList.innerHTML = '';

        // Find best channel
        let bestChannel = null;
        let bestSignal = -100;

        results.channels.forEach(channel => {
            if (channel.signal > bestSignal) {
                bestSignal = channel.signal;
                bestChannel = channel;
            }
        });

        // Display each channel
        results.channels.forEach(channel => {
            const channelBar = document.createElement('div');
            channelBar.className = `channel-bar ${channel.channel === bestChannel?.channel ? 'best-channel' : ''}`;

            // Calculate signal strength percentage (signal is in dBm, typically -30 to -90)
            // -30 dBm = excellent (100%), -90 dBm = poor (0%)
            const signalPercent = Math.max(0, Math.min(100, ((90 + channel.signal) / 60) * 100));

            channelBar.innerHTML = `
                <div class="channel-number">${channel.channel}</div>
                <div class="channel-bar-fill">
                    <div class="channel-bar-progress" style="width: ${signalPercent}%"></div>
                </div>
                <div class="channel-signal">${channel.signal}dBm</div>
            `;

            this.elements.channelQualityList.appendChild(channelBar);
        });

        // Update current channel display
        if (this.elements.currentChannelDisplay) {
            this.elements.currentChannelDisplay.textContent = `CH ${results.currentChannel}`;
        }

        // Show apply button if we have results
        if (this.elements.applyBestChannelBtn) {
            this.elements.applyBestChannelBtn.classList.remove('hidden');
        }
    }

    showWifiScanError(message) {
        if (this.elements.wifiScanError && this.elements.wifiErrorMessage) {
            this.elements.wifiScanError.classList.remove('hidden');
            this.elements.wifiErrorMessage.textContent = message;
            this.elements.wifiResults.classList.add('hidden');
        }
        this.showToast('WiFi scan failed: ' + message, 'error');
    }

    confirmChannelChange() {
        // Get the best channel info
        const bestChannelBar = this.elements.channelQualityList?.querySelector('.best-channel');
        if (!bestChannelBar) {
            this.showToast('No channel data available', 'warning');
            return;
        }

        const channelNumber = bestChannelBar.querySelector('.channel-number')?.textContent;
        const signalStrength = bestChannelBar.querySelector('.channel-signal')?.textContent;

        if (!channelNumber || !signalStrength) {
            this.showToast('Unable to determine best channel', 'warning');
            return;
        }

        const currentChannel = this.elements.currentChannelDisplay?.textContent?.replace('CH ', '') || 'Unknown';

        // Determine quality badge
        const signalValue = parseInt(signalStrength);
        let qualityClass = 'poor';
        let qualityText = 'Poor';

        if (signalValue > -50) {
            qualityClass = 'excellent';
            qualityText = 'Excellent';
        } else if (signalValue > -65) {
            qualityClass = 'good';
            qualityText = 'Good';
        }

        // Create confirmation modal
        const modal = document.createElement('div');
        modal.className = 'wifi-confirmation-modal';
        modal.innerHTML = `
            <div class="wifi-confirmation-content">
                <div class="wifi-confirmation-header">
                    <span class="wifi-confirmation-icon">📡</span>
                    <h3 class="wifi-confirmation-title">Change WiFi Channel</h3>
                </div>

                <p class="wifi-confirmation-message">
                    Are you sure you want to change the WiFi channel? This will affect all connected buzzers and may temporarily disconnect devices.
                </p>

                <div class="wifi-channel-details">
                    <div class="channel-change-summary">
                        <span class="channel-change-label">Current Channel:</span>
                        <span class="channel-change-value">${currentChannel}</span>
                    </div>
                    <div class="channel-change-summary">
                        <span class="channel-change-label">New Channel:</span>
                        <span class="channel-change-value">${channelNumber}</span>
                    </div>
                    <div class="channel-quality-indicator">
                        <span class="channel-change-label">Signal Quality:</span>
                        <span class="quality-badge ${qualityClass}">${qualityText} (${signalStrength})</span>
                    </div>
                </div>

                <div class="wifi-confirmation-actions">
                    <button class="wifi-cancel-btn" onclick="this.closest('.wifi-confirmation-modal').remove()">Cancel</button>
                    <button class="wifi-confirm-btn" onclick="window.hostControl.applyBestChannel('${channelNumber}')">Change Channel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    async applyBestChannel(channelNumber) {
        // Remove confirmation modal
        const modal = document.querySelector('.wifi-confirmation-modal');
        if (modal) modal.remove();

        try {
            const response = await fetch('/api/wifi/channel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: parseInt(channelNumber) })
            });

            if (response.ok) {
                const result = await response.json();
                this.showToast(`WiFi channel changed to ${channelNumber}`, 'success');

                // Update current channel display
                if (this.elements.currentChannelDisplay) {
                    this.elements.currentChannelDisplay.textContent = `CH ${channelNumber}`;
                }
            } else {
                const error = await response.json();
                this.showToast(`Failed to change channel: ${error.message}`, 'error');
            }
        } catch (error) {
            console.error('Failed to change WiFi channel:', error);
            this.showToast('Failed to change WiFi channel', 'error');
        }
    }

    // =========================================
    // Game Actions Modal Methods
    // =========================================

    showGameActionsModal() {
        console.log('🎯 showGameActionsModal called');
        if (this.elements.gameActionsModal) {
            console.log('✅ Opening game actions modal');
            this.elements.gameActionsModal.classList.remove('hidden');
            this.updateGameActionsState();

            // Attach modal button event listeners only once
            if (!this.modalEventListenersAttached) {
                console.log('🔧 Attaching modal event listeners');
                if (this.elements.resetScoresBtn) {
                    console.log('📌 Attaching reset-scores button listener');
                    this.elements.resetScoresBtn.addEventListener('click', () => {
                        console.log('🎯 reset-scores button clicked');
                        this.confirmAction('reset-scores');
                    });
                }
                if (this.elements.resetQuestionsBtn) {
                    console.log('📌 Attaching reset-questions button listener');
                    this.elements.resetQuestionsBtn.addEventListener('click', () => {
                        console.log('🎯 reset-questions button clicked');
                        this.confirmAction('reset-questions');
                    });
                }
                if (this.elements.resetGameBtn) {
                    console.log('📌 Attaching reset-game button listener');
                    this.elements.resetGameBtn.addEventListener('click', () => {
                        console.log('🎯 reset-game button clicked');
                        this.confirmAction('reset-game');
                    });
                }
                if (this.elements.clearGameHistoryBtn) this.elements.clearGameHistoryBtn.addEventListener('click', () => this.confirmAction('clear-history'));
                if (this.elements.confirmActionBtn) {
                    console.log('📌 Attaching confirm-action button listener');
                    this.elements.confirmActionBtn.addEventListener('click', () => {
                        console.log('🎯 confirm-action button clicked');
                        this.executeConfirmedAction();
                    });
                }
                if (this.elements.cancelActionBtn) this.elements.cancelActionBtn.addEventListener('click', () => this.hideConfirmationDialog());
                this.modalEventListenersAttached = true;
                console.log('✅ Modal event listeners attached');
            }
        }
    }

    hideGameActionsModal() {
        if (this.elements.gameActionsModal) {
            this.elements.gameActionsModal.classList.add('hidden');
            this.hideConfirmationDialog();
            this.hideActionStatus();
        }
    }

    updateGameActionsState() {
        // No longer needed since we removed pause/resume buttons
    }

    async confirmAction(actionType) {
        console.log('🎯 confirmAction called with:', actionType);
        let title, message, icon;

        switch (actionType) {
            case 'reset-scores':
                title = 'Reset All Scores';
                message = 'This will reset all team scores to zero. This action cannot be undone.';
                icon = 'restart_alt';
                // Note: resetAllScores is called in executeConfirmedAction
                break;
            case 'reset-questions':
                title = 'Reset Questions';
                message = 'This will reset the question progress but keep scores. This action cannot be undone.';
                icon = 'restore';
                break;
            case 'reset-game':
                title = 'Reset Game';
                message = 'This will reset the entire game, clearing all scores and progress. This action cannot be undone.';
                icon = 'delete_forever';
                // Note: scores will be reset in executeConfirmedAction along with questions
                break;
            case 'clear-history':
                title = 'Clear Game History';
                message = 'This will clear all game history and logs. This action cannot be undone.';
                icon = 'clear_all';
                break;
            default:
                return;
        }

        this.pendingAction = actionType;
        console.log('🎯 Setting pendingAction to:', actionType);
        this.showConfirmationDialog(title, message, icon);
    }

    showConfirmationDialog(title, message, icon) {
        console.log('🎯 showConfirmationDialog called with:', { title, message, icon });
        if (!this.elements.gameActionConfirmation ||
            !this.elements.confirmationTitle ||
            !this.elements.confirmationMessage ||
            !this.elements.confirmationIcon) {
            console.error('❌ Confirmation dialog elements not found');
            return;
        }

        this.elements.confirmationTitle.textContent = title;
        this.elements.confirmationMessage.textContent = message;
        this.elements.confirmationIcon.textContent = icon;
        this.elements.gameActionConfirmation.classList.remove('hidden');
        console.log('✅ Confirmation dialog shown');
    }

    hideConfirmationDialog() {
        if (this.elements.gameActionConfirmation) {
            this.elements.gameActionConfirmation.classList.add('hidden');
        }
        this.pendingAction = null;
    }

    async executeConfirmedAction() {
        if (!this.pendingAction) return;

        // Capture the action before hiding dialog (which sets pendingAction to null)
        const actionToExecute = this.pendingAction;

        this.hideConfirmationDialog();
        this.showActionStatus('Processing...');

        try {
            console.log('🔄 Executing action:', actionToExecute);
            switch (actionToExecute) {
                case 'reset-scores':
                    await this.resetAllScores();
                    this.showToast('All scores have been reset to zero', 'success');
                    break;
                case 'reset-questions':
                    await this.resetQuestions();
                    this.showToast('Question progress has been reset', 'success');
                    break;
                case 'reset-game':
                    await this.resetAllScores();
                    await this.resetGame();
                    this.showToast('Game has been completely reset', 'success');
                    break;
                case 'clear-history':
                    await this.clearGameHistory();
                    this.showToast('Game history has been cleared', 'success');
                    break;
            }
            console.log('🎉 Action execution completed successfully');
        } catch (error) {
            console.error('❌ Action failed:', error);
            this.showToast(`Action failed: ${error.message}`, 'error');
        } finally {
            this.hideActionStatus();
            this.pendingAction = null;
        }
    }

    showActionStatus(message) {
        if (this.elements.gameActionStatus && this.elements.statusMessage) {
            this.elements.statusMessage.textContent = message;
            this.elements.gameActionStatus.classList.remove('hidden');
        }
    }

    hideActionStatus() {
        if (this.elements.gameActionStatus) {
            this.elements.gameActionStatus.classList.add('hidden');
        }
    }

    async resetAllScores() {
        console.log('resetAllScores called, currentGame:', !!this.currentGame, 'teams length:', this.teams.length);
        if (!this.currentGame || !this.teams.length) {
            console.log('No active game or teams, returning early');
            this.showToast('No active game or teams to reset', 'warning');
            return;
        }

        try {
            console.log('Starting score reset for', this.teams.length, 'teams');
            // Reset each team's score in the database
            const resetPromises = this.teams.map(async (team) => {
                if (team.score !== 0) {
                    const pointsDifference = -team.score; // Negative of current score to bring to 0
                    await fetch(`/api/games/${this.currentGame.id}/award-points`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ groupId: team.id, points: pointsDifference })
                    });
                }
            });

            await Promise.all(resetPromises);

            // Update local state
            this.teams.forEach(team => {
                team.score = 0;
            });

            // Emit to display clients
            this.socket.emit('update-teams', this.teams);
            this.updateTeamDisplay();

            console.log('resetAllScores completed successfully');
            // Note: Toast will be shown after confirmation in executeConfirmedAction
        } catch (error) {
            console.error('Failed to reset scores:', error);
            this.showToast('Failed to reset scores in database', 'error');
            throw error; // Re-throw so calling function knows it failed
        }
    }

    async resetQuestions() {
        console.log('🔄 resetQuestions called');
        if (!this.currentGame) {
            console.log('❌ No active game to reset');
            this.showToast('No active game to reset', 'warning');
            return;
        }

        try {
            console.log('📡 Calling server API to reset questions');
            // Call server API to reset questions
            const response = await fetch(`/api/games/${this.currentGame.id}/reset-questions`, {
                method: 'POST'
            });

            console.log('📡 API response status:', response.status);
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API response not ok:', response.status, errorText);
                throw new Error('Failed to reset questions on server');
            }

            console.log('📡 Fetching updated game data');
            // Fetch updated game data from server to ensure we're in sync
            const gameResponse = await fetch(`/api/games/${this.currentGame.id}`);
            const updatedGame = await gameResponse.json();
            console.log('📡 Updated game data:', updatedGame.played_questions);

            // Update local game state with server data
            console.log('🔄 Calling onGameChanged with updated game');
            this.onGameChanged(updatedGame);

            // Reset additional local state
            this.activeQuestionIndex = -1;
            this.isQuestionActive = false;
            this.buzzerOrder.length = 0;
            console.log('🔄 Reset local state');

            // Emit to display clients
            this.socket.emit('game-state', this.getGameState());
            console.log('📡 Emitted game-state to display clients');

            // Update UI controls
            this.updateQuestionControls();
            this.updateQuestionTabsState(); // Ensure tabs reflect reset state
            console.log('🔄 Updated UI controls and tabs');

            console.log('✅ resetQuestions completed successfully');
            // Note: Toast will be shown after confirmation in executeConfirmedAction
        } catch (error) {
            console.error('❌ Failed to reset questions:', error);
            this.showToast('Failed to reset questions', 'error');
        }
    }

    async resetGame() {
        // Full game reset (scores already reset before confirmation)
        await this.resetQuestions();

        // Call server reset endpoint to ensure server state consistency
        try {
            const response = await fetch(`/api/games/${this.currentGame.id}/reset`, {
                method: 'POST'
            });

            if (response.ok) {
                // Fetch the fully reset game data from server
                const gameResponse = await fetch(`/api/games/${this.currentGame.id}`);
                const updatedGame = await gameResponse.json();

                // Update local game state with fully reset server data
                this.onGameChanged(updatedGame);

                // Reset additional local state
                this.currentQuestionIndex = 0;
                this.activeQuestionIndex = -1;
                this.isQuestionActive = false;
                this.buzzerOrder.length = 0;

                // Emit to display clients
                this.socket.emit('game-state', this.getGameState());
                this.socket.emit('update-teams', this.teams);

                // Additional UI updates to ensure everything is refreshed
                this.updateQuestionControls();
                this.updateQuestionTabsState();
            }
        } catch (error) {
            console.error('Failed to call server reset:', error);
            // Show error to user since full reset failed
            this.showToast('Failed to complete full game reset', 'error');
            return;
        }

        // Note: Toast will be shown after confirmation in executeConfirmedAction
    }


    async exportGameData() {
        try {
            const gameData = {
                gameId: this.currentGame?.id,
                teams: this.teams,
                questions: this.questions,
                playedQuestions: Array.from(this.playedQuestions),
                buzzerOrder: this.buzzerOrder,
                timestamp: new Date().toISOString()
            };

            const dataStr = JSON.stringify(gameData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = `trivia-game-${this.currentGame?.id || 'export'}-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.showToast('Game data exported successfully', 'success');
        } catch (error) {
            console.error('Export failed:', error);
            this.showToast('Failed to export game data', 'error');
        }
    }

    async clearGameHistory() {
        // Clear evaluation history and logs
        this.evaluationHistory.length = 0;
        this.keyPressCount = { 'A': 0, lastTime: 0 };

        // Clear evaluation display
        if (this.elements.evaluationList) {
            this.elements.evaluationList.innerHTML = '';
        }

        // Note: Toast will be shown after confirmation in executeConfirmedAction
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.hostControl = new HostControl();
});