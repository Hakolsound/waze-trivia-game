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
                        <button id="close-game-selector-x" class="game-selector-close" title="Close (Esc)">×</button>
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
        const closeXBtn = document.getElementById('close-game-selector-x');

        const closeModal = () => {
            modal?.classList.add('hidden');
        };

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                modal?.classList.remove('hidden');
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        if (closeXBtn) {
            closeXBtn.addEventListener('click', closeModal);
        }

        // Add escape key functionality
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
                closeModal();
                e.preventDefault();
            }
        });

        // Close modal when clicking outside
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
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

        if (list) {
            // Add create new game button
            let createGameHTML = `
                <div class="game-selector-create-new">
                    <button id="create-new-game-btn" class="btn btn-success game-selector-create-btn">
                        <span class="create-icon">➕</span>
                        <span class="create-text">Create New Game</span>
                    </button>
                </div>
            `;
            
            if (this.games.length > 0) {
                list.innerHTML = createGameHTML + '<div class="games-divider"><span>Or select existing game:</span></div>' + this.games.map(game => `
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
                        <div class="action-buttons">
                            ${this.currentGame?.id === game.id ? 
                                '<span class="current-badge">Current</span>' : 
                                '<button class="btn btn-primary btn-small select-game-btn">Select</button>'
                            }
                            <button class="btn btn-danger btn-small delete-game-btn" title="Delete Game">🗑️</button>
                        </div>
                    </div>
                </div>
            `).join('');
            } else {
                list.innerHTML = createGameHTML + '<div class="no-games-message">No games found. Create your first game to get started!</div>';
            }
            
            // Add click handler for create new game button
            const createBtn = document.getElementById('create-new-game-btn');
            if (createBtn) {
                createBtn.addEventListener('click', () => {
                    this.showCreateGameModal();
                });
            }

            // Add click handlers for select buttons
            list.querySelectorAll('.select-game-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = btn.closest('.game-selector-item');
                    const gameId = item.dataset.gameId;
                    
                    if (this.currentGame) {
                        // Show confirmation if switching games
                        this.confirmGameSwitch(gameId);
                    } else {
                        this.setCurrentGame(gameId);
                    }
                });
            });

            // Add click handlers for delete buttons
            list.querySelectorAll('.delete-game-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = btn.closest('.game-selector-item');
                    const gameId = item.dataset.gameId;
                    const gameName = this.games.find(g => g.id === gameId)?.name || 'Unknown Game';
                    
                    this.confirmGameDelete(gameId, gameName);
                });
            });
        }
    }

    confirmGameSwitch(newGameId) {
        const newGame = this.games.find(g => g.id === newGameId);
        const currentGameName = this.currentGame?.name || 'current game';
        const newGameName = newGame?.name || 'selected game';
        
        if (confirm(`⚠️ Switch from "${currentGameName}" to "${newGameName}"?\n\nThis will change the current game for all interfaces (Admin, Host Control, and Game Display).\n\nAny unsaved changes will be lost.`)) {
            this.setCurrentGame(newGameId);
        }
    }

    confirmGameDelete(gameId, gameName) {
        const isCurrentGame = this.currentGame?.id === gameId;
        const warningMessage = isCurrentGame 
            ? `🚨 DELETE CURRENT GAME: "${gameName}"?\n\n⚠️ WARNING: This game is currently active!\n\n❌ This will PERMANENTLY DELETE:\n• All teams and their scores\n• All questions and answers\n• All game history and statistics\n• Game branding and settings\n\n💥 THIS ACTION CANNOT BE UNDONE!\n\nType the game name to confirm deletion:`
            : `🗑️ DELETE GAME: "${gameName}"?\n\n❌ This will PERMANENTLY DELETE:\n• All teams and their scores\n• All questions and answers\n• All game history and statistics\n• Game branding and settings\n\n💥 THIS ACTION CANNOT BE UNDONE!\n\nType the game name to confirm deletion:`;
        
        const confirmation = prompt(warningMessage);
        
        if (confirmation === gameName) {
            this.deleteGame(gameId, isCurrentGame);
        } else if (confirmation !== null) {
            alert('❌ Game name does not match. Deletion cancelled for safety.');
        }
    }

    async deleteGame(gameId, isCurrentGame) {
        try {
            const response = await fetch(`/api/games/${gameId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showToast('Game deleted successfully', 'success');
                
                // If we deleted the current game, clear the current selection
                if (isCurrentGame) {
                    await this.clearCurrentGame();
                }
                
                // Reload the games list
                await this.loadAvailableGames();
                
                // Show the game selector if no game is selected
                if (!this.currentGame) {
                    const modal = document.getElementById('game-selector-modal');
                    if (modal) {
                        modal.classList.remove('hidden');
                    }
                }
            } else {
                this.showToast('Failed to delete game', 'error');
            }
        } catch (error) {
            console.error('Failed to delete game:', error);
            this.showToast('Failed to delete game', 'error');
        }
    }

    // Method to force show the game selector (used by admin interface)
    showGameSelector() {
        const modal = document.getElementById('game-selector-modal');
        if (modal) {
            modal.classList.remove('hidden');
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
    
    showCreateGameModal() {
        // Create modal HTML
        const modalHTML = `
            <div id="create-game-modal" class="game-selector-modal">
                <div class="game-selector-content create-game-content">
                    <div class="game-selector-header">
                        <h2>🎮 Create New Game</h2>
                        <p>Set up a new trivia game</p>
                        <button id="close-create-game-modal" class="game-selector-close" title="Close (Esc)">×</button>
                    </div>
                    <div class="game-selector-body">
                        <form id="create-game-form" class="create-game-form">
                            <div class="form-group">
                                <label for="new-game-name">Game Name:</label>
                                <input type="text" id="new-game-name" class="form-input" placeholder="Enter game name..." required>
                            </div>
                            <div class="form-group">
                                <label for="new-game-description">Description (optional):</label>
                                <input type="text" id="new-game-description" class="form-input" placeholder="Brief description...">
                            </div>
                        </form>
                    </div>
                    <div class="game-selector-actions">
                        <button id="create-game-submit" class="btn btn-primary">Create Game</button>
                        <button id="cancel-create-game" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        const existingModal = document.getElementById('create-game-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Set up event listeners
        const modal = document.getElementById('create-game-modal');
        const form = document.getElementById('create-game-form');
        const nameInput = document.getElementById('new-game-name');
        const descInput = document.getElementById('new-game-description');
        const submitBtn = document.getElementById('create-game-submit');
        const cancelBtn = document.getElementById('cancel-create-game');
        const closeBtn = document.getElementById('close-create-game-modal');
        
        const closeModal = () => {
            modal.remove();
        };
        
        // Focus on name input
        nameInput.focus();
        
        // Event listeners
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        
        // Form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const gameName = nameInput.value.trim();
            const gameDescription = descInput.value.trim();
            
            if (!gameName) {
                this.showToast('Please enter a game name', 'error');
                return;
            }
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
            
            try {
                const success = await this.createNewGame(gameName, gameDescription);
                if (success) {
                    closeModal();
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Game';
            }
        });
        
        // Click submit button directly
        submitBtn.addEventListener('click', () => {
            form.dispatchEvent(new Event('submit'));
        });
        
        // ESC key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
    
    async createNewGame(name, description = '') {
        try {
            const response = await fetch('/api/games', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    description: description
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create game');
            }
            
            const newGame = await response.json();
            
            // Refresh games list
            await this.loadAvailableGames();
            
            // Auto-select the new game
            await this.setCurrentGame(newGame.id);
            
            this.showToast(`Game "${name}" created successfully!`, 'success');
            return true;
            
        } catch (error) {
            console.error('Failed to create game:', error);
            this.showToast('Failed to create game', 'error');
            return false;
        }
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