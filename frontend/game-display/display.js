class GameDisplay {
    constructor() {
        this.socket = io();
        this.currentGame = null;
        this.currentQuestion = null;
        this.questionTimer = null;
        this.timeRemaining = 0;
        this.buzzerOrder = [];
        this.gameSelector = null;
        
        this.initializeGameSelector();
        this.initializeElements();
        this.setupSocketListeners();
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
        console.log('Game changed in display:', game);
        
        if (game) {
            // Update team names mapping
            if (game.groups) {
                game.groups.forEach(team => {
                    this.teamNames.set(team.id, team.name);
                });
            }

            // Handle the game state
            this.handleGameState(game);
            
            // Join game room
            this.socket.emit('join-game', game.id);
            this.socket.emit('join-display');
        } else {
            // Clear game data and show waiting screen
            this.currentGame = null;
            this.teamNames.clear();
            this.showWaitingScreen('No game selected. Please select a game to continue.');
        }
    }

    onGamesLoaded(games) {
        console.log('Games loaded in display:', games.length);
    }

    initializeElements() {
        this.elements = {
            gameTitle: document.getElementById('game-title'),
            gameStatus: document.getElementById('game-status'),
            questionCounter: document.getElementById('question-counter'),
            questionSection: document.getElementById('question-section'),
            questionText: document.getElementById('question-text'),
            questionMedia: document.getElementById('question-media'),
            timerText: document.getElementById('timer-text'),
            timerCircle: document.querySelector('.timer-circle'),
            timer: document.getElementById('question-timer'),
            
            // Current answerer display elements
            currentAnswererDisplay: document.getElementById('current-answerer-display'),
            currentAnswererPosition: document.getElementById('current-answerer-position'),
            currentAnswererName: document.getElementById('current-answerer-name'),
            currentAnswererTime: document.getElementById('current-answerer-time'),
            currentAnswererStatus: document.getElementById('current-answerer-status'),
            
            buzzerResults: document.getElementById('buzzer-results'),
            buzzerList: document.getElementById('buzzer-list'),
            answerSection: document.getElementById('answer-section'),
            answerText: document.getElementById('answer-text'),
            teamsList: document.getElementById('teams-list'),
            waitingScreen: document.getElementById('waiting-screen'),
            messageOverlay: document.getElementById('message-overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlayMessage: document.getElementById('overlay-message')
        };
        
        // Initialize team name mapping
        this.teamNames = new Map();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateStatus('Connected');
            this.socket.emit('join-display');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateStatus('Disconnected');
        });

        this.socket.on('game-state', (state) => {
            this.handleGameState(state);
        });

        this.socket.on('question-start', (data) => {
            this.handleQuestionStart(data);
        });

        this.socket.on('question-end', (data) => {
            this.handleQuestionEnd(data);
        });

        this.socket.on('buzzer-pressed', (data) => {
            this.handleBuzzerPress(data);
        });

        this.socket.on('score-update', (data) => {
            this.handleScoreUpdate(data);
        });

        this.socket.on('game-status', (data) => {
            this.updateGameStatus(data.status);
        });

        this.socket.on('game-reset', () => {
            this.resetDisplay();
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

    // Game connection is now handled by the global game selector

    handleGameState(state) {
        if (!state) {
            this.showWaitingScreen('No game data available');
            return;
        }

        this.elements.gameTitle.textContent = state.name || 'Trivia Game';
        this.updateGameStatus(state.status);
        this.updateQuestionCounter(state.current_question_index || 0, state.questions?.length || 0);
        this.updateTeamsList(state.groups || []);
        
        // Update team names mapping
        if (state.groups) {
            state.groups.forEach(team => {
                this.teamNames.set(team.id, team.name);
            });
        }

        // Determine whether to show waiting screen based on game state
        const hasQuestions = state.questions && state.questions.length > 0;
        const hasTeams = state.groups && state.groups.length > 0;
        const isGameSetup = hasQuestions && hasTeams;

        if (state.status === 'setup' || state.status === 'waiting') {
            this.showWaitingScreen('Game is being set up...');
        } else if (!isGameSetup) {
            this.showWaitingScreen('Waiting for questions and teams to be configured...');
        } else {
            this.hideWaitingScreen();
        }

        if (state.activeQuestion) {
            this.handleActiveQuestion(state.activeQuestion);
        }
    }

    handleQuestionStart(data) {
        this.currentQuestion = data.question;
        this.timeRemaining = data.question.time_limit;
        this.questionStartTime = data.startTime;
        this.buzzerOrder = [];

        this.hideWaitingScreen(); // Ensure waiting screen is hidden when question starts
        this.hideAllSections();
        this.hideCurrentAnswererDisplay();
        
        // Add smooth reveal animation
        this.elements.questionSection.classList.remove('hidden');
        this.elements.questionSection.classList.add('animate-fade-in');
        
        this.elements.questionText.textContent = data.question.text;
        
        if (data.question.media_url) {
            this.showQuestionMedia(data.question.media_url);
        } else {
            this.elements.questionMedia.classList.add('hidden');
        }

        this.startLiveTimer();
        this.updateQuestionCounter(data.questionIndex + 1, this.getTotalQuestions());
        this.updateGameStatus('Question Active');
    }

    handleQuestionEnd(data) {
        this.stopTimer();
        this.buzzerOrder = data.buzzerOrder || [];
        this.showBuzzerResults();
        this.updateGameStatus('Question Ended');
    }

    handleBuzzerPress(data) {
        this.buzzerOrder.push(data);
        this.updateBuzzerResults();
        
        if (this.buzzerOrder.length === 1) {
            this.showCurrentAnswererDisplay(data);
            this.showMessage('⚡ First Buzzer!', `${this.getTeamName(data.groupId)} buzzed in first!`, 2000);
            
            // Add visual feedback with screen flash effect
            document.body.style.background = 'linear-gradient(135deg, #FFD700 0%, #FF6B35 100%)';
            setTimeout(() => {
                document.body.style.background = '';
            }, 200);
        }
    }

    handleScoreUpdate(data) {
        this.updateTeamScore(data.groupId, data.newScore);
        
        if (data.pointsAwarded > 0) {
            this.showMessage('🎉 Points Awarded!', `+${data.pointsAwarded} points to ${this.getTeamName(data.groupId)}!`, 3000);
            
            // Create floating points animation
            this.createFloatingPointsAnimation(data.groupId, data.pointsAwarded);
        }
    }

    handleActiveQuestion(activeQuestion) {
        if (activeQuestion.timeRemaining > 0) {
            this.timeRemaining = Math.ceil(activeQuestion.timeRemaining / 1000);
            this.buzzerOrder = activeQuestion.buzzerOrder || [];
            this.startTimer();
        }
    }

    startTimer() {
        this.stopTimer();
        
        const totalTime = this.currentQuestion?.time_limit || 30;
        const timerElement = document.querySelector('.timer');
        
        this.questionTimer = setInterval(() => {
            this.timeRemaining--;
            this.elements.timerText.textContent = this.timeRemaining;
            
            const progress = (this.timeRemaining / totalTime) * 360;
            this.elements.timerCircle.style.setProperty('--progress', `${progress}deg`);
            
            // Add warning and danger states with smooth transitions
            timerElement.classList.remove('warning', 'danger');
            if (this.timeRemaining <= 5) {
                timerElement.classList.add('danger');
            } else if (this.timeRemaining <= 10) {
                timerElement.classList.add('warning');
            }
            
            if (this.timeRemaining <= 0) {
                this.stopTimer();
            }
        }, 1000);
        
        // Add entrance animation to question section
        if (this.elements.questionSection) {
            this.elements.questionSection.classList.add('animate-in');
            setTimeout(() => {
                this.elements.questionSection.classList.remove('animate-in');
            }, 500);
        }
    }

    stopTimer() {
        if (this.questionTimer) {
            clearInterval(this.questionTimer);
            this.questionTimer = null;
        }
    }

    showBuzzerResults() {
        this.elements.buzzerResults.classList.remove('hidden');
        this.elements.buzzerResults.classList.add('animate-slide-up');
        this.updateBuzzerResults();
        
        // Remove animation class after completion
        setTimeout(() => {
            this.elements.buzzerResults.classList.remove('animate-slide-up');
        }, 350);
    }

    updateBuzzerResults() {
        const buzzerList = this.elements.buzzerList;
        buzzerList.innerHTML = '';

        this.buzzerOrder.forEach((buzzer, index) => {
            const buzzerItem = document.createElement('div');
            buzzerItem.className = 'buzzer-item';
            
            const teamName = this.getTeamName(buzzer.groupId);
            const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
            
            buzzerItem.innerHTML = `
                <div class="buzzer-position">${index + 1}</div>
                <span class="buzzer-team">${teamName}</span>
                <span class="buzzer-time">${deltaTime}s</span>
            `;
            
            buzzerList.appendChild(buzzerItem);
        });
    }

    showQuestionMedia(mediaUrl) {
        this.elements.questionMedia.innerHTML = '';
        
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif)$/i)) {
            const img = document.createElement('img');
            img.src = mediaUrl;
            img.alt = 'Question Image';
            this.elements.questionMedia.appendChild(img);
        } else if (mediaUrl.match(/\.(mp4|webm|ogg)$/i)) {
            const video = document.createElement('video');
            video.src = mediaUrl;
            video.controls = true;
            video.autoplay = true;
            video.muted = true;
            this.elements.questionMedia.appendChild(video);
        }
        
        this.elements.questionMedia.classList.remove('hidden');
    }

    updateTeamsList(teams) {
        const teamsList = this.elements.teamsList;
        teamsList.innerHTML = '';

        teams.sort((a, b) => b.score - a.score).forEach((team, index) => {
            const teamItem = document.createElement('div');
            teamItem.className = 'team-item';
            teamItem.style.setProperty('--team-color', team.color || '#6750A4');
            teamItem.dataset.teamId = team.id;
            
            teamItem.innerHTML = `
                <span class="team-name">${team.name}</span>
                <span class="team-score">${team.score}</span>
            `;
            
            // Enhanced leader styling with Material Design colors
            if (index === 0 && team.score > 0) {
                teamItem.style.background = 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)';
                teamItem.style.boxShadow = '0 8px 32px rgba(255, 215, 0, 0.4), 0 0 0 1px rgba(255, 215, 0, 0.1)';
                teamItem.style.transform = 'scale(1.05)';
                
                // Add crown emoji for leader
                const crownSpan = document.createElement('span');
                crownSpan.textContent = '👑';
                crownSpan.style.marginLeft = '8px';
                crownSpan.style.fontSize = '1.2em';
                teamItem.querySelector('.team-name').appendChild(crownSpan);
            }
            
            // Staggered entrance animations
            teamItem.style.animationDelay = `${index * 100}ms`;
            teamItem.classList.add('animate-fade-in');
            
            teamsList.appendChild(teamItem);
        });
    }

    updateTeamScore(groupId, newScore) {
        const teamItem = document.querySelector(`[data-team-id="${groupId}"]`);
        if (teamItem) {
            const scoreElement = teamItem.querySelector('.team-score');
            
            // Animate score change with bounce effect
            scoreElement.style.transform = 'scale(1.3)';
            scoreElement.style.color = 'var(--md-sys-color-primary)';
            
            setTimeout(() => {
                scoreElement.textContent = newScore;
                scoreElement.style.transform = 'scale(1)';
                scoreElement.style.color = '';
            }, 200);
            
            // Enhanced team item animation with elevation
            teamItem.style.transform = 'translateY(-8px) scale(1.02)';
            teamItem.style.boxShadow = 'var(--md-sys-elevation-level5)';
            teamItem.style.zIndex = '10';
            
            setTimeout(() => {
                teamItem.style.transform = '';
                teamItem.style.boxShadow = '';
                teamItem.style.zIndex = '';
            }, 600);
        }
    }

    getTeamName(groupId) {
        const teamItem = document.querySelector(`[data-team-id="${groupId}"]`);
        return teamItem ? teamItem.querySelector('.team-name').textContent : 'Unknown Team';
    }

    updateStatus(status) {
        this.elements.gameStatus.textContent = status;
    }

    updateGameStatus(status) {
        const statusText = {
            'setup': 'Setting Up',
            'question_active': 'Question Active',
            'question_ended': 'Question Ended',
            'game_over': 'Game Over'
        }[status] || status;
        
        this.updateStatus(statusText);
    }

    updateQuestionCounter(current, total) {
        this.elements.questionCounter.textContent = `Question ${current} of ${total}`;
    }

    getTotalQuestions() {
        return document.querySelectorAll('.team-item').length || 0;
    }

    showWaitingScreen(message) {
        if (message) {
            const waitingContent = this.elements.waitingScreen.querySelector('.waiting-content p');
            waitingContent.textContent = message;
        }
        this.elements.waitingScreen.classList.remove('hidden');
    }

    hideWaitingScreen() {
        this.elements.waitingScreen.classList.add('hidden');
    }

    showMessage(title, message, duration = 3000) {
        this.elements.overlayTitle.textContent = title;
        this.elements.overlayMessage.textContent = message;
        this.elements.messageOverlay.classList.remove('hidden');
        
        // Add entrance animation
        const messageContent = this.elements.messageOverlay.querySelector('.message-content');
        if (messageContent) {
            messageContent.style.animation = 'none';
            setTimeout(() => {
                messageContent.style.animation = 'bounceIn var(--md-sys-motion-duration-long1) var(--md-sys-motion-easing-emphasized)';
            }, 10);
        }
        
        setTimeout(() => {
            this.elements.messageOverlay.classList.add('hidden');
        }, duration);
    }

    hideAllSections() {
        this.elements.questionSection.classList.add('hidden');
        this.elements.buzzerResults.classList.add('hidden');
        this.elements.answerSection.classList.add('hidden');
    }

    createFloatingPointsAnimation(groupId, points) {
        const teamItem = document.querySelector(`[data-team-id="${groupId}"]`);
        if (!teamItem) return;
        
        const floatingElement = document.createElement('div');
        floatingElement.textContent = `+${points}`;
        floatingElement.style.cssText = `
            position: absolute;
            color: var(--md-sys-color-primary);
            font-weight: 700;
            font-size: 1.5em;
            pointer-events: none;
            z-index: 1000;
            animation: floatUp 2s ease-out forwards;
        `;
        
        const rect = teamItem.getBoundingClientRect();
        floatingElement.style.left = `${rect.left + rect.width / 2}px`;
        floatingElement.style.top = `${rect.top}px`;
        
        document.body.appendChild(floatingElement);
        
        // Add floating animation keyframes if not already present
        if (!document.querySelector('#floating-points-keyframes')) {
            const style = document.createElement('style');
            style.id = 'floating-points-keyframes';
            style.textContent = `
                @keyframes floatUp {
                    0% {
                        opacity: 1;
                        transform: translateY(0px) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translateY(-100px) scale(1.5);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        setTimeout(() => {
            floatingElement.remove();
        }, 2000);
    }

    resetDisplay() {
        this.hideAllSections();
        this.stopTimer();
        this.buzzerOrder = [];
        this.currentQuestion = null;
        
        // Reset timer classes
        const timerElement = document.querySelector('.timer');
        if (timerElement) {
            timerElement.classList.remove('warning', 'danger');
        }
        
        this.showWaitingScreen('🔄 Game has been reset');
    }

    // Live Timer Methods
    startLiveTimer() {
        if (!this.questionStartTime || !this.currentQuestion) return;

        this.stopTimer(); // Clear any existing timer
        
        const totalTime = this.currentQuestion.time_limit;
        
        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - this.questionStartTime) / 1000);
            const remaining = Math.max(0, totalTime - elapsed);
            
            this.elements.timerText.textContent = remaining;
            
            // Update progress indicator
            const progress = Math.min(100, (elapsed / totalTime) * 100);
            if (this.elements.timerCircle) {
                this.elements.timerCircle.style.setProperty('--timer-progress', `${progress}%`);
            }
            
            // Change style based on remaining time
            if (this.elements.timer) {
                this.elements.timer.classList.remove('warning', 'danger', 'critical');
                if (remaining <= 5) {
                    this.elements.timer.classList.add('critical');
                } else if (remaining <= 10) {
                    this.elements.timer.classList.add('warning');
                }
            }
            
            if (remaining <= 0) {
                this.stopTimer();
            }
        };
        
        updateTimer();
        this.questionTimer = setInterval(updateTimer, 1000);
    }

    // Current Answerer Display Methods
    showCurrentAnswererDisplay(buzzerData) {
        if (!this.elements.currentAnswererDisplay || !buzzerData) return;

        const teamName = this.getTeamName(buzzerData.groupId);
        const deltaTime = (buzzerData.deltaMs / 1000).toFixed(2);
        const position = this.buzzerOrder.findIndex(b => b.groupId === buzzerData.groupId) + 1;
        const positionText = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`;

        // Update display elements
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

        // Show the display
        this.elements.currentAnswererDisplay.classList.remove('hidden', 'correct', 'incorrect');
        this.elements.currentAnswererDisplay.classList.add('animate-slide-up');
    }

    hideCurrentAnswererDisplay() {
        if (this.elements.currentAnswererDisplay) {
            this.elements.currentAnswererDisplay.classList.add('hidden');
            this.elements.currentAnswererDisplay.classList.remove('correct', 'incorrect');
        }
    }

    showAnswerFeedback(isCorrect, teamName) {
        if (!this.elements.currentAnswererDisplay) return;

        const statusText = this.elements.currentAnswererStatus?.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = isCorrect ? 'CORRECT! ✅' : 'INCORRECT ❌';
            statusText.style.fontSize = '1.2rem';
            statusText.style.fontWeight = '700';
        }

        // Add result class
        this.elements.currentAnswererDisplay.classList.remove('correct', 'incorrect');
        this.elements.currentAnswererDisplay.classList.add(isCorrect ? 'correct' : 'incorrect');

        // Show full-screen feedback message
        const resultMessage = isCorrect ? 
            `🎉 ${teamName} is CORRECT!` : 
            `❌ ${teamName} is incorrect...`;
        
        this.showMessage(isCorrect ? 'Correct!' : 'Incorrect!', resultMessage, 3000);

        // Hide after 4 seconds
        setTimeout(() => {
            this.hideCurrentAnswererDisplay();
        }, 4000);
    }

    // Enhanced Buzzer Results Display
    updateBuzzerResults() {
        if (this.buzzerOrder.length === 0) {
            this.elements.buzzerResults.classList.add('hidden');
            return;
        }

        this.elements.buzzerResults.classList.remove('hidden');
        this.elements.buzzerList.innerHTML = '';

        this.buzzerOrder.forEach((buzzer, index) => {
            const buzzerItem = document.createElement('div');
            buzzerItem.className = 'buzzer-item';
            
            const teamName = this.getTeamName(buzzer.groupId);
            const deltaTime = (buzzer.deltaMs / 1000).toFixed(2);
            
            // Add evaluation status if available
            let statusElement = '';
            if (buzzer.evaluated) {
                const statusClass = buzzer.isCorrect ? 'evaluated-correct' : 'evaluated-incorrect';
                buzzerItem.classList.add(statusClass);
                
                if (buzzer.pointsAwarded !== undefined) {
                    if (buzzer.pointsAwarded > 0) {
                        statusElement = `<div class="buzzer-status"><span class="points-awarded">+${buzzer.pointsAwarded}</span></div>`;
                    } else if (buzzer.pointsAwarded < 0) {
                        statusElement = `<div class="buzzer-status"><span class="points-deducted">${buzzer.pointsAwarded}</span></div>`;
                    }
                }
            } else {
                statusElement = '<div class="buzzer-status"><span class="waiting-evaluation">Waiting...</span></div>';
            }
            
            buzzerItem.innerHTML = `
                <div class="buzzer-rank">${index + 1}</div>
                <div class="buzzer-info">
                    <div class="buzzer-team">
                        ${teamName}
                        ${buzzer.evaluated ? (buzzer.isCorrect ? ' ✅' : ' ❌') : ''}
                    </div>
                    <div class="buzzer-time">${deltaTime}s</div>
                </div>
                ${statusElement}
            `;
            
            this.elements.buzzerList.appendChild(buzzerItem);
        });
    }

    // Answer Evaluation Event Handlers
    handleAnswerEvaluated(data) {
        const teamName = this.getTeamName(data.groupId);
        
        // Show visual feedback for the current answerer
        this.showAnswerFeedback(data.isCorrect, teamName);
        
        // Update the buzzer order with evaluation results
        const buzzerIndex = this.buzzerOrder.findIndex(b => b.groupId === data.groupId);
        if (buzzerIndex !== -1) {
            this.buzzerOrder[buzzerIndex].evaluated = true;
            this.buzzerOrder[buzzerIndex].isCorrect = data.isCorrect;
            this.buzzerOrder[buzzerIndex].pointsAwarded = data.pointsAwarded;
        }
        
        // Update buzzer results display
        this.updateBuzzerResults();
        
        // Show next answerer if available and answer was incorrect
        if (!data.isCorrect && data.nextInLine) {
            setTimeout(() => {
                this.showCurrentAnswererDisplay(data.nextInLine);
            }, 3000);
        }
    }

    handleQuestionPrepared(data) {
        this.showMessage('📝 Next Question Ready', `Question ${data.nextQuestionIndex + 1}: ${data.question.text.substring(0, 60)}...`, 4000);
        this.hideCurrentAnswererDisplay();
    }

    handleGameCompleted(data) {
        this.hideCurrentAnswererDisplay();
        this.stopTimer();
        
        // Find the winner
        const winner = data.finalScores && data.finalScores.length > 0 ? data.finalScores[0] : null;
        const winnerMessage = winner ? `🏆 ${winner.name} wins with ${winner.score} points!` : 'Game completed!';
        
        this.showMessage('🎉 Game Over!', winnerMessage, 8000);
        
        // Update final scores
        this.updateTeamsList(data.finalScores || []);
    }

    // Helper method to get team name
    getTeamName(groupId) {
        return this.teamNames.get(groupId) || `Team ${groupId.substring(0, 8)}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new GameDisplay();
});