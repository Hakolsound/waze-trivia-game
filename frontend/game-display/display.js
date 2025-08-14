class GameDisplay {
    constructor() {
        this.socket = io();
        this.gameId = null;
        this.currentQuestion = null;
        this.questionTimer = null;
        this.timeRemaining = 0;
        this.buzzerOrder = [];
        
        this.initializeElements();
        this.setupSocketListeners();
        this.connectToGame();
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
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateStatus('Connected');
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
    }

    async connectToGame() {
        try {
            const response = await fetch('/api/games');
            const games = await response.json();
            
            if (games.length > 0) {
                this.gameId = games[0].id;
                this.socket.emit('join-game', this.gameId);
                
                const gameResponse = await fetch(`/api/games/${this.gameId}/state`);
                const gameState = await gameResponse.json();
                
                // If game has questions and teams, hide waiting screen
                if (gameState && (gameState.questions?.length > 0 || gameState.groups?.length > 0)) {
                    this.hideWaitingScreen();
                }
                
                this.handleGameState(gameState);
            } else {
                this.showWaitingScreen('No games available');
            }
        } catch (error) {
            console.error('Failed to connect to game:', error);
            this.showWaitingScreen('Connection failed');
        }
    }

    handleGameState(state) {
        if (!state) return;

        this.elements.gameTitle.textContent = state.name || 'Trivia Game';
        this.updateGameStatus(state.status);
        this.updateQuestionCounter(state.current_question_index, state.questions?.length || 0);
        this.updateTeamsList(state.groups || []);

        if (state.status === 'setup' || state.status === 'waiting') {
            this.showWaitingScreen('Game is being set up...');
        } else if (state.status === 'active' || state.status === 'in_progress' || state.questions?.length > 0) {
            this.hideWaitingScreen();
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
        this.buzzerOrder = [];

        this.hideWaitingScreen(); // Ensure waiting screen is hidden when question starts
        this.hideAllSections();
        
        // Add smooth reveal animation
        this.elements.questionSection.classList.remove('hidden');
        this.elements.questionSection.classList.add('animate-fade-in');
        
        this.elements.questionText.textContent = data.question.text;
        
        if (data.question.media_url) {
            this.showQuestionMedia(data.question.media_url);
        } else {
            this.elements.questionMedia.classList.add('hidden');
        }

        this.startTimer();
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
}

document.addEventListener('DOMContentLoaded', () => {
    new GameDisplay();
});