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
        this.sidebarExpanded = true;
        this.answerWasShown = false; // Track if answer was shown for current question
        this.showingAllTeams = false; // Track if we're showing all teams in leaderboard
        
        // Performance optimization caches
        this.lastTimerPercentage = -1;
        this.lastDisplayedSeconds = -1;
        this.lastDisplayedPoints = -1;
        this.timerAnimationFrame = null;
        this.lastTimerUpdate = 0;
        this.mediaObserver = null; // Intersection observer for media lazy loading
        this.animationObserver = null; // Intersection observer for animations
        this.loadedMedia = new Set(); // Track loaded media to prevent duplicates
        this.eventListeners = new Map(); // Track event listeners for cleanup
        this.timers = new Set(); // Track timers for cleanup
        this.animatedElements = new WeakSet(); // Track elements that have been animated

        this.initializeGameSelector();
        this.initializeElements();
        this.setupSocketListeners();
        this.setupUI();
        this.setupMediaObserver();
        this.setupAnimationObserver();
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
        
        // Auto-hide correct answer overlay when game changes
        this.hideCorrectAnswer();
        
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
            
            // Set initial font size
            this.updateDisplayFontSize(game.display_font_size || 100);
            
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
            
            // Correct answer elements
            correctAnswerOverlay: document.getElementById('correct-answer-overlay'),
            correctAnswerText: document.getElementById('correct-answer-text'),
            
            // Overlay elements
            messageOverlay: document.getElementById('message-overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlayMessage: document.getElementById('overlay-message'),
            
            // Leaderboard elements
            leaderboardOverlay: document.getElementById('leaderboard-overlay'),
            rankedTeamsList: document.getElementById('ranked-teams-list')
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

        this.socket.on('timer-paused', (data) => {
            this.pauseTimer(data);
        });

        this.socket.on('timer-resumed', (data) => {
            this.resumeTimer(data);
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

        this.socket.on('score-update', (data) => {
            this.handleScoreUpdate(data);
        });

        // Game control events
        this.socket.on('game-reset', () => {
            this.handleGameReset();
        });

        this.socket.on('game-state', (data) => {
            this.handleGameStateUpdate(data);
        });

        // Leaderboard events
        this.socket.on('show-leaderboard', (data) => {
            console.log('DEBUG: Received show-leaderboard event with data:', data);
            this.showLeaderboard(data?.view || 'all');
        });

        this.socket.on('hide-leaderboard', () => {
            console.log('DEBUG: Received hide-leaderboard event');
            this.hideLeaderboard();
        });

        // Correct answer events
        this.socket.on('show-correct-answer', (data) => {
            this.showCorrectAnswer(data);
        });

        this.socket.on('hide-correct-answer', (data) => {
            this.hideCorrectAnswer();
        });

        // Font size change event
        this.socket.on('font-size-changed', (data) => {
            this.updateDisplayFontSize(data.fontSize);
        });

        // Question navigation events - hide answer when navigating
        this.socket.on('question-prepared', (data) => {
            this.hideCorrectAnswer();
            
            // If answer was shown, go to idle screen; otherwise keep current display
            if (this.answerWasShown) {
                this.showIdleState();
                console.log('Question prepared:', data.nextQuestionIndex + 1, '- showing idle (answer was shown)');
            } else {
                console.log('Question prepared:', data.nextQuestionIndex + 1, '- keeping current display (no answer shown)');
            }
        });

        this.socket.on('question-navigation', (data) => {
            this.hideCorrectAnswer();
            
            // If answer was shown, go to idle screen; otherwise keep current display  
            if (this.answerWasShown) {
                this.showIdleState();
                console.log('Navigation to question:', data.questionIndex + 1, '- showing idle (answer was shown)');
            } else {
                console.log('Navigation to question:', data.questionIndex + 1, '- keeping current display (no answer shown)');
            }
        });

        // Window resize listener for dynamic text sizing
        window.addEventListener('resize', () => {
            if (this.currentState === 'question' && this.elements.questionText.textContent) {
                // Debounce the resize calls
                clearTimeout(this.resizeTimeout);
                this.resizeTimeout = setTimeout(() => {
                    this.adjustQuestionTextSize();
                }, 250);
            }
        });

        // Fullscreen keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                this.enterFullscreen();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (!this.elements.leaderboardOverlay.classList.contains('hidden')) {
                    this.hideLeaderboard();
                } else {
                    this.exitFullscreen();
                }
            } else if (e.key === 'l' || e.key === 'L') {
                e.preventDefault();
                this.toggleLeaderboard();
            } else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                console.log('DEBUG: Manual leaderboard test - forcing show');
                this.elements.leaderboardOverlay.classList.remove('hidden');
                console.log('DEBUG: leaderboardOverlay visible:', !this.elements.leaderboardOverlay.classList.contains('hidden'));
            }
        });
    }

    // State Management
    showIdleState() {
        this.currentState = 'idle';
        
        // Auto-hide correct answer overlay when transitioning to idle
        this.hideCorrectAnswer();
        
        // Clear any media from previous questions
        this.clearQuestionMedia();
        
        this.elements.idleState.classList.add('active');
        this.elements.idleState.classList.remove('hidden');
        this.elements.questionSection.classList.add('hidden');
        this.elements.questionSection.classList.remove('active');
        this.elements.answerFeedback.classList.add('hidden');
        
        // Collapse sidebar on idle screen to hide buzzer activity
        this.collapseSidebar();
        
        this.updateGameStatus('Ready to play');
        this.clearBuzzerQueue();
    }

    showQuestionState(question) {
        this.currentState = 'question';
        
        // Auto-hide correct answer overlay when showing new question
        this.hideCorrectAnswer();
        
        // Clear any previous media first
        this.clearQuestionMedia();
        
        this.elements.idleState.classList.remove('active');
        this.elements.idleState.classList.add('hidden');
        this.elements.questionSection.classList.remove('hidden');
        this.elements.questionSection.classList.add('active');
        this.elements.answerFeedback.classList.add('hidden');
        
        // Collapse sidebar for new question
        this.collapseSidebar();
        
        // Update question content
        this.elements.questionText.textContent = question.text;
        
        // Store base points for time-based calculation
        this.basePoints = question.points || 100;
        this.elements.questionPoints.textContent = `${this.basePoints} Points`;
        
        // Handle media and layout
        if (question.media_url) {
            this.loadQuestionMedia(question.media_url);
            
            const questionContent = document.querySelector('.question-content');
            // Add has-media class to change layout
            questionContent.classList.add('has-media');
            
            // Randomly shuffle media side (left or right)
            const isMediaRight = Math.random() > 0.5;
            if (isMediaRight) {
                questionContent.classList.add('media-right');
                console.log('Media positioned on RIGHT side');
            } else {
                questionContent.classList.remove('media-right');
                console.log('Media positioned on LEFT side');
            }
        } else {
            const questionContent = document.querySelector('.question-content');
            // Hide the media container
            const mediaContainer = document.getElementById('question-media-container');
            if (mediaContainer) {
                mediaContainer.classList.add('hidden');
            }
            // Remove has-media classes for normal layout
            questionContent.classList.remove('has-media', 'media-right');
        }
        
        // Apply dynamic text sizing after content is set
        this.adjustQuestionTextSize();
        
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
        
        // Auto-hide correct answer overlay when new question starts
        this.hideCorrectAnswer();
        
        // Reset answer shown flag for new question
        this.answerWasShown = false;
        
        this.showQuestionState(data.question);
        this.totalTime = data.question.time_limit || 30;
        this.timeRemaining = this.totalTime;
        
        // Clear any previous timer state
        this.clearTimer();
        
        // Update display and start fresh timer
        this.updateTimer(this.timeRemaining, this.totalTime);
        this.startTimer();
        
        console.log('Question started on display, timer:', this.totalTime);
    }

    handleQuestionEnded(data) {
        this.clearTimer();
        // Keep question visible instead of returning to idle state
        // The question will be hidden when a correct answer is given or host manually advances
        this.updateGameStatus('Time up - Waiting for answer');
        this.elements.timerText.textContent = 'Time up!';
        
        // Pause any playing media when time is up
        this.pauseMedia();
    }

    handleBuzzerPressed(data) {
        console.log('Buzzer pressed:', data);
        
        // Expand sidebar on first buzzer press
        if (this.buzzerQueue.length === 0 && !this.sidebarExpanded) {
            this.expandSidebar();
        }
        
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

        // Update the buzzer queue item with evaluation status
        const buzzerIndex = this.buzzerQueue.findIndex(item => item.groupId === data.groupId);
        if (buzzerIndex !== -1) {
            this.buzzerQueue[buzzerIndex].evaluated = true;
            this.buzzerQueue[buzzerIndex].isCorrect = data.isCorrect;
        }

        // Show answer feedback
        this.showAnswerFeedback(displayData);

        // Update buzzer queue to show result
        this.updateBuzzerQueueWithResult(displayData);
        
        // Clear after delay
        setTimeout(() => {
            if (data.isCorrect) {
                this.showIdleState();
                this.currentQuestion = null;
                // Clear the buzzer queue after correct answer
                this.buzzerQueue = [];
                this.updateBuzzerQueue();
            }
            // For incorrect answers, keep the evaluated team in queue with styling
            // Don't remove them - let them stay as visual history
        }, 3000);
    }

    handleTeamsUpdated(teams) {
        // Update team names mapping and current game data
        teams.forEach(team => {
            // Map both groupId and buzzer_id for compatibility
            this.teamNames.set(team.id, team.name);
            this.teamNames.set(team.buzzer_id || team.id, team.name);
        });
        
        // Update current game groups data if we have a current game
        if (this.currentGame && this.currentGame.groups) {
            this.currentGame.groups = teams;
        }
    }

    handleScoreUpdate(data) {
        console.log('Score update received:', data);
        
        // Update the specific team's score in current game data
        if (this.currentGame && this.currentGame.groups) {
            const team = this.currentGame.groups.find(t => t.id === data.groupId);
            if (team) {
                team.score = data.newScore;
                console.log(`Updated ${team.name} score to ${data.newScore}`);
            }
        }
    }

    handleGameReset() {
        this.clearTimer();
        this.clearBuzzerQueue();

        // Auto-hide correct answer overlay on game reset
        this.hideCorrectAnswer();

        this.showIdleState();
    }

    handleGameStateUpdate(data) {
        console.log('Game state update received:', data);

        // Update buzzer queue based on new game state
        // If questions are reset, clear the buzzer queue
        if (data.played_questions && data.played_questions.length === 0) {
            console.log('Questions reset detected, clearing buzzer queue');
            this.clearBuzzerQueue();
        }

        // Update current question index if changed
        if (data.current_question_index !== undefined) {
            // Handle question navigation if needed
        }
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
        
        // Reset performance caches
        this.lastTimerPercentage = -1;
        this.lastDisplayedSeconds = -1;
        this.lastDisplayedPoints = -1;
        
        // Gentle 10 FPS update for smooth audience experience
        const updateInterval = 1000 / 10; // 10 FPS = 100ms intervals  
        const decrementPerUpdate = 1 / 10; // Decrease by 1/10th of a second each update
        
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

    pauseTimer(data) {
        // STOP the local timer interval immediately
        this.clearTimer();
        
        // Calculate exact remaining time from backend data
        const elapsedMs = data.timeElapsed;
        const elapsedSeconds = elapsedMs / 1000;
        this.timeRemaining = Math.max(0, this.totalTime - elapsedSeconds);
        
        // Update display with paused indicator (keep showing seconds)
        const displaySeconds = Math.ceil(this.timeRemaining);
        this.elements.timerText.textContent = `⏸️ ${displaySeconds}s`;
        
        // Update timer bar to exact position
        const percentage = this.totalTime > 0 ? Math.max(0, (this.timeRemaining / this.totalTime) * 100) : 0;
        this.elements.timerProgress.style.width = `${percentage}%`;
        
        // Update points display if time-based scoring
        if (this.currentGame && this.currentGame.time_based_scoring && this.currentQuestion) {
            const points = this.calculateTimeBasedPoints(
                this.currentQuestion.points,
                this.timeRemaining,
                this.totalTime
            );
            if (this.lastDisplayedPoints !== points) {
                this.elements.questionPoints.textContent = `${points} points`;
                this.lastDisplayedPoints = points;
            }
        }
        
        console.log('Timer paused on display, remaining:', this.timeRemaining);
        
        // Pause any playing media
        this.pauseMedia();
    }

    resumeTimer(data) {
        // Set exact remaining time from backend
        this.timeRemaining = Math.max(0, data.timeRemaining / 1000); // Convert ms to seconds
        
        // Update display immediately
        this.updateTimer(this.timeRemaining, this.totalTime);
        
        // Restart the local timer countdown from this exact point
        this.startTimer();
        
        console.log('Timer resumed on display, remaining:', this.timeRemaining);
        
        // Resume any paused media
        this.resumeMedia();
    }

    updateTimer(timeRemaining, totalTime) {
        this.timeRemaining = timeRemaining;
        this.totalTime = totalTime;

        // Throttle updates to 30fps for better performance
        const now = performance.now();
        if (now - this.lastTimerUpdate < 33) { // ~30fps
            return;
        }
        this.lastTimerUpdate = now;

        // Use requestAnimationFrame for smooth updates
        if (this.timerAnimationFrame) {
            cancelAnimationFrame(this.timerAnimationFrame);
        }

        this.timerAnimationFrame = requestAnimationFrame(() => {
            this.performTimerUpdate(timeRemaining, totalTime);
            this.timerAnimationFrame = null;
        });
    }

    performTimerUpdate(timeRemaining, totalTime) {
        // Ensure timer bar is completely empty when time is up
        let percentage;
        if (timeRemaining <= 0 || totalTime <= 0) {
            percentage = 0;
        } else {
            percentage = Math.max(0, (timeRemaining / totalTime) * 100);
        }

        // Only update timer progress if it changed significantly (avoid micro-updates)
        const roundedPercentage = Math.round(percentage * 10) / 10; // Round to 1 decimal
        if (this.lastTimerPercentage !== roundedPercentage) {
            this.elements.timerProgress.style.width = `${roundedPercentage}%`;
            this.lastTimerPercentage = roundedPercentage;
        }

        const seconds = Math.max(0, Math.floor(timeRemaining)); // Round down to show accurate seconds
        if (seconds > 0) {
            // Only update timer text if seconds changed
            if (this.lastDisplayedSeconds !== seconds) {
                this.elements.timerText.textContent = `${seconds}s`;
                this.lastDisplayedSeconds = seconds;
            }

            // Update points display for time-based scoring (only when points change)
            if (this.currentGame && this.currentGame.time_based_scoring && this.basePoints && this.currentState === 'question') {
                const currentPoints = this.calculateTimeBasedPoints(this.basePoints, timeRemaining, totalTime);
                if (this.lastDisplayedPoints !== currentPoints) {
                    this.elements.questionPoints.textContent = `${currentPoints} Points`;
                    this.lastDisplayedPoints = currentPoints;
                }
            }
        } else {
            this.elements.timerText.textContent = 'Time up!';
            // Force timer to 0% when showing "Time up!"
            this.elements.timerProgress.style.width = '0%';

            // Show 0 points when time is up for time-based scoring
            if (this.currentGame && this.currentGame.time_based_scoring) {
                this.elements.questionPoints.textContent = '0 Points';
            }
        }
    }

    // Buzzer Queue Methods
    updateBuzzerQueue() {
        const container = this.elements.buzzerQueue;

        // Use document fragment for better performance
        const fragment = document.createDocumentFragment();

        if (this.buzzerQueue.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'buzzer-item';
            emptyItem.innerHTML = `
                <div class="buzzer-team"></div>
                <div class="buzzer-details">
                    <span class="buzzer-order">-</span>
                    <span class="buzzer-time">-</span>
                </div>
            `;
            fragment.appendChild(emptyItem);
        } else {
            // Create items efficiently with object pooling
            this.buzzerQueue.forEach((item, index) => {
                const buzzerItem = this.createOrReuseBuzzerItem(item, index);
                fragment.appendChild(buzzerItem);
            });
        }

        // Batch DOM update
        container.innerHTML = '';
        container.appendChild(fragment);
    }

    createOrReuseBuzzerItem(item, index) {
        const buzzerItem = document.createElement('div');

        // Determine the appropriate class based on evaluation status
        let itemClass = 'buzzer-item';

        if (item.evaluated) {
            // Already evaluated - show result
            itemClass += item.isCorrect ? ' correct' : ' incorrect';
        } else {
            // Not evaluated yet - check if it's the current fastest (first unevaluated)
            const firstUnevaluatedIndex = this.buzzerQueue.findIndex(b => !b.evaluated);
            if (index === firstUnevaluatedIndex) {
                itemClass += ' fastest';
            } else {
                itemClass += ' active';
            }
        }

        buzzerItem.className = itemClass;
        buzzerItem.dataset.buzzerId = item.buzzerId;

        // Use textContent for better performance than innerHTML
        buzzerItem.innerHTML = `
            <div class="buzzer-team">${item.teamName}</div>
            <div class="buzzer-details">
                <span class="buzzer-order">${item.order}</span>
                <span class="buzzer-time">${item.deltaTime.toFixed(2)}s</span>
            </div>
        `;

        return buzzerItem;
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
            points.innerHTML = `👍 ${data.points || 100}<span class="pts-label">pts</span>`;
            message.textContent = '';
            feedback.className = 'answer-feedback correct show';
        } else {
            icon.textContent = '✗';
            icon.className = 'feedback-icon incorrect';
            points.className = 'feedback-points negative';
            points.innerHTML = `👎 ${data.points || 100}<span class="pts-label">pts</span>`;
            message.textContent = '';
            feedback.className = 'answer-feedback incorrect show';
        }

        team.textContent = teamName;

        // Add some celebration effects for correct answers
        if (data.correct) {
            document.body.style.animation = 'celebrate 0.5s ease-in-out';
            setTimeout(() => {
                document.body.style.animation = '';
            }, 500);
        }

        // Hide after longer delay to let people appreciate the enhanced display
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

    // Time-based scoring calculation (matches backend logic)
    calculateTimeBasedPoints(originalPoints, timeRemaining, totalTime) {
        if (timeRemaining <= 0) return 0;
        if (timeRemaining >= totalTime) return originalPoints;
        
        // Linear decrease from original points to 0
        const ratio = timeRemaining / totalTime;
        return Math.ceil(originalPoints * ratio);
    }

    // Dynamic Text Sizing
    adjustQuestionTextSize() {
        const questionElement = this.elements.questionText;
        const containerElement = questionElement.closest('.question-container');
        
        if (!questionElement || !containerElement) return;
        
        // Base font size in rem (current default)
        const baseFontSize = 8;
        const minFontSize = 3; // Minimum font size in rem
        const maxFontSize = 10; // Maximum font size in rem
        
        // Reset to base size first
        questionElement.style.fontSize = `${baseFontSize}rem`;
        
        // Wait for next frame to ensure text is rendered
        requestAnimationFrame(() => {
            const containerRect = containerElement.getBoundingClientRect();
            const questionRect = questionElement.getBoundingClientRect();
            
            // Calculate available space (subtract padding and some margin for media)
            const availableWidth = containerRect.width * 0.9; // 90% of container width
            const availableHeight = containerRect.height * 0.6; // 60% of container height (leave room for media)
            
            let fontSize = baseFontSize;
            
            // If text is too wide or too tall, reduce font size
            if (questionRect.width > availableWidth || questionRect.height > availableHeight) {
                const widthRatio = availableWidth / questionRect.width;
                const heightRatio = availableHeight / questionRect.height;
                const scaleFactor = Math.min(widthRatio, heightRatio);
                
                fontSize = Math.max(minFontSize, baseFontSize * scaleFactor);
            }
            // If text is much smaller than available space, increase font size (but not beyond max)
            else if (questionRect.width < availableWidth * 0.5 && questionRect.height < availableHeight * 0.5) {
                const widthRatio = (availableWidth * 0.8) / questionRect.width;
                const heightRatio = (availableHeight * 0.8) / questionRect.height;
                const scaleFactor = Math.min(widthRatio, heightRatio);
                
                fontSize = Math.min(maxFontSize, baseFontSize * scaleFactor);
            }
            
            // Apply the calculated font size
            questionElement.style.fontSize = `${fontSize}rem`;
            
            // Update line height proportionally
            const lineHeight = fontSize >= 6 ? 1.2 : 1.3;
            questionElement.style.lineHeight = lineHeight;
        });
    }

    // Sidebar Management
    collapseSidebar() {
        this.sidebarExpanded = false;
        document.getElementById('app').classList.add('sidebar-collapsed');
    }

    expandSidebar() {
        this.sidebarExpanded = true;
        document.getElementById('app').classList.remove('sidebar-collapsed');
    }

    // Fullscreen Methods
    enterFullscreen() {
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
    }

    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }

    // Leaderboard Methods
    showLeaderboard(view = 'all') {
        console.log('DEBUG: showLeaderboard called with view:', view);
        console.log('DEBUG: current game teams count:', this.currentGame?.groups?.length || 0);
        if (!this.currentGame || !this.currentGame.groups) {
            console.log('No game or teams available for leaderboard');
            return;
        }

        // Show immediately with current data
        console.log('DEBUG: Showing leaderboard with current data for view:', view);
        this.displayLeaderboardWithCurrentData(view);

        // Also request fresh data to update if available
        console.log('DEBUG: Requesting fresh game data');
        this.socket.emit('get-game-state', this.currentGame.id);

        // Listen for the response with fresh data (but don't show again)
        this.socket.once('game-state-response', (gameData) => {
            console.log('DEBUG: Received game-state-response:', gameData);
            if (gameData && gameData.groups) {
                // Update current game data with fresh scores
                this.currentGame.groups = gameData.groups;
                console.log('DEBUG: Updated game data with fresh scores');
                // Note: We don't call displayLeaderboardWithCurrentData again to avoid flickering
            }
        });
    }
    
    displayLeaderboardWithCurrentData(view = 'all') {
        console.log('DEBUG: displayLeaderboardWithCurrentData called with view:', view);
        console.log('DEBUG: currentGame exists:', !!this.currentGame);
        console.log('DEBUG: currentGame.groups exists:', !!(this.currentGame && this.currentGame.groups));
        if (!this.currentGame || !this.currentGame.groups) {
            console.log('No game or teams available for leaderboard display');
            return;
        }

        // Sort teams by score (descending)
        const allTeams = [...this.currentGame.groups].sort((a, b) => b.score - a.score);
        console.log('DEBUG: allTeams length:', allTeams.length);

        // Filter teams based on view
        let teamsToShow = allTeams;
        let hasMoreTeams = false;
        console.log('DEBUG: Processing view:', view, 'showingAllTeams:', this.showingAllTeams);
        switch (view) {
            case 'top3':
                teamsToShow = allTeams.slice(0, 3);
                console.log('DEBUG: top3 view - showing 3 teams');
                break;
            case 'top5':
                teamsToShow = allTeams.slice(0, 5);
                console.log('DEBUG: top5 view - showing 5 teams');
                break;
            case 'all':
            default:
                console.log('DEBUG: all view - processing all teams');
                // For performance, limit to 20 teams initially with option to show more
                // But if this is called from showAllTeams, show everything
                const MAX_INITIAL_TEAMS = 20;
                const showAllRequested = this.showingAllTeams;
                console.log('DEBUG: allTeams.length:', allTeams.length, 'MAX_INITIAL_TEAMS:', MAX_INITIAL_TEAMS, 'showAllRequested:', showAllRequested);
                if (allTeams.length > MAX_INITIAL_TEAMS && !showAllRequested) {
                    teamsToShow = allTeams.slice(0, MAX_INITIAL_TEAMS);
                    hasMoreTeams = true;
                    console.log('DEBUG: Limiting to first', MAX_INITIAL_TEAMS, 'teams, hasMoreTeams:', hasMoreTeams);
                } else {
                    teamsToShow = allTeams;
                    hasMoreTeams = false;
                    this.showingAllTeams = true; // Mark that we're showing all teams now
                    console.log('DEBUG: Showing all teams, hasMoreTeams:', hasMoreTeams, 'showingAllTeams set to:', this.showingAllTeams);
                }
                break;
        }

        const teamCount = teamsToShow.length;
        console.log('DEBUG: Final teamsToShow length:', teamCount, 'for view:', view);

        // Apply view-specific styling to overlay
        this.applyViewSpecificStyling(view, teamCount);

        // Update ranked teams list based on view
        if (view === 'top3') {
            this.updateTop3PodiumView(teamsToShow);
        } else if (view === 'top5') {
            this.updateTop5HighlightView(teamsToShow);
        } else {
            // Apply dynamic sizing based on team count for 'all' view
            this.applyDynamicSizing(teamCount);
            this.updateRankedTeamsList(teamsToShow, hasMoreTeams, allTeams);
        }

        // Show the leaderboard overlay
        console.log('DEBUG: About to show leaderboard overlay');
        console.log('DEBUG: leaderboardOverlay element exists:', !!this.elements.leaderboardOverlay);
        console.log('DEBUG: leaderboardOverlay has hidden class:', this.elements.leaderboardOverlay.classList.contains('hidden'));
        this.elements.leaderboardOverlay.classList.remove('hidden');
        console.log('DEBUG: leaderboardOverlay has hidden class after removal:', this.elements.leaderboardOverlay.classList.contains('hidden'));
        
        // Ensure first item is visible and scrolled into view
        setTimeout(() => {
            const firstItem = this.elements.rankedTeamsList.querySelector('.ranked-team-item:first-child');
            if (firstItem) {
                // Force visibility by adding a class and ensuring proper styles
                firstItem.classList.add('first-place-visible');
                firstItem.style.opacity = '1';
                firstItem.style.transform = 'translateY(0)';
                firstItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 50); // Reduced delay for faster visibility
        
        console.log(`Leaderboard shown (${view}) with`, teamCount, 'teams', teamsToShow.map(t => `${t.name}: ${t.score}`));
    }

    hideLeaderboard() {
        this.elements.leaderboardOverlay.classList.remove('view-top3', 'view-top5', 'view-all');
        this.elements.leaderboardOverlay.classList.add('hidden');
        console.log('Leaderboard hidden');
    }

    applyViewSpecificStyling(view, teamCount) {
        // Remove existing view classes
        this.elements.leaderboardOverlay.classList.remove('view-top3', 'view-top5', 'view-all');
        
        // Add current view class
        this.elements.leaderboardOverlay.classList.add(`view-${view}`);
        
        // For 'all' view, also apply the existing dynamic sizing
        if (view === 'all') {
            this.applyDynamicSizing(teamCount);
        }
    }

    updateTop3PodiumView(teams) {
        const container = this.elements.rankedTeamsList;
        
        if (!teams || teams.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: rgba(255, 255, 255, 0.6); padding: 40px;">No teams available</p>';
            return;
        }

        // Create podium-style layout for top 3
        container.innerHTML = `
            <div class="podium-container">
                <div class="podium-platforms">
                    ${teams[1] ? `
                        <div class="podium-platform second-place" style="animation-delay: 100ms">
                            <div class="podium-team-info">
                                <div class="podium-position">2</div>
                                <div class="podium-team-name">${teams[1].name || `Team ${teams[1].id}`}</div>
                                <div class="podium-score">${teams[1].score || 0}</div>
                                <div class="podium-medal">🥈</div>
                            </div>
                            <div class="podium-base second"></div>
                        </div>
                    ` : ''}
                    
                    ${teams[0] ? `
                        <div class="podium-platform first-place" style="animation-delay: 200ms">
                            <div class="podium-team-info">
                                <div class="podium-position">1</div>
                                <div class="podium-team-name">${teams[0].name || `Team ${teams[0].id}`}</div>
                                <div class="podium-score">${teams[0].score || 0}</div>
                                <div class="podium-medal">🏆</div>
                            </div>
                            <div class="podium-base first"></div>
                        </div>
                    ` : ''}
                    
                    ${teams[2] ? `
                        <div class="podium-platform third-place" style="animation-delay: 300ms">
                            <div class="podium-team-info">
                                <div class="podium-position">3</div>
                                <div class="podium-team-name">${teams[2].name || `Team ${teams[2].id}`}</div>
                                <div class="podium-score">${teams[2].score || 0}</div>
                                <div class="podium-medal">🥉</div>
                            </div>
                            <div class="podium-base third"></div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    updateTop5HighlightView(teams) {
        const container = this.elements.rankedTeamsList;
        
        if (!teams || teams.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: rgba(255, 255, 255, 0.6); padding: 40px;">No teams available</p>';
            return;
        }

        // Create highlight view for top 5 with special emphasis on top 3
        container.innerHTML = teams.map((team, index) => {
            const position = index + 1;
            const isTop3 = position <= 3;
            
            let positionIcon = '';
            let specialClass = '';
            
            if (position === 1) {
                positionIcon = '👑';
                specialClass = 'highlight-first';
            } else if (position === 2) {
                positionIcon = '🥈';
                specialClass = 'highlight-second';
            } else if (position === 3) {
                positionIcon = '🥉';
                specialClass = 'highlight-third';
            } else if (position === 4) {
                positionIcon = '⭐';
                specialClass = 'highlight-fourth';
            } else {
                positionIcon = '🌟';
                specialClass = 'highlight-fifth';
            }
            
            return `
                <div class="top5-team-item ${specialClass}" style="animation-delay: ${index * 150}ms">
                    <div class="top5-rank-section">
                        <div class="top5-position-icon">${positionIcon}</div>
                        <div class="top5-position-number">${position}</div>
                    </div>
                    <div class="top5-info-section">
                        <div class="top5-team-name">${team.name || `Team ${team.id}`}</div>
                        ${isTop3 ? `<div class="top5-badge">${position === 1 ? 'CHAMPION' : position === 2 ? 'RUNNER-UP' : 'THIRD PLACE'}</div>` : ''}
                    </div>
                    <div class="top5-score-section">
                        <div class="top5-team-score">${team.score || 0}</div>
                        <div class="top5-points-label">pts</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    toggleLeaderboard() {
        if (this.elements.leaderboardOverlay.classList.contains('hidden')) {
            this.showLeaderboard();
        } else {
            this.hideLeaderboard();
        }
    }

    updateRankedTeamsList(teams, hasMoreTeams = false, allTeams = []) {
        const container = this.elements.rankedTeamsList;
        
        if (!teams || teams.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: rgba(255, 255, 255, 0.6); padding: 40px;">No teams available</p>';
            return;
        }

        container.innerHTML = teams.map((team, index) => {
            const position = index + 1;
            const isTop3 = position <= 3;
            const isWinner = position === 1;
            
            // Get position icon and styling
            let positionIcon = '';
            let rankClass = '';
            
            if (position === 1) {
                positionIcon = '👑';
                rankClass = 'rank-first';
            } else if (position === 2) {
                positionIcon = '🥈';
                rankClass = 'rank-second';
            } else if (position === 3) {
                positionIcon = '🥉';
                rankClass = 'rank-third';
            } else if (position <= 5) {
                positionIcon = '⭐';
                rankClass = 'rank-top5';
            } else {
                positionIcon = '📍';
                rankClass = 'rank-standard';
            }
            
            return `
                <div class="ranked-team-item ${rankClass} ${isTop3 ? 'top-three' : ''} ${isWinner ? 'winner' : ''}" 
                     style="animation-delay: ${index * 100}ms">
                    <div class="team-rank-section">
                        <div class="position-icon">${positionIcon}</div>
                        <div class="position-number">${position}</div>
                    </div>
                    <div class="team-info-section">
                        <div class="team-name-line">
                            <span class="team-name">${team.name || `Team ${team.id}`}</span>
                            ${isTop3 ? `<span class="team-badge">${position === 1 ? 'CHAMPION' : position === 2 ? 'RUNNER-UP' : 'THIRD PLACE'}</span>` : ''}
                        </div>
                    </div>
                    <div class="team-score-section">
                        <div class="team-score">${team.score || 0}</div>
                        <div class="points-label">pts</div>
                    </div>
                    ${isTop3 ? '<div class="sparkle-trail"></div>' : ''}
                </div>
            `;
        }).join('');

        // Add "Show More" button if there are more teams
        if (hasMoreTeams) {
            const remainingCount = allTeams.length - teams.length;
            teamsHtml += `
                <div class="show-more-container" style="animation-delay: ${teams.length * 100}ms">
                    <button class="show-more-btn" onclick="window.gameDisplay.showAllTeams()">
                        Show ${remainingCount} More Team${remainingCount > 1 ? 's' : ''}
                        <span class="show-more-icon">▼</span>
                    </button>
                </div>
            `;
        }

        container.innerHTML = teamsHtml;
    }

    showAllTeams() {
        // Re-show leaderboard with all teams
        this.showLeaderboard('all');
    }

    applyDynamicSizing(teamCount) {
        // Calculate available space and optimal sizing
        const remainingTeamsCount = Math.max(0, teamCount - 3); // Teams beyond top 3
        const container = this.elements.leaderboardOverlay;
        const rankedTeamsList = this.elements.rankedTeamsList;
        
        // Size categories based on team count
        let sizeCategory;
        if (teamCount <= 3) sizeCategory = 'minimal'; // Only podium
        else if (teamCount <= 6) sizeCategory = 'small';
        else if (teamCount <= 9) sizeCategory = 'medium';
        else if (teamCount <= 12) sizeCategory = 'large';
        else sizeCategory = 'maximum'; // 13-15 teams
        
        // Remove existing size classes
        container.classList.remove('size-minimal', 'size-small', 'size-medium', 'size-large', 'size-maximum');
        
        // Add appropriate size class
        container.classList.add(`size-${sizeCategory}`);
        
        // Calculate dynamic spacing to maximize container usage
        this.calculateDynamicSpacing(teamCount, rankedTeamsList);
        
        console.log(`Applied dynamic sizing: ${sizeCategory} for ${teamCount} teams`);
    }

    calculateDynamicSpacing(teamCount, container) {
        // Get the available height of the leaderboard content area
        const leaderboardContent = container.closest('.leaderboard-content');
        if (!leaderboardContent) return;
        
        // Wait for next frame to ensure elements are rendered
        requestAnimationFrame(() => {
            const contentHeight = leaderboardContent.offsetHeight;
            const headerHeight = 80; // Approximate header height
            const footerHeight = 40; // Approximate footer/padding
            const availableHeight = contentHeight - headerHeight - footerHeight;
            
            // Estimate item heights based on scaling
            const baseItemHeight = 70; // Base row height
            const scaledHeights = {
                1: baseItemHeight * 1.12, // Winner (breathing effect max)
                2: baseItemHeight * 1.06,
                3: baseItemHeight * 1.04,
                4: baseItemHeight * 1.02,
                5: baseItemHeight * 1.02,
            };
            
            // Calculate total height needed for all items
            let totalItemsHeight = 0;
            for (let i = 1; i <= teamCount; i++) {
                if (i <= 5) {
                    totalItemsHeight += scaledHeights[i] || baseItemHeight;
                } else {
                    totalItemsHeight += baseItemHeight;
                }
            }
            
            // Calculate optimal gap
            const totalGapsNeeded = teamCount - 1;
            const availableSpaceForGaps = Math.max(0, availableHeight - totalItemsHeight);
            const optimalGap = totalGapsNeeded > 0 ? Math.min(20, Math.max(4, availableSpaceForGaps / totalGapsNeeded)) : 8;
            
            // Apply the calculated gap
            container.style.gap = `${optimalGap}px`;
            
            console.log(`Dynamic spacing: ${optimalGap}px gap for ${teamCount} teams (available: ${availableHeight}px, items: ${totalItemsHeight}px)`);
        });
    }

    // Correct Answer Methods
    showCorrectAnswer(data) {
        console.log('Showing correct answer:', data);
        
        // Update the correct answer text
        this.elements.correctAnswerText.textContent = data.correctAnswer;
        
        // Show the overlay and mark that answer was shown
        this.elements.correctAnswerOverlay.classList.remove('hidden');
        this.answerWasShown = true;
        
        // Auto-hide after 15 seconds
        setTimeout(() => {
            this.hideCorrectAnswer();
        }, 15000);
    }

    hideCorrectAnswer() {
        if (this.elements && this.elements.correctAnswerOverlay) {
            this.elements.correctAnswerOverlay.classList.add('hidden');
            console.log('Correct answer overlay hidden');
        }
    }

    // Font Size Control Methods
    updateDisplayFontSize(fontSize) {
        console.log('Updating display font size to:', fontSize);
        
        // Store the font size as a CSS custom property for easy access
        document.documentElement.style.setProperty('--display-font-scale', fontSize / 100);
        
        // Apply font size to question text specifically
        if (this.elements.questionText) {
            this.elements.questionText.style.transform = `scale(${fontSize / 100})`;
            this.elements.questionText.style.transformOrigin = 'center';
        }
        
        // Also apply to correct answer text
        if (this.elements.correctAnswerText) {
            this.elements.correctAnswerText.style.transform = `scale(${fontSize / 100})`;
            this.elements.correctAnswerText.style.transformOrigin = 'center';
        }
        
        // Update idle state game description text
        if (this.elements.gameDescriptionDisplay) {
            this.elements.gameDescriptionDisplay.style.transform = `scale(${fontSize / 100})`;
            this.elements.gameDescriptionDisplay.style.transformOrigin = 'center';
        }
        
        console.log('Font size updated successfully');
    }

    // Media Loading Methods
    loadQuestionMedia(mediaUrl) {
        if (!mediaUrl) return;

        console.log('Loading question media:', mediaUrl);
        
        const mediaContainer = document.getElementById('question-media-container');
        const imageElement = document.getElementById('question-media');
        const videoElement = document.getElementById('question-video');
        const iframeElement = document.getElementById('question-iframe');
        
        if (!mediaContainer || !imageElement || !videoElement || !iframeElement) return;

        // Reset all elements
        mediaContainer.classList.add('hidden');
        imageElement.style.display = 'none';
        videoElement.style.display = 'none';
        iframeElement.style.display = 'none';
        imageElement.src = '';
        videoElement.src = '';
        iframeElement.src = '';

        // Handle different URL types
        let finalUrl = mediaUrl;
        
        // If it's a relative URL, make it absolute
        if (!mediaUrl.startsWith('http') && !mediaUrl.startsWith('/')) {
            finalUrl = window.location.origin + '/' + mediaUrl;
        }
        // If it starts with '/' but is not absolute, make it relative to server
        else if (mediaUrl.startsWith('/') && !mediaUrl.startsWith('//')) {
            finalUrl = window.location.origin + mediaUrl;
        }

        console.log('Loading media from URL:', finalUrl);

        // Check if it's a YouTube URL and convert to embed format
        const youtubeMatch = finalUrl.match(/(?:youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]+)|youtu\.be\/([a-zA-Z0-9_-]+))/);
        const isYouTube = youtubeMatch !== null;
        
        // Determine if it's a video file based on file extension
        const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i.test(finalUrl);
        
        if (isYouTube) {
            // Handle YouTube video via iframe
            const videoId = youtubeMatch[1] || youtubeMatch[2]; // Handle both youtube.com and youtu.be formats
            
            // Try unmuted first, browsers will block if not allowed
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&controls=0&rel=0&modestbranding=1&showinfo=0&fs=0&disablekb=1&playsinline=1&loop=0&start=0&enablejsapi=1`;
            
            // Set iframe attributes for autoplay permissions
            iframeElement.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
            iframeElement.setAttribute('allowfullscreen', 'true');
            
            iframeElement.src = embedUrl;
            iframeElement.style.display = 'block';
            iframeElement.onload = () => {
                console.log('YouTube video loaded successfully:', embedUrl);
                mediaContainer.classList.remove('hidden');
                
                // Fallback: Try to trigger autoplay via postMessage API
                setTimeout(() => {
                    try {
                        iframeElement.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                    } catch (e) {
                        console.log('YouTube autoplay fallback failed (expected in some cases):', e.message);
                    }
                }, 1000);
            };
            iframeElement.onerror = () => {
                console.error('Failed to load YouTube video:', embedUrl);
                this.showMediaError(finalUrl);
            };
        } else if (isVideo) {
            // Handle regular video files
            videoElement.src = finalUrl;
            videoElement.style.display = 'block';
            videoElement.onloadedmetadata = () => {
                console.log('Video loaded successfully:', finalUrl);
                mediaContainer.classList.remove('hidden');
            };
            videoElement.onerror = () => {
                console.error('Failed to load video:', finalUrl);
                this.showMediaError(finalUrl);
            };
        } else {
            // Handle image
            imageElement.crossOrigin = 'anonymous';
            imageElement.onload = () => {
                console.log('Image loaded successfully:', finalUrl);
                imageElement.style.display = 'block';
                mediaContainer.classList.remove('hidden');
            };
            imageElement.onerror = () => {
                console.error('Failed to load image:', finalUrl);
                this.showMediaError(finalUrl);
            };
            imageElement.src = finalUrl;
        }
    }


    showMediaError(failedUrl) {
        console.log('Showing media error for:', failedUrl);
        // Hide the media container and remove has-media layout
        const mediaContainer = document.getElementById('question-media-container');
        if (mediaContainer) {
            mediaContainer.classList.add('hidden');
        }
        document.querySelector('.question-content').classList.remove('has-media', 'media-right');
    }

    // Clear all media from previous questions
    clearQuestionMedia() {
        console.log('Clearing previous question media');
        
        const questionContent = document.querySelector('.question-content');
        const mediaContainer = document.getElementById('question-media-container');
        const imageElement = document.getElementById('question-media');
        const videoElement = document.getElementById('question-video');
        const iframeElement = document.getElementById('question-iframe');
        
        // Remove all media-related CSS classes
        if (questionContent) {
            questionContent.classList.remove('has-media', 'media-right');
        }
        
        // Hide media container
        if (mediaContainer) {
            mediaContainer.classList.add('hidden');
        }
        
        // Clear all media elements
        if (imageElement) {
            imageElement.style.display = 'none';
            imageElement.src = '';
        }
        
        if (videoElement) {
            videoElement.style.display = 'none';
            videoElement.src = '';
            videoElement.pause(); // Stop any playing video
        }
        
        if (iframeElement) {
            iframeElement.style.display = 'none';
            iframeElement.src = '';
        }
    }

    // Pause media playback
    pauseMedia() {
        const videoElement = document.getElementById('question-video');
        const iframeElement = document.getElementById('question-iframe');
        
        // Pause HTML5 video
        if (videoElement && videoElement.style.display !== 'none' && !videoElement.paused) {
            videoElement.pause();
            console.log('Video paused');
        }
        
        // Pause YouTube video via postMessage
        if (iframeElement && iframeElement.style.display !== 'none' && iframeElement.src.includes('youtube.com')) {
            try {
                iframeElement.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                console.log('YouTube video paused');
            } catch (e) {
                console.log('YouTube pause failed:', e.message);
            }
        }
    }

    // Resume media playback  
    resumeMedia() {
        const videoElement = document.getElementById('question-video');
        const iframeElement = document.getElementById('question-iframe');
        
        // Resume HTML5 video
        if (videoElement && videoElement.style.display !== 'none' && videoElement.paused) {
            videoElement.play().catch(e => {
                console.log('Video resume failed (may require user interaction):', e.message);
            });
            console.log('Video resumed');
        }
        
        // Resume YouTube video via postMessage
        if (iframeElement && iframeElement.style.display !== 'none' && iframeElement.src.includes('youtube.com')) {
            try {
                iframeElement.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                console.log('YouTube video resumed');
            } catch (e) {
                console.log('YouTube resume failed:', e.message);
            }
        }
    }

    // Media Lazy Loading Methods
    setupMediaObserver() {
        if (!('IntersectionObserver' in window)) {
            console.log('IntersectionObserver not supported, falling back to immediate loading');
            return;
        }

        this.mediaObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadMedia(entry.target);
                    this.mediaObserver.unobserve(entry.target);
                }
            });
        }, {
            rootMargin: '50px', // Start loading 50px before element enters viewport
            threshold: 0.1
        });
    }

    setupAnimationObserver() {
        if (!('IntersectionObserver' in window)) {
            console.log('IntersectionObserver not supported for animations, animations will play normally');
            return;
        }

        this.animationObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.animatedElements.has(entry.target)) {
                    this.triggerElementAnimation(entry.target);
                    this.animatedElements.add(entry.target);
                    // Keep observing to handle re-entry if needed
                }
            });
        }, {
            rootMargin: '100px', // Trigger animations 100px before entering viewport
            threshold: 0.1
        });
    }

    triggerElementAnimation(element) {
        // Add animation trigger class if element has animation capabilities
        if (element.classList.contains('ranked-team-item') ||
            element.classList.contains('buzzer-item') ||
            element.classList.contains('question-card')) {
            element.classList.add('animate-in');
        }
    }

    loadMedia(mediaElement) {
        const src = mediaElement.dataset.src;
        if (!src || this.loadedMedia.has(src)) {
            return;
        }

        this.loadedMedia.add(src);

        if (mediaElement.tagName === 'IMG') {
            mediaElement.src = src;
            mediaElement.classList.add('loaded');
        } else if (mediaElement.tagName === 'VIDEO') {
            mediaElement.src = src;
            mediaElement.load();
            mediaElement.classList.add('loaded');
        } else if (mediaElement.tagName === 'IFRAME') {
            mediaElement.src = src;
            mediaElement.classList.add('loaded');
        }
    }

    observeMedia(mediaElement) {
        if (this.mediaObserver && mediaElement) {
            this.mediaObserver.observe(mediaElement);
        } else {
            // Fallback: load immediately
            this.loadMedia(mediaElement);
        }
    }

    unloadMedia() {
        // Clear loaded media cache when switching questions
        this.loadedMedia.clear();

        // Pause and clean up any playing videos
        const videos = this.elements.questionMedia?.querySelectorAll('video');
        if (videos) {
            videos.forEach(video => {
                video.pause();
                video.currentTime = 0;
                video.src = ''; // Clear source to free memory
                video.load(); // Reset video element
            });
        }

        // Clean up images
        const images = this.elements.questionMedia?.querySelectorAll('img');
        if (images) {
            images.forEach(img => {
                img.src = ''; // Clear source to free memory
            });
        }

        // Clean up iframes
        const iframes = this.elements.questionMedia?.querySelectorAll('iframe');
        if (iframes) {
            iframes.forEach(iframe => {
                iframe.src = 'about:blank'; // Clear source safely
            });
        }
    }

    // Memory Management Methods
    addTrackedTimer(timerId) {
        this.timers.add(timerId);
    }

    clearTrackedTimer(timerId) {
        if (this.timers.has(timerId)) {
            clearTimeout(timerId);
            clearInterval(timerId);
            this.timers.delete(timerId);
        }
    }

    clearAllTimers() {
        this.timers.forEach(timerId => {
            clearTimeout(timerId);
            clearInterval(timerId);
        });
        this.timers.clear();

        // Clear animation frames
        if (this.timerAnimationFrame) {
            cancelAnimationFrame(this.timerAnimationFrame);
            this.timerAnimationFrame = null;
        }
    }

    cleanup() {
        // Clear all tracked resources
        this.clearAllTimers();

        // Disconnect intersection observers
        if (this.mediaObserver) {
            this.mediaObserver.disconnect();
            this.mediaObserver = null;
        }

        if (this.animationObserver) {
            this.animationObserver.disconnect();
            this.animationObserver = null;
        }

        // Clear media cache
        this.unloadMedia();

        // Clear caches
        this.loadedMedia.clear();
        this.teamNames.clear();
        this.animatedElements = new WeakSet(); // Reset animation tracking

        // Disconnect socket listeners
        if (this.socket) {
            this.socket.removeAllListeners();
        }

        console.log('GameDisplay cleanup completed');
    }
}

// Initialize the display when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.gameDisplay = new GameDisplay();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.gameDisplay && typeof window.gameDisplay.cleanup === 'function') {
        window.gameDisplay.cleanup();
    }
});

// Handle visibility change to pause/resume media
document.addEventListener('visibilitychange', () => {
    if (window.gameDisplay) {
        if (document.hidden) {
            // Page is hidden, pause media
            window.gameDisplay.unloadMedia();
        } else {
            // Page is visible again, can resume if needed
            console.log('Page became visible again');
        }
    }
});