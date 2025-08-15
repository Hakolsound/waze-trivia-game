const { v4: uuidv4 } = require('uuid');

class GameService {
  constructor(database, io) {
    this.db = database;
    this.io = io;
    this.activeGames = new Map();
    this.currentGlobalGame = null; // Global current game for all frontend apps
    this.buzzerActivity = new Map(); // Track last activity for each buzzer
    this.onlineBuzzers = new Set(); // Track which buzzer IDs are currently online
  }

  async createGame(gameData) {
    const gameId = uuidv4();
    await this.db.run(
      'INSERT INTO games (id, name, status) VALUES (?, ?, ?)',
      [gameId, gameData.name, 'setup']
    );

    if (gameData.groups) {
      for (let i = 0; i < gameData.groups.length; i++) {
        const groupId = uuidv4();
        const group = gameData.groups[i];
        await this.db.run(
          'INSERT INTO groups (id, game_id, name, color, position, buzzer_id) VALUES (?, ?, ?, ?, ?, ?)',
          [groupId, gameId, group.name, group.color, i + 1, group.buzzer_id || `buzzer_${i + 1}`]
        );
      }
    }

    if (gameData.questions) {
      for (let i = 0; i < gameData.questions.length; i++) {
        const questionId = uuidv4();
        const question = gameData.questions[i];
        await this.db.run(
          'INSERT INTO questions (id, game_id, text, correct_answer, time_limit, points, question_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [questionId, gameId, question.text, question.correct_answer, question.time_limit || 30, question.points || 100, i + 1]
        );
      }
    }

    return this.getGame(gameId);
  }

  async getGame(gameId) {
    const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new Error('Game not found');

    const groups = await this.db.all('SELECT * FROM groups WHERE game_id = ? ORDER BY position', [gameId]);
    const questions = await this.db.all('SELECT * FROM questions WHERE game_id = ? ORDER BY question_order', [gameId]);

    return { ...game, groups, questions };
  }

  async getAllGames() {
    return await this.db.all('SELECT * FROM games ORDER BY created_at DESC');
  }

  async updateGameStatus(gameId, status) {
    await this.db.run(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, gameId]
    );

