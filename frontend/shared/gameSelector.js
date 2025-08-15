/**
 * Global Game Selection Manager
 * Handles game selection state across all frontend applications
 */

class GlobalGameSelector {
    constructor(options = {}) {
        this.socket = options.socket || (typeof io !== 'undefined' ? io() : null);
        this.currentGame = null;
        this.games = [];
        this.callbacks = {
            gameChanged: [],
            gamesLoaded: []
        };
        
        this.containerSelector = options.containerSelector || '#game-selector-container';
        this.showIfNoGame = options.showIfNoGame !== false; // Default to true
        this.allowGameChange = options.allowGameChange !== false; // Default to true
        
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.loadAvailableGames();
        this.checkCurrentGame();
        
        if (this.showIfNoGame) {
            this.createGameSelectorUI();
        }
    }

    setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('global-game-status', (status) => {
            this.handleGlobalGameUpdate(status);
        });

        this.socket.on('global-game-changed', (data) => {
            this.handleGlobalGameUpdate(data);
        });
    }

    async loadAvailableGames() {
        try {
            const response = await fetch('/api/games');
            this.games = await response.json();
            this.triggerCallback('gamesLoaded', this.games);
            this.updateGameSelectorUI();
        } catch (error) {
            console.error('Failed to load games:', error);
        }
    }

    async checkCurrentGame() {
        try {
            const response = await fetch('/api/games/global/current');
            const status = await response.json();
            this.handleGlobalGameUpdate(status);
        } catch (error) {
            console.error('Failed to check current game:', error);
        }
    }

    handleGlobalGameUpdate(status) {
        const previousGame = this.currentGame;
        this.currentGame = status.gameId ? status.game : null;
        
        if (previousGame?.id !== this.currentGame?.id) {
            this.triggerCallback('gameChanged', this.currentGame);
            this.updateGameSelectorUI();
        }
    }

    async setCurrentGame(gameId) {
        if (!this.allowGameChange) return false;
        
        try {
            const response = await fetch(`/api/games/global/set/${gameId}`, {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Game selected successfully', 'success');
                return true;
            } else {
                this.showToast('Failed to select game', 'error');
                return false;
            }
        } catch (error) {
            console.error('Failed to set current game:', error);
            this.showToast('Failed to select game', 'error');
            return false;
        }
    }

    async clearCurrentGame() {
        if (!this.allowGameChange) return false;
        
        try {
            const response = await fetch('/api/games/global/clear', {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Game cleared successfully', 'success');
                return true;
            } else {
                this.showToast('Failed to clear game', 'error');
                return false;
            }
        } catch (error) {
            console.error('Failed to clear current game:', error);
            this.showToast('Failed to clear game', 'error');
            return false;
        }
    }

    createGameSelectorUI() {
        const container = document.querySelector(this.containerSelector);
        if (!container) {
            console.warn(`Game selector container not found: ${this.containerSelector}`);
            return;
        }

        container.innerHTML = `
            <div id="game-selector-modal" class="game-selector-modal ${this.currentGame ? 'hidden' : ''}">
                <div class="game-selector-content">
                    <div class="game-selector-header">
                        <h2>🎮 Select Current Game</h2>
                        <p>Choose which game to load across all trivia interfaces</p>
                    </div>
                    <div class="game-selector-body">
                        <div id="game-selector-list" class="game-selector-list">
                            <div class="loading">Loading games...</div>
                        </div>
                    </div>
                    ${this.currentGame ? `
                        <div class="game-selector-actions">
                            <button id="close-game-selector" class="btn btn-secondary">Cancel</button>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div id="current-game-indicator" class="current-game-indicator ${this.currentGame ? '' : 'hidden'}">
                <div class="current-game-info">
                    <span class="current-game-label">Current Game:</span>
                    <strong id="current-game-name">${this.currentGame?.name || 'No Game Selected'}</strong>
                </div>
                ${this.allowGameChange ? `
                    <button id="change-game-btn" class="btn btn-small btn-secondary">Change Game</button>
                ` : ''}
            </div>
        `;

        this.setupGameSelectorEvents();
        this.updateGameSelectorUI();
    }

    setupGameSelectorEvents() {
        const modal = document.getElementById('game-selector-modal');
        const changeBtn = document.getElementById('change-game-btn');
        const closeBtn = document.getElementById('close-game-selector');

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                modal?.classList.remove('hidden');
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal?.classList.add('hidden');
            });
        }
    }

    updateGameSelectorUI() {
        const list = document.getElementById('game-selector-list');
        const currentNameEl = document.getElementById('current-game-name');
        const indicator = document.getElementById('current-game-indicator');
        const modal = document.getElementById('game-selector-modal');

        if (currentNameEl) {
            currentNameEl.textContent = this.currentGame?.name || 'No Game Selected';
        }

        if (indicator) {
            indicator.classList.toggle('hidden', !this.currentGame);
        }

        if (modal && this.currentGame && this.showIfNoGame) {
            modal.classList.add('hidden');
        }

        if (list && this.games.length > 0) {
            list.innerHTML = this.games.map(game => `
                <div class="game-selector-item ${this.currentGame?.id === game.id ? 'selected' : ''}"
                     data-game-id="${game.id}">
                    <div class="game-selector-item-content">
                        <h3>${game.name}</h3>
                        <div class="game-meta">
                            <span class="team-count">Teams: ${game.groups?.length || 0}</span>
                            <span class="question-count">Questions: ${game.questions?.length || 0}</span>
                        </div>
                    </div>
                    <div class="game-selector-item-actions">
                        ${this.currentGame?.id === game.id ? 
                            '<span class="current-badge">Current</span>' : 
                            '<button class="btn btn-primary btn-small select-game-btn">Select</button>'
                        }
                    </div>
                </div>
            `).join('');

            // Add click handlers
            list.querySelectorAll('.select-game-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = btn.closest('.game-selector-item');
                    const gameId = item.dataset.gameId;
                    this.setCurrentGame(gameId);
                });
            });
        }
    }

    // Event system
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }

    off(event, callback) {
        if (this.callbacks[event]) {
            const index = this.callbacks[event].indexOf(callback);
            if (index > -1) {
                this.callbacks[event].splice(index, 1);
            }
        }
    }

    triggerCallback(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in ${event} callback:`, error);
                }
            });
        }
    }

    // Utility methods
    getCurrentGame() {
        return this.currentGame;
    }

    getGames() {
        return this.games;
    }

    hasCurrentGame() {
        return !!this.currentGame;
    }

    showToast(message, type = 'info') {
        // Try to use existing toast system or create simple toast
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Export for use in different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GlobalGameSelector;
} else if (typeof window !== 'undefined') {
    window.GlobalGameSelector = GlobalGameSelector;
}