    this.io.to(`game-${gameId}`).emit('game-status', { gameId, status });
    return this.getGame(gameId);
  }

  async startQuestion(gameId, questionIndex) {
    const game = await this.getGame(gameId);
    if (questionIndex >= game.questions.length) {
      throw new Error('Question index out of bounds');
    }

    await this.db.run(
      'UPDATE games SET current_question_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [questionIndex, 'question_active', gameId]
    );

    const currentQuestion = game.questions[questionIndex];
    // Clear any existing timeout for this game
    const existingGameState = this.activeGames.get(gameId);
    if (existingGameState && existingGameState.timeoutId) {
      clearTimeout(existingGameState.timeoutId);
    }

    // Set up the new timeout
    const timeoutId = setTimeout(() => {
      this.endQuestion(gameId);
    }, currentQuestion.time_limit * 1000);

    this.activeGames.set(gameId, {
      questionId: currentQuestion.id,
      startTime: Date.now(),
      buzzerOrder: [],
      timeLimit: currentQuestion.time_limit * 1000,
      timeoutId: timeoutId
    });

    this.io.to(`game-${gameId}`).emit('question-start', {
      gameId,
      question: currentQuestion,
      questionIndex,
      startTime: Date.now()
    });

    // Arm buzzers for both host control and all game clients (including virtual buzzers)
    this.io.to('control-panel').emit('buzzers-armed', { gameId, questionId: currentQuestion.id });
    this.io.to(`game-${gameId}`).emit('buzzers-armed', { gameId, questionId: currentQuestion.id });

    // Timeout is now handled above in the activeGames setup

    return currentQuestion;
  }

  async endQuestion(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState) return;

    // Clear the timeout if it exists
    if (gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }

    await this.db.run(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['question_ended', gameId]
    );

    this.io.to(`game-${gameId}`).emit('question-end', {
      gameId,
      buzzerOrder: gameState.buzzerOrder
    });

    // Disarm buzzers for both host control and all game clients (including virtual buzzers)
    this.io.to('control-panel').emit('buzzers-disarmed', { gameId });
    this.io.to(`game-${gameId}`).emit('buzzers-disarmed', { gameId });

    // Remove the game state to prevent any lingering timers
    this.activeGames.delete(gameId);
  }

  async evaluateAnswer(gameId, isCorrect, buzzerPosition = 0) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState || !gameState.buzzerOrder.length) {
      throw new Error('No active question or buzzer presses found');
    }

    const game = await this.getGame(gameId);
    const currentQuestion = game.questions[game.current_question_index];
    
    if (!currentQuestion) {
      throw new Error('Current question not found');
    }

    // Get the buzzer entry at the specified position
    const buzzerEntry = gameState.buzzerOrder[buzzerPosition];
    if (!buzzerEntry) {
      throw new Error('Buzzer entry not found at position ' + buzzerPosition);
    }

    // Calculate points based on time-based scoring setting
    let pointsToAward;
    if (isCorrect) {
      if (game.time_based_scoring) {
        // Calculate time remaining when buzzer was pressed
        const timeElapsed = buzzerEntry.deltaMs;
        const timeRemaining = Math.max(0, currentQuestion.time_limit * 1000 - timeElapsed);
        pointsToAward = this.calculateTimeBasedPoints(currentQuestion.points, timeRemaining, currentQuestion.time_limit * 1000);
      } else {
        pointsToAward = currentQuestion.points;
      }
    } else {
      // Incorrect answers still lose half points regardless of time-based scoring
      pointsToAward = -Math.floor(currentQuestion.points * 0.5);
    }
    
    // Award or deduct points
    await this.awardPoints(gameId, buzzerEntry.groupId, pointsToAward);
    
    // Mark this buzzer entry as evaluated
    buzzerEntry.evaluated = true;
    buzzerEntry.isCorrect = isCorrect;
    buzzerEntry.pointsAwarded = pointsToAward;

    // Emit answer evaluation event
    this.io.to(`game-${gameId}`).emit('answer-evaluated', {
      gameId,
      groupId: buzzerEntry.groupId,
      isCorrect,
      pointsAwarded: pointsToAward,
      buzzerPosition,
      nextInLine: gameState.buzzerOrder.length > buzzerPosition + 1 ? gameState.buzzerOrder[buzzerPosition + 1] : null
    });

    this.io.to('control-panel').emit('answer-evaluated', {
      gameId,
      groupId: buzzerEntry.groupId,
      isCorrect,
      pointsAwarded: pointsToAward,
      buzzerPosition,
      remainingBuzzers: gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated),
      questionComplete: isCorrect || gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated).length === 0
    });

    // If answer is correct, end current question and prepare next one
    if (isCorrect) {
      await this.endQuestion(gameId);
      await this.prepareNextQuestion(gameId);
    }

    return {
      success: true,
      isCorrect,
      pointsAwarded: pointsToAward,
      nextInLine: gameState.buzzerOrder.length > buzzerPosition + 1 && !isCorrect,
      questionComplete: isCorrect || gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated).length === 0
    };
  }

  async prepareNextQuestion(gameId) {
    const game = await this.getGame(gameId);
    const nextQuestionIndex = game.current_question_index + 1;
    
    if (nextQuestionIndex < game.questions.length) {
      // Update current question index but don't start yet (host controls when to start)
      await this.db.run(
        'UPDATE games SET current_question_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [nextQuestionIndex, 'waiting_for_next', gameId]
      );
      
      this.io.to(`game-${gameId}`).emit('question-prepared', {
        gameId,
        nextQuestionIndex,
        question: game.questions[nextQuestionIndex],
        totalQuestions: game.questions.length
      });
      
      this.io.to('control-panel').emit('question-prepared', {
        gameId,
        nextQuestionIndex,
        question: game.questions[nextQuestionIndex],
        totalQuestions: game.questions.length
      });
    } else {
      // Game completed
      await this.db.run(
        'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['game_over', gameId]
      );
      
      this.io.to(`game-${gameId}`).emit('game-completed', {
        gameId,
        finalScores: game.groups.sort((a, b) => b.score - a.score)
      });
      
      this.io.to('control-panel').emit('game-completed', {
        gameId,
        finalScores: game.groups.sort((a, b) => b.score - a.score)
      });
      
      // Clear the active game state only when game is completed
      this.activeGames.delete(gameId);
    }
    
    // Don't clear active game state here for normal question preparation
    // Game state should only be cleared when game is completed or question ends
  }

  async getNextInLineBuzzer(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState || !gameState.buzzerOrder.length) {
      return null;
    }

    // Find the first unevaluated buzzer entry
    const nextBuzzer = gameState.buzzerOrder.find(buzzer => !buzzer.evaluated);
    return nextBuzzer || null;
  }

  async getCurrentQuestionState(gameId) {
    const gameState = this.activeGames.get(gameId);
    const game = await this.getGame(gameId);
    
    if (!gameState) {
      return {
        hasActiveQuestion: false,
        currentQuestion: null,
        buzzerOrder: [],
        nextInLine: null
      };
    }

    const currentQuestion = game.questions[game.current_question_index];
    const nextInLine = this.getNextInLineBuzzer(gameId);
    
    return {
      hasActiveQuestion: true,
      currentQuestion,
      buzzerOrder: gameState.buzzerOrder,
      nextInLine: await nextInLine,
      timeRemaining: Math.max(0, gameState.timeLimit - (Date.now() - gameState.startTime))
    };
  }

  async handleBuzzerPress(data) {
    const { gameId, groupId, timestamp, buzzer_id, buzzerId } = data;
    const gameState = this.activeGames.get(gameId);
    
    if (!gameState) return;

    // Track buzzer activity for virtual buzzer availability
    const actualBuzzerId = buzzerId || buzzer_id || `physical_${groupId}`;
    this.updateBuzzerActivity(actualBuzzerId, groupId);

    const deltaMs = timestamp - gameState.startTime;
    const buzzerEntry = {
      groupId,
      buzzer_id,
      timestamp,
      deltaMs,
      position: gameState.buzzerOrder.length + 1
    };

    gameState.buzzerOrder.push(buzzerEntry);

    await this.db.run(
      'INSERT INTO buzzer_events (game_id, question_id, group_id, timestamp, delta_ms) VALUES (?, ?, ?, ?, ?)',
      [gameId, gameState.questionId, groupId, timestamp, deltaMs]
    );

    this.io.to(`game-${gameId}`).emit('buzzer-pressed', buzzerEntry);
    this.io.to('control-panel').emit('buzzer-pressed', buzzerEntry);
  }

  // Calculate time-based points (decreases linearly from max to 0)
  calculateTimeBasedPoints(originalPoints, timeRemaining, totalTime) {
    if (timeRemaining <= 0) return 0;
    if (timeRemaining >= totalTime) return originalPoints;
    
    // Linear decrease from original points to 0
    const ratio = timeRemaining / totalTime;
    return Math.ceil(originalPoints * ratio);
  }

  async awardPoints(gameId, groupId, points) {
    await this.db.run(
      'UPDATE groups SET score = score + ? WHERE id = ? AND game_id = ?',
      [points, groupId, gameId]
    );

    const group = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    
    this.io.to(`game-${gameId}`).emit('score-update', {
      groupId,
      newScore: group.score,
      pointsAwarded: points
    });

    return group;
  }

  async getGameState(gameId) {
    const game = await this.getGame(gameId);
    const gameState = this.activeGames.get(gameId);
    
    return {
      ...game,
      activeQuestion: gameState ? {
        questionId: gameState.questionId,
        startTime: gameState.startTime,
        buzzerOrder: gameState.buzzerOrder,
        timeRemaining: Math.max(0, gameState.timeLimit - (Date.now() - gameState.startTime))
      } : null
    };
  }

  async resetGame(gameId) {
    await this.db.run(
      'UPDATE games SET status = ?, current_question_index = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['setup', gameId]
    );

    await this.db.run(
      'UPDATE groups SET score = 0 WHERE game_id = ?',
      [gameId]
    );

    await this.db.run(
      'DELETE FROM buzzer_events WHERE game_id = ?',
      [gameId]
    );

    // Clear any running timers before deleting the game state
    const gameState = this.activeGames.get(gameId);
    if (gameState && gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }

    this.activeGames.delete(gameId);

    this.io.to(`game-${gameId}`).emit('game-reset', { gameId });
    
    return this.getGame(gameId);
  }

  // Branding methods
  async getGameBranding(gameId) {
    const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new Error('Game not found');
    return game;
  }

  async updateGameBranding(gameId, brandingData) {
    const fields = [];
    const values = [];
    
    const allowedFields = [
      'logo_url', 'logo_position', 'logo_size', 'primary_color', 
      'secondary_color', 'accent_color', 'background_style', 'font_family',
      'default_question_time', 'max_groups', 'show_timer', 'show_scores', 
      'auto_advance', 'game_description'
    ];
    
    for (const field of allowedFields) {
      if (brandingData.hasOwnProperty(field)) {
        fields.push(`${field} = ?`);
        values.push(brandingData[field]);
      }
    }
    
    if (fields.length === 0) {
      throw new Error('No valid branding fields provided');
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(gameId);
    
    await this.db.run(
      `UPDATE games SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    
    return this.getGameBranding(gameId);
  }

  async resetGameBranding(gameId) {
    const defaultBranding = {
      logo_url: null,
      logo_position: 'top-right',
      logo_size: 'medium',
      primary_color: '#667eea',
      secondary_color: '#764ba2',
      accent_color: '#FFD700',
      background_style: 'gradient',
      font_family: 'Segoe UI',
      default_question_time: 30,
      max_groups: 8,
      show_timer: 1,
      show_scores: 1,
      auto_advance: 0,
      game_description: ''
    };
    
    return this.updateGameBranding(gameId, defaultBranding);
  }

  // Scoring Settings Methods
  async updateScoringSettings(gameId, settings) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    await this.db.run(
      'UPDATE games SET time_based_scoring = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [settings.timeBasedScoring ? 1 : 0, gameId]
    );

    return this.getGame(gameId);
  }

  async getScoringSettings(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    return {
      timeBasedScoring: Boolean(game.time_based_scoring)
    };
  }

  // Virtual Buzzer Settings Methods
  async updateVirtualBuzzerSettings(gameId, settings) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    await this.db.run(
      'UPDATE games SET virtual_buzzers_enabled = ?, buzzer_offline_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [settings.virtualBuzzersEnabled ? 1 : 0, settings.buzzerOfflineThreshold || 120, gameId]
    );

    return this.getGame(gameId);
  }

  async getVirtualBuzzerSettings(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    return {
      virtualBuzzersEnabled: Boolean(game.virtual_buzzers_enabled),
      buzzerOfflineThreshold: game.buzzer_offline_threshold || 120
    };
  }

  // Buzzer Activity Tracking Methods
  updateBuzzerActivity(buzzerId, groupId) {
    this.buzzerActivity.set(buzzerId, {
      groupId: groupId,
      lastSeen: Date.now(),
      isPhysical: !buzzerId.startsWith('virtual_')
    });
  }

  // Update online buzzer status (called from ESP32 events)
  updateBuzzerOnlineStatus(buzzerId, isOnline) {
    if (isOnline) {
      this.onlineBuzzers.add(buzzerId.toString());
    } else {
      this.onlineBuzzers.delete(buzzerId.toString());
    }
  }

  // Get current online buzzer IDs
  getOnlineBuzzerIds() {
    return Array.from(this.onlineBuzzers);
  }

  async getAvailableTeamsForVirtual(gameId) {
    const game = await this.getGame(gameId);
    if (!game || !game.virtual_buzzers_enabled) {
      return [];
    }

    const onlineBuzzerIds = this.getOnlineBuzzerIds();
    
    return game.groups.filter(team => {
      // Team is available if its buzzer_id is NOT in the online buzzers list
      const teamBuzzerId = team.buzzer_id?.toString();
      const hasOnlinePhysicalBuzzer = teamBuzzerId && onlineBuzzerIds.includes(teamBuzzerId);
      
      return !hasOnlinePhysicalBuzzer;
    });
  }

  // Global Game Management Methods
  async setCurrentGlobalGame(gameId) {
    if (gameId) {
      const game = await this.getGame(gameId);
      this.currentGlobalGame = gameId;
      
      // Notify all connected clients about the new global game
      this.io.emit('global-game-changed', {
        gameId: gameId,
        game: game
      });
      
      return game;
    } else {
      this.currentGlobalGame = null;
      this.io.emit('global-game-changed', {
        gameId: null,
        game: null
      });
      return null;
    }
  }

  getCurrentGlobalGame() {
    return this.currentGlobalGame;
  }

  async getCurrentGlobalGameData() {
    if (!this.currentGlobalGame) {
      return null;
    }
    return await this.getGame(this.currentGlobalGame);
  }

  // This method should be called when a client connects to get the current global game
  async getGlobalGameStatus() {
    if (!this.currentGlobalGame) {
      return { gameId: null, game: null };
    }
    
    const game = await this.getGame(this.currentGlobalGame);
    return { gameId: this.currentGlobalGame, game };
  }
}

module.exports = GameService